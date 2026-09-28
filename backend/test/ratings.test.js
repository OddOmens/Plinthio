import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function seedMovie(dataDir, libraryId) {
  const db = await open({ filename: path.join(dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 5000');
  await db.run(
    `INSERT INTO items (id, library_id, title, path, media_type, format)
     VALUES ('movie-1', ?, 'Some Film', '/tmp/seeded/film.mkv', 'movie', 'mkv')`,
    [libraryId]
  );
  await db.close();
}

async function sendJson(baseUrl, method, path, token, body) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return (await res.json()).token;
}

describe('/api/ratings', () => {
  let server;
  let adminToken;
  let viewerToken;

  before(async () => {
    // No TMDB key in the environment, so world ratings are never fetched over the network.
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    ({ token: adminToken } = await setupAdmin(server.baseUrl));
    const { libraryId } = await seedItems(server.dataDir, 3);
    await seedMovie(server.dataDir, libraryId);

    await sendJson(server.baseUrl, 'POST', '/users', adminToken, { username: 'viewer', password: 'viewer-password-1' });
    viewerToken = await login(server.baseUrl, 'viewer', 'viewer-password-1');
  });

  after(async () => { await server.stop(); });

  test('a new item has no personal or community rating yet', async () => {
    const { status, body } = await getJson(server.baseUrl, '/ratings/seed-00000', adminToken);
    assert.equal(status, 200);
    assert.equal(body.userRating, null);
    assert.deepEqual(body.community, { average: null, count: 0 });
    assert.ok(!('external' in body), 'manga has no world rating source');
  });

  test('each user rates separately and the community average combines them', async () => {
    const mine = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00000', adminToken, { rating: 5 });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.userRating, 5);

    const theirs = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00000', viewerToken, { rating: 2 });
    assert.equal(theirs.body.userRating, 2);
    assert.deepEqual(theirs.body.community, { average: 3.5, count: 2 });

    // Re-rating replaces rather than adds a second vote.
    const changed = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00000', viewerToken, { rating: 4 });
    assert.deepEqual(changed.body.community, { average: 4.5, count: 2 });

    const adminView = await getJson(server.baseUrl, '/ratings/seed-00000', adminToken);
    assert.equal(adminView.body.userRating, 5, 'another user rating must not overwrite yours');
  });

  test('the shelf and detail rows carry your own rating', async () => {
    const list = await getJson(server.baseUrl, '/items?limit=10', viewerToken);
    const rated = list.body.items.find((i) => i.id === 'seed-00000');
    assert.equal(rated.user_rating, 4);
    assert.equal(list.body.items.find((i) => i.id === 'seed-00001').user_rating, null);

    const detail = await getJson(server.baseUrl, '/items/seed-00000', adminToken);
    assert.equal(detail.body.item.user_rating, 5);
  });

  test('clearing a rating removes it from the average', async () => {
    const cleared = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00000', viewerToken, { rating: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.userRating, null);
    assert.deepEqual(cleared.body.community, { average: 5, count: 1 });
  });

  test('ratings outside 1–5 or non-integers are rejected', async () => {
    for (const rating of [0.5, 6, -1, 3.5, '4']) {
      const res = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00001', adminToken, { rating });
      assert.equal(res.status, 400, `rating ${JSON.stringify(rating)} should be rejected`);
    }
  });

  test('unknown and hidden items 404', async () => {
    const missing = await getJson(server.baseUrl, '/ratings/does-not-exist', adminToken);
    assert.equal(missing.status, 404);

    await sendJson(server.baseUrl, 'POST', '/items/seed-00002/hide', viewerToken);
    const hidden = await getJson(server.baseUrl, '/ratings/seed-00002', viewerToken);
    assert.equal(hidden.status, 404);
  });

  test('video items include a world-rating slot, empty without a TMDB key', async () => {
    const { body } = await getJson(server.baseUrl, '/ratings/seed-00000', adminToken);
    assert.ok(!('external' in body));

    const movie = await getJson(server.baseUrl, '/ratings/movie-1', adminToken);
    assert.equal(movie.status, 200);
    assert.equal(movie.body.external, null);
  });

  test('admin switches hide sections server-side and block rating when personal is off', async () => {
    const viewerTry = await sendJson(server.baseUrl, 'PATCH', '/customization', viewerToken, { ratings: { showCommunity: false } });
    assert.equal(viewerTry.status, 403, 'only an admin may change what ratings are shown');

    const saved = await sendJson(server.baseUrl, 'PATCH', '/customization', adminToken, {
      ratings: { showPersonal: false, showCommunity: false }
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.ratings, { showPersonal: false, showCommunity: false, showExternal: true });

    const publicConfig = await fetch(`${server.baseUrl}/api/customization`).then((r) => r.json());
    assert.deepEqual(publicConfig.ratings, { showPersonal: false, showCommunity: false, showExternal: true });

    const summary = await getJson(server.baseUrl, '/ratings/seed-00000', viewerToken);
    assert.ok(!('userRating' in summary.body));
    assert.ok(!('community' in summary.body));

    const blocked = await sendJson(server.baseUrl, 'PUT', '/ratings/seed-00001', viewerToken, { rating: 3 });
    assert.equal(blocked.status, 403);

    await sendJson(server.baseUrl, 'PATCH', '/customization', adminToken, { ratings: { showPersonal: true, showCommunity: true } });
    const restored = await getJson(server.baseUrl, '/ratings/seed-00000', viewerToken);
    assert.deepEqual(restored.body.community, { average: 5, count: 1 }, 'existing ratings survive being hidden');
  });
});
