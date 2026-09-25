import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';

// Regression cover for: the shelf asked for 5000 items in one request and the API capped it
// there, so anything past the 5000th item alphabetically simply didn't exist as far as the
// UI was concerned — silently, with no error and no indicator.
describe('GET /api/items', () => {
  let server;
  let token;

  before(async () => {
    server = await startTestServer();
    ({ token } = await setupAdmin(server.baseUrl));
    await seedItems(server.dataDir, 120);
  });

  after(async () => { await server.stop(); });

  test('pages are disjoint, ordered, and reassemble into the full list', async () => {
    const all = await getJson(server.baseUrl, '/items?limit=5000', token);
    assert.equal(all.body.items.length, 120);

    const p1 = await getJson(server.baseUrl, '/items?limit=50&offset=0', token);
    const p2 = await getJson(server.baseUrl, '/items?limit=50&offset=50', token);
    const p3 = await getJson(server.baseUrl, '/items?limit=50&offset=100', token);

    assert.equal(p1.body.items.length, 50);
    assert.equal(p2.body.items.length, 50);
    assert.equal(p3.body.items.length, 20, 'the last page is short, which is how the client knows it is done');

    const paged = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i) => i.id);
    assert.deepEqual(paged, all.body.items.map((i) => i.id), 'paging must match a single full fetch exactly');
    assert.equal(new Set(paged).size, paged.length, 'no item may appear on two pages');
  });

  test('every item is reachable past the old 5000 cap boundary', async () => {
    // The cap itself still exists as a ceiling per request — what must not happen is a
    // request for the rows beyond it coming back empty.
    const beyond = await getJson(server.baseUrl, '/items?limit=50&offset=110', token);
    assert.equal(beyond.body.items.length, 10);
  });

  test('list rows omit the long-form metadata a card never renders', async () => {
    const { body } = await getJson(server.baseUrl, '/items?limit=1', token);
    const row = body.items[0];

    for (const field of ['title', 'author', 'series', 'media_type', 'cover_path', 'path']) {
      assert.ok(field in row, `the shelf needs ${field}`);
    }
    for (const field of ['description', 'genres', 'themes', 'artists', 'publisher']) {
      assert.ok(!(field in row), `${field} belongs to the detail view, not the list payload`);
    }
  });

  test('the detail endpoint still returns the full row', async () => {
    const list = await getJson(server.baseUrl, '/items?limit=1', token);
    const detail = await getJson(server.baseUrl, `/items/${list.body.items[0].id}`, token);
    assert.equal(detail.status, 200);
    assert.ok('description' in detail.body.item, 'detail views read description from here');
  });

  test('JSON responses are compressed on the wire', async () => {
    const res = await fetch(`${server.baseUrl}/api/items?limit=5000`, {
      headers: { ...authed(token), 'accept-encoding': 'gzip' }
    });
    assert.equal(res.headers.get('content-encoding'), 'gzip');
  });
});
