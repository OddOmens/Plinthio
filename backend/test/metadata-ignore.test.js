import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// Home videos have no poster or synopsis to find. An admin can stop them being flagged,
// title by title or for a whole library, in Admin → Metadata and in Health.
describe('ignoring missing metadata', () => {
  let server; let admin;
  const id = (c) => c.repeat(32);
  const send = (method, url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method, headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const manager = async (filter = 'all') => (await getJson(server.baseUrl, `/metadata/admin/items?filter=${filter}`, admin.token)).body;
  const health = async () => (await getJson(server.baseUrl, '/admin/health', admin.token)).body.summary;

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('films', 'Movies', '/tmp/films', 'movies'), ('home', 'Home Videos', '/tmp/home', 'movies')");
    const add = (i, lib, title) => db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format) VALUES (?, ?, ?, ?, 'movie', 'mkv')`,
      [i, lib, title, `/tmp/${lib}/${title}.mkv`]
    );
    await add(id('a'), 'films', 'Heat');
    await add(id('b'), 'films', 'Birthday Party');
    await add(id('c'), 'home', 'Beach Day');
    await add(id('d'), 'home', 'First Steps');
    await db.close();
  });
  after(async () => { await server.stop(); });

  test('every title starts out flagged for its missing poster and details', async () => {
    const all = await manager();
    assert.deepEqual([all.totalMissingCover, all.totalMissingMeta, all.totalIgnored], [4, 4, 0]);
    assert.equal((await health()).noCover, 4);
  });

  test('ignored titles drop out of the counts and lists, and can be brought back', async () => {
    assert.equal((await send('POST', '/metadata/admin/ignore-missing', { itemIds: [id('b')], ignored: true })).status, 200);
    const all = await manager();
    assert.deepEqual([all.totalMissingCover, all.totalMissingMeta, all.totalIgnored], [3, 3, 1]);
    assert.ok(!(await manager('missing_cover')).items.some((i) => i.id === id('b')));
    assert.deepEqual((await manager('ignored')).items.map((i) => i.id), [id('b')]);
    assert.equal((await health()).noCover, 3);

    assert.equal((await send('POST', '/metadata/admin/ignore-missing', { itemIds: [id('b')], ignored: false })).status, 200);
    assert.equal((await manager()).totalMissingCover, 4);
  });

  test('a library set to ignore missing metadata covers every title in it', async () => {
    assert.equal((await send('PATCH', '/libraries/home', { ignoreMissingMetadata: true })).status, 200);
    const all = await manager();
    assert.deepEqual([all.totalMissingCover, all.totalIgnored], [2, 2]);
    const ignored = (await manager('ignored')).items;
    assert.ok(ignored.every((i) => i.ignoredByLibrary), 'they say it was the library');
    assert.equal((await health()).noCover, 2);
    // Kids Mode still works through the same route, alone or together.
    assert.equal((await send('PATCH', '/libraries/home', { kidsAllowed: true, ignoreMissingMetadata: false })).status, 200);
    assert.equal((await manager()).totalMissingCover, 4);
  });

  test('bad requests are refused', async () => {
    assert.equal((await send('POST', '/metadata/admin/ignore-missing', { itemIds: [], ignored: true })).status, 400);
    assert.equal((await send('POST', '/metadata/admin/ignore-missing', { itemIds: [id('a')], ignored: 'yes' })).status, 400);
    assert.equal((await send('PATCH', '/libraries/home', { ignoreMissingMetadata: 'on' })).status, 400);
    assert.equal((await send('PATCH', '/libraries/home', {})).status, 400);
  });
});
