import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { sendError } from '../errors.js';
import { outsideAccessProblem } from '../services/network.js';
import { logger, oneLineError } from '../services/logger.js';

const userAuthCache = new Map();
const AUTH_CACHE_TTL = 60 * 1000;

// Call when a user's auth state changes (token_version, role, deletion) so it applies at once.
export function invalidateUserCache(userId) {
  userAuthCache.delete(userId);
}

// API key from an HTTP Basic header; the username half is ignored for lookup.
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

// Each token kind (`typ`) is accepted only where it belongs, since all share one secret.
// Unlabelled session tokens (`userId`, no `typ`) are still accepted until refreshed.
const SESSION_TOKEN_TYPE = 'session';

export function signSessionToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0, typ: SESSION_TOKEN_TYPE },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// Media URLs can't send headers, so they use `?token=` with a separate media token: URLs
// leak, so it only opens /api/media/* read-only, expires within a day, and shares the
// session's token_version. Exception: the player's stop-transcode sendBeacon POST.
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

function mediaTokenMayDoThis(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return req.method === 'POST' && req.baseUrl === '/api/media/video' && /^\/[a-f0-9]{32}\/hls\/stop\/?$/.test(req.path || '');
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

/** The account behind a raw API key: `{ user, keyId, expired }`, or null. */
export function userForApiKey(rawKey) {
  const keyHash = crypto.createHash('sha256').update(String(rawKey).trim()).digest('hex');
  return apiKeyUser('k.key = ?', [keyHash]);
}

// For the Komga session cookie, so deleting the key signs Mihon out too.
export function userForApiKeyId(keyId) {
  return apiKeyUser('k.id = ?', [keyId]);
}

// KOReader sends an MD5 of the key; the DB stores SHA-256 of that, so a DB copy can't be
// replayed. The username must match too.
export function kosyncKeyHash(md5) {
  return crypto.createHash('sha256').update(String(md5).trim().toLowerCase()).digest('hex');
}

export function userForApiKeyMd5(username, md5) {
  return apiKeyUser('k.key_md5 = ? AND lower(u.username) = lower(?)', [kosyncKeyHash(md5), String(username)]);
}

export { basicAuthApiKey };

// Home-only servers or accounts get nothing from outside. Returns true after sending the
// error. { session: true } also enforces two-factor away from home (P112).
export async function blockedByNetwork(req, res, user, options) {
  const problem = await outsideAccessProblem(req, user, options);
  if (!problem) return false;
  sendError(req, res, problem.code, problem.message ? { message: problem.message } : {});
  return true;
}

export async function authenticateToken(req, res, next) {
  // X-API-Key for scripts, HTTP Basic (API key as password) for reader apps.
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
      console.error('API key auth error:', oneLineError(err));
    }
    return sendError(req, res, 'P104');
  }

  // Bearer token or ?token=
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
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    // URL tokens must be media tokens on a media route; header tokens must be session tokens.
    // Any other kind is not a sign-in.
    const isMediaToken = payload.typ === MEDIA_TOKEN_TYPE;
    const isSessionToken = payload.typ === SESSION_TOKEN_TYPE || payload.typ === undefined;
    if ((!isMediaToken && !isSessionToken) || typeof payload.userId !== 'string' || !payload.userId) {
      return sendError(req, res, 'P102', { message: 'That token is not a sign-in token' });
    }
    if (fromQuery ? (!isMediaToken || !isMediaRoute(req)) : isMediaToken) {
      return sendError(req, res, 'P102', {
        message: isMediaToken
          ? 'Media tokens only work as ?token= on media URLs, not in an Authorization header or on other routes'
          : 'Session tokens are not accepted in URLs, send them in the Authorization header'
      });
    }
    if (isMediaToken && !mediaTokenMayDoThis(req)) {
      return sendError(req, res, 'P102', { message: 'Media tokens can only read. Send the session token in the Authorization header to change something' });
    }

    const now = Date.now();
    let user = null;

    const cached = userAuthCache.get(payload.userId);
    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      const db = await getDb();
      // two_factor: whether the account has two-factor on, for "two-factor away from home".
      user = await db.get(`SELECT id, username, role, avatar, preferences, expires_at, token_version, max_age_rating,
          allow_unrated, kids_mode, remote_access, (totp_enabled_at IS NOT NULL) AS two_factor FROM users WHERE id = ?`, [payload.userId]);

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

    // A bumped token_version revokes every earlier token.
    if ((payload.tokenVersion || 0) !== (user.token_version || 0)) {
      return sendError(req, res, 'P101', { message: 'Session was signed out, please log in again' });
    }

    if (await blockedByNetwork(req, res, user, { session: true })) return;
    req.user = user;
    next();
  } catch (err) {
    // 401, not 403: the frontend only clears the token and goes to /login on 401.
    return sendError(req, res, 'P101', {
      message: fromQuery ? 'Media link expired, reload to get a new one' : 'Session expired, please log in again'
    });
  }
}

// A key acts as its owner but can't become a session or make keys, which would skip 2FA.
export function requireSession(req, res, next) {
  if (req.isApiKey) {
    return sendError(req, res, 'P003', { message: 'API keys cannot do this. Sign in with your password' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return sendError(req, res, 'P105');
  }
  next();
}

// Whether an account may edit the library: admins, and editors without Kids Mode or a
// content limit (editors can change age ratings, so a restricted one could lift its own).
export function canEditLibrary(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'editor') return false;
  if (user.kids_mode === 1 || user.kids_mode === true) return false;
  return !user.max_age_rating;
}

export function requireEditor(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'editor')) {
    return sendError(req, res, 'P106');
  }
  if (req.user.kids_mode === 1 || req.user.kids_mode === true) {
    return sendError(req, res, 'P106', { message: 'A Kids Mode account cannot edit the library' });
  }
  if (!canEditLibrary(req.user)) {
    return sendError(req, res, 'P106', { message: 'An account with a content limit cannot edit the library' });
  }
  next();
}

// ─── Guess limits ────────────────────────────────────────────────────────────────────────
// `max` failures within `windowMs` hold the key for `lockMs`, doubling per hold within a day
// (up to `maxLockMs`) so patient guessing slows. In memory only.
export class FailureLock {
  constructor({ max = 10, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000, maxLockMs = 24 * 60 * 60 * 1000, maxKeys = 10000 } = {}) {
    Object.assign(this, { max, windowMs, lockMs, maxLockMs, maxKeys });
    this.entries = new Map();
  }

  // Milliseconds the key is still held for, or 0.
  heldFor(key, now = Date.now()) {
    const e = this.entries.get(key);
    return e && e.until > now ? e.until - now : 0;
  }

  // Records a failure. Returns { held, count }: `held` is true when this one tipped it over.
  fail(key, now = Date.now()) {
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= this.maxKeys) this.prune(now);
      e = { fails: [], until: 0, holds: 0, lastHold: 0 };
      this.entries.set(key, e);
    }
    e.fails = e.fails.filter((t) => now - t < this.windowMs);
    e.fails.push(now);
    if (e.fails.length < this.max) return { held: false, count: e.fails.length };
    if (now - e.lastHold > 24 * 60 * 60 * 1000) e.holds = 0;
    const duration = Math.min(this.lockMs * 2 ** e.holds, this.maxLockMs);
    e.holds += 1;
    e.lastHold = now;
    e.until = now + duration;
    e.fails = [];
    return { held: true, count: this.max, minutes: Math.ceil(duration / 60000) };
  }

  // A success forgets the failures so far, but not how many times the key has been held.
  succeed(key) {
    const e = this.entries.get(key);
    if (e) e.fails = [];
  }

  prune(now) {
    for (const [k, e] of this.entries) {
      if (e.until <= now && now - e.lastHold > 24 * 60 * 60 * 1000 && !e.fails.some((t) => now - t < this.windowMs)) this.entries.delete(k);
    }
    if (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value);
  }
}

// Limits password re-confirmation, so an open or stolen session can't be used to guess the
// password. Sign-in itself is unaffected.
export const confirmLock = new FailureLock();

// Null when the password is right, else P107 (wrong) or P108 (too many). `what` is for the log.
export async function checkOwnPassword(db, req, password, what) {
  const key = req.user.id;
  if (confirmLock.heldFor(key)) return 'P108';
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const ok = typeof password === 'string' && !!password && !!row && await bcrypt.compare(password, row.password_hash);
  if (ok) {
    confirmLock.succeed(key);
    return null;
  }
  noteConfirmFailure(req, `gave a wrong password while ${what}`);
  return 'P107';
}

// Wrong two-factor codes in the same kind of confirmation have a lock of their own
// (confirmCodeLock in routes/auth.js): a right password clears this one.
export function noteConfirmFailure(req, did) {
  const result = confirmLock.fail(req.user.id);
  logger.warn('auth', result.held
    ? `"${req.user.username}" ${did}, ${result.count} times running: confirmations for this account are held for ${result.minutes} minutes`
    : `"${req.user.username}" ${did}`, { ip: req.ip });
}

// Sends checkOwnPassword's code; P108 gets its own wording since this isn't a sign-in.
export function sendConfirmProblem(req, res, code, message) {
  if (code === 'P108') {
    return sendError(req, res, 'P108', { message: 'Too many wrong answers. Wait a while, then try again' });
  }
  return sendError(req, res, code, message ? { message } : {});
}
