import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const id = (c) => c.repeat(32);

async function send(baseUrl, method, url, token, body) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method, headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return res.json();
}

// Settings → Hidden: each person picks libraries to stop seeing, and can hide kids content.
// A choice, not a restriction, so it only ever changes what that one account sees.
describe('Hidden libraries and kids content', () => {
  let server; let admin; let john; let kid;
  const titles = async (token) => (await getJson(server.baseUrl, '/items', token)).body.items.map((i) => i.title).sort();
  const prefs = (token, body) => send(server.baseUrl, 'PATCH', '/users/preferences', token, body);

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run(`INSERT INTO libraries (id, name, path, type, kids_allowed) VALUES
      ('movies', 'Movies', '/tmp/m', 'movies', 0), ('shows', 'Shows', '/tmp/s', 'shows', 0),
      ('kidsmovies', 'Kids Movies', '/tmp/km', 'movies', 1), ('kidsshows', 'Kids Shows', '/tmp/ks', 'shows', 1)`);
    const add = (i, lib, title, type, series = null) => db.run(
      `INSERT INTO items (id, library_id, title, series, path, media_type, format) VALUES (?, ?, ?, ?, ?, ?, 'mkv')`,
      [i, lib, title, series, `/tmp/${i}.mkv`, type]
    );
    await add(id('a'), 'movies', 'Heist Film', 'movie');
    await add(id('b'), 'movies', 'Family Film', 'movie');
    await add(id('c'), 'shows', 'Crime Show S01E01', 'show', 'Crime Show');
    await add(id('d'), 'shows', 'Bluey S01E01', 'show', 'Bluey');
    await add(id('e'), 'kidsmovies', 'Cartoon Film', 'movie');
    await add(id('f'), 'kidsshows', 'Puppet Show S01E01', 'show', 'Puppet Show');
    // Kids-safe titles that live in the grown-up libraries.
    await db.run(`INSERT INTO kids_titles (id, library_id, item_id) VALUES ('k1', 'movies', ?)`, [id('b')]);
    await db.run(`INSERT INTO kids_titles (id, library_id, series) VALUES ('k2', 'shows', 'Bluey')`);
    await db.close();

    await send(server.baseUrl, 'POST', '/users', admin.token, { username: 'john', password: 'john-password-1' });
    const k = await send(server.baseUrl, 'POST', '/users', admin.token, { username: 'kid', password: 'kid-password-1' });
    await send(server.baseUrl, 'PATCH', `/users/${k.body.user.id}`, admin.token, { kidsMode: true });
    john = (await login(server.baseUrl, 'john', 'john-password-1')).token;
    kid = (await login(server.baseUrl, 'kid', 'kid-password-1')).token;
  });
  after(async () => { await server.stop(); });

  test('hiding libraries leaves just the ones you want, for you alone', async () => {
    assert.equal((await prefs(john, { hiddenLibraries: ['shows', 'kidsmovies', 'kidsshows'] })).status, 200);
    assert.deepEqual(await titles(john), ['Family Film', 'Heist Film']);
    assert.equal((await titles(admin.token)).length, 6, 'other accounts are unaffected');

    // Gone from direct links and series pages too, the same as a hidden title.
    assert.equal((await getJson(server.baseUrl, `/items/${id('c')}`, john)).status, 404);
    assert.equal((await getJson(server.baseUrl, '/items/series/Crime%20Show', john)).status, 404);

    assert.equal((await prefs(john, { hiddenLibraries: [] })).status, 200);
    assert.equal((await titles(john)).length, 6, 'showing a library again brings it straight back');
  });

  test('hiding kids content takes out kids libraries and titles marked for Kids Mode', async () => {
    assert.equal((await prefs(john, { hideKids: true })).status, 200);
    assert.deepEqual(await titles(john), ['Crime Show S01E01', 'Heist Film']);
    assert.equal((await prefs(john, { hideKids: false })).status, 200);
    assert.equal((await titles(john)).length, 6);
  });

  test('a Kids Mode account can hide libraries, but hiding kids content is ignored', async () => {
    const all = ['Bluey S01E01', 'Cartoon Film', 'Family Film', 'Puppet Show S01E01'];
    assert.equal((await prefs(kid, { hideKids: true })).status, 200);
    assert.deepEqual(await titles(kid), all, 'it would otherwise leave a kids account with nothing');
    assert.equal((await prefs(kid, { hiddenLibraries: ['kidsshows'] })).status, 200);
    assert.deepEqual(await titles(kid), all.filter((t) => t !== 'Puppet Show S01E01'));
  });

  test('only library ids and true/false are saved', async () => {
    for (const body of [
      { hiddenLibraries: "movies') OR 1=1 --" },
      { hiddenLibraries: ["movies') OR ('1'='1"] },
      { hiddenLibraries: [42] },
      { hiddenLibraries: Array.from({ length: 201 }, (_, i) => `lib${i}`) },
      { hideKids: 'yes' }
    ]) {
      assert.equal((await prefs(john, body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await titles(john)).length, 6, 'nothing was saved');
  });
});
