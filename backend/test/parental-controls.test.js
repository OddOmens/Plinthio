import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';

async function patchUser(baseUrl, token, id, body) {
  const res = await fetch(`${baseUrl}/api/users/${id}`, {
    method: 'PATCH',
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

describe('parental controls (max age rating)', () => {
  let server;
  let admin;
  let kid;
  let kidId;

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    // 11 series ("Series 0".."Series 10"), 22 items.
    const { libraryId } = await seedItems(server.dataDir, 22);

    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    // Series 0 is Mature, Series 1 is Everyone; one Series-1 item overrides itself to Explicit.
    await db.run("INSERT INTO series_settings (id, library_id, series_name, age_rating) VALUES ('s0', ?, 'Series 0', 'Mature')", [libraryId]);
    await db.run("INSERT INTO series_settings (id, library_id, series_name, age_rating) VALUES ('s1', ?, 'Series 1', 'Everyone')", [libraryId]);
    await db.run("UPDATE items SET age_rating = 'Explicit' WHERE id = 'seed-00001'");
    await db.close();

    const created = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'kid-password-1' })
    });
    kidId = (await created.json()).user.id;
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'kid-password-1' })
    });
    kid = await login.json();
  });

  after(async () => { await server.stop(); });

  test('an unrestricted account sees everything', async () => {
    const res = await getJson(server.baseUrl, '/items', kid.token);
    assert.equal(res.body.items.length, 22);
  });

  test('a Teen limit hides Mature series and Explicit items, keeps unrated', async () => {
    const r = await patchUser(server.baseUrl, admin.token, kidId, { maxAgeRating: 'Teen' });
    assert.equal(r.status, 200);

    const res = await getJson(server.baseUrl, '/items', kid.token);
    const ids = res.body.items.map((i) => i.id);
    assert.ok(!ids.includes('seed-00000'), 'Series 0 (Mature) is hidden');
    assert.ok(!ids.includes('seed-00011'), 'Series 0 (Mature) is hidden');
    assert.ok(!ids.includes('seed-00001'), 'Explicit override is hidden');
    assert.ok(ids.includes('seed-00012'), 'Series 1 (Everyone) stays');
    assert.ok(ids.includes('seed-00002'), 'unrated stays by default');

    const direct = await getJson(server.baseUrl, '/items/seed-00000', kid.token);
    assert.equal(direct.status, 404, 'direct fetch by id is blocked too');
  });

  test('blocking unrated leaves only rated-and-allowed items', async () => {
    await patchUser(server.baseUrl, admin.token, kidId, { allowUnrated: false });
    const res = await getJson(server.baseUrl, '/items', kid.token);
    assert.deepEqual(res.body.items.map((i) => i.id), ['seed-00012']);
  });

  test('clearing the limit restores everything; admins cannot restrict themselves', async () => {
    await patchUser(server.baseUrl, admin.token, kidId, { maxAgeRating: null });
    const res = await getJson(server.baseUrl, '/items', kid.token);
    assert.equal(res.body.items.length, 22);

    const self = await patchUser(server.baseUrl, admin.token, admin.user.id, { maxAgeRating: 'Teen' });
    assert.equal(self.status, 400);
  });
});
