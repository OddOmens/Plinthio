import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import net from 'net';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import {
  authenticateToken, invalidateUserCache, requireSession, signMediaToken, signSessionToken,
  FailureLock, confirmLock, checkOwnPassword, noteConfirmFailure, sendConfirmProblem
} from '../middleware/auth.js';
import { scanLibrary } from '../services/scanner.js';
import { logger } from '../services/logger.js';
import { LIBRARY_TYPES, resolveLibraryPath, listMediaDirectories } from './libraries.js';
import { ALL_MEDIA_TYPES } from '../config/mediaTypes.js';
import { handle, serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { normalizeUsername, USERNAME_RULE } from '../utils/username.js';
import { requestLocation, outsideAccessError, saveNetworkSettings, UNTRUSTED_PROXY_HINT } from '../services/network.js';
import { isPrivateHostName, tlsSettings } from '../services/tls.js';
import {
  newSecret, otpauthUri, verifyTotp, sealSecret, openSecret, newRecoveryCodes, useRecoveryCode,
  recoveryCodesLeft, createChallenge, takeChallengeAttempt, endChallenge
} from '../services/twoFactor.js';
import { getSetting, setSetting } from '../services/settings.js';

const router = express.Router();
const VALID_ROLES = ['admin', 'editor', 'viewer'];
// A throwaway hash at the same cost factor as real ones (see the unknown-user login path).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

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

// A web page on another site, opened by someone on the home network, could otherwise POST
// here while no admin exists yet and claim the server. The setup wizard is always
// same-origin; non-browser clients send no Origin at all. Where the browser says outright
// how the request relates to the page (Sec-Fetch-Site, which a page can't forge), that
// settles it; otherwise the page's origin has to be the address the request was sent to.
function crossSiteRequest(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

// Comparing the page's origin with the Host header isn't enough on its own: a page on
// evil.example can point its own name at 192.168.1.5 a moment after loading (DNS
// rebinding), and then the browser calls it same-origin while the request lands on this
// server. What the attacker can't do is make that name anything but a public one. So until
// the server is set up, it only answers under an address nobody outside could have pointed
// here: an IP address, localhost, a bare machine name, a home-network name (.local, .lan,
// .home, .home.arpa, .internal), a Tailscale name, or one the admin listed in TLS_HOSTNAMES.
function hostWithoutPort(raw) {
  const host = String(raw || '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']') === -1 ? undefined : host.indexOf(']'));
  return host.replace(/:\d+$/, '');
}

function isSetupHost(raw) {
  const name = hostWithoutPort(raw);
  if (!name) return false;
  if (net.isIP(name)) return true;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) return false;
  return !name.includes('.') || isPrivateHostName(name) || name.endsWith('.ts.net') || tlsSettings.extraNames.includes(name);
}

// Why first-run setup can't be done by this request: { code, message }, or null when it can.
async function setupRefusal(req) {
  if (crossSiteRequest(req)) return { code: 'P003', message: 'Set Plinthio up from its own page' };
  // Both the name the browser asked for and, behind a trusted proxy, the one it forwarded.
  if (!isSetupHost(req.headers.host) || !isSetupHost(req.hostname)) {
    return {
      code: 'P003',
      message: 'For first-time setup, open Plinthio by its IP address (for example http://192.168.1.20:8088) instead of a domain name'
    };
  }
  const loc = await requestLocation(req);
  if (loc.where === 'outside') {
    return { code: 'P109', message: loc.untrustedProxy ? `Set Plinthio up from your home network. ${UNTRUSTED_PROXY_HINT}` : 'Set Plinthio up from your home network' };
  }
  return null;
}

router.get('/setup/browse', async (req, res) => {
  try {
    const refusal = await setupRefusal(req);
    if (refusal) return sendError(req, res, refusal.code, { message: refusal.message });
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

  const refusal = await setupRefusal(req);
  if (refusal) {
    return sendError(req, res, refusal.code, { message: refusal.message });
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

    if (typeof serverName === 'string' && serverName.trim()) {
      await setSetting(db, 'server_name', serverName.trim());
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

    const token = signSessionToken({ id: userId, username: adminName, role: 'admin', token_version: 0 });

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
  const token = signSessionToken(user);
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
      // As /auth/me reports it, so screens that differ for a Kids Mode account are right
      // from the first sign-in, not only after the session next refreshes.
      kids_mode: user.kids_mode ? 1 : 0,
      preferences
    }
  });
}

// Login. Checked in this order:
//   1. a home-only server refuses outside sign-ins before looking at the password, so the
//      internet can't even guess passwords (P109)
//   2. the password (P107), and whether the account has expired (P103)
//   3. a home-only account from outside
//   4. two-factor: an account with it gets a challenge to answer at /login/2fa instead of a
//      session; one without it, signing in from outside where two-factor is required, is
//      refused
// From outside, 3, 4's refusal and an expired account all answer exactly like a wrong
// password (P107) and count as one: "this account is home-only" said only after the right
// password would tell someone guessing that they'd found it. The real reason goes to the log
// (Admin → Logs) and the sign-in history. At home each keeps its own message.
//
// Per-account limit on wrong passwords from outside the home network, on top of the per-
// address limit in index.js: guessing spread over many addresses still stops after
// OUTSIDE_FAILS_PER_ACCOUNT tries in the window. Sign-ins from home are never held back, so
// someone on the internet can't lock the household out of its own accounts.
const OUTSIDE_FAILS_PER_ACCOUNT = 10;
const OUTSIDE_FAIL_WINDOW_MS = 15 * 60 * 1000;
const outsideFails = new Map();

function outsideFailKey(username) {
  return username.trim().toLowerCase().slice(0, 64);
}

function outsideLocked(username) {
  const entry = outsideFails.get(outsideFailKey(username));
  if (!entry) return false;
  if (Date.now() - entry.since > OUTSIDE_FAIL_WINDOW_MS) {
    outsideFails.delete(outsideFailKey(username));
    return false;
  }
  return entry.count >= OUTSIDE_FAILS_PER_ACCOUNT;
}

function noteOutsideFail(username) {
  const key = outsideFailKey(username);
  const now = Date.now();
  const entry = outsideFails.get(key);
  if (entry && now - entry.since <= OUTSIDE_FAIL_WINDOW_MS) {
    entry.count += 1;
    return;
  }
  if (outsideFails.size >= 10000) {
    for (const [k, e] of outsideFails) if (now - e.since > OUTSIDE_FAIL_WINDOW_MS) outsideFails.delete(k);
    if (outsideFails.size >= 10000) outsideFails.delete(outsideFails.keys().next().value);
  }
  outsideFails.set(key, { count: 1, since: now });
}

// Wrong two-factor codes, per account. The per-address limit and the five tries a challenge
// allows don't add up to much on their own: every correct password starts a fresh challenge,
// and addresses are cheap. Ten wrong codes in 15 minutes hold code entry for that account for
// 15 minutes, longer each time it happens again. Counted separately for home and away, so
// someone outside who has the password can't keep the owner from signing in at home.
const codeLock = new FailureLock();
const codeLockKey = (userId, away) => `${userId}:${away ? 'away' : 'home'}`;

// A username nobody has is often not a username at all: a password typed into the wrong box,
// or pasted with the username. Sign-in history and the logs are kept, shown to admins and
// copied into backups, so for a name that matches no account only its first two characters
// and its length are recorded. A real account's name is recorded as it is.
export function maskUnknownUsername(raw) {
  const name = String(raw || '').trim();
  const length = [...name].length;
  return `${[...name].slice(0, 2).join('')}… (${length} character${length === 1 ? '' : 's'}, no such account)`;
}

// Signing in is only for Plinthio's own page (and apps, which send no Origin). A page on
// another site can't read the answer unless CORS_ORIGIN lets it, but with it opened to
// everyone (`*`) any site someone visits could try passwords against the server from inside
// their home network. Origins the admin listed by name in CORS_ORIGIN are let through:
// that's what listing them is for. Without Sec-Fetch-Site (plain http, older browsers) the
// only evidence is Origin against Host, which a reverse proxy that rewrites Host would trip
// for the real page too; browsers already stop a cross-site JSON request unless CORS is open
// to everyone, so that comparison is only used then.
function crossSiteSignIn(req) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  const allowed = config.corsOrigin;
  if (origin && allowed && allowed !== '*' && [].concat(allowed).includes(origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'cross-site';
  return allowed === '*' && crossSiteRequest(req);
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || null;

  if (crossSiteSignIn(req)) {
    return sendError(req, res, 'P003', { message: 'Sign in from Plinthio\'s own page' });
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const db = await getDb();
    const loc = await requestLocation(req);
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    // What the logs and the sign-in history call whoever this is.
    const shown = user ? user.username : maskUnknownUsername(username);

    if (loc.away && !loc.settings.remoteAccess) {
      logger.warn('auth', `Refused an outside sign-in for "${shown}": the server is home-only${loc.untrustedProxy ? ' (the request came through a reverse proxy that TRUST_PROXY does not cover, so it counts as outside)' : ''}`, { ip });
      return sendError(req, res, 'P109', loc.untrustedProxy
        ? { message: `This server can only be used from its home network. ${UNTRUSTED_PROXY_HINT}` }
        : {});
    }

    if (loc.away && outsideLocked(username)) {
      logger.warn('auth', `Held back an outside sign-in for "${shown}": too many wrong passwords`, { ip });
      return sendError(req, res, 'P108');
    }

    // A failed sign-in: recorded, logged with the real reason, and counted against the
    // account when it came from outside.
    const fail = async (reason, code = 'P107') => {
      if (loc.away) noteOutsideFail(username);
      await recordLoginAttempt(db, { userId: user?.id || null, username: shown, success: false, ip, userAgent, network: loc.where });
      logger.warn('auth', reason, { ip });
      return sendError(req, res, loc.away ? 'P107' : code);
    };

    if (!user) {
      // Burn the same bcrypt time a real account would, so response timing doesn't reveal
      // which usernames exist.
      await bcrypt.compare(password, DUMMY_HASH);
      return fail(`Failed sign-in attempt for unknown username "${shown}"`);
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return fail(`Failed sign-in attempt for "${user.username}" (wrong password)`);
    }

    if (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) {
      return fail(`Failed sign-in attempt for expired account "${user.username}"`, 'P103');
    }

    const blocked = await outsideAccessError(req, user);
    if (blocked) {
      return fail(`Refused an outside sign-in for home-only account "${user.username}" (the password was right; they were told only that sign-in failed)`, blocked);
    }

    if (user.totp_enabled_at) {
      const challenge = createChallenge(user, { where: loc.where });
      return res.json({ twoFactorRequired: true, challenge });
    }
    if (loc.away && loc.settings.require2faOutside) {
      return fail(`Refused an outside sign-in for "${user.username}": two-factor is required away from home and isn't set up (the password was right; they were told only that sign-in failed)`, 'P112');
    }

    await issueSession(req, res, db, user, loc.where);
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'Login failed. Check the server logs for details.' });
  }
});

// The second half of a two-factor sign-in: the challenge from /login plus a code from the
// authenticator app, or one of the backup codes. Five tries per challenge (P113 after that),
// under the same rate limit as /login, and ten wrong codes per account (codeLock above).
router.post('/login/2fa', async (req, res) => {
  const { challenge, code, recoveryCode } = req.body || {};
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || null;
  if (crossSiteSignIn(req)) {
    return sendError(req, res, 'P003', { message: 'Sign in from Plinthio\'s own page' });
  }
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

    const loc = await requestLocation(req);
    const lockKey = codeLockKey(user.id, loc.away);
    if (codeLock.heldFor(lockKey)) {
      endChallenge(challenge);
      logger.warn('auth', `Held back a two-factor code for "${user.username}": too many wrong codes`, { ip });
      return sendError(req, res, 'P108');
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
      // Whoever is entering codes already has the password, so from outside each wrong code
      // also counts towards holding back outside sign-ins for the account altogether.
      const result = codeLock.fail(lockKey);
      if (loc.away) noteOutsideFail(user.username);
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent, network: pending.where });
      logger.warn('auth', result.held
        ? `${result.count} wrong two-factor codes for "${user.username}" ${loc.away ? 'from outside' : 'at home'}: whoever is trying has the password. Code entry ${loc.away ? 'from outside' : 'at home'} is held for ${result.minutes} minutes`
        : `Wrong two-factor code for "${user.username}"`, { ip });
      return sendError(req, res, 'P111');
    }

    codeLock.succeed(lockKey);
    endChallenge(challenge);
    await issueSession(req, res, db, user, loc.where);
  } catch (err) {
    console.error('[auth] two-factor sign-in failed:', err);
    res.status(500).json({ error: 'Sign-in failed. Check the server logs for details.' });
  }
});

// What the sign-in page needs to know before anyone signs in: whether this device is
// outside the home network, and if so whether that's allowed at all.
router.get('/access', handle(async (req, res) => {
  const loc = await requestLocation(req);
  res.json({
    where: loc.where,
    away: loc.away,
    allowed: !loc.away || loc.settings.remoteAccess,
    twoFactorRequired: loc.away && loc.settings.require2faOutside
  });
}));

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

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Exchange a still-valid token for a fresh one. The app calls this on load, which is what
// makes a shorter token lifetime workable: someone who opens Plinthio regularly is never
// signed out, while a token copied off a shared machine stops working within the window
// rather than a month later.
router.post('/refresh', authenticateToken, requireSession, (req, res) => {
  const token = signSessionToken(req.user);
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
// change uses, so it revokes instantly rather than waiting for expiry. "Everywhere" includes
// the apps signed in with an API key (reading apps, scripts): the keys are deleted too, or a
// key copied off a lost device would go on working. Not something a key can do itself: a
// leaked key could otherwise sign its owner out of everything, over and over.
router.post('/sign-out-everywhere', authenticateToken, requireSession, handle(async (req, res) => {
  const db = await getDb();
  await db.run(
    'UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.user.id]
  );
  const keys = await db.run('DELETE FROM api_keys WHERE user_id = ?', [req.user.id]);
  invalidateUserCache(req.user.id);
  logger.info('auth', `"${req.user.username}" signed out all sessions${keys.changes ? ` and revoked ${keys.changes} API key${keys.changes === 1 ? '' : 's'}` : ''}`, { ip: req.ip });
  res.json({ message: 'All sessions signed out. Please sign in again.', apiKeysRevoked: keys.changes || 0 });
}));

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

router.get('/2fa', authenticateToken, sessionOnly, handle(async (req, res) => {
  res.json(await twoFactorStatus(await getDb(), req.user.id));
}));

// Step 1: a new secret, held as pending until a code from it is confirmed. Returns the
// otpauth:// link (the app shows it as a QR code) and the secret for typing in by hand.
// Needs the account's password (body: { password }): whoever turns two-factor on holds the
// only authenticator, so someone at an unlocked, signed-in browser could otherwise lock the
// owner out of their own account with a phone of their own.
router.post('/2fa/setup', authenticateToken, sessionOnly, handle(async (req, res) => {
  const db = await getDb();
  const row = await db.get('SELECT totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
  if (row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is already on. Turn it off first to set it up again.' });
  const problem = await checkOwnPassword(db, req, req.body?.password, 'turning on two-factor');
  if (problem) return sendConfirmProblem(req, res, problem);
  const secret = newSecret();
  await db.run('UPDATE users SET totp_pending = ? WHERE id = ?', [sealSecret(secret), req.user.id]);
  const name = (await getSetting(db, 'server_name'))?.trim() || 'Plinthio';
  res.json({ secret, uri: otpauthUri(secret, { issuer: name, account: req.user.username }) });
}));

// Step 2: a code from the app proves it's set up; two-factor goes on and the backup codes
// are shown, once.
router.post('/2fa/enable', authenticateToken, sessionOnly, handle(async (req, res) => {
  const db = await getDb();
  const row = await db.get('SELECT totp_pending, totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
  if (row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is already on' });
  const secret = openSecret(row?.totp_pending);
  if (!secret) return res.status(400).json({ error: 'Start setting up two-factor first' });
  const step = verifyTotp(secret, req.body?.code);
  if (step === null) {
    // Counted like a wrong password in a confirmation, so the code can't be guessed either.
    if (confirmLock.heldFor(req.user.id)) return sendConfirmProblem(req, res, 'P108');
    noteConfirmFailure(req, 'gave a wrong code while turning on two-factor');
    return sendError(req, res, 'P111');
  }
  const { codes, stored } = newRecoveryCodes();
  // Every other session is signed out (one started before two-factor, perhaps by whoever
  // made it necessary, shouldn't outlive it); this device gets a fresh token in the answer.
  await db.run(
    `UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled_at = CURRENT_TIMESTAMP,
         totp_last_step = ?, totp_recovery = ?, token_version = token_version + 1 WHERE id = ?`,
    [sealSecret(secret), step, stored, req.user.id]
  );
  invalidateUserCache(req.user.id);
  const user = { ...req.user, token_version: (req.user.token_version || 0) + 1 };
  const token = signSessionToken(user);
  logger.info('auth', `"${req.user.username}" turned on two-factor sign-in`);
  res.json({ ...(await twoFactorStatus(db, req.user.id)), recoveryCodes: codes, token, mediaToken: signMediaToken(user) });
}));

// Checks the password and a current code (or a backup code), for turning two-factor off or
// getting new backup codes: someone at an unlocked, signed-in browser can't do either. Wrong
// answers are counted per account (checkOwnPassword in middleware/auth.js), codes included:
// after ten in 15 minutes it answers P108 until the hold runs out.
async function confirmIdentity(db, req, { needCode, what }) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const { password, code, recoveryCode } = req.body || {};
  const problem = await checkOwnPassword(db, req, password, what);
  if (problem) return problem;
  if (!needCode || !user.totp_enabled_at) return null;
  if (recoveryCode) {
    const updated = useRecoveryCode(user.totp_recovery, recoveryCode);
    if (!updated) {
      noteConfirmFailure(req, `gave a wrong backup code while ${what}`);
      return 'P111';
    }
    await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [updated, user.id]);
    return null;
  }
  const secret = openSecret(user.totp_secret);
  const step = secret ? verifyTotp(secret, code, { lastStep: user.totp_last_step }) : null;
  if (step === null) {
    noteConfirmFailure(req, `gave a wrong two-factor code while ${what}`);
    return 'P111';
  }
  await db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, user.id]);
  return null;
}

router.post('/2fa/disable', authenticateToken, sessionOnly, handle(async (req, res) => {
  const db = await getDb();
  const problem = await confirmIdentity(db, req, { needCode: true, what: 'turning off two-factor' });
  if (problem) return sendConfirmProblem(req, res, problem);
  await db.run(
    'UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = NULL WHERE id = ?',
    [req.user.id]
  );
  // The signed-in account is remembered for a minute, including whether it has two-factor.
  invalidateUserCache(req.user.id);
  logger.warn('auth', `"${req.user.username}" turned off two-factor sign-in`);
  res.json(await twoFactorStatus(db, req.user.id));
}));

router.post('/2fa/recovery-codes', authenticateToken, sessionOnly, handle(async (req, res) => {
  const db = await getDb();
  const row = await db.get('SELECT totp_enabled_at FROM users WHERE id = ?', [req.user.id]);
  if (!row?.totp_enabled_at) return res.status(400).json({ error: 'Two-factor is off' });
  const problem = await confirmIdentity(db, req, { needCode: true, what: 'making new backup codes' });
  if (problem) return sendConfirmProblem(req, res, problem);
  const { codes, stored } = newRecoveryCodes();
  await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [stored, req.user.id]);
  logger.info('auth', `"${req.user.username}" made new two-factor backup codes`);
  res.json({ ...(await twoFactorStatus(db, req.user.id)), recoveryCodes: codes });
}));

export default router;
