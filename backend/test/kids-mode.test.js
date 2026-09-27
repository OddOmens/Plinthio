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

describe('Kids Mode', () => {
  let server; let admin; let kid; let kidId; let editor;
  const titles = async (token) => (await getJson(server.baseUrl, '/items', token)).body.items.map((i) => i.title).sort();

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('kidsmovies', 'Kids Movies', '/tmp/k', 'movies'), ('movies', 'Movies', '/tmp/m', 'movies'), ('shows', 'Shows', '/tmp/s', 'shows')");
    const add = (i, lib, title, type, series = null) => db.run(
      `INSERT INTO items (id, library_id, title, series, path, media_type, format) VALUES (?, ?, ?, ?, ?, ?, 'mkv')`,
      [i, lib, title, series, `/tmp/${i}.mkv`, type]
    );
    await add(id('a'), 'kidsmovies', 'Cartoon Film', 'movie');
    await add(id('b'), 'movies', 'Grown-up Film', 'movie');
    await add(id('c'), 'movies', 'Family Film', 'movie');
    await add(id('d'), 'shows', 'Bluey S01E01', 'show', 'Bluey');
    await add(id('e'), 'shows', 'Bluey S01E02', 'show', 'Bluey');
    await add(id('f'), 'shows', 'Crime Show S01E01', 'show', 'Crime Show');
    await db.close();

    const k = await send(server.baseUrl, 'POST', '/users', admin.token, { username: 'kid', password: 'kid-password-1' });
    kidId = k.body.user.id;
    await send(server.baseUrl, 'POST', '/users', admin.token, { username: 'ed', password: 'ed-password-12', role: 'editor' });
    assert.equal((await send(server.baseUrl, 'PATCH', `/users/${kidId}`, admin.token, { kidsMode: true })).status, 200);
    kid = (await login(server.baseUrl, 'kid', 'kid-password-1')).token;
    editor = (await login(server.baseUrl, 'ed', 'ed-password-12')).token;
  });
  after(async () => { await server.stop(); });

  test('a kids account sees nothing until something is marked kids-safe', async () => {
    assert.deepEqual(await titles(kid), []);
    assert.equal((await titles(admin.token)).length, 6, 'other accounts are unaffected');
  });

  test('editors mark a library, a series and a single title', async () => {
    assert.equal((await send(server.baseUrl, 'PATCH', '/libraries/kidsmovies', editor, { kidsAllowed: true })).status, 200);
    assert.equal((await send(server.baseUrl, 'POST', '/kids/titles', editor, { libraryId: 'shows', series: 'Bluey' })).status, 201);
    assert.equal((await send(server.baseUrl, 'POST', '/kids/titles', editor, { itemId: id('c') })).status, 201);
    assert.deepEqual(await titles(kid), ['Bluey S01E01', 'Bluey S01E02', 'Cartoon Film', 'Family Film']);

    const status = await getJson(server.baseUrl, `/kids/status?itemId=${id('d')}`, editor);
    assert.deepEqual([status.body.allowed, status.body.via], [true, 'series']);
    assert.equal((await getJson(server.baseUrl, '/kids', kid)).status, 403, 'kids can\'t see or change the list');
  });

  test('direct links, series pages and watch parties are closed too', async () => {
    assert.equal((await getJson(server.baseUrl, `/items/${id('b')}`, kid)).status, 404);
    assert.equal((await getJson(server.baseUrl, '/items/series/Crime%20Show', kid)).status, 404);
    await send(server.baseUrl, 'PATCH', '/customization', admin.token, { partyModeEnabled: true });
    const party = await send(server.baseUrl, 'POST', '/party', admin.token, { itemId: id('b') });
    assert.ok(party.body.party?.code, `party created (status ${party.status})`);
    const join = await getJson(server.baseUrl, `/party/${party.body.party.code}`, kid);
    assert.equal(join.body.code, 'P603', 'a kids account can\'t join a party for a title outside Kids Mode');
  });

  test('removing access takes effect immediately', async () => {
    await send(server.baseUrl, 'DELETE', '/kids/titles', editor, { itemId: id('c') });
    assert.ok(!(await titles(kid)).includes('Family Film'));
  });

  test('never on yourself, never on an admin', async () => {
    assert.equal((await send(server.baseUrl, 'PATCH', `/users/${admin.user.id}`, admin.token, { kidsMode: true })).status, 400);
    const ed = (await getJson(server.baseUrl, '/users', admin.token)).body.users.find((u) => u.username === 'ed');
    assert.equal((await send(server.baseUrl, 'PATCH', `/users/${ed.id}`, admin.token, { kidsMode: true, role: 'admin' })).status, 400);
  });
});
