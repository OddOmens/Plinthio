import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, getJson } from './helpers/server.js';

const id = (c) => c.repeat(32);

describe('extras stay off the shelf', () => {
  let server;
  let admin;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib', 'Movies', '/tmp/movies', 'movies')");
    const add = (i, title, extraType = null, extraOf = null, series = null) => db.run(
      `INSERT INTO items (id, library_id, title, series, path, media_type, format, extra_type, extra_of)
       VALUES (?, 'lib', ?, ?, ?, 'movie', 'mkv', ?, ?)`,
      [i, title, series, `/tmp/movies/${title}.mkv`, extraType, extraOf]
    );
    await add(id('a'), 'Quiet Harbor');
    await add(id('b'), 'Making Of', 'Featurette', id('a'));
    await add(id('c'), 'Star Wars', null, null, 'Star Wars');
    await add(id('d'), 'Star Wars Trailer', 'Trailer', id('c'), 'Star Wars');
    await db.close();
  });
  after(async () => { await server.stop(); });

  test('the shelf and search never list extras', async () => {
    const all = (await getJson(server.baseUrl, '/items', admin.token)).body.items.map((i) => i.title);
    assert.deepEqual(all.sort(), ['Quiet Harbor', 'Star Wars']);
    const search = (await getJson(server.baseUrl, '/items?search=Making', admin.token)).body.items;
    assert.equal(search.length, 0);
  });

  test("a film's page gets its extras; a series page keeps them out of the volumes", async () => {
    const extras = (await getJson(server.baseUrl, `/items/${id('a')}/extras`, admin.token)).body.extras;
    assert.deepEqual(extras.map((e) => [e.title, e.extra_type]), [['Making Of', 'Featurette']]);

    const series = (await getJson(server.baseUrl, '/items/series/Star%20Wars', admin.token)).body.series;
    assert.equal(series.volumeCount, 1);
    assert.deepEqual(series.volumes.map((v) => v.title), ['Star Wars']);
    assert.deepEqual(series.extras.map((v) => v.title), ['Star Wars Trailer']);
  });
});
