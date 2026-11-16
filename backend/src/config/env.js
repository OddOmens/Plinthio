import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ quiet: true });

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

import crypto from 'crypto';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Generate and persist a random JWT secret when none is configured.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  const secretPath = path.join(DATA_DIR, 'jwt.secret');
  if (fs.existsSync(secretPath)) {
    jwtSecret = fs.readFileSync(secretPath, 'utf8').trim();
  } else {
    jwtSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(secretPath, jwtSecret, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      console.warn('Could not persist jwt.secret, using memory instance:', e.message);
    }
  }
}

// Opt-in trust of X-Forwarded-For. Behind a proxy without it, every client shares the proxy's
// login rate-limit bucket; enabled without a proxy, anyone can forge their IP. Set it to the
// proxy's address/subnet (a hop count is only safe if the proxy is the sole way in).
// Untrusted forwarded requests count as outside the home network (forwardedUntrusted).
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  return Number.isInteger(asNumber) && asNumber >= 0 ? asNumber : raw;
}

function parseCorsOrigin(raw) {
  const list = String(raw || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!list.length) return null;
  if (list.includes('*')) return '*';
  return list.length === 1 ? list[0] : list;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  cacheDir: CACHE_DIR,
  coversDir: COVERS_DIR,
  avatarsDir: AVATARS_DIR,
  dbPath: path.join(DATA_DIR, 'plinthio.sqlite'),
  jwtSecret,
  // Short because the app refreshes its token on every load (POST /api/auth/refresh), so a
  // leaked token dies in days while active users stay signed in.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Which other websites' pages may call the API from a browser. Unset: none (the web app is
  // same-origin and the apps aren't browsers). One origin, a comma-separated list, or `*`.
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // Idle lifetime of an on-disk HLS cache entry before sweepHlsCache deletes it.
  hlsCacheMaxAgeHours: parseInt(process.env.HLS_CACHE_MAX_AGE_HOURS || '24', 10)
};
