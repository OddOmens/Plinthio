import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

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

describe('/api/highlights', () => {
  let server;
  let adminToken;
  let viewerToken;

  before(async () => {
    server = await startTestServer();
    ({ token: adminToken } = await setupAdmin(server.baseUrl));
    await sendJson(server.baseUrl, 'POST', '/users', adminToken, { username: 'reader', password: 'reader-password-1' });
    viewerToken = await login(server.baseUrl, 'reader', 'reader-password-1');
  });

  after(async () => { await server.stop(); });

  test('saves highlights in book order, each with its colour', async () => {
    const later = await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, {
      itemId: 'book-1', cfiRange: 'epubcfi(/6/8!/4/2,/1:0,/1:20)', text: 'Later passage', color: 'blue', progress: 60
    });
    assert.equal(later.status, 201);
    assert.equal(later.body.highlight.color, 'blue');
    await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, {
      itemId: 'book-1', cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:10)', text: 'Early passage', progress: 5, chapter: 'Chapter 1'
    });

    const { body } = await getJson(server.baseUrl, '/highlights/book-1', adminToken);
    assert.deepEqual(body.highlights.map((h) => h.text), ['Early passage', 'Later passage']);
    assert.equal(body.highlights[0].color, 'yellow', 'yellow is the default');
    assert.equal(body.highlights[0].chapter, 'Chapter 1');
  });

  test('rejects an unknown colour and a missing range', async () => {
    const bad = await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, { itemId: 'book-1', cfiRange: 'epubcfi(/6/2)', color: 'purple' });
    assert.equal(bad.status, 400);
    const noRange = await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, { itemId: 'book-1' });
    assert.equal(noRange.status, 400);
  });

  test('recolours, adds and clears a note, and deletes', async () => {
    const { body: { highlight } } = await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, {
      itemId: 'book-2', cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', text: 'Hello'
    });
    const recoloured = await sendJson(server.baseUrl, 'PATCH', `/highlights/${highlight.id}`, adminToken, { color: 'pink', note: 'Remember this' });
    assert.equal(recoloured.body.highlight.color, 'pink');
    assert.equal(recoloured.body.highlight.note, 'Remember this');
    const cleared = await sendJson(server.baseUrl, 'PATCH', `/highlights/${highlight.id}`, adminToken, { note: '' });
    assert.equal(cleared.body.highlight.note, null);
    const gone = await sendJson(server.baseUrl, 'DELETE', `/highlights/${highlight.id}`, adminToken);
    assert.equal(gone.status, 200);
    const { body } = await getJson(server.baseUrl, '/highlights/book-2', adminToken);
    assert.equal(body.highlights.length, 0);
  });

  test("one reader can't see, change or delete another's highlights", async () => {
    const { body: { highlight } } = await sendJson(server.baseUrl, 'POST', '/highlights', adminToken, {
      itemId: 'book-3', cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', text: 'Private'
    });
    const { body } = await getJson(server.baseUrl, '/highlights/book-3', viewerToken);
    assert.equal(body.highlights.length, 0);
    assert.equal((await sendJson(server.baseUrl, 'PATCH', `/highlights/${highlight.id}`, viewerToken, { color: 'green' })).status, 404);
    assert.equal((await sendJson(server.baseUrl, 'DELETE', `/highlights/${highlight.id}`, viewerToken)).status, 404);
  });
});
