import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

describe('avatar management', () => {
  let server;
  let token;
  let adminUser;

  before(async () => {
    server = await startTestServer();
    ({ token, user: adminUser } = await setupAdmin(server.baseUrl));
  });

  after(async () => {
    await server.stop();
  });

  test('GET /api/users/:id/avatar returns 404 when no avatar is set', async () => {
    const res = await fetch(`${server.baseUrl}/api/users/${adminUser.id}/avatar`);
    assert.equal(res.status, 404);
  });

  test('POST /api/users/avatar uploads and normalizes an avatar image', async () => {
    // Generate a test PNG image buffer with sharp
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    }).png().toBuffer();

    const formData = new FormData();
    formData.append('avatar', new Blob([testImage], { type: 'image/png' }), 'test-avatar.png');

    const res = await fetch(`${server.baseUrl}/api/users/avatar`, {
      method: 'POST',
      headers: authed(token),
      body: formData
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.avatar, 'avatar URL must be returned');
    assert.ok(body.avatar.startsWith(`/api/users/${adminUser.id}/avatar`));
    assert.equal(body.user.avatar, body.avatar);

    // Verify GET /api/users/:id/avatar serves the newly uploaded image as WebP
    const getRes = await fetch(`${server.baseUrl}/api/users/${adminUser.id}/avatar`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get('content-type'), 'image/webp');
    const imageBytes = await getRes.arrayBuffer();
    assert.ok(imageBytes.byteLength > 0);

    // Verify /api/auth/me returns the avatar
    const meRes = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(token) });
    const me = await meRes.json();
    assert.equal(me.user.avatar, body.avatar);
  });

  test('POST /api/users/avatar rejects non-image uploads', async () => {
    const formData = new FormData();
    formData.append('avatar', new Blob(['hello world text'], { type: 'text/plain' }), 'fake.txt');

    const res = await fetch(`${server.baseUrl}/api/users/avatar`, {
      method: 'POST',
      headers: authed(token),
      body: formData
    });

    assert.equal(res.status, 400);
  });

  test('DELETE /api/users/avatar removes the avatar', async () => {
    const res = await fetch(`${server.baseUrl}/api/users/avatar`, {
      method: 'DELETE',
      headers: authed(token)
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.avatar, null);

    // GET should now return 404
    const getRes = await fetch(`${server.baseUrl}/api/users/${adminUser.id}/avatar`);
    assert.equal(getRes.status, 404);

    // /api/auth/me should have null avatar
    const meRes = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(token) });
    const me = await meRes.json();
    assert.equal(me.user.avatar, null);
  });
});
