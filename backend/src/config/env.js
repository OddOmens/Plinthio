import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

import crypto from 'crypto';

// Ensure essential directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

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
// X-Forwarded-For and bypass rate limiting entirely — so it stays opt-in, off by default.
// Set TRUST_PROXY=1 for a single proxy hop, or a subnet/IP list per Express's docs.
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  return Number.isInteger(asNumber) && asNumber >= 0 ? asNumber : raw;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  cacheDir: CACHE_DIR,
  coversDir: COVERS_DIR,
  dbPath: path.join(DATA_DIR, 'plinthio.sqlite'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY)
};
