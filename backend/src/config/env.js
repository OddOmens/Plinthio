import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ quiet: true });

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

import crypto from 'crypto';

// Ensure essential directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Auto-generate and persist cryptographically secure random JWT secret if not explicitly provided
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

// Express only believes X-Forwarded-For when it's told to trust the proxy in front of it.
// This matters as soon as Plinthio is exposed through nginx / Caddy / a Cloudflare tunnel:
// left off, every request looks like it came from the proxy's IP, so the per-IP login
// limiter becomes one shared bucket for everyone (one person fat-fingering a password
// locks out the whole household). Turned on when NOT behind a proxy, anyone can forge
// X-Forwarded-For and bypass rate limiting entirely (and pass for a home device) — so it
// stays opt-in, off by default. Set it to the proxy's own address or subnet; a hop count
// like 1 is only safe when the proxy is the only way to reach Plinthio (Express's docs list
// the forms). Left off behind a proxy, forwarded requests are treated as coming from outside
// the home network: see forwardedUntrusted in services/network.js.
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
  // Shortened from 30d now that the app refreshes its token on every load (see
  // POST /api/auth/refresh): regular users stay signed in indefinitely, while a token that
  // leaks off a shared or lost device stops working in days rather than a month. Override
  // with JWT_EXPIRES_IN if a different trade-off suits your setup.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Which other websites' pages may call the API from a browser. Unset: none (the web app is
  // same-origin and the apps aren't browsers). One origin, a comma-separated list, or `*`.
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // How long an idle on-disk HLS segment cache entry survives before the periodic sweep
  // deletes it (see services/hls.js sweepHlsCache).
  hlsCacheMaxAgeHours: parseInt(process.env.HLS_CACHE_MAX_AGE_HOURS || '24', 10)
};
