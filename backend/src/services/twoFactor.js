import crypto from 'crypto';
import { config } from '../config/env.js';

// TOTP (RFC 6238): HMAC-SHA1, 30-second steps, 6 digits, the standard authenticator app format.
// RFC test vectors are in test/two-factor.test.js.

const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept one step either side for clock drift.
const WINDOW = 1;

// ─── Base32 (RFC 4648), the format authenticator apps take secrets in ───────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Not base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ─── TOTP ───────────────────────────────────────────────────────────────────────────────
export function totpAt(secret, step, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

// Returns the matched step or null. Steps <= `lastStep` are refused so each code works once.
export function verifyTotp(secretB32, code, { lastStep = null, nowMs = Date.now() } = {}) {
  const digits = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const now = currentStep(nowMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return step;
  }
  return null;
}

export function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// The otpauth:// link encoded in the QR code.
export function otpauthUri(secretB32, { issuer, account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// ─── Secrets at rest ────────────────────────────────────────────────────────────────────
// Encrypted with a key derived from the JWT secret so a database copy alone doesn't leak
// second factors. Changing JWT_SECRET invalidates every user's two-factor setup.
function keyFor(purpose) {
  return Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'plinthio', purpose, 32));
}

export function sealSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor('totp-secret'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function openSecret(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1:')) return null;
  try {
    const [, iv, tag, data] = sealed.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor('totp-secret'), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ─── Backup codes ───────────────────────────────────────────────────────────────────────
// Single-use codes ("k7mq-2xfp"); only HMACs are stored. No look-alike characters.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

function hashRecovery(code) {
  const normal = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHmac('sha256', keyFor('totp-recovery')).update(normal).digest('hex');
}

export function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    let c = '';
    for (let j = 0; j < 8; j++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    codes.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return { codes, stored: JSON.stringify(codes.map((c) => ({ hash: hashRecovery(c), used_at: null }))) };
}

// Updated JSON with the code marked used, or null if not an unused code.
export function useRecoveryCode(storedJson, code) {
  let list;
  try { list = JSON.parse(storedJson || '[]'); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const hash = Buffer.from(hashRecovery(code));
  const match = list.find((entry) => !entry.used_at && entry.hash?.length === hash.length && crypto.timingSafeEqual(Buffer.from(entry.hash), hash));
  if (!match) return null;
  match.used_at = new Date().toISOString();
  return JSON.stringify(list);
}

export function recoveryCodesLeft(storedJson) {
  try {
    const list = JSON.parse(storedJson || '[]');
    return Array.isArray(list) ? list.filter((e) => !e.used_at).length : 0;
  } catch {
    return 0;
  }
}

// ─── The sign-in challenge ──────────────────────────────────────────────────────────────
// In-memory challenge between password and code: five minutes, five attempts.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_ATTEMPTS = 5;
const challenges = new Map();

export function createChallenge(user, extra = {}) {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expiresAt <= now) challenges.delete(id);
  const id = crypto.randomBytes(32).toString('hex');
  challenges.set(id, { userId: user.id, tokenVersion: user.token_version || 0, expiresAt: now + CHALLENGE_TTL_MS, attemptsLeft: CHALLENGE_ATTEMPTS, ...extra });
  return id;
}

// Counts an attempt; null if expired or out of attempts.
export function takeChallengeAttempt(id) {
  if (typeof id !== 'string') return null;
  const c = challenges.get(id);
  if (!c) return null;
  if (c.expiresAt <= Date.now() || c.attemptsLeft <= 0) {
    challenges.delete(id);
    return null;
  }
  c.attemptsLeft--;
  return c;
}

export function endChallenge(id) {
  challenges.delete(id);
}
