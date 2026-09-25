import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';

describe('shelf search and filters', () => {
  let server;
  let admin;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    await seedItems(server.dataDir, 6);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("UPDATE items SET genres = 'Action'");
    await db.run("UPDATE items SET genres = 'Melodrama', description = 'A tale of time travel' WHERE id = 'seed-00000'");
    await db.run("UPDATE items SET genres = 'Comedy, Drama' WHERE id = 'seed-00001'");
    await db.run("UPDATE items SET created_at = datetime('now', '-60 days') WHERE id NOT IN ('seed-00005')");
    await db.close();

    const post = (id, body) => fetch(`${server.baseUrl}/api/progress/${id}`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    await post('seed-00002', { currentPage: 50, totalPages: 180 });
    await post('seed-00003', { isFinished: true });
  });

  after(async () => { await server.stop(); });

  const ids = async (qs) => (await getJson(server.baseUrl, `/items?${qs}`, admin.token)).body.items.map((i) => i.id);

  test('search reaches descriptions', async () => {
    assert.deepEqual(await ids('search=time%20travel'), ['seed-00000']);
  });

  test('progress filters', async () => {
    assert.deepEqual(await ids('progress=in_progress'), ['seed-00002']);
    assert.deepEqual(await ids('progress=finished'), ['seed-00003']);
    const unread = await ids('progress=unread');
    assert.equal(unread.length, 4);
    assert.ok(!unread.includes('seed-00002') && !unread.includes('seed-00003'));
  });

  test('genre filter matches whole genres only', async () => {
    assert.deepEqual(await ids('genre=Drama'), ['seed-00001']);
    const genres = (await getJson(server.baseUrl, '/items/genres', admin.token)).body.genres.map((g) => g.name);
    assert.ok(genres.includes('Drama') && genres.includes('Melodrama') && genres.includes('Comedy'));
  });

  test('recently added and sort orders', async () => {
    assert.deepEqual(await ids('addedWithinDays=7'), ['seed-00005']);
    assert.equal((await ids('sort=added'))[0], 'seed-00005');
    // Items with progress come first (most recently touched first), then everything else.
    assert.deepEqual((await ids('sort=recent')).slice(0, 2).sort(), ['seed-00002', 'seed-00003']);
  });
});
