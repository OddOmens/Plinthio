import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import { ERROR_CODES, codeForStatus, codeForFsError } from '../src/errors.js';
import { renderErrorDocs } from '../src/errorDocs.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('error code catalog', () => {
  test('every code is P + three digits and fully described', () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      assert.match(code, /^P\d{3}$/, code);
      for (const field of ['title', 'message', 'meaning', 'fix']) {
        assert.ok(entry[field], `${code} is missing ${field}`);
      }
      if (entry.side === 'client') {
        assert.equal(entry.status, null, `${code} is client-side, so it has no HTTP status`);
      } else {
        assert.ok(entry.status >= 400 && entry.status < 600, `${code} needs an error status`);
      }
    }
  });

  test('status fallbacks all point at real codes', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 418]) {
      assert.ok(ERROR_CODES[codeForStatus(status)], `no code for ${status}`);
    }
  });

  test('filesystem errors map to drive/permission codes', () => {
    assert.equal(codeForFsError({ code: 'EIO' }), 'P201');
    assert.equal(codeForFsError({ code: 'EACCES' }), 'P202');
    assert.equal(codeForFsError({ code: 'ENOENT' }), 'P200');
    assert.equal(codeForFsError({ code: 'EIO' }, { playback: true }), 'P302');
    assert.equal(codeForFsError({ code: 'ENOENT' }, { playback: true }), 'P301');
    assert.equal(codeForFsError({ code: 'SQLITE_BUSY' }), null);
  });

  test('docs/error-codes.md is up to date (run `npm run docs:errors`)', () => {
    const committed = fs.readFileSync(path.join(repoRoot, 'docs/error-codes.md'), 'utf8');
    assert.equal(committed, renderErrorDocs());
  });
});

describe('error responses carry codes', () => {
  let server;
  let admin;
  let mediaToken;
  const videoId = crypto.randomBytes(16).toString('hex');

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const mt = await fetch(`${server.baseUrl}/api/auth/media-token`, { method: 'POST', headers: authed(admin.token) });
    mediaToken = (await mt.json()).mediaToken;

    // A video whose file isn't on disk, inside a library whose folder doesn't exist.
    const { libraryId } = await seedItems(server.dataDir, 1);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format)
       VALUES (?, ?, 'Gone Movie', '/tmp/seeded/gone.mkv', 'movie', 'mkv')`,
      [videoId, libraryId]
    );
    await db.close();
    server.libraryId = libraryId;
  });

  after(async () => { await server.stop(); });

  async function call(url, init) {
    const res = await fetch(`${server.baseUrl}${url}`, init);
    return { status: res.status, body: await res.json() };
  }

  test('no credentials → P100', async () => {
    const { status, body } = await call('/api/items');
    assert.equal(status, 401);
    assert.equal(body.code, 'P100');
  });

  test('media token in an Authorization header → P102 (the hls.js playback bug)', async () => {
    const { status, body } = await call(
      `/api/media/video/${videoId}/hls/master.m3u8?token=${mediaToken}`,
      { headers: authed(mediaToken) }
    );
    assert.equal(status, 401);
    assert.equal(body.code, 'P102');
  });

  test('media token in the URL alone gets past auth', async () => {
    const { body } = await call(`/api/media/video/${videoId}/hls/master.m3u8?token=${mediaToken}`);
    assert.notEqual(body.code, 'P102');
    assert.notEqual(body.code, 'P101');
  });

  test('session token in a URL → P102', async () => {
    const { status, body } = await call(`/api/media/cover/${videoId}?token=${admin.token}`);
    assert.equal(status, 401);
    assert.equal(body.code, 'P102');
  });

  test('garbage token → P101', async () => {
    const { status, body } = await call('/api/items', { headers: authed('not-a-jwt') });
    assert.equal(status, 401);
    assert.equal(body.code, 'P101');
  });

  test('wrong password → P107', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    assert.equal(status, 401);
    assert.equal(body.code, 'P107');
  });

  test('unknown video → P300, file missing from disk → P301', async () => {
    const unknown = await call(`/api/media/video/${'b'.repeat(32)}/playback-info`, { headers: authed(admin.token) });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'P300');

    const missing = await call(`/api/media/video/${videoId}/playback-info`, { headers: authed(admin.token) });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'P301');
  });

  test('scanning a library whose folder is gone → P200', async () => {
    const { status, body } = await call(`/api/libraries/${server.libraryId}/scan`, {
      method: 'POST',
      headers: authed(admin.token)
    });
    assert.equal(status, 400);
    assert.equal(body.code, 'P200');
  });

  test('unreadable library folder → P202', { skip: process.getuid?.() === 0 && 'root can read anything' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-locked-'));
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    const libId = crypto.randomUUID();
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES (?, 'Locked', ?, 'movies')", [libId, dir]);
    await db.close();
    fs.chmodSync(dir, 0o000);
    try {
      const { status, body } = await call(`/api/libraries/${libId}/scan`, { method: 'POST', headers: authed(admin.token) });
      assert.equal(status, 403);
      assert.equal(body.code, 'P202');
      assert.ok(body.detail, 'admins get the underlying cause');
    } finally {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('responses without a named code get one from their status', async () => {
    const { status, body } = await call('/api/collections', {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(status, 400);
    assert.equal(body.code, 'P001');
  });

  test('requests: unknown request → P506, duplicate → P503', async () => {
    const gone = await call(`/api/requests/${crypto.randomUUID()}`, { method: 'DELETE', headers: authed(admin.token) });
    assert.equal(gone.body.code, 'P506');

    const payload = { mediaType: 'movie', source: 'tmdb', externalId: '603', title: 'The Matrix' };
    const init = { method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(payload) };
    assert.equal((await call('/api/requests', init)).status, 201);
    const dup = await call('/api/requests', init);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'P503');
    assert.equal(dup.body.status, 'pending');
  });

  test('GET /api/errors serves the catalog without signing in', async () => {
    const { status, body } = await call('/api/errors');
    assert.equal(status, 200);
    assert.equal(body.codes.length, Object.keys(ERROR_CODES).length);
    assert.ok(body.codes.find((c) => c.code === 'P102'));
  });
});
