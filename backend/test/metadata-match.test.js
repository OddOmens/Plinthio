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
});
