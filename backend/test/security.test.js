import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return { status: res.status, body: await res.json() };
}

describe('media tokens, path redaction and username rules', () => {
  let server;
  let admin;
  let viewer;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    await seedItems(server.dataDir, 3);

    await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1', role: 'viewer' })
    });
    viewer = (await login(server.baseUrl, 'viewer', 'viewer-password-1')).body;
  });

  after(async () => { await server.stop(); });

  test('login hands out a separate media token', () => {
    assert.ok(viewer.mediaToken);
    assert.notEqual(viewer.mediaToken, viewer.token);
  });

  test('a session token is refused in a URL', async () => {
    const res = await fetch(`${server.baseUrl}/api/media/cover/${'a'.repeat(32)}?token=${viewer.token}`);
    assert.equal(res.status, 401);
  });

  test('a media token opens media routes but not the API', async () => {
    const media = await fetch(`${server.baseUrl}/api/media/cover/${'a'.repeat(32)}?token=${viewer.mediaToken}`);
    assert.notEqual(media.status, 401);

    const apiViaQuery = await fetch(`${server.baseUrl}/api/items?token=${viewer.mediaToken}`);
    assert.equal(apiViaQuery.status, 401);

    const apiViaHeader = await fetch(`${server.baseUrl}/api/items`, { headers: authed(viewer.mediaToken) });
    assert.equal(apiViaHeader.status, 401);
  });

  test('non-admins get a relative folder, never the absolute path', async () => {
    const asViewer = await getJson(server.baseUrl, '/items', viewer.token);
    assert.ok(asViewer.body.items.length > 0);
    for (const item of asViewer.body.items) {
      assert.equal(item.path, undefined);
      assert.equal(typeof item.folder, 'string');
    }
    const asAdmin = await getJson(server.baseUrl, '/items', admin.token);
    assert.ok(asAdmin.body.items[0].path);

    const libs = await getJson(server.baseUrl, '/libraries', viewer.token);
    for (const lib of libs.body.libraries) assert.equal(lib.path, undefined);
  });

  test('usernames are validated', async () => {
    for (const username of ['<script>', ' ', 'x'.repeat(65), '-leading']) {
      const res = await fetch(`${server.baseUrl}/api/users`, {
        method: 'POST',
        headers: { ...authed(admin.token), 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'long-enough-pw' })
      });
      assert.equal(res.status, 400, `expected "${username}" to be rejected`);
    }
  });

  test('login with non-string input is a 400, not a 500', async () => {
    const res = await login(server.baseUrl, { $gt: '' }, 'x');
    assert.equal(res.status, 400);
  });

  test('server errors do not leak internals to non-admins', async () => {
    const res = await fetch(`${server.baseUrl}/api/items?limit=abc`, { headers: authed(viewer.token) });
    const body = await res.json();
    assert.equal(body.detail, undefined);
  });
});

describe('auth rate limiting', () => {
  test('page-load calls (setup-status, refresh) never trip the sign-in limiter', async () => {
    const server = await startTestServer();
    try {
      const admin = await setupAdmin(server.baseUrl);
      for (let i = 0; i < 70; i++) {
        const status = await fetch(`${server.baseUrl}/api/auth/setup-status`);
        assert.equal(status.status, 200, `setup-status call ${i + 1} was throttled`);
      }
      for (let i = 0; i < 65; i++) {
        const res = await fetch(`${server.baseUrl}/api/auth/refresh`, { method: 'POST', headers: authed(admin.token) });
        assert.equal(res.status, 200, `refresh call ${i + 1} was throttled`);
      }
    } finally {
      await server.stop();
    }
  });
});
