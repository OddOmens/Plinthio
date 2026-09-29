import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, authed } from './helpers/server.js';
import { totpAt, base32Decode, currentStep } from '../src/services/twoFactor.js';

// Away-from-home controls and two-factor sign-in, over HTTP against a real server. The server
// trusts 127.0.0.1 as its proxy (TRUST_PROXY=loopback, as the add-ons set it), so each request
// says where it "comes from" with X-Forwarded-For: a home address, Tailscale, or the internet.
const HOME = '192.168.1.20';
const TAILSCALE = '100.100.1.2';
let outsideCounter = 1;
// A fresh internet address for each check, so the per-address sign-in rate limit never
// decides a test.
const outside = () => `203.0.113.${outsideCounter++}`;

describe('away from home, and two-factor', () => {
  let server;
  let base;

  const req = async (method, url, { from = HOME, token, apiKey, body } = {}) => {
    const headers = { 'x-forwarded-for': from };
    if (token) Object.assign(headers, authed(token));
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: data };
  };
  const login = (username, password, from) => req('POST', '/auth/login', { from, body: { username, password } });
  const codeFor = (secret, offset = 0) => totpAt(base32Decode(secret), currentStep() + offset);

  const ADMIN = { username: 'owner', password: 'owner-password-1' };
  const GUEST = { username: 'guest', password: 'guest-password-1' };
  let adminToken;
  let guestId;

  before(async () => {
    server = await startTestServer({ env: { TRUST_PROXY: 'loopback' } });
    base = server.baseUrl;
  });
  after(async () => { await server.stop(); });

  test('first-run setup can only be done from home', async () => {
    const away = await req('POST', '/auth/setup', { from: outside(), body: { ...ADMIN } });
    assert.equal(away.status, 403);
    assert.equal(away.body.code, 'P109');
    assert.equal((await req('GET', '/auth/setup/browse', { from: outside() })).body.code, 'P109');

    const res = await req('POST', '/auth/setup', { body: { ...ADMIN } });
    assert.equal(res.status, 200);
    adminToken = res.body.token;
    const made = await req('POST', '/users', { token: adminToken, body: { ...GUEST } });
    guestId = made.body.user.id;
  });

  test('a new server is home-only: outside sign-in is refused before the password is checked', async () => {
    const access = await req('GET', '/auth/access', { from: outside() });
    assert.deepEqual(access.body, { where: 'outside', away: true, allowed: false, twoFactorRequired: false });

    const wrong = await login(ADMIN.username, 'not-the-password', outside());
    assert.equal(wrong.body.code, 'P109', 'no password guessing from outside');
    const right = await login(ADMIN.username, ADMIN.password, outside());
    assert.equal(right.body.code, 'P109');

    // A session made at home doesn't work from outside either.
    assert.equal((await req('GET', '/items', { from: outside(), token: adminToken })).body.code, 'P109');
    assert.equal((await req('GET', '/items', { token: adminToken })).status, 200);
  });

  test('a Tailscale Funnel request counts as outside, whatever its address', async () => {
    const res = await fetch(`${base}/api/auth/access`, { headers: { 'x-forwarded-for': TAILSCALE, 'tailscale-funnel-request': '?1' } });
    const body = await res.json();
    assert.equal(body.where, 'outside');
    assert.equal(body.allowed, false, 'home-only server');
  });

  test('Tailscale counts as home by default', async () => {
    assert.equal((await req('GET', '/auth/access', { from: TAILSCALE })).body.allowed, true);
    assert.equal((await login(GUEST.username, GUEST.password, TAILSCALE)).status, 200);
  });

  test("an admin can't lock out the device they're using", async () => {
    const res = await req('PATCH', '/admin/network', { from: TAILSCALE, token: adminToken, body: { tailscaleIsHome: false } });
    assert.equal(res.status, 400);
    const net = await req('GET', '/admin/network', { token: adminToken });
    assert.equal(net.body.settings.tailscaleIsHome, true);
    assert.equal(net.body.thisDevice.where, 'home');
  });

  test('opening to the outside, with a home-only account', async () => {
    const on = await req('PATCH', '/admin/network', { token: adminToken, body: { remoteAccess: true } });
    assert.equal(on.body.settings.remoteAccess, true);
    assert.equal((await login(GUEST.username, GUEST.password, outside())).status, 200);

    await req('PATCH', `/users/${guestId}`, { token: adminToken, body: { remoteAccess: false } });
    const blocked = await login(GUEST.username, GUEST.password, outside());
    assert.equal(blocked.body.code, 'P110');
    const home = await login(GUEST.username, GUEST.password, HOME);
    assert.equal(home.status, 200);
    // Their session, and an API key of theirs, stop at the door outside.
    assert.equal((await req('GET', '/items', { from: outside(), token: home.body.token })).body.code, 'P110');
    const key = await req('POST', '/keys', { token: home.body.token, body: { name: 'reader' } });
    assert.equal((await req('GET', '/items', { from: outside(), apiKey: key.body.key.key })).body.code, 'P110');
    assert.equal((await req('GET', '/items', { apiKey: key.body.key.key })).status, 200);

    await req('PATCH', `/users/${guestId}`, { token: adminToken, body: { remoteAccess: true } });
  });

  test('two-factor required away from home: without it, outside sign-in waits until it is set up', async () => {
    await req('PATCH', '/admin/network', { token: adminToken, body: { require2faOutside: true } });
    assert.equal((await req('GET', '/auth/access', { from: outside() })).body.twoFactorRequired, true);
    assert.equal((await login(GUEST.username, GUEST.password, outside())).body.code, 'P112');
    assert.equal((await login(GUEST.username, GUEST.password, HOME)).status, 200, 'at home, a password is enough');
  });

  let secret;
  let recovery;
  test('turning on two-factor: a code from the app confirms it, and backup codes come once', async () => {
    const start = await req('POST', '/auth/2fa/setup', { token: adminToken });
    assert.match(start.body.uri, /^otpauth:\/\/totp\//);
    secret = start.body.secret;
    assert.equal((await req('POST', '/auth/2fa/enable', { token: adminToken, body: { code: '000000' } })).body.code, 'P111');
    const on = await req('POST', '/auth/2fa/enable', { token: adminToken, body: { code: codeFor(secret) } });
    assert.equal(on.status, 200);
    assert.equal(on.body.enabled, true);
    assert.equal(on.body.recoveryCodes.length, 10);
    recovery = on.body.recoveryCodes;
    assert.equal((await req('GET', '/auth/2fa', { token: adminToken })).body.recoveryCodesLeft, 10);
  });

  test('signing in with two-factor: a challenge, then a code; each code works once', async () => {
    const from = outside();
    const first = await login(ADMIN.username, ADMIN.password, from);
    assert.equal(first.body.twoFactorRequired, true);
    assert.ok(!first.body.token, 'no session before the code');

    const wrong = await req('POST', '/auth/login/2fa', { from, body: { challenge: first.body.challenge, code: '123456' } });
    assert.equal(wrong.body.code, 'P111');
    // The code used to switch it on is spent; the next one works.
    const code = codeFor(secret, 1);
    const ok = await req('POST', '/auth/login/2fa', { from, body: { challenge: first.body.challenge, code } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    assert.equal((await req('POST', '/auth/login/2fa', { from, body: { challenge: first.body.challenge, code } })).body.code, 'P113', 'challenge used up');

    const again = await login(ADMIN.username, ADMIN.password, from);
    const replay = await req('POST', '/auth/login/2fa', { from, body: { challenge: again.body.challenge, code } });
    assert.equal(replay.body.code, 'P111', 'the same code twice is refused');
  });

  test('a backup code signs in once', async () => {
    const from = outside();
    const a = await login(ADMIN.username, ADMIN.password, from);
    const ok = await req('POST', '/auth/login/2fa', { from, body: { challenge: a.body.challenge, recoveryCode: recovery[0].toUpperCase() } });
    assert.equal(ok.status, 200);
    const b = await login(ADMIN.username, ADMIN.password, from);
    assert.equal((await req('POST', '/auth/login/2fa', { from, body: { challenge: b.body.challenge, recoveryCode: recovery[0] } })).body.code, 'P111');
    assert.equal((await req('GET', '/auth/2fa', { token: adminToken })).body.recoveryCodesLeft, 9);
  });

  test('five wrong codes end the challenge', async () => {
    const from = outside();
    const a = await login(ADMIN.username, ADMIN.password, from);
    for (let i = 0; i < 5; i++) {
      await req('POST', '/auth/login/2fa', { from, body: { challenge: a.body.challenge, code: '000001' } });
    }
    assert.equal((await req('POST', '/auth/login/2fa', { from, body: { challenge: a.body.challenge, code: codeFor(secret) } })).body.code, 'P113');
  });

  test('turning it off needs the password and a code; API keys can’t touch it', async () => {
    const key = await req('POST', '/keys', { token: adminToken, body: { name: 'script' } });
    assert.equal((await req('GET', '/auth/2fa', { apiKey: key.body.key.key })).status, 403);

    const noCode = await req('POST', '/auth/2fa/disable', { token: adminToken, body: { password: ADMIN.password } });
    assert.equal(noCode.body.code, 'P111');
    const badPassword = await req('POST', '/auth/2fa/disable', { token: adminToken, body: { password: 'nope', recoveryCode: recovery[1] } });
    assert.equal(badPassword.body.code, 'P107');
    // Still signed in after those: a wrong answer isn't a dead session.
    assert.equal((await req('GET', '/auth/2fa', { token: adminToken })).body.enabled, true);
  });

  test('an admin can reset someone’s two-factor, which signs them out', async () => {
    const guestLogin = await login(GUEST.username, GUEST.password, HOME);
    const gToken = guestLogin.body.token;
    const gStart = await req('POST', '/auth/2fa/setup', { token: gToken });
    await req('POST', '/auth/2fa/enable', { token: gToken, body: { code: codeFor(gStart.body.secret) } });
    assert.equal((await login(GUEST.username, GUEST.password, HOME)).body.twoFactorRequired, true);

    const reset = await req('POST', `/users/${guestId}/two-factor/reset`, { token: adminToken });
    assert.equal(reset.status, 200);
    assert.equal((await req('GET', '/items', { token: gToken })).body.code, 'P101', 'signed out');
    const after = await login(GUEST.username, GUEST.password, HOME);
    assert.equal(after.status, 200);
    assert.ok(after.body.token, 'password alone again');
  });

  test('the Users list says who has two-factor and who is home-only', async () => {
    const list = (await req('GET', '/users', { token: adminToken })).body.users;
    const owner = list.find((u) => u.username === ADMIN.username);
    assert.equal(owner.two_factor, true);
    assert.equal(owner.remote_access, 1);
    assert.ok(!('totp_secret' in owner) && !('totp_recovery' in owner), 'no secrets in the list');
    assert.equal(owner.last_login_network, 'outside');
  });
});
