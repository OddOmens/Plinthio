import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-repair-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { getDb } = await import('../src/config/database.js');
const { mergeSamePathRows } = await import('../src/services/catalogRepair.js');

// Before 1.8.0 the scan after a rename listed the renamed file a second time.
describe('one file, one row', () => {
  after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('two rows for one file become one, keeping the history and filling the gaps', async () => {
    const db = await getDb();
    const file = '/media/Shows/Show/Season 01/Show - S01E02.mkv';
    const fresh = crypto.createHash('md5').update(file).digest('hex'); // what the later scan added
    const old = 'a'.repeat(32); // the row re-linked after the rename, with its history
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('shows', 'Shows', '/media/Shows', 'shows')");
    await db.run("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'viewer', 'x', 'viewer')");
    const add = (id, extra) => db.run(
      `INSERT INTO items (id, library_id, title, series, volume, path, media_type, format, file_size, description, release_date)
       VALUES (?, 'shows', 'Episode Two', 'Show', 1.002, ?, 'show', 'mkv', 1000, ?, ?)`,
      [id, file, extra.description ?? null, extra.release_date ?? null]
    );
    await add(old, { description: null, release_date: '2024-01-08' });
    await add(fresh, { description: 'What happens in episode two.' });
    await db.run("INSERT INTO user_progress (user_id, item_id, current_page, total_pages) VALUES ('u1', ?, 300, 1400)", [old]);
    await db.run("INSERT INTO bookmarks (id, user_id, item_id, type, position) VALUES ('b1', 'u1', ?, 'show', 120)", [old]);
    await db.run("INSERT INTO user_ratings (user_id, item_id, rating) VALUES ('u1', ?, 4)", [fresh]);

    assert.equal(await mergeSamePathRows(db), 1);

    const rows = await db.all('SELECT * FROM items WHERE path = ?', [file]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, old, 'the row with the most history is the one kept');
    assert.equal(rows[0].description, 'What happens in episode two.', 'its empty description is filled from the other row');
    assert.equal(rows[0].release_date, '2024-01-08');
    assert.equal((await db.get('SELECT current_page FROM user_progress WHERE item_id = ?', [old])).current_page, 300);
    assert.equal((await db.get('SELECT rating FROM user_ratings WHERE item_id = ?', [old])).rating, 4, 'the rating moved across');
    assert.equal((await db.get('SELECT COUNT(*) n FROM user_ratings WHERE item_id = ?', [fresh])).n, 0);

    assert.equal(await mergeSamePathRows(db), 0, 'nothing left to merge the second time');
  });

  test('with no history on either, the fuller row is kept', async () => {
    const db = await getDb();
    const file = '/media/Shows/Show/Season 01/Show - S01E03.mkv';
    await db.run(`INSERT INTO items (id, library_id, title, path, media_type, format, cover_path)
      VALUES (?, 'shows', 'Episode Three', ?, 'show', 'mkv', NULL), (?, 'shows', 'Episode Three', ?, 'show', 'mkv', 'cover.jpg')`,
    ['b'.repeat(32), file, 'c'.repeat(32), file]);
    assert.equal(await mergeSamePathRows(db), 1);
    assert.deepEqual((await db.all('SELECT id FROM items WHERE path = ?', [file])).map((r) => r.id), ['c'.repeat(32)]);
  });
});
