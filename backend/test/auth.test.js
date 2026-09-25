import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

describe('session lifetime and revocation', () => {
  let server;
  let token;

  before(async () => {
    server = await startTestServer();
    ({ token } = await setupAdmin(server.baseUrl));
  });

  after(async () => { await server.stop(); });

  const post = (path, tok) => fetch(`${server.baseUrl}/api${path}`, { method: 'POST', headers: authed(tok) });

  test('refresh issues a working token for the same user', async () => {
    const res = await post('/auth/refresh', token);
    assert.equal(res.status, 200);

    const { token: refreshed, user } = await res.json();
    assert.ok(refreshed, 'a new token must come back');
    assert.equal(user.username, 'admin');

    const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(refreshed) });
    assert.equal(me.status, 200, 'the refreshed token must authenticate');
  });

  test('refresh rejects a token that is not valid', async () => {
    const res = await post('/auth/refresh', 'not-a-real-token');
    assert.equal(res.status, 401);
  });

  test('signing out everywhere revokes existing tokens immediately', async () => {
    const signIn = async () => {
      const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test-password-123' })
      });
      return (await res.json()).token;
    };

    // Two sign-ins, standing in for two devices.
    const sessionA = await signIn();
    const sessionB = await signIn();

    assert.equal((await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(sessionA) })).status, 200);

    const out = await post('/auth/sign-out-everywhere', sessionB);
    assert.equal(out.status, 200);

    // Both sessions must stop working — not just the one that pressed the button.
    assert.equal((await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(sessionA) })).status, 401);
    assert.equal((await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(sessionB) })).status, 401);
  });

  test('signing in again after a revocation works', async () => {
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password-123' })
    });
    assert.equal(login.status, 200);
    const { token: fresh } = await login.json();
    assert.equal((await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(fresh) })).status, 200);
  });
});
