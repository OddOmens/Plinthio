import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-2fa-unit-'));
process.env.JWT_SECRET = 'test-secret';
const tf = await import('../src/services/twoFactor.js');

// RFC 6238 appendix B, SHA-1 (secret "12345678901234567890"), last six of the eight digits.
test('TOTP matches the RFC 6238 test vectors', () => {
  const secret = Buffer.from('12345678901234567890');
  const vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
  for (const [seconds, code] of vectors) {
    assert.equal(tf.totpAt(secret, Math.floor(seconds / 30)), code, `t=${seconds}`);
  }
});

test('base32 round-trips, and a secret decodes to 20 bytes', () => {
  const buf = Buffer.from('12345678901234567890');
  assert.equal(tf.base32Encode(buf), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(tf.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), buf);
  assert.equal(tf.base32Decode(tf.newSecret()).length, 20);
});

test('a code works once, within a step either side, and not after', () => {
  const secret = tf.base32Encode(Buffer.from('12345678901234567890'));
  const nowMs = 1111111111 * 1000;
  const step = tf.verifyTotp(secret, '050471', { nowMs });
  assert.ok(step);
  assert.equal(tf.verifyTotp(secret, '050471', { nowMs, lastStep: step }), null, 'replay refused');
  assert.equal(tf.verifyTotp(secret, '081804', { nowMs }), step - 1, 'previous step accepted (clock skew)');
  assert.equal(tf.verifyTotp(secret, '050471', { nowMs: nowMs + 90_000 }), null, 'too old');
  assert.equal(tf.verifyTotp(secret, '12345', { nowMs }), null);
  assert.equal(tf.verifyTotp(secret, 'abcdef', { nowMs }), null);
});

test('secrets are sealed, and a tampered one does not open', () => {
  const sealed = tf.sealSecret('JBSWY3DPEHPK3PXP');
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(tf.openSecret(sealed), 'JBSWY3DPEHPK3PXP');
  const parts = sealed.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.equal(tf.openSecret(parts.join(':')), null);
});

test('backup codes: ten, single use, stored only as hashes, forgiving about case and dashes', () => {
  const { codes, stored } = tf.newRecoveryCodes();
  assert.equal(codes.length, 10);
  for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.ok(!stored.includes(codes[0]));
  const after = tf.useRecoveryCode(stored, codes[0].toUpperCase().replace('-', ' '));
  assert.ok(after);
  assert.equal(tf.recoveryCodesLeft(after), 9);
  assert.equal(tf.useRecoveryCode(after, codes[0]), null, 'used once only');
  assert.equal(tf.useRecoveryCode(after, 'zzzz-zzzz'), null);
});

test('a sign-in challenge allows five attempts', () => {
  const id = tf.createChallenge({ id: 'u1', token_version: 0 });
  for (let i = 0; i < 5; i++) assert.ok(tf.takeChallengeAttempt(id), `attempt ${i + 1}`);
  assert.equal(tf.takeChallengeAttempt(id), null);
  assert.equal(tf.takeChallengeAttempt('nope'), null);
});
