import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

describe('GET /api/admin/health', () => {
  let server;
  let admin;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);

    const libDir = path.join(server.dataDir, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, 'present.cbz'), 'x');

    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib1', 'Comics', ?, 'manga')", [libDir]);
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib2', 'Gone', '/nonexistent/plinthio', 'manga')");
    const insert = (id, title, file, size, series = null, volume = null, lib = 'lib1') => db.run(
      `INSERT INTO items (id, library_id, title, series, volume, path, media_type, file_size, format)
       VALUES (?, ?, ?, ?, ?, ?, 'manga', ?, 'cbz')`,
      [id, lib, title, series, volume, path.join(lib === 'lib1' ? libDir : '/nonexistent/plinthio', file), size]
    );
    await insert('a'.repeat(32), 'Present', 'present.cbz', 1);
    await insert('b'.repeat(32), 'Gone Missing', 'missing.cbz', 10);
    await insert('c'.repeat(32), 'Twin', 'twin1.cbz', 500, 'S', 1);
    await insert('d'.repeat(32), 'twin ', 'twin2.cbz', 500, 'S', 1);
    await insert('e'.repeat(32), 'On unreachable lib', 'x.cbz', 7, null, null, 'lib2');
    await db.close();
  });

  after(async () => { await server.stop(); });

  test('reports missing files, duplicates, clashes and unreachable libraries', async () => {
    const { status, body } = await getJson(server.baseUrl, '/admin/health', admin.token);
    assert.equal(status, 200);
    assert.equal(body.summary.unreachableLibraries, 1);
    // twin1/twin2 are missing too; the unreachable library's item is not double-counted.
    assert.deepEqual(body.missingFiles.map((i) => i.title).sort(), ['Gone Missing', 'Twin', 'twin '].sort());
    assert.equal(body.duplicates.length, 1);
    assert.equal(body.duplicates[0].items.length, 2);
    assert.equal(body.volumeClashes.length, 1);
    assert.equal(body.summary.noCover, 5);
  });

  test('is admin-only', async () => {
    await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    });
    const login = await (await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    })).json();
    const res = await getJson(server.baseUrl, '/admin/health', login.token);
    assert.equal(res.status, 403);
  });
});
