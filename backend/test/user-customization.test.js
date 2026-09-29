import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

async function sendJson(baseUrl, method, path, token, body) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return (await res.json()).token;
}

describe('/api/customization user customization rules & server defaults', () => {
  let server;
  let adminToken;
  let viewerToken;

  before(async () => {
    server = await startTestServer();
    ({ token: adminToken } = await setupAdmin(server.baseUrl));
    await sendJson(server.baseUrl, 'POST', '/users', adminToken, { username: 'viewer', password: 'viewer-password-1' });
    viewerToken = await login(server.baseUrl, 'viewer', 'viewer-password-1');
  });

  after(async () => {
    await server.stop();
  });

  test('GET /api/customization returns default pageWidth and userCustomization flags', async () => {
    const res = await fetch(`${server.baseUrl}/api/customization`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pageWidth, 'full');
    assert.deepEqual(body.userCustomization, {
      enabled: true,
      accentColor: true,
      layoutMode: true,
      pageWidth: true,
      pauseScreen: true
    });
  });

  test('PATCH /api/customization requires admin role', async () => {
    const res = await sendJson(server.baseUrl, 'PATCH', '/customization', viewerToken, {
      pageWidth: 'contained'
    });
    assert.equal(res.status, 403);
  });

  test('PATCH /api/customization validates pageWidth and userCustomization', async () => {
    const badWidth = await sendJson(server.baseUrl, 'PATCH', '/customization', adminToken, {
      pageWidth: 'invalid-width'
    });
    assert.equal(badWidth.status, 400);

    const badCustom = await sendJson(server.baseUrl, 'PATCH', '/customization', adminToken, {
      userCustomization: 'not-an-object'
    });
    assert.equal(badCustom.status, 400);
  });

  test('PATCH /api/customization updates server defaults and user customization rules', async () => {
    const updateRes = await sendJson(server.baseUrl, 'PATCH', '/customization', adminToken, {
      pageWidth: 'contained',
      userCustomization: {
        enabled: true,
        accentColor: false
      }
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.pageWidth, 'contained');
    assert.deepEqual(updateRes.body.userCustomization, {
      enabled: true,
      accentColor: false,
      layoutMode: true,
      pageWidth: true,
      pauseScreen: true
    });

    // Public GET also reflects the updated rules
    const getRes = await fetch(`${server.baseUrl}/api/customization`);
    const publicBody = await getRes.json();
    assert.equal(publicBody.pageWidth, 'contained');
    assert.equal(publicBody.userCustomization.accentColor, false);
    assert.equal(publicBody.userCustomization.enabled, true);
  });
});
