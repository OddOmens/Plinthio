import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

async function sendJson(baseUrl, method, p, token, body) {
  const res = await fetch(`${baseUrl}/api${p}`, {
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

describe('reading notes are private, and backups keep them', () => {
  let server;
  let adminToken;
  let aliceToken;
  let bobToken;
  let aliceId;

  before(async () => {
    server = await startTestServer();
    ({ token: adminToken } = await setupAdmin(server.baseUrl));
    const alice = await sendJson(server.baseUrl, 'POST', '/users', adminToken, { username: 'alice', password: 'alice-password-1' });
    aliceId = alice.body.user?.id || alice.body.id;
    await sendJson(server.baseUrl, 'POST', '/users', adminToken, { username: 'bob', password: 'bob-password-1' });
    aliceToken = await login(server.baseUrl, 'alice', 'alice-password-1');
    bobToken = await login(server.baseUrl, 'bob', 'bob-password-1');
  });

  after(async () => { await server.stop(); });

  test("bookmarks: another reader can't list, edit or delete them", async () => {
    const { body: { bookmark } } = await sendJson(server.baseUrl, 'POST', '/bookmarks', aliceToken, {
      itemId: 'shared-book', type: 'book', position: 10, title: 'Chapter 2', cfi: 'epubcfi(/6/4!/4/2/1:0)'
    });
    const mine = await getJson(server.baseUrl, '/bookmarks/shared-book', aliceToken);
    assert.equal(mine.body.bookmarks.length, 1);

    const theirs = await getJson(server.baseUrl, '/bookmarks/shared-book', bobToken);
    assert.equal(theirs.body.bookmarks.length, 0);
    const adminView = await getJson(server.baseUrl, '/bookmarks/shared-book', adminToken);
    assert.equal(adminView.body.bookmarks.length, 0, 'not even an admin sees them');
    assert.equal((await sendJson(server.baseUrl, 'PATCH', `/bookmarks/${bookmark.id}`, bobToken, { title: 'mine now' })).status, 404);
    assert.equal((await sendJson(server.baseUrl, 'DELETE', `/bookmarks/${bookmark.id}`, bobToken)).status, 404);
    assert.equal((await getJson(server.baseUrl, '/bookmarks/shared-book', aliceToken)).body.bookmarks[0].title, 'Chapter 2');
  });

  test("highlights: an admin can't see a reader's highlights either", async () => {
    await sendJson(server.baseUrl, 'POST', '/highlights', aliceToken, {
      itemId: 'shared-book', cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:9)', text: 'Private passage', note: 'my note'
    });
    assert.equal((await getJson(server.baseUrl, '/highlights/shared-book', adminToken)).body.highlights.length, 0);
    assert.equal((await getJson(server.baseUrl, '/highlights/shared-book', bobToken)).body.highlights.length, 0);
  });

  test('backups are on by default, and a backup holds bookmarks, highlights and reader settings', async () => {
    const { body: cfg } = await getJson(server.baseUrl, '/settings/backup/config', adminToken);
    assert.equal(cfg.enabled, true);

    await sendJson(server.baseUrl, 'PATCH', '/users/preferences', aliceToken, { ebookReader: { theme: 'sepia', fontSize: 22 } });
    const created = await sendJson(server.baseUrl, 'POST', '/settings/backup/create', adminToken);
    assert.equal(created.status, 200);

    const snapshot = await open({ filename: path.join(server.dataDir, 'backups', created.body.backup.filename), driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
      assert.equal((await snapshot.get("SELECT COUNT(*) AS n FROM bookmarks WHERE item_id = 'shared-book'")).n, 1);
      assert.equal((await snapshot.get("SELECT note FROM highlights WHERE text = 'Private passage'")).note, 'my note');
      const prefs = JSON.parse((await snapshot.get("SELECT preferences FROM users WHERE username = 'alice'")).preferences);
      assert.deepEqual(prefs.ebookReader, { theme: 'sepia', fontSize: 22 });
    } finally {
      await snapshot.close();
    }
  });

  test('the backup schedule never prunes the newest pre-upgrade snapshots', async () => {
    const dir = path.join(server.dataDir, 'backups');
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dir, `plinthio-backup-before-9.${i}.0-from-9.0.0-2020-01-0${i + 1}T00-00-00-000Z.sqlite`), 'x');
    }
    await sendJson(server.baseUrl, 'PUT', '/settings/backup/config', adminToken, { enabled: true, intervalHours: 24, retentionCount: 1 });
    await sendJson(server.baseUrl, 'POST', '/settings/backup/create', adminToken);
    await sendJson(server.baseUrl, 'POST', '/settings/backup/create', adminToken);

    const files = fs.readdirSync(dir);
    assert.equal(files.filter((f) => f.startsWith('plinthio-backup-before-')).length, 3, 'pre-upgrade snapshots kept');
    assert.equal(files.filter((f) => !f.startsWith('plinthio-backup-before-')).length, 1, 'retention applies to the rest');
  });

  test('a backup destination must be a writable folder outside the data folder', async () => {
    const check = (p) => sendJson(server.baseUrl, 'POST', '/settings/backup/destination/check', adminToken, { path: p });
    assert.equal((await check('relative/folder')).body.ok, false);
    assert.match((await check(path.join(server.dataDir, 'elsewhere'))).body.error, /data folder/);
    assert.match((await check('/definitely/not/here/plinthio')).body.error, /exists/);
    const good = fs.mkdtempSync(path.join(path.dirname(server.dataDir), 'plinthio-dest-'));
    const ok = (await check(path.join(good, 'new-subfolder'))).body;
    assert.equal(ok.ok, true, 'a missing last folder is created');
    assert.equal(typeof ok.sameDisk, 'boolean');
    const rejected = await sendJson(server.baseUrl, 'PUT', '/settings/backup/config', adminToken, { enabled: true, intervalHours: 24, retentionCount: 7, destination: 'not/absolute' });
    assert.equal(rejected.status, 400);
  });

  test('backups are copied to the destination, with the files a restore needs, and trimmed there', async () => {
    const dest = fs.mkdtempSync(path.join(path.dirname(server.dataDir), 'plinthio-dest-'));
    const saved = await sendJson(server.baseUrl, 'PUT', '/settings/backup/config', adminToken, {
      enabled: true, intervalHours: 24, retentionCount: 7, destination: dest, copyRetentionCount: 2, copyFiles: true
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.destination, dest);

    // What a docker install has in /config besides the database.
    fs.writeFileSync(path.join(server.dataDir, 'jwt.secret'), 'secret-for-the-copy-test', { mode: 0o600 });
    fs.mkdirSync(path.join(server.dataDir, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(server.dataDir, 'avatars', 'someone.webp'), 'img');

    for (let i = 0; i < 3; i++) {
      assert.equal((await sendJson(server.baseUrl, 'POST', '/settings/backup/create', adminToken)).status, 200);
    }
    const copies = fs.readdirSync(path.join(dest, 'database'));
    assert.equal(copies.filter((f) => !f.includes('-before-')).length, 2, 'the destination keeps its own count');
    assert.equal(copies.filter((f) => f.includes('-before-')).length, 3, 'pre-upgrade snapshots go too');
    const secret = path.join(dest, 'files', 'jwt.secret');
    assert.equal(fs.readFileSync(secret, 'utf8'), 'secret-for-the-copy-test');
    assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(dest, 'files', 'avatars', 'someone.webp'), 'utf8'), 'img');
    const { body: cfg } = await getJson(server.baseUrl, '/settings/backup/config', adminToken);
    assert.ok(cfg.lastCopyAt);
    assert.equal(cfg.lastCopyError, null);
  });

  test("an unreachable destination doesn't stop the backup, and says why", async () => {
    const { body: cfg } = await getJson(server.baseUrl, '/settings/backup/config', adminToken);
    fs.chmodSync(path.join(cfg.destination, 'database'), 0o555);
    fs.chmodSync(cfg.destination, 0o555);
    try {
      const made = await sendJson(server.baseUrl, 'POST', '/settings/backup/create', adminToken);
      assert.equal(made.status, 200, 'the backup itself still happens');
      const { body: after } = await getJson(server.baseUrl, '/settings/backup/config', adminToken);
      assert.match(after.lastCopyError || '', /write/);
    } finally {
      fs.chmodSync(cfg.destination, 0o755);
      fs.chmodSync(path.join(cfg.destination, 'database'), 0o755);
    }
    const retry = await sendJson(server.baseUrl, 'POST', '/settings/backup/copy', adminToken);
    assert.equal(retry.status, 200);
    assert.equal((await getJson(server.baseUrl, '/settings/backup/config', adminToken)).body.lastCopyError, null);
  });

  test("deleting a user deletes their bookmarks and highlights", async () => {
    assert.ok(aliceId, 'user id from the create response');
    const res = await sendJson(server.baseUrl, 'DELETE', `/users/${aliceId}`, adminToken);
    assert.equal(res.status, 200);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', [aliceId])).n, 0);
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM highlights WHERE user_id = ?', [aliceId])).n, 0);
    } finally {
      await db.close();
    }
  });
});
