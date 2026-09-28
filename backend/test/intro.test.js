import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const TINY_MP4 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny.mp4'); // 2 s, H.264
const hasFfprobe = (() => {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
})();

async function upload(baseUrl, token, bytes, name = 'intro.mp4') {
  const form = new FormData();
  form.append('intro', new Blob([bytes], { type: 'video/mp4' }), name);
  const res = await fetch(`${baseUrl}/api/customization/intro`, { method: 'POST', headers: authed(token), body: form });
  return { status: res.status, body: await res.json() };
}

async function patch(baseUrl, token, body) {
  const res = await fetch(`${baseUrl}/api/customization`, {
    method: 'PATCH',
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

describe('opening sequence', () => {
  let server;
  let adminToken;
  let viewerToken;

  before(async () => {
    server = await startTestServer();
    ({ token: adminToken } = await setupAdmin(server.baseUrl));
    await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    });
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    });
    viewerToken = (await login.json()).token;
  });

  after(async () => { await server.stop(); });

  test('is off by default, and can\'t be switched on without a clip', async () => {
    const config = await fetch(`${server.baseUrl}/api/customization`).then((r) => r.json());
    assert.equal(config.introEnabled, false);
    assert.equal(config.introVersion, null);
    const { body } = await patch(server.baseUrl, adminToken, { introEnabled: true });
    assert.equal(body.introEnabled, false);
  });

  test('only an admin can upload one', async () => {
    const { status } = await upload(server.baseUrl, viewerToken, fs.readFileSync(TINY_MP4));
    assert.equal(status, 403);
  });

  test('a file that isn\'t a video is refused', { skip: !hasFfprobe && 'needs ffprobe' }, async () => {
    const { status, body } = await upload(server.baseUrl, adminToken, Buffer.from('not a video at all'));
    assert.equal(status, 400);
    assert.match(body.error, /MP4/);
  });

  test('a short H.264 MP4 is accepted, played once switched on, and removable', { skip: !hasFfprobe && 'needs ffprobe' }, async () => {
    const up = await upload(server.baseUrl, adminToken, fs.readFileSync(TINY_MP4));
    assert.equal(up.status, 200);
    assert.ok(up.body.introVersion);
    assert.equal(Math.round(up.body.introDuration), 2);
    assert.equal(up.body.introEnabled, false, 'uploading doesn\'t switch it on');

    const on = await patch(server.baseUrl, adminToken, { introEnabled: true, introShows: false });
    assert.equal(on.body.introEnabled, true);
    assert.equal(on.body.introMovies, true);
    assert.equal(on.body.introShows, false);

    // Any signed-in user can fetch it, in ranges like any video.
    const clip = await fetch(`${server.baseUrl}/api/media/intro`, { headers: { ...authed(viewerToken), range: 'bytes=0-99' } });
    assert.equal(clip.status, 206);
    assert.equal(clip.headers.get('content-type'), 'video/mp4');
    assert.equal((await fetch(`${server.baseUrl}/api/media/intro`)).status, 401);

    const del = await fetch(`${server.baseUrl}/api/customization/intro`, { method: 'DELETE', headers: authed(adminToken) });
    const after = await del.json();
    assert.equal(after.introEnabled, false);
    assert.equal(after.introVersion, null);
    assert.equal((await fetch(`${server.baseUrl}/api/media/intro`, { headers: authed(viewerToken) })).status, 404);
  });

  test('the public config says what the player needs and nothing more', async () => {
    const { body } = await getJson(server.baseUrl, '/customization', viewerToken);
    for (const key of ['introEnabled', 'introMovies', 'introShows', 'introVersion', 'introDuration']) assert.ok(key in body, key);
  });
});
