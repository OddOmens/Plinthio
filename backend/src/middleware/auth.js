import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { sendError } from '../errors.js';
import { outsideAccessError } from '../services/network.js';

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

const API_KEY_USER_COLUMNS = 'u.id, u.username, u.role, u.avatar, u.preferences, u.expires_at, u.max_age_rating, u.allow_unrated, u.kids_mode, u.remote_access';

async function apiKeyUser(where, params) {
  const db = await getDb();
  const row = await db.get(
    `SELECT k.id AS api_key_id, ${API_KEY_USER_COLUMNS}
     FROM api_keys k JOIN users u ON k.user_id = u.id
     WHERE ${where}`,
    params
  );
  if (!row) return null;
  const { api_key_id: keyId, ...user } = row;
  user.preferences = user.preferences ? JSON.parse(user.preferences) : {};
  return { user, keyId, expired: !!(user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) };
}

/**
 * The account behind a raw API key — `{ user, keyId, expired }`, or null. Used by every
 * app that signs in with a key: scripts (X-API-Key), OPDS readers and Mihon (HTTP Basic,
 * key as the password).
 */
export function userForApiKey(rawKey) {
  const keyHash = crypto.createHash('sha256').update(String(rawKey).trim()).digest('hex');
  return apiKeyUser('k.key = ?', [keyHash]);
}

// A key by its id — for the Komga session cookie (routes/komga.js), which names the key it
// was issued for so deleting the key signs Mihon out too.
export function userForApiKeyId(keyId) {
  return apiKeyUser('k.id = ?', [keyId]);
}

// KOReader's sync plugin sends the MD5 of the password rather than the password, so keys
// also store their MD5 (routes/apiKeys.js). The username has to match as well.
export function userForApiKeyMd5(username, md5) {
  return apiKeyUser('k.key_md5 = ? AND lower(u.username) = lower(?)', [String(md5).toLowerCase(), String(username)]);
}

export { basicAuthApiKey };

// Away from home (services/network.js): a server that only allows home access, or an
// account that's home-only, gets nothing from outside — not the API, not media, not the
// reading apps. Sends the error and returns true when the request has to stop here.
export async function blockedByNetwork(req, res, user) {
  const code = await outsideAccessError(req, user);
  if (!code) return false;
  sendError(req, res, code);
  return true;
}

export async function authenticateToken(req, res, next) {
  // 1. Support X-API-Key for developer/script integrations, and HTTP Basic (username +
  // API key as the password) for OPDS reader apps, which can't do Bearer tokens and
  // shouldn't be handed the real account password.
  const apiKey = req.headers['x-api-key'] || basicAuthApiKey(req);
  if (apiKey) {
    try {
      const found = await userForApiKey(apiKey);
      if (found) {
        if (found.expired) return sendError(req, res, 'P103');
        if (await blockedByNetwork(req, res, found.user)) return;
        req.user = found.user;
        req.isApiKey = true;
        req.apiKeyId = found.keyId;
        return next();
      }
    } catch (err) {
      console.error('API key auth error:', err);
    }
    return sendError(req, res, 'P104');
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
    return sendError(req, res, 'P100');
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);

    // A URL token must be a media token on a media route; a header token must be a full
    // session token. So a leaked media URL can't drive the API, and a session token pasted
    // into a URL is simply refused.
    const isMediaToken = payload.typ === MEDIA_TOKEN_TYPE;
    if (fromQuery ? (!isMediaToken || !isMediaRoute(req)) : isMediaToken) {
      return sendError(req, res, 'P102', {
        message: isMediaToken
          ? 'Media tokens only work as ?token= on media URLs, not in an Authorization header or on other routes'
          : 'Session tokens are not accepted in URLs, send them in the Authorization header'
      });
    }

    const now = Date.now();
    let user = null;

    const cached = userAuthCache.get(payload.userId);
    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      const db = await getDb();
      user = await db.get('SELECT id, username, role, avatar, preferences, expires_at, token_version, max_age_rating, allow_unrated, kids_mode, remote_access FROM users WHERE id = ?', [payload.userId]);

      if (!user) {
        return sendError(req, res, 'P101', { message: 'This account no longer exists' });
      }

      user.preferences = user.preferences ? JSON.parse(user.preferences) : {};
      userAuthCache.set(payload.userId, { user, expiresAt: now + AUTH_CACHE_TTL });
    }

    if (user.expires_at && new Date(user.expires_at).getTime() <= now) {
      userAuthCache.delete(payload.userId);
      return sendError(req, res, 'P103');
    }

    // A password change bumps token_version server-side, which immediately invalidates
    // every token issued before that change (rather than leaving a stolen/old token
    // valid for its full remaining lifetime).
    if ((payload.tokenVersion || 0) !== (user.token_version || 0)) {
      return sendError(req, res, 'P101', { message: 'Session was signed out, please log in again' });
    }

    if (await blockedByNetwork(req, res, user)) return;
    req.user = user;
    next();
  } catch (err) {
    // Any jwt.verify failure (bad signature, malformed, expired) means this token can never
    // become valid again — 401 so the frontend's response interceptor clears it and bounces
    // to /login, instead of 403 which it doesn't treat as "log in again" and just retries
    // into the same dead token forever.
    return sendError(req, res, 'P101', {
      message: fromQuery ? 'Media link expired, reload to get a new one' : 'Session expired, please log in again'
    });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return sendError(req, res, 'P105');
  }
  next();
}

// Admins implicitly have every Editor right too.
export function requireEditor(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'editor')) {
    return sendError(req, res, 'P106');
  }
  next();
}
