import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, getJson } from './helpers/server.js';

const MOVIE_HEALTHY = 'a'.repeat(32);
const MOVIE_DAMAGED = 'b'.repeat(32);
const MANGA_DAMAGED = 'c'.repeat(32);

const openDb = async (dataDir) => {
  const db = await open({ filename: path.join(dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 5000');
  return db;
};

// An install upgrading from before user_progress stopped cascading off items: the server
// rebuilds the table on start. `current_time` shares its name with SQLite's CURRENT_TIME
// keyword, so the rebuild must copy the column, not the clock — and rows an earlier
// version of that rebuild already damaged must get a numeric position back.
describe('user_progress rebuild keeps current_time and repairs clock-time values', () => {
  let server;
  let admin;

  before(async () => {
    const first = await startTestServer();
    admin = await setupAdmin(first.baseUrl);
    await first.stopKeepData();

    // Swap the current table for the old schema (item_id cascading off items) and fill it.
    const db = await openDb(first.dataDir);
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib', 'Mixed', '/tmp/mixed', 'movie')");
    for (const [id, mediaType] of [[MOVIE_HEALTHY, 'movie'], [MOVIE_DAMAGED, 'movie'], [MANGA_DAMAGED, 'manga']]) {
      await db.run(
        `INSERT INTO items (id, library_id, title, path, media_type, format) VALUES (?, 'lib', ?, ?, ?, 'mkv')`,
        [id, `Item ${id[0]}`, `/tmp/mixed/${id}`, mediaType]
      );
    }
    await db.exec(`
      DROP TABLE user_progress;
      CREATE TABLE user_progress (
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        current_time REAL DEFAULT 0,
        duration REAL DEFAULT 0,
        current_page INTEGER DEFAULT 0,
        total_pages INTEGER DEFAULT 0,
        progress_percent REAL DEFAULT 0,
        is_finished INTEGER DEFAULT 0,
        cfi TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, item_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);
    const insert = `INSERT INTO user_progress
      (user_id, item_id, current_time, duration, current_page, total_pages, progress_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
    // A healthy position whose percent-derived estimate (120) differs from the real value,
    // so the test can tell "copied intact" apart from "clobbered, then repaired".
    await db.run(insert, [admin.user.id, MOVIE_HEALTHY, 123.5, 1000, 0, 0, 12]);
    // Rows already damaged by the old rebuild: text where seconds should be.
    await db.run(insert, [admin.user.id, MOVIE_DAMAGED, '20:44:06', 3600, 0, 0, 50]);
    await db.run(insert, [admin.user.id, MANGA_DAMAGED, '20:44:06', 0, 40, 100, 40]);
    await db.close();

    server = await startTestServer({ dataDir: first.dataDir });
  });

  after(async () => { await server.stop(); });

  test('the rebuild copies the saved position, not the clock', async () => {
    const db = await openDb(server.dataDir);
    try {
      const row = await db.get(
        `SELECT typeof("current_time") AS type, "current_time" AS position FROM user_progress WHERE item_id = ?`,
        [MOVIE_HEALTHY]
      );
      assert.deepEqual(row, { type: 'real', position: 123.5 });

      const leftover = await db.get("SELECT name FROM sqlite_master WHERE name = 'user_progress_pre_cascade_fix'");
      assert.equal(leftover, undefined);
      const foreignKeys = await db.all('PRAGMA foreign_key_list(user_progress)');
      assert.ok(!foreignKeys.some((fk) => fk.table === 'items'), 'item_id no longer cascades off items');
    } finally {
      await db.close();
    }
  });

  test('clock-time positions become numbers: estimated from percent for video, 0 for pages', async () => {
    const db = await openDb(server.dataDir);
    try {
      const textRows = await db.get(`SELECT COUNT(*) AS n FROM user_progress WHERE typeof("current_time") = 'text'`);
      assert.equal(textRows.n, 0);

      const movie = await db.get(`SELECT "current_time" AS position FROM user_progress WHERE item_id = ?`, [MOVIE_DAMAGED]);
      assert.equal(movie.position, 1800);

      const manga = await db.get(
        `SELECT "current_time" AS position, current_page, progress_percent FROM user_progress WHERE item_id = ?`,
        [MANGA_DAMAGED]
      );
      assert.deepEqual(manga, { position: 0, current_page: 40, progress_percent: 40 });
    } finally {
      await db.close();
    }
  });

  test('the API hands back numeric positions', async () => {
    const { status, body } = await getJson(server.baseUrl, `/progress/${MOVIE_DAMAGED}`, admin.token);
    assert.equal(status, 200);
    assert.equal(body.progress.current_time, 1800);
  });
});
