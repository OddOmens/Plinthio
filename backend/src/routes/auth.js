import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, invalidateUserCache } from '../middleware/auth.js';
import { scanLibrary } from '../services/scanner.js';
import { logger } from '../services/logger.js';
import { LIBRARY_TYPES, resolveLibraryPath, listMediaDirectories } from './libraries.js';
import { ALL_MEDIA_TYPES } from '../config/mediaTypes.js';

const router = express.Router();
const VALID_ROLES = ['admin', 'editor', 'viewer'];

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
router.get('/setup/browse', async (req, res) => {
  try {
    const db = await getDb();
    const countResult = await db.get('SELECT COUNT(*) as count FROM users');
    if (countResult.count > 0) {
      return res.status(403).json({ error: 'Server is already set up' });
    }
    res.json(listMediaDirectories(req.query.dir));
  } catch (err) {
    console.error('[auth] setup browse failed:', err);
    res.status(500).json({ error: 'Could not list folders' });
  }
});

// Initial Setup Wizard - Creates the first Admin user and bootstraps server configuration
router.post('/setup', async (req, res) => {
  const { username, password, theme = 'dark', serverName, enabledMediaTypes, libraries = [], extraUsers = [] } = req.body;

  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Admin username and password (min 8 chars) are required' });
  }

  try {
    const db = await getDb();
    const countResult = await db.get('SELECT COUNT(*) as count FROM users');

    if (countResult.count > 0) {
      return res.status(400).json({ error: 'Server is already set up. Please log in.' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const mediaTypes = Array.isArray(enabledMediaTypes) && enabledMediaTypes.length > 0 
      ? enabledMediaTypes 
      : ALL_MEDIA_TYPES;

    // The setup wizard already walks the admin through theme, accent and media types, so
    // mark onboarding done for them — otherwise they'd be asked the same questions twice in
    // a row. Accounts created below (and any added later) deliberately omit the flag so they
    // get the onboarding on their own first login.
    const adminPrefs = JSON.stringify({
      theme: theme === 'light' ? 'light' : 'dark',
      enabledMediaTypes: mediaTypes,
      defaultView: 'all',
      onboardingComplete: true
    });

    await db.run(
      'INSERT INTO users (id, username, password_hash, role, preferences) VALUES (?, ?, ?, ?, ?)',
      [userId, username.trim(), passwordHash, 'admin', adminPrefs]
    );

    // Save Server Name if provided
    if (serverName && serverName.trim()) {
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('server_name', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [serverName.trim()]
      );
    }

    // Insert any initial libraries configured during setup, then kick off their first scan.
    // Without that scan the wizard finishes and drops the user on a completely empty shelf
    // with no indication anything is missing — the library rows exist but nothing has been
    // indexed yet. Scans run in the background so setup returns immediately.
    if (Array.isArray(libraries)) {
      for (const lib of libraries) {
        if (lib.name && lib.path && lib.type) {
          if (!LIBRARY_TYPES.includes(lib.type)) continue;
          const libId = crypto.randomUUID();
          // Same normalization the Admin "Add Library" path gets, so a host-style path
          // typed during setup (/media/you/Drive/Books) still resolves to the container's
          // mount (/media/Books) instead of silently scanning nothing.
          const resolvedPath = resolveLibraryPath(lib.path);
          await db.run(
            'INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
            [libId, lib.name.trim(), resolvedPath, lib.type]
          );
          scanLibrary(libId).catch((err) =>
            logger.error('scan', `Initial scan failed for "${lib.name}": ${err.message}`, { libraryId: libId })
          );
        }
      }
    }

    // Insert any extra users created during setup
    if (Array.isArray(extraUsers)) {
      for (const u of extraUsers) {
        if (u.username && u.password && u.password.length >= 8) {
          const uId = crypto.randomUUID();
          const uHash = await bcrypt.hash(u.password, 10);
          const uRole = VALID_ROLES.includes(u.role) ? u.role : 'viewer';
          const uPrefs = JSON.stringify({
            theme: 'dark',
            enabledMediaTypes: mediaTypes,
            defaultView: 'all'
          });
          await db.run(
            'INSERT INTO users (id, username, password_hash, role, preferences) VALUES (?, ?, ?, ?, ?)',
            [uId, u.username.trim(), uHash, uRole, uPrefs]
          );
        }
      }
    }

    const token = jwt.sign(
      { userId, username: username.trim(), role: 'admin', tokenVersion: 0 },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      message: 'Server initialized successfully',
      token,
      user: { id: userId, username: username.trim(), role: 'admin', preferences: JSON.parse(adminPrefs) }
    });
  } catch (err) {
    console.error('[auth] setup failed:', err);
    res.status(500).json({ error: 'Server setup failed. Check the server logs for details.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || null;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);

    if (!user) {
      await recordLoginAttempt(db, { userId: null, username: username.trim(), success: false, ip, userAgent });
      logger.warn('auth', `Failed sign-in attempt for unknown username "${username.trim()}"`, { ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await recordLoginAttempt(db, { userId: user.id, username: user.username, success: false, ip, userAgent });
      logger.warn('auth', `Failed sign-in attempt for "${user.username}" (wrong password)`, { ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0 },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    await db.run(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?',
      [ip, user.id]
    );
    await recordLoginAttempt(db, { userId: user.id, username: user.username, success: true, ip, userAgent });
    logger.info('auth', `"${user.username}" signed in`, { ip });

    let preferences = { enabledMediaTypes: ALL_MEDIA_TYPES, defaultView: 'all' };
    if (user.preferences) {
      try { preferences = JSON.parse(user.preferences); } catch (e) {}
    }

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, preferences }
    });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'Login failed. Check the server logs for details.' });
  }
});

async function recordLoginAttempt(db, { userId, username, success, ip, userAgent }) {
  try {
    await db.run(
      'INSERT INTO login_history (user_id, username, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [userId, username, success ? 1 : 0, ip, userAgent]
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
  res.json({ token, user: req.user });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
