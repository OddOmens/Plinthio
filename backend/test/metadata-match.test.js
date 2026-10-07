import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// No network needed: both cases are decided before any provider is contacted.
describe('auto-match reports setup problems plainly', () => {
  let server;
  let admin;
  const match = (id) => fetch(`${server.baseUrl}/api/metadata/admin/match-single/${id}`, {
    method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: '{}'
  });

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib', 'Mixed', '/tmp/mixed', 'movies')");
    await db.run(`INSERT INTO items (id, library_id, title, path, media_type, format) VALUES (?, 'lib', 'Heat', '/tmp/mixed/Heat.1995.mkv', 'movie', 'mkv')`, ['a'.repeat(32)]);
    await db.run(`INSERT INTO items (id, library_id, title, path, media_type, format) VALUES (?, 'lib', 'A Listen', '/tmp/mixed/A Listen.m4b', 'audiobook', 'm4b')`, ['b'.repeat(32)]);
    await db.close();
  });
  after(async () => { await server.stop(); });

  test('a movie with no TMDB key configured is P400, not a server error', async () => {
    const res = await match('a'.repeat(32));
    const body = await res.json();
    assert.equal(body.code, 'P400');
    assert.notEqual(res.status, 500);
  });

  test('a type with no metadata source is "no match", not a failure', async () => {
    const res = await match('b'.repeat(32));
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /No metadata source for audiobooks/);
  });

  test('admin items lists frames as missing artwork and flags isFrame', async () => {
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format, cover_path, cover_source)
       VALUES (?, 'lib', 'Frame Movie', '/tmp/mixed/Frame.Movie.2020.mkv', 'movie', 'mkv', 'frame.jpg', 'frame')`,
      ['c'.repeat(32)]
    );
    await db.close();

    const res = await fetch(`${server.baseUrl}/api/metadata/admin/items?filter=missing_cover`, {
      headers: authed(admin.token)
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const frameItem = data.items.find((i) => i.id === 'c'.repeat(32));
    assert.ok(frameItem, 'an item with only a video frame must appear in missing_cover filter');
    assert.equal(frameItem.hasCover, false);
    assert.equal(frameItem.isFrame, true);
  });

  test('POST /metadata/apply-series updates all items in a series', async () => {
    const ep1Id = 'd'.repeat(32);
    const ep2Id = 'e'.repeat(32);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format, series, volume)
       VALUES (?, 'lib', 'Show - S01E01', '/tmp/mixed/Show.S01E01.mkv', 'show', 'mkv', 'Old Show', 1.001)`,
      [ep1Id]
    );
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format, series, volume)
       VALUES (?, 'lib', 'Show - S01E02', '/tmp/mixed/Show.S01E02.mkv', 'show', 'mkv', 'Old Show', 1.002)`,
      [ep2Id]
    );
    await db.close();

    const res = await fetch(`${server.baseUrl}/api/metadata/apply-series`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        applyToIds: [ep1Id, ep2Id],
        series: 'New Series Name',
        author: 'Series Director',
        description: 'Series Description',
        genres: 'Drama, Sci-Fi'
      })
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.updatedCount, 2);

    const checkDb = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    const rows = await checkDb.all('SELECT id, series, author, description, genres FROM items WHERE id IN (?, ?)', [ep1Id, ep2Id]);
    await checkDb.close();

    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.series, 'New Series Name');
      assert.equal(row.author, 'Series Director');
      assert.equal(row.description, 'Series Description');
      assert.equal(row.genres, 'Drama, Sci-Fi');
    }
  });
});

describe('matchItemMetadata granularity: episodes and manga volumes', () => {
  let db;
  let origFetch;

  before(async () => {
    process.env.TMDB_API_KEY = 'mock-tmdb-key';
    origFetch = globalThis.fetch;
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        library_id TEXT,
        title TEXT,
        author TEXT,
        artists TEXT,
        series TEXT,
        volume REAL,
        path TEXT,
        cover_path TEXT,
        cover_source TEXT,
        media_type TEXT,
        description TEXT,
        release_date TEXT,
        genres TEXT,
        external_rating REAL,
        external_rating_votes INTEGER,
        external_rating_source TEXT,
        external_rating_checked_at DATETIME,
        tmdb_id TEXT,
        credits_json TEXT,
        credits_checked_at DATETIME,
        updated_at DATETIME
      );
    `);
  });

  after(async () => {
    delete process.env.TMDB_API_KEY;
    globalThis.fetch = origFetch;
    await db.close();
  });

  test('TV Show episode syncs episode title, overview, air_date without overwriting with series name', async () => {
    const { matchItemMetadata } = await import('../src/routes/metadata.js');
    const epId = '1'.repeat(32);
    const item = {
      id: epId,
      library_id: 'lib1',
      title: 'Doctor Who - S01E01',
      path: '/media/Doctor Who/Doctor Who - S01E01 - Rose.mkv',
      media_type: 'show',
      series: 'Doctor Who',
      volume: 1.001,
      cover_path: 'frame.jpg',
      cover_source: 'frame'
    };
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, series, volume, cover_path, cover_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.library_id, item.title, item.path, item.media_type, item.series, item.volume, item.cover_path, item.cover_source]
    );

    const tmdbSeasonCache = new Map();
    tmdbSeasonCache.set('100_s1', {
      episodes: [
        {
          episode_number: 1,
          name: 'Rose',
          overview: 'Rose Tyler meets a mysterious Time Lord called the Doctor.',
          air_date: '2005-03-26',
          still_path: null,
          vote_average: 7.8,
          vote_count: 50,
          crew: [{ job: 'Director', name: 'Keith Boak' }],
          guest_stars: [{ name: 'Billie Piper' }]
        }
      ]
    });

    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/search/tv')) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: 100, name: 'Doctor Who', first_air_date: '2005-03-26', overview: 'The adventures of a Time Lord.' }]
          })
        };
      }
      if (u.includes('/tv/genre/list')) {
        return { ok: true, json: async () => ({ genres: [{ id: 18, name: 'Drama' }] }) };
      }
      return origFetch(url, opts);
    };

    const result = await matchItemMetadata(db, item, { tmdbSeasonCache });
    assert.equal(result.matchedTitle, 'Rose');
    assert.equal(result.item.title, 'Rose');
    assert.equal(result.item.series, 'Doctor Who');
    assert.equal(result.item.description, 'Rose Tyler meets a mysterious Time Lord called the Doctor.');
    assert.equal(result.item.author, 'Keith Boak');
    assert.equal(result.item.release_date, '2005-03-26');
  });

  test('Manga sync preserves volume title and volume number', async () => {
    const { matchItemMetadata } = await import('../src/routes/metadata.js');
    const mangaId = '2'.repeat(32);
    const item = {
      id: mangaId,
      library_id: 'lib2',
      title: 'Solo Leveling v02',
      path: '/media/Solo Leveling/Solo Leveling v02.cbz',
      media_type: 'manga',
      series: 'Solo Leveling',
      volume: 2
    };
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, series, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.library_id, item.title, item.path, item.media_type, item.series, item.volume]
    );

    const mangaDexCoverCache = new Map();
    mangaDexCoverCache.set('md-1', new Map([['2', 'https://uploads.mangadex.org/covers/md-1/v2.jpg']]));

    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('api.mangadex.org/manga')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'md-1',
              attributes: {
                title: { en: 'Solo Leveling' },
                description: { en: 'In a world where hunters must battle deadly monsters...' },
                tags: []
              },
              relationships: [
                { type: 'author', attributes: { name: 'Chugong' } },
                { type: 'cover_art', attributes: { fileName: 'series_cover.jpg' } }
              ]
            }]
          })
        };
      }
      return origFetch(url, opts);
    };

    const result = await matchItemMetadata(db, item, { mangaDexCoverCache });
    assert.equal(result.matchedTitle, 'Solo Leveling, Vol. 2');
    assert.equal(result.item.title, 'Solo Leveling, Vol. 2');
    assert.equal(result.item.series, 'Solo Leveling');
    assert.equal(result.item.author, 'Chugong');
  });

  test('Movie replaces provisional frame cover with poster even when overwriteCover is false', async () => {
    const { matchItemMetadata } = await import('../src/routes/metadata.js');
    const sharp = (await import('sharp')).default;
    const testJpg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } }
    }).jpeg().toBuffer();

    const movieId = '3'.repeat(32);
    const item = {
      id: movieId,
      library_id: 'lib3',
      title: 'Inception',
      path: '/media/Movies/Inception.2010.mkv',
      media_type: 'movie',
      cover_path: 'frame.jpg',
      cover_source: 'frame'
    };
    await db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, cover_path, cover_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.library_id, item.title, item.path, item.media_type, item.cover_path, item.cover_source]
    );

    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/search/movie')) {
        return {
          ok: true,
          json: async () => ({
            results: [{
              id: 27205,
              title: 'Inception',
              release_date: '2010-07-16',
              overview: 'A thief who steals corporate secrets...',
              poster_path: '/inception.jpg'
            }]
          })
        };
      }
      if (u.includes('image.tmdb.org')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(testJpg.length) }),
          arrayBuffer: async () => testJpg.buffer.slice(testJpg.byteOffset, testJpg.byteOffset + testJpg.byteLength)
        };
      }
      if (u.includes('/movie/genre/list')) {
        return { ok: true, json: async () => ({ genres: [{ id: 28, name: 'Action' }] }) };
      }
      return origFetch(url, opts);
    };

    const result = await matchItemMetadata(db, item, { overwriteCover: false });
    assert.equal(result.matchedTitle, 'Inception');
    assert.equal(result.item.title, 'Inception');
    assert.equal(result.posterUpdated, true);
    assert.equal(result.item.cover_source, 'tmdb');
    assert.equal(result.item.cover_path, `${movieId}.jpg`);
  });
});


