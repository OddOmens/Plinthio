import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { sendError } from '../errors.js';
import { outsideAccessProblem } from '../services/network.js';
import { logger } from '../services/logger.js';

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

// Every token says what it is (`typ`), and each kind is only accepted where it belongs: a
// session token in the Authorization header, a media token in a media URL, Mihon's cookie on
// the Komga routes (routes/komga.js). All are signed with the same secret, so without the
// label one kind could be passed off as another. Session tokens issued before they carried a
// label (a `userId` and no `typ`) are still accepted, so updating signs nobody out; they're
// replaced by labelled ones the next time the app refreshes its session.
const SESSION_TOKEN_TYPE = 'session';

export function signSessionToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, tokenVersion: user.token_version || 0, typ: SESSION_TOKEN_TYPE },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// Media URLs (<img>, <video>, <track>, OPDS page links) can't carry an Authorization
// header, so they authenticate with `?token=`. Anything in a URL leaks — browser history,
// proxy access logs, a copied link — so the URL never carries the session token itself: it
// carries a separate media token that only opens /api/media/* and expires within a day.
// Revocation still works because it's bound to the same token_version as the session.
// It only reads (GET, HEAD): a leaked link can't be used to change anything. The one
// exception is the video player telling the server to stop transcoding as the page closes,
// which the browser can only send as a header-less POST (navigator.sendBeacon).
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
// { session: true } for a signed-in session, which also has to meet "two-factor away from
// home" on every request (P112, see outsideAccessProblem).
export async function blockedByNetwork(req, res, user, options) {
  const problem = await outsideAccessProblem(req, user, options);
  if (!problem) return false;
  sendError(req, res, problem.code, problem.message ? { message: problem.message } : {});
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
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    // A URL token must be a media token on a media route; a header token must be a full
    // session token. So a leaked media URL can't drive the API, and a session token pasted
    // into a URL is simply refused. Anything else signed with the server's secret (the Komga
    // cookie, a kind added later) is not a sign-in at all.
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

    // A password change bumps token_version server-side, which immediately invalidates
    // every token issued before that change (rather than leaving a stolen/old token
    // valid for its full remaining lifetime).
    if ((payload.tokenVersion || 0) !== (user.token_version || 0)) {
      return sendError(req, res, 'P101', { message: 'Session was signed out, please log in again' });
    }

    if (await blockedByNetwork(req, res, user, { session: true })) return;
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

// A key acts as its owner (scripts may run admin tasks with one), but it can't be turned into
// a sign-in or make more keys: a key copied out of a reader app could otherwise be exchanged
// for a session that skips two-factor and the away-from-home sign-in rules.
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

// Admins implicitly have every Editor right too. A Kids Mode account never does, whatever its
// role says: an editor can mark titles kids-safe and change age ratings, so a kids account
// with the role could let itself see anything.
export function requireEditor(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'editor')) {
    return sendError(req, res, 'P106');
  }
  if (req.user.kids_mode === 1 || req.user.kids_mode === true) {
    return sendError(req, res, 'P106', { message: 'A Kids Mode account cannot edit the library' });
  }
  next();
}

// ─── Guess limits ────────────────────────────────────────────────────────────────────────
// Counts failures per key. `max` of them inside `windowMs` holds the key for `lockMs`, and
// each further hold within a day lasts twice as long (up to `maxLockMs`), so slow, patient
// guessing gets slower instead of settling into a steady rate. In memory: a restart clears it.
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

// Someone already signed in, asked for their password again before something sensitive
// (changing it, making an API key, turning two-factor on or off). Without a limit, a session
// left open on a shared computer, or a stolen one, could be used to guess the password as
// fast as the server answers. Ten wrong answers in 15 minutes hold that account's
// confirmations back; signing in is unaffected, so nobody is locked out of the server.
export const confirmLock = new FailureLock();

// Null when `password` is the signed-in account's password, otherwise the error code to
// send: P107 (wrong) or P108 (too many wrong answers, wait). `what` names the action for the
// log, e.g. "making an API key".
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

// Also used for a wrong two-factor code in the same kind of confirmation (routes/auth.js).
export function noteConfirmFailure(req, did) {
  const result = confirmLock.fail(req.user.id);
  logger.warn('auth', result.held
    ? `"${req.user.username}" ${did}, ${result.count} times running: confirmations for this account are held for ${result.minutes} minutes`
    : `"${req.user.username}" ${did}`, { ip: req.ip });
}

// Sends what checkOwnPassword (or a wrong code) returned. P108's own wording is about
// signing in, which this isn't.
export function sendConfirmProblem(req, res, code, message) {
  if (code === 'P108') {
    return sendError(req, res, 'P108', { message: 'Too many wrong answers. Wait a while, then try again' });
  }
  return sendError(req, res, code, message ? { message } : {});
}
