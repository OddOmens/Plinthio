import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, authed } from './helpers/server.js';
import { totpAt, base32Decode, currentStep } from '../src/services/twoFactor.js';

// Guess limits on the signed-in two-factor confirmations, the expiry of a secret being set
// up, and the admin reset routes, over HTTP against a real server. As in
// security-access.test.js the server trusts 127.0.0.1 as its proxy and each request comes
// "from" a fresh home address, so the per-address rate limits never decide a test.
let homeCounter = 1;
const home = () => `192.168.9.${homeCounter++}`;

describe('two-factor confirmations and admin resets', () => {
  let server;
  let base;
  let db;
  let adminToken;
  let adminId;
  const ADMIN = { username: 'owner', password: 'owner-password-1' };

  const req = async (method, url, { from = home(), token, apiKey, body } = {}) => {
    const headers = { 'x-forwarded-for': from };
    if (token) Object.assign(headers, authed(token));
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: data };
  };
  const login = (username, password) => req('POST', '/auth/login', { body: { username, password } });
  const codeFor = (secret, offset = 0) => totpAt(base32Decode(secret), currentStep() + offset);
  // A code that is certainly wrong right now (not valid for this step or either side of it).
  const wrongCode = (secret) => {
    const valid = new Set([-1, 0, 1].map((o) => codeFor(secret, o)));
    return ['000000', '111111', '222222', '333333'].find((c) => !valid.has(c));
  };

  async function account(username) {
    const password = `${username}-password-1`;
    const made = await req('POST', '/users', { token: adminToken, body: { username, password } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const session = await login(username, password);
    return { id: made.body.user.id, username, password, token: session.body.token };
  }

  // An account with two-factor on. Its token is the fresh one /2fa/enable hands back.
  async function withTwoFactor(username) {
    const u = await account(username);
    const start = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    assert.equal(start.status, 200);
    const on = await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(start.body.secret) } });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    return { ...u, token: on.body.token, secret: start.body.secret, recovery: on.body.recoveryCodes };
  }

  before(async () => {
    server = await startTestServer({ env: { TRUST_PROXY: 'loopback' } });
    base = server.baseUrl;
    const setup = await req('POST', '/auth/setup', { body: { ...ADMIN } });
    assert.equal(setup.status, 200);
    adminToken = setup.body.token;
    adminId = setup.body.user.id;
    db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
  });

  after(async () => {
    await db?.close();
    await server?.stop();
  });

  // ─── Wrong codes in a confirmation are held back ─────────────────────────────────
  test('ten right-password, wrong-code confirmations hold the eleventh, even with the right code', async () => {
    const u = await withTwoFactor('codeguess');
    for (let i = 0; i < 10; i++) {
      const res = await req('POST', '/auth/2fa/disable', { token: u.token, body: { password: u.password, code: wrongCode(u.secret) } });
      assert.equal(res.body.code, 'P111', `try ${i + 1}`);
    }
    const held = await req('POST', '/auth/2fa/disable', { token: u.token, body: { password: u.password, code: codeFor(u.secret) } });
    assert.equal(held.status, 429);
    assert.equal(held.body.code, 'P108');
    // A backup code waits too, and so does making new backup codes.
    assert.equal((await req('POST', '/auth/2fa/disable', { token: u.token, body: { password: u.password, recoveryCode: u.recovery[0] } })).body.code, 'P108');
    assert.equal((await req('POST', '/auth/2fa/recovery-codes', { token: u.token, body: { password: u.password, code: codeFor(u.secret) } })).body.code, 'P108');
    assert.equal((await req('GET', '/auth/2fa', { token: u.token })).body.enabled, true, 'still on');
    // Signing in has its own limit: the owner is not locked out.
    const signIn = await login(u.username, u.password);
    assert.equal(signIn.body.twoFactorRequired, true);
  });

  test('a right password elsewhere (making an API key) does not reset the count of wrong codes', async () => {
    const u = await withTwoFactor('keyreset');
    for (let i = 0; i < 10; i++) {
      const res = await req('POST', '/auth/2fa/disable', { token: u.token, body: { password: u.password, code: wrongCode(u.secret) } });
      assert.equal(res.body.code, 'P111', `try ${i + 1}`);
      if (i < 9) {
        const key = await req('POST', '/keys', { token: u.token, body: { name: `k${i}`, password: u.password } });
        assert.equal(key.status, 200, 'the password itself is not held');
      }
    }
    const held = await req('POST', '/auth/2fa/disable', { token: u.token, body: { password: u.password, code: codeFor(u.secret) } });
    assert.equal(held.body.code, 'P108');
  });

  test('a right code clears the count of wrong ones', async () => {
    const u = await withTwoFactor('clears');
    for (let i = 0; i < 9; i++) {
      await req('POST', '/auth/2fa/recovery-codes', { token: u.token, body: { password: u.password, code: wrongCode(u.secret) } });
    }
    const ok = await req('POST', '/auth/2fa/recovery-codes', { token: u.token, body: { password: u.password, recoveryCode: u.recovery[0] } });
    assert.equal(ok.status, 200);
    const next = await req('POST', '/auth/2fa/recovery-codes', { token: u.token, body: { password: u.password, code: wrongCode(u.secret) } });
    assert.equal(next.body.code, 'P111', 'counting starts again');
  });

  // ─── Enrolment checks the hold before the code ───────────────────────────────────
  test('after ten wrong codes while turning on two-factor, a right code waits as well', async () => {
    const u = await account('enrolguess');
    const start = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    const secret = start.body.secret;
    for (let i = 0; i < 10; i++) {
      assert.equal((await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: wrongCode(secret) } })).body.code, 'P111', `try ${i + 1}`);
    }
    const held = await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(secret) } });
    assert.equal(held.status, 429);
    assert.equal(held.body.code, 'P108');
    // Wrong codes during the hold are refused the same way and don't end it.
    assert.equal((await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: wrongCode(secret) } })).body.code, 'P108');
    assert.equal((await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(secret) } })).body.code, 'P108');
    assert.equal((await req('GET', '/auth/2fa', { token: u.token })).body.enabled, false);
  });

  test('a secret being set up has to be confirmed within a few minutes', async () => {
    const u = await account('slowsetup');
    const start = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    const row = await db.get('SELECT totp_pending_at FROM users WHERE id = ?', [u.id]);
    assert.ok(row.totp_pending_at, 'when it was made is kept');
    await db.run('UPDATE users SET totp_pending_at = ? WHERE id = ?', [new Date(Date.now() - 20 * 60 * 1000).toISOString(), u.id]);
    const late = await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(start.body.secret) } });
    assert.equal(late.status, 400);
    assert.match(late.body.error, /took too long/);
    assert.equal((await db.get('SELECT totp_pending FROM users WHERE id = ?', [u.id])).totp_pending, null, 'the pending secret is gone');
    assert.equal((await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(start.body.secret) } })).status, 400);

    // One left over from before the time was kept (none recorded) counts as expired too.
    const again = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    await db.run('UPDATE users SET totp_pending_at = NULL WHERE id = ?', [u.id]);
    assert.equal((await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(again.body.secret) } })).status, 400);

    // In time, it works.
    const fresh = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    const on = await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(fresh.body.secret) } });
    assert.equal(on.status, 200);
    assert.equal((await db.get('SELECT totp_pending_at FROM users WHERE id = ?', [u.id])).totp_pending_at, null);
  });

  // ─── Admin resets need a session, and never on your own account ──────────────────
  test('an admin API key cannot reset passwords or two-factor', async () => {
    const target = await withTwoFactor('resettarget');
    const key = (await req('POST', '/keys', { token: adminToken, body: { name: 'script', password: ADMIN.password } })).body.key.key;
    for (const [method, url, body] of [
      ['PATCH', `/users/${adminId}/password`, { newPassword: 'taken-over-password-1' }],
      ['POST', `/users/${adminId}/two-factor/reset`, undefined],
      ['PATCH', `/users/${target.id}/password`, { newPassword: 'taken-over-password-1' }],
      ['POST', `/users/${target.id}/two-factor/reset`, undefined]
    ]) {
      const res = await req(method, url, { apiKey: key, body });
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal(res.body.code, 'P003');
    }
    assert.equal((await login(ADMIN.username, ADMIN.password)).status, 200, 'the password is unchanged');
    assert.equal((await req('GET', '/auth/2fa', { token: target.token })).body.enabled, true);
    // Other admin work with a key is unchanged.
    assert.equal((await req('GET', '/users', { apiKey: key })).status, 200);
  });

  test('an admin session cannot reset its own password or two-factor here, only someone else\'s', async () => {
    const own = await req('PATCH', `/users/${adminId}/password`, { token: adminToken, body: { newPassword: 'another-password-1' } });
    assert.equal(own.status, 400);
    assert.match(own.body.error, /your own/);
    const ownTwoFactor = await req('POST', `/users/${adminId}/two-factor/reset`, { token: adminToken });
    assert.equal(ownTwoFactor.status, 400);
    assert.match(ownTwoFactor.body.error, /your own/);
    assert.equal((await login(ADMIN.username, ADMIN.password)).status, 200);

    const other = await withTwoFactor('lostphone');
    assert.equal((await req('POST', `/users/${other.id}/two-factor/reset`, { token: adminToken })).status, 200);
    assert.equal((await req('PATCH', `/users/${other.id}/password`, { token: adminToken, body: { newPassword: 'brand-new-password-1' } })).status, 200);
    assert.equal((await login(other.username, 'brand-new-password-1')).status, 200);
  });
});
