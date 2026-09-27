import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

describe('user account expiration limits', () => {
  let server;
  let adminToken;
  let adminUser;

  before(async () => {
    server = await startTestServer();
    ({ token: adminToken, user: adminUser } = await setupAdmin(server.baseUrl));
  });

  after(async () => {
    await server.stop();
  });

  test('POST /api/users creates a user with a duration preset', async () => {
    const res = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'guest_1day',
        password: 'password123',
        role: 'viewer',
        duration: '1d'
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.user.expires_at, 'User should have expires_at set');
    const expiry = new Date(body.user.expires_at).getTime();
    const now = Date.now();
    assert.ok(expiry > now, 'Expiration should be in the future');
    assert.ok(expiry <= now + 25 * 60 * 60 * 1000, 'Expiration should be ~1 day from now');
  });

  test('Login succeeds for unexpired user', async () => {
    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'guest_1day', password: 'password123' })
    });

    assert.equal(loginRes.status, 200);
    const body = await loginRes.json();
    assert.ok(body.token);
    assert.ok(body.user.expires_at);

    // Can access protected route
    const meRes = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: authed(body.token)
    });
    assert.equal(meRes.status, 200);
  });

  test('Login is rejected with 403 P103 (account expired) for expired user', async () => {
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const createRes = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'expired_viewer',
        password: 'password123',
        role: 'viewer',
        expires_at: pastDate
      })
    });
    assert.equal(createRes.status, 200);

    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'expired_viewer', password: 'password123' })
    });

    assert.equal(loginRes.status, 403);
    const errBody = await loginRes.json();
    assert.equal(errBody.code, 'P103');
  });

  test('API request is rejected with 403 P103 (account expired) when account expires', async () => {
    // 1. Create a user with future expiry
    const futureExpiry = new Date(Date.now() + 10000).toISOString();
    const createRes = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'soon_expired',
        password: 'password123',
        role: 'viewer',
        expires_at: futureExpiry
      })
    });
    assert.equal(createRes.status, 200);
    const { user } = await createRes.json();

    // 2. Sign in and get a valid token
    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soon_expired', password: 'password123' })
    });
    assert.equal(loginRes.status, 200);
    const { token: userToken } = await loginRes.json();

    // 3. User can fetch /api/auth/me
    const initialMe = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(userToken) });
    assert.equal(initialMe.status, 200);

    // 4. Admin updates user expiration to the past
    const patchRes = await fetch(`${server.baseUrl}/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_at: new Date(Date.now() - 1000).toISOString()
      })
    });
    assert.equal(patchRes.status, 200);

    // 5. User token is now rejected on next API request
    const expiredMe = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(userToken) });
    assert.equal(expiredMe.status, 403);
    const expiredJson = await expiredMe.json();
    assert.equal(expiredJson.code, 'P103');
  });

  test('Admin can extend and renew an expired account', async () => {
    // Locate the expired user
    const usersRes = await fetch(`${server.baseUrl}/api/users`, { headers: authed(adminToken) });
    const { users } = await usersRes.json();
    const expiredUser = users.find(u => u.username === 'expired_viewer');
    assert.ok(expiredUser);

    // Extend access by 7 days
    const extendRes = await fetch(`${server.baseUrl}/api/users/${expiredUser.id}/extend`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: '7d' })
    });
    assert.equal(extendRes.status, 200);
    const extendBody = await extendRes.json();
    assert.ok(extendBody.user.expires_at);
    assert.ok(new Date(extendBody.user.expires_at).getTime() > Date.now());

    // Now expired_viewer can log in again
    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'expired_viewer', password: 'password123' })
    });
    assert.equal(loginRes.status, 200);
  });

  test('Admin cannot set expiration on own account', async () => {
    const res = await fetch(`${server.baseUrl}/api/users/${adminUser.id}`, {
      method: 'PATCH',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: '1d' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Cannot set an expiration date on your own account');
  });
});
