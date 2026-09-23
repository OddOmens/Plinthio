import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';

const userAuthCache = new Map();
const AUTH_CACHE_TTL = 60 * 1000; // 60 seconds

// Call whenever a user's auth-relevant state changes server-side (password change bumping
// token_version, role change, deletion) so the change takes effect on their very next
// request instead of waiting up to AUTH_CACHE_TTL for the stale cache entry to expire.
export function invalidateUserCache(userId) {
  userAuthCache.delete(userId);
}

export async function authenticateToken(req, res, next) {
  // 1. Support X-API-Key for developer/script integrations
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    try {
      const db = await getDb();
      const keyHash = crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
      const keyRow = await db.get(
        `SELECT u.id, u.username, u.role, u.preferences
         FROM api_keys k
         JOIN users u ON k.user_id = u.id
         WHERE k.key = ?`,
        [keyHash]
      );
      if (keyRow) {
        keyRow.preferences = keyRow.preferences ? JSON.parse(keyRow.preferences) : {};
        req.user = keyRow;
        req.isApiKey = true;
        return next();
      }
    } catch (err) {
      console.error('API key auth error:', err);
    }
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  // 2. Support Bearer token or URL query token
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const now = Date.now();
    let user = null;

    const cached = userAuthCache.get(payload.userId);
    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      const db = await getDb();
      user = await db.get('SELECT id, username, role, preferences, token_version FROM users WHERE id = ?', [payload.userId]);

      if (!user) {
        return res.status(401).json({ error: 'User no longer exists' });
      }

      user.preferences = user.preferences ? JSON.parse(user.preferences) : {};
      userAuthCache.set(payload.userId, { user, expiresAt: now + AUTH_CACHE_TTL });
    }

    // A password change bumps token_version server-side, which immediately invalidates
    // every token issued before that change (rather than leaving a stolen/old token
    // valid for its full remaining lifetime).
    if ((payload.tokenVersion || 0) !== (user.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    req.user = user;
    next();
  } catch (err) {
    // Any jwt.verify failure (bad signature, malformed, expired) means this token can never
    // become valid again — 401 so the frontend's response interceptor clears it and bounces
    // to /login, instead of 403 which it doesn't treat as "log in again" and just retries
    // into the same dead token forever.
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

// Admins implicitly have every Editor right too.
export function requireEditor(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'editor')) {
    return res.status(403).json({ error: 'Editor privileges required' });
  }
  next();
}
