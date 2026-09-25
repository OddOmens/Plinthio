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

// Pulls the API key out of an HTTP Basic header. The username half is ignored for lookup
// (the key alone identifies the account) but readers still need to send something there.
function basicAuthApiKey(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator === -1 ? null : decoded.slice(separator + 1).trim() || null;
  } catch {
    return null;
  }
}

// Media URLs (<img>, <video>, <track>, OPDS page links) can't carry an Authorization
// header, so they authenticate with `?token=`. Anything in a URL leaks — browser history,
// proxy access logs, a copied link — so the URL never carries the session token itself: it
// carries a separate media token that only opens /api/media/* and expires within a day.
// Revocation still works because it's bound to the same token_version as the session.
const MEDIA_TOKEN_TYPE = 'media';
const MEDIA_TOKEN_TTL = process.env.MEDIA_TOKEN_EXPIRES_IN || '24h';

export function signMediaToken(user) {
  return jwt.sign(
    { userId: user.id, tokenVersion: user.token_version || 0, typ: MEDIA_TOKEN_TYPE },
    config.jwtSecret,
    { expiresIn: MEDIA_TOKEN_TTL }
  );
}

function isMediaRoute(req) {
  return (req.baseUrl || '').startsWith('/api/media');
}

export async function authenticateToken(req, res, next) {
  // 1. Support X-API-Key for developer/script integrations, and HTTP Basic (username +
  // API key as the password) for OPDS reader apps, which can't do Bearer tokens and
  // shouldn't be handed the real account password.
  const apiKey = req.headers['x-api-key'] || basicAuthApiKey(req);
  if (apiKey) {
    try {
      const db = await getDb();
      const keyHash = crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
      const keyRow = await db.get(
        `SELECT u.id, u.username, u.role, u.avatar, u.preferences, u.expires_at, u.max_age_rating, u.allow_unrated
         FROM api_keys k
         JOIN users u ON k.user_id = u.id
         WHERE k.key = ?`,
        [keyHash]
      );
      if (keyRow) {
        if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() <= Date.now()) {
          return res.status(403).json({
            error: 'ACCOUNT_EXPIRED',
            message: 'Your account access has expired. Please contact your administrator.'
          });
        }
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
  let fromQuery = false;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = String(req.query.token);
    fromQuery = true;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);

    // A URL token must be a media token on a media route; a header token must be a full
    // session token. So a leaked media URL can't drive the API, and a session token pasted
    // into a URL is simply refused.
    const isMediaToken = payload.typ === MEDIA_TOKEN_TYPE;
    if (fromQuery ? (!isMediaToken || !isMediaRoute(req)) : isMediaToken) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    const now = Date.now();
    let user = null;

    const cached = userAuthCache.get(payload.userId);
    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      const db = await getDb();
      user = await db.get('SELECT id, username, role, avatar, preferences, expires_at, token_version, max_age_rating, allow_unrated FROM users WHERE id = ?', [payload.userId]);

      if (!user) {
        return res.status(401).json({ error: 'User no longer exists' });
      }

      user.preferences = user.preferences ? JSON.parse(user.preferences) : {};
      userAuthCache.set(payload.userId, { user, expiresAt: now + AUTH_CACHE_TTL });
    }

    if (user.expires_at && new Date(user.expires_at).getTime() <= now) {
      userAuthCache.delete(payload.userId);
      return res.status(403).json({
        error: 'ACCOUNT_EXPIRED',
        message: 'Your account access has expired. Please contact your administrator.'
      });
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
