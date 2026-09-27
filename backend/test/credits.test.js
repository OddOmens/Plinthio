import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const CACHED = 'a'.repeat(32);
const UNCACHED = 'b'.repeat(32);
const EPISODE_1 = 'c'.repeat(32);
const EPISODE_2 = 'd'.repeat(32);
const SHREK_1 = '1'.repeat(32);
const SHREK_2 = '2'.repeat(32);
const LONE = '3'.repeat(32);
const HAND_SET = '4'.repeat(32);

const credits = {
  tmdbId: '11',
  tagline: 'A long time ago…',
  studios: ['Lucasfilm'],
  networks: [],
  creators: [],
  status: null,
  cast: [{ name: 'Mark Hamill', character: 'Luke Skywalker', photo: null }],
  crew: [{ name: 'George Lucas', job: 'Director', photo: null }]
};

async function seedVideo(dataDir, libraryId) {
  const db = await open({ filename: path.join(dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 5000');
  const insert = (id, title, type, series, extra = {}) => db.run(
    `INSERT INTO items (id, library_id, title, path, media_type, format, series, credits_json, credits_checked_at)
     VALUES (?, ?, ?, ?, ?, 'mkv', ?, ?, ?)`,
    [id, libraryId, title, `/tmp/seeded/${id}.mkv`, type, series, extra.json || null, extra.checked || null]
  );
  await insert(CACHED, 'Star Wars', 'movie', null, { json: JSON.stringify(credits), checked: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  await insert(UNCACHED, 'Some Film', 'movie', null);
  // A show whose credits were cached (on every episode, as ensureCredits stores them).
  await insert(EPISODE_1, 'Pilot', 'show', 'Some Show', { json: JSON.stringify({ ...credits, creators: ['Someone'] }), checked: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  await insert(EPISODE_2, 'Second', 'show', 'Some Show', { json: JSON.stringify({ ...credits, creators: ['Someone'] }), checked: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  const inCollection = (collection) => ({ json: JSON.stringify({ ...credits, collection }), checked: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  await insert(SHREK_1, 'Shrek', 'movie', null, inCollection('Shrek Collection'));
  await insert(SHREK_2, 'Shrek 2', 'movie', null, inCollection('Shrek Collection'));
  await insert(LONE, 'The Wild Robot', 'movie', null, inCollection('The Wild Robot Collection'));
  await insert(HAND_SET, 'Shrek the Third', 'movie', 'My Ogre Films', inCollection('Shrek Collection'));
  await db.close();
}

describe('/api/items/:id/credits', () => {
  let server;
  let token;

  before(async () => {
    // No TMDB key, so nothing is ever looked up over the network.
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    ({ token } = await setupAdmin(server.baseUrl));
    const { libraryId } = await seedItems(server.dataDir, 1);
    await seedVideo(server.dataDir, libraryId);
  });

  after(async () => { await server.stop(); });

  test('serves cached credits without a lookup', async () => {
    const { status, body } = await getJson(server.baseUrl, `/items/${CACHED}/credits`, token);
    assert.equal(status, 200);
    assert.deepEqual(body.credits, credits);
  });

  test('an episode gets its show\'s credits', async () => {
    const { body } = await getJson(server.baseUrl, `/items/${EPISODE_2}/credits`, token);
    assert.deepEqual(body.credits.creators, ['Someone']);
  });

  test('without a TMDB key an uncached title has none, and nothing fails', async () => {
    const { status, body } = await getJson(server.baseUrl, `/items/${UNCACHED}/credits`, token);
    assert.equal(status, 200);
    assert.equal(body.credits, null);
  });

  test('films sharing a TMDB collection are grouped once two are in the library', async () => {
    await getJson(server.baseUrl, `/items/${SHREK_1}/credits`, token);
    await getJson(server.baseUrl, `/items/${LONE}/credits`, token);
    const item = async (id) => (await getJson(server.baseUrl, `/items/${id}`, token)).body.item;
    assert.equal((await item(SHREK_1)).series, 'Shrek Collection');
    assert.equal((await item(SHREK_2)).series, 'Shrek Collection');
    assert.equal((await item(LONE)).series, null, 'a lone film is not a one-film collection');
    assert.equal((await item(HAND_SET)).series, 'My Ogre Films', 'a collection set by hand is kept');
  });

  test('rejects malformed ids and 404s unknown ones', async () => {
    assert.equal((await getJson(server.baseUrl, '/items/not-an-id/credits', token)).status, 400);
    assert.equal((await getJson(server.baseUrl, `/items/${'e'.repeat(32)}/credits`, token)).status, 404);
  });

  test('an episode still 404s (so the page shows the cover) when the file can\'t be read', async () => {
    const res = await fetch(`${server.baseUrl}/api/media/still/${EPISODE_1}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 404);
    const bad = await fetch(`${server.baseUrl}/api/media/still/nope`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(bad.status, 400);
  });
});
