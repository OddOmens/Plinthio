import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, invalidateUserCache, signMediaToken } from '../middleware/auth.js';
import { scanLibrary } from '../services/scanner.js';
import { logger } from '../services/logger.js';
import { LIBRARY_TYPES, resolveLibraryPath, listMediaDirectories } from './libraries.js';
import { ALL_MEDIA_TYPES } from '../config/mediaTypes.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { normalizeUsername, USERNAME_RULE } from '../utils/username.js';
import { requestLocation, outsideAccessError, saveNetworkSettings } from '../services/network.js';
import {
  newSecret, otpauthUri, verifyTotp, sealSecret, openSecret, newRecoveryCodes, useRecoveryCode,
  recoveryCodesLeft, createChallenge, takeChallengeAttempt, endChallenge
} from '../services/twoFactor.js';

const router = express.Router();
const VALID_ROLES = ['admin', 'editor', 'viewer'];
// A throwaway hash at the same cost factor as real ones (see the unknown-user login path).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Check if initial admin account has been set up
router.get('/setup-status', async (req, res) => {
  try {
    const db = await getDb();
    const countResult = await db.get('SELECT COUNT(*) as count FROM users');
    res.json({ isSetup: countResult.count > 0 });
  } catch (err) {
    // These auth routes are reachable without a token, so the raw error (SQL text, file
    // paths) must stay server-side — it's in the container logs, not the HTTP response.
    console.error('[auth] setup-status failed:', err);
    res.status(500).json({ error: 'Could not read server setup status' });
  }
});

// Folder picker for the first-run wizard. Unauthenticated by necessity (no account exists
// yet), but hard-gated on the server being un-set-up — the same window in which anyone who
// can reach the server could already claim the admin account, so this grants no new
// capability, and it closes permanently the moment setup completes.
// First-run setup claims the admin account, so it's only ever done from the home network
// (or Tailscale): a server exposed to the internet before it's set up can't be taken over.
async function setupFromOutside(req) {
  return (await requestLocation(req)).where === 'outside';
}

router.get('/setup/browse', async (req, res) => {
  try {
    if (await setupFromOutside(req)) return sendError(req, res, 'P109', { message: 'Set Plinthio up from your home network' });
    const db = await getDb();
    const countResult = await db.get('SELECT COUNT(*) as count FROM users');
    if (countResult.count > 0) {
      return res.status(403).json({ error: 'Server is already set up' });
    }
    res.json(listMediaDirectories(req.query.dir));
  } catch (err) {
    // A folder that can't be read (disconnected drive → EIO) gets its library code (P201).
    serverError(req, res, err, 'Could not list folders');
  }
});

// Initial Setup Wizard - Creates the first Admin user and bootstraps server configuration.
// Only one setup can run at a time: without this, two requests arriving together (the
// owner's wizard and anyone else on the network) could both see "no users yet" during the
// bcrypt hashing below and both create an admin account.
let setupInFlight = false;

router.post('/setup', async (req, res) => {
  const { username, password, theme = 'dark', serverName, enabledMediaTypes, libraries = [], extraUsers = [], access = {} } = req.body;

  if (await setupFromOutside(req)) {
    return sendError(req, res, 'P109', { message: 'Set Plinthio up from your home network' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Admin username and password (min 8 chars) are required' });
  }
  const adminName = normalizeUsername(username);
  if (!adminName) {
    return res.status(400).json({ error: USERNAME_RULE });
  }
  if (setupInFlight) {
    return res.status(409).json({ error: 'Setup is already in progress' });
  }

  setupInFlight = true;
  let inTransaction = false;
  let db;
  try {
    db = await getDb();
    const countResult = await db.get('SELECT COUNT(*) as count FROM users');

    if (countResult.count > 0) {
      return res.status(400).json({ error: 'Server is already set up. Please log in.' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const mediaTypes = Array.isArray(enabledMediaTypes) && enabledMediaTypes.length > 0
      ? enabledMediaTypes.filter((t) => ALL_MEDIA_TYPES.includes(t))
      : ALL_MEDIA_TYPES;

    // The setup wizard already walks the admin through theme, accent and media types, so
    // mark onboarding done for them — otherwise they'd be asked the same questions twice in
    // a row. Accounts created below (and any added later) deliberately omit the flag so they
    // get the onboarding on their own first login.
    const adminPrefs = JSON.stringify({
      theme: theme === 'light' ? 'light' : 'dark',
      enabledMediaTypes: mediaTypes.length > 0 ? mediaTypes : ALL_MEDIA_TYPES,
      defaultView: 'all',
      onboardingComplete: true
    });

    // Extra accounts are validated and hashed before anything is written, and a name that
    // repeats one already taken is skipped — so a typo in the wizard can't leave the server
    // half set up (admin created, then a UNIQUE failure) behind an error message.
    const takenNames = new Set([adminName]);
    const extraRows = [];
    for (const u of Array.isArray(extraUsers) ? extraUsers : []) {
      const name = normalizeUsername(u?.username);
      if (!name || takenNames.has(name) || typeof u.password !== 'string' || u.password.length < 8) continue;
      takenNames.add(name);
      extraRows.push({
        id: crypto.randomUUID(),
        username: name,
        hash: await bcrypt.hash(u.password, 10),
        role: VALID_ROLES.includes(u.role) ? u.role : 'viewer'
      });
    }

    const libraryRows = [];
    for (const lib of Array.isArray(libraries) ? libraries : []) {
      if (!lib || typeof lib.name !== 'string' || !lib.name.trim() || typeof lib.path !== 'string' || !lib.path) continue;
      if (!LIBRARY_TYPES.includes(lib.type)) continue;
      // Same normalization the Admin "Add Library" path gets, so a host-style path
      // typed during setup (/media/you/Drive/Books) still resolves to the container's
      // mount (/media/Books) instead of silently scanning nothing.
      libraryRows.push({ id: crypto.randomUUID(), name: lib.name.trim(), path: resolveLibraryPath(lib.path), type: lib.type });
    }

    await db.run('BEGIN IMMEDIATE');
    inTransaction = true;

    await db.run(
      'INSERT INTO users (id, username, password_hash, role, preferences) VALUES (?, ?, ?, ?, ?)',
      [userId, adminName, passwordHash, 'admin', adminPrefs]
    );

    // Save Server Name if provided
    if (typeof serverName === 'string' && serverName.trim()) {
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('server_name', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [serverName.trim()]
      );
    }

    for (const lib of libraryRows) {
      await db.run('INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)', [lib.id, lib.name, lib.path, lib.type]);
    }

    // Who can reach the server from where (Admin → Network). A new server is home-only unless
    // the wizard's Access step opened it up.
    await saveNetworkSettings(db, {
      remoteAccess: access.remoteAccess === true,
      tailscaleIsHome: access.tailscaleIsHome !== false,
      require2faOutside: access.require2faOutside === true
    });

    const userPrefs = JSON.stringify({ theme: 'dark', enabledMediaTypes: mediaTypes.length > 0 ? mediaTypes : ALL_MEDIA_TYPES, defaultView: 'all' });
    for (const u of extraRows) {
      await db.run(
        'INSERT INTO users (id, username, password_hash, role, preferences) VALUES (?, ?, ?, ?, ?)',
        [u.id, u.username, u.hash, u.role, userPrefs]
      );
    }

    await db.run('COMMIT');
    inTransaction = false;

    // Kick off each new library's first scan. Without it the wizard finishes and drops the
    // user on a completely empty shelf with no indication anything is missing. Scans run in
    // the background so setup returns immediately.
    for (const lib of libraryRows) {
      scanLibrary(lib.id).catch((err) =>
        logger.error('scan', `Initial scan failed for "${lib.name}": ${err.message}`, { libraryId: lib.id })
      );
    }

    const token = jwt.sign(
      { userId, username: adminName, role: 'admin', tokenVersion: 0 },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      message: 'Server initialized successfully',
      token,
      mediaToken: signMediaToken({ id: userId, token_version: 0 }),
      user: { id: userId, username: adminName, role: 'admin', avatar: null, expires_at: null, preferences: JSON.parse(adminPrefs) }
    });
  } catch (err) {
    if (inTransaction) {
      await db.run('ROLLBACK').catch(() => {});
    }
    console.error('[auth] setup failed:', err);
    res.status(500).json({ error: 'Server setup failed. Check the server logs for details.' });
  } finally {
    setupInFlight = false;
  }
});

// The session a successful sign-in gets, as the login and two-factor routes both return it.
async function issueSession(req, res, db, user, where) {
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  const ip = req.ip;
  await db.run(
    'UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?, last_login_network = ? WHERE id = ?',
    [ip, where, user.id]
  );
  await recordLoginAttempt(db, { userId: user.id, username: user.username, success: true, ip, userAgent: req.headers['user-agent'] || null, network: where });
  logger.info('auth', `"${user.username}" signed in${where === 'home' ? '' : ` (${where === 'tailscale' ? 'Tailscale' : 'outside the home network'})`}`, { ip });

  let preferences = { enabledMediaTypes: ALL_MEDIA_TYPES, defaultView: 'all' };
  if (user.preferences) {
    try { preferences = JSON.parse(user.preferences); } catch (e) {}
  }
  res.json({
    token,
    mediaToken: signMediaToken(user),
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      avatar: user.avatar || null,
      expires_at: user.expires_at || null,
      preferences
    }
  });
}

// Login. Checked in this order:
//   1. a home-only server refuses outside sign-ins before looking at the password, so the
//      internet can't even guess passwords (P109)
//   2. the password (P107), and whether the account has expired (P103)
//   3. a home-only account from outside (P110)
//   4. two-factor: an account with it gets a challenge to answer at /login/2fa instead of a
//      session; one without it, signing in from outside where two-factor is required, is
//      told to set it up at home (P112)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || null;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const db = await getDb();
    const loc = await requestLocation(req);
    if (loc.away && !loc.settings.remoteAccess) {
      logger.warn('auth', `Refused an outside sign-in for "${username.trim().slice(0, 64)}": the server is home-only`, { ip });
      return sendError(req, res, 'P109');
    }

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);

    if (!user) {
      // Burn the same bcrypt time a real account would, so response timing doesn't reveal
      // which usernames exist.
      await bcrypt.compare(password, DUMMY_HASH);
      await recordLoginAttempt(db, { userId: null, username: username.trim().slice(0, 64), success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', `Failed sign-in attempt for unknown username "${username.trim()}"`, { ip });
      return sendError(req, res, 'P107');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', `Failed sign-in attempt for "${user.username}" (wrong password)`, { ip });
      return sendError(req, res, 'P107');
    }

    if (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', `Failed sign-in attempt for expired account "${user.username}"`, { ip });
      return sendError(req, res, 'P103');
    }

    const blocked = await outsideAccessError(req, user);
    if (blocked) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', `Refused an outside sign-in for home-only account "${user.username}"`, { ip });
      return sendError(req, res, blocked);
    }

    if (user.totp_enabled_at) {
      const challenge = createChallenge(user, { where: loc.where });
      return res.json({ twoFactorRequired: true, challenge });
    }
    if (loc.away && loc.settings.require2faOutside) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', `Refused an outside sign-in for "${user.username}": two-factor is required away from home and isn't set up`, { ip });
      return sendError(req, res, 'P112');
    }

    await issueSession(req, res, db, user, loc.where);
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'Login failed. Check the server logs for details.' });
  }
});

// The second half of a two-factor sign-in: the challenge from /login plus a code from the
// authenticator app, or one of the backup codes. Five tries per challenge (P113 after that),
// under the same rate limit as /login.
router.post('/login/2fa', async (req, res) => {
  const { challenge, code, recoveryCode } = req.body || {};
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || null;
  const pending = takeChallengeAttempt(challenge);
  if (!pending) return sendError(req, res, 'P113');

  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [pending.userId]);
    // The account changed under the challenge (password reset, sign out everywhere, two-
    // factor turned off, expired): start over.
    if (!user || (user.token_version || 0) !== pending.tokenVersion || !user.totp_enabled_at ||
        (user.expires_at && new Date(user.expires_at).getTime() <= Date.now())) {
      endChallenge(challenge);
      return sendError(req, res, 'P113');
    }
    const blocked = await outsideAccessError(req, user);
    if (blocked) {
      endChallenge(challenge);
      return sendError(req, res, blocked);
    }

    let ok = false;
    if (recoveryCode) {
      const updated = useRecoveryCode(user.totp_recovery, recoveryCode);
      if (updated) {
        await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [updated, user.id]);
        logger.warn('auth', `"${user.username}" signed in with a backup code (${recoveryCodesLeft(updated)} left)`, { ip });
        ok = true;
      }
    } else {
      const secret = openSecret(user.totp_secret);
      const step = secret ? verifyTotp(secret, code, { lastStep: user.totp_last_step }) : null;
      if (step !== null) {
        // Only if no other request used this step meanwhile: each code works once.
        const claimed = await db.run(
          'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
          [step, user.id, step]
        );
        ok = claimed.changes === 1;
      }
    }

    if (!ok) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: pending.where });
      logger.warn('auth', `Wrong two-factor code for "${user.username}"`, { ip });
      return sendError(req, res, 'P111');
    }

    endChallenge(challenge);
    await issueSession(req, res, db, user, (await requestLocation(req)).where);
  } catch (err) {
    console.error('[auth] two-factor sign-in failed:', err);
    res.status(500).json({ error: 'Sign-in failed. Check the server logs for details.' });
  }
});

// What the sign-in page needs to know before anyone signs in: whether this device is
// outside the home network, and if so whether that's allowed at all.
router.get('/access', async (req, res) => {
  try {
    const loc = await requestLocation(req);
    res.json({
      where: loc.where,
      away: loc.away,
      allowed: !loc.away || loc.settings.remoteAccess,
      twoFactorRequired: loc.away && loc.settings.require2faOutside
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

async function recordLoginAttempt(db, { userId, username, success, ip, userAgent, network = null }) {
  try {
    await db.run(
      'INSERT INTO login_history (user_id, username, success, ip_address, user_agent, network) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, username, success ? 1 : 0, ip, userAgent, network]
    );
  } catch (err) {
    // Never let sign-in tracking break the actual login flow
    console.error('[auth] failed to record login history:', err);
  }
}

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Exchange a still-valid token for a fresh one. The app calls this on load, which is what
// makes a shorter token lifetime workable: someone who opens Plinthio regularly is never
// signed out, while a token copied off a shared machine stops working within the window
// rather than a month later.
router.post('/refresh', authenticateToken, (req, res) => {
  const token = jwt.sign(
    {
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      tokenVersion: req.user.token_version || 0
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  res.json({ token, mediaToken: signMediaToken(req.user), user: req.user });
});

// Just a fresh media token, for a long-lived tab whose current one is close to expiring.
router.post('/media-token', authenticateToken, (req, res) => {
  if (req.isApiKey) {
    return res.status(400).json({ error: 'API keys authenticate media requests directly' });
  }
  res.json({ mediaToken: signMediaToken(req.user) });
});

// Invalidate every token issued for this account, this one included — the "signed in
// somewhere I shouldn't be" button. Bumping token_version is the same mechanism a password
// change uses, so it revokes instantly rather than waiting for expiry.
router.post('/sign-out-everywhere', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [req.user.id]
    );
    invalidateUserCache(req.user.id);
    logger.info('auth', `"${req.user.username}" signed out all sessions`);
    res.json({ message: 'All sessions signed out. Please sign in again.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Two-factor: turning it on and off, for your own account ─────────────────────────────
// Only with a signed-in session, never an API key: a key handed to a reading app mustn't be
// able to change how the account signs in.
function sessionOnly(req, res, next) {
  if (req.isApiKey) return res.status(403).json({ error: 'Sign in with your password to change two-factor' });
  next();
}

async function twoFactorStatus(db, userId) {
  const row = await db.get('SELECT totp_enabled_at, totp_recovery FROM users WHERE id = ?', [userId]);
  return {
    enabled: !!row?.totp_enabled_at,
    enabledAt: row?.totp_enabled_at || null,
    recoveryCodesLeft: row?.totp_enabled_at ? recoveryCodesLeft(row.totp_recovery) : 0
  };
}

router.get('/2fa', authenticateToken, sessionOnly, async (req, res) => {
  try {
    res.json(await twoFactorStatus(await getDb(), req.user.id));
  } catch (err) {
    serverError(req, res, err);
  }
});

// Step 1: a new secret, held as pending until a code from it is confirmed. Returns the
// otpauth:// link (the app shows it as a QR code) and the secret for typing in by hand.
router.post('/2fa/setup', authenticateToken, sessionOnly, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
    if (row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is already on. Turn it off first to set it up again.' });
    const secret = newSecret();
    await db.run('UPDATE users SET totp_pending = ? WHERE id = ?', [sealSecret(secret), req.user.id]);
    const name = (await db.get("SELECT value FROM settings WHERE key = 'server_name'"))?.value?.trim() || 'Plinthio';
    res.json({ secret, uri: otpauthUri(secret, { issuer: name, account: req.user.username }) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Step 2: a code from the app proves it's set up; two-factor goes on and the backup codes
// are shown, once.
router.post('/2fa/enable', authenticateToken, sessionOnly, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT totp_pending, totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
    if (row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is already on' });
    const secret = openSecret(row?.totp_pending);
    if (!secret) return res.status(400).json({ error: 'Start setting up two-factor first' });
    const step = verifyTotp(secret, req.body?.code);
    if (step === null) return sendError(req, res, 'P111');
    const { codes, stored } = newRecoveryCodes();
    await db.run(
      `UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled_at = CURRENT_TIMESTAMP,
         totp_last_step = ?, totp_recovery = ? WHERE id = ?`,
      [sealSecret(secret), step, stored, req.user.id]
    );
    logger.info('auth', `"${req.user.username}" turned on two-factor sign-in`);
    res.json({ ...(await twoFactorStatus(db, req.user.id)), recoveryCodes: codes });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Checks the password and a current code (or a backup code), for turning two-factor off or
// getting new backup codes: someone at an unlocked, signed-in browser can't do either.
async function confirmIdentity(db, req, { needCode }) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const { password, code, recoveryCode } = req.body || {};
  if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) return 'P107';
  if (!needCode || !user.totp_enabled_at) return null;
  if (recoveryCode) {
    const updated = useRecoveryCode(user.totp_recovery, recoveryCode);
    if (!updated) return 'P111';
    await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [updated, user.id]);
    return null;
  }
  const secret = openSecret(user.totp_secret);
  const step = secret ? verifyTotp(secret, code, { lastStep: user.totp_last_step }) : null;
  if (step === null) return 'P111';
  await db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, user.id]);
  return null;
}

router.post('/2fa/disable', authenticateToken, sessionOnly, async (req, res) => {
  try {
    const db = await getDb();
    const problem = await confirmIdentity(db, req, { needCode: true });
    if (problem) return sendError(req, res, problem);
    await db.run(
      'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = NULL WHERE id = ?',
      [req.user.id]
    );
    logger.warn('auth', `"${req.user.username}" turned off two-factor sign-in`);
    res.json(await twoFactorStatus(db, req.user.id));
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/2fa/recovery-codes', authenticateToken, sessionOnly, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
    if (!row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is off' });
    const problem = await confirmIdentity(db, req, { needCode: true });
    if (problem) return sendError(req, res, problem);
    const { codes, stored } = newRecoveryCodes();
    await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [stored, req.user.id]);
    logger.info('auth', `"${req.user.username}" made new two-factor backup codes`);
    res.json({ ...(await twoFactorStatus(db, req.user.id)), recoveryCodes: codes });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
