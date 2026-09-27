import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// Five volumes of one series; ids are 32-hex like real ones so the skip endpoint accepts them.
const vol = (n) => String(n).padStart(32, 'a');

describe('skipped volumes', () => {
  let server;
  let admin;

  const post = (url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST',
    headers: { ...authed(admin.token), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const series = async () => (await getJson(server.baseUrl, '/items/series/Saga', admin.token)).body.series;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib', 'Manga', '/tmp/manga', 'manga')");
    for (let n = 1; n <= 5; n++) {
      await db.run(
        `INSERT INTO items (id, library_id, title, series, volume, path, media_type, total_pages, format)
         VALUES (?, 'lib', ?, 'Saga', ?, ?, 'manga', 100, 'cbz')`,
        [vol(n), `Saga v${n}`, n, `/tmp/manga/v${n}.cbz`]
      );
    }
    await db.close();
  });

  after(async () => { await server.stop(); });

  test('skipping volumes 1-3 moves "next" to volume 4 and counts them as covered', async () => {
    const res = await post('/progress/skip', { itemIds: [vol(1), vol(2), vol(3)], skipped: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 3);

    const s = await series();
    assert.equal(s.skippedCount, 3);
    assert.equal(s.readCount, 0);
    assert.equal(s.unreadCount, 2);
    assert.equal(s.nextVolume.id, vol(4));
    assert.equal(s.overallProgress, 60);
  });

  test('skipped volumes are their own filter, not "unread", and never in Continue', async () => {
    const ids = async (q) => (await getJson(server.baseUrl, `/items?${q}`, admin.token)).body.items.map((i) => i.id);
    assert.deepEqual((await ids('progress=skipped')).sort(), [vol(1), vol(2), vol(3)]);
    assert.deepEqual((await ids('progress=unread')).sort(), [vol(4), vol(5)]);

    await post(`/progress/${vol(2)}`, { currentPage: 10, totalPages: 100 });
    await post('/progress/skip', { itemIds: [vol(2)], skipped: true });
    const cont = (await getJson(server.baseUrl, '/progress/continue', admin.token)).body.items.map((i) => i.id);
    assert.ok(!cont.includes(vol(2)), 'a skipped volume with old partial progress stays out of Continue');
  });

  test('reading a skipped volume un-skips it; un-skip works; bad input is rejected', async () => {
    await post(`/progress/${vol(1)}`, { currentPage: 5, totalPages: 100 });
    let s = await series();
    assert.equal(s.volumes.find((v) => v.id === vol(1)).is_skipped, 0);
    assert.equal(s.skippedCount, 2);

    await post('/progress/skip', { itemIds: [vol(2), vol(3)], skipped: false });
    s = await series();
    assert.equal(s.skippedCount, 0);

    assert.equal((await post('/progress/skip', { itemIds: [] })).status, 400);
    assert.equal((await post('/progress/skip', { itemIds: ['../etc'] })).status, 400);
  });
});
