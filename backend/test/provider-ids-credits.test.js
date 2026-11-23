import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-idcredits-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';
process.env.TMDB_API_KEY = 'test-key';

// TMDB is faked: every request is recorded and answered from this table, nothing leaves the machine.
const asked = [];
const answers = {
  '/3/find/tt0133093': { movie_results: [{ id: 603 }], tv_results: [{ id: 1 }] },
  '/3/movie/603': { id: 603, title: 'The Matrix', credits: { cast: [{ name: 'Keanu Reeves', character: 'Neo' }], crew: [] } },
  '/3/find/81189': { movie_results: [{ id: 2 }], tv_results: [{ id: 1396 }] },
  '/3/tv/1396': { id: 1396, name: 'Breaking Bad', aggregate_credits: { cast: [], crew: [] } }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const { pathname, search } = new URL(url);
  asked.push(pathname + search.replace(/[?&]api_key=[^&]*/, ''));
  const body = answers[pathname];
  return new Response(JSON.stringify(body || {}), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
};

const { getDb } = await import('../src/config/database.js');
const { ensureCredits } = await import('../src/services/credits.js');

describe('credits from ids read off the disk', () => {
  after(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('a film with only an IMDb id is resolved through it, not by a title search', async () => {
    const db = await getDb();
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib-m', 'm', '/tmp/none-m', 'movies')");
    await db.run(`INSERT INTO items (id, library_id, title, path, media_type, format, imdb_id)
      VALUES ('film-1', 'lib-m', 'Matrix Rip Final', '/tmp/none-m/a.mkv', 'movie', 'mkv', 'tt0133093')`);
    const item = await db.get("SELECT * FROM items WHERE id = 'film-1'");

    const credits = await ensureCredits(db, item);
    assert.equal(credits.cast[0].name, 'Keanu Reeves');
    assert.equal((await db.get("SELECT tmdb_id FROM items WHERE id = 'film-1'")).tmdb_id, '603');
    assert.ok(asked.some((u) => u.startsWith('/3/find/tt0133093?external_source=imdb_id')));
    assert.ok(!asked.some((u) => u.startsWith('/3/search/')), 'no title search when an id is known');
  });

  test('an episode uses the TVDB id another episode of its show carries', async () => {
    const db = await getDb();
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib-s', 's', '/tmp/none-s', 'shows')");
    await db.run(`INSERT INTO items (id, library_id, title, series, volume, path, media_type, format, tvdb_id)
      VALUES ('ep-1', 'lib-s', 'S01E01', 'Breaking Bad', 1.001, '/tmp/none-s/1.mkv', 'show', 'mkv', '81189'),
             ('ep-2', 'lib-s', 'S01E02', 'Breaking Bad', 1.002, '/tmp/none-s/2.mkv', 'show', 'mkv', NULL)`);
    asked.length = 0;
    await ensureCredits(db, await db.get("SELECT * FROM items WHERE id = 'ep-2'"));

    const rows = await db.all("SELECT tmdb_id FROM items WHERE library_id = 'lib-s'");
    assert.deepEqual(rows.map((r) => r.tmdb_id), ['1396', '1396']);
    assert.ok(asked.some((u) => u.startsWith('/3/find/81189?external_source=tvdb_id')));
    assert.ok(!asked.some((u) => u.startsWith('/3/search/')));
  });
});
