import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { startFakeSeerr, GOOD_KEY } from './helpers/fakeSeerr.js';

describe('accepting requests automatically', () => {
  let server;
  let seerr;
  let admin;
  let viewer;
  let kid;

  const call = async (method, path, token, body) => {
    const res = await fetch(`${server.baseUrl}/api${path}`, {
      method,
      headers: { ...authed(token), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  const ask = async (token, externalId, title, mediaType = 'movie', source = 'tmdb') =>
    (await call('POST', '/requests', token, { mediaType, source, externalId, title })).body.request;
  const setMode = (autoAccept, token = admin) => call('PUT', '/settings/requests', token, { autoAccept });
  const sentToSeerr = () => seerr.state.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/request');
  const signUp = async (username, extra = {}) => {
    const made = await call('POST', '/users', admin, { username, password: `${username}-password-1`, role: 'viewer' });
    assert.ok(made.body.user?.id, JSON.stringify(made.body));
    if (Object.keys(extra).length) {
      const limited = await call('PATCH', `/users/${made.body.user.id}`, admin, extra);
      assert.equal(limited.status, 200, JSON.stringify(limited.body));
    }
    return (await call('POST', '/auth/login', null, { username, password: `${username}-password-1` })).body.token;
  };

  before(async () => {
    server = await startTestServer();
    seerr = await startFakeSeerr();
    admin = (await setupAdmin(server.baseUrl)).token;
    viewer = await signUp('viewer');
    kid = await signUp('kid', { kidsMode: true });
    const saved = await call('PUT', '/settings/seerr', admin, { url: seerr.url, apiKey: GOOD_KEY });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });

  after(async () => {
    await server.stop();
    await seerr.stop();
  });

  test('it is off until an admin turns it on, and only an admin can', async () => {
    assert.deepEqual((await getJson(server.baseUrl, '/settings/requests', admin)).body, { autoAccept: 'off' });
    assert.equal((await getJson(server.baseUrl, '/settings/requests', viewer)).status, 403);
    assert.equal((await setMode('all', viewer)).status, 403);
    assert.equal((await setMode('everyone')).status, 400);

    const req = await ask(admin, '1', 'Waits For Review');
    assert.equal(req.status, 'pending');
    assert.equal(sentToSeerr().length, 0);
  });

  test('"staff": an admin\'s own request is accepted and sent on; a viewer\'s still waits', async () => {
    assert.deepEqual((await setMode('staff')).body, { autoAccept: 'staff' });

    const mine = await ask(admin, '603', 'The Matrix');
    assert.equal(mine.status, 'accepted_pending');
    assert.equal(mine.auto_accepted, 1);
    assert.equal(mine.forward_state, 'sent');
    assert.deepEqual(sentToSeerr().at(-1).body, { mediaType: 'movie', mediaId: 603 });

    const before = sentToSeerr().length;
    const theirs = await ask(viewer, '11', 'Star Wars');
    assert.equal(theirs.status, 'pending');
    assert.equal(sentToSeerr().length, before);
  });

  test('"all": a viewer\'s request is accepted and sent on, without telling them where', async () => {
    await setMode('all');
    const req = await ask(viewer, '1396', 'A Show', 'show');
    assert.equal(req.status, 'accepted_pending');
    assert.deepEqual(sentToSeerr().at(-1).body, { mediaType: 'tv', mediaId: 1396, seasons: 'all' });
    assert.ok(!('forward_state' in req), 'where it went is the reviewers\' business');

    // The review queue shows it as accepted with nobody's name on it.
    const queue = (await getJson(server.baseUrl, '/requests?scope=all', admin)).body.requests;
    const row = queue.find((r) => r.id === req.id);
    assert.equal(row.auto_accepted, 1);
    assert.equal(row.handled_by, null);
    assert.equal(row.forward_state, 'sent');
    assert.equal((await getJson(server.baseUrl, '/requests/pending-count', admin)).body.count, 2);
  });

  test('a book is accepted too, and simply stays in the queue to be added', async () => {
    const before = sentToSeerr().length;
    const book = await ask(admin, 'OL1W', 'A Book', 'book', 'open-library');
    assert.equal(book.status, 'accepted_pending');
    assert.equal(book.forward_state, null);
    assert.equal(sentToSeerr().length, before);
  });

  test('an account with Kids Mode always waits for a reviewer', async () => {
    const before = sentToSeerr().length;
    const req = await ask(kid, '862', 'Toy Story');
    assert.equal(req.status, 'pending');
    assert.equal(sentToSeerr().length, before);
  });

  test('Seerr being down does not lose the request: it is accepted, with the failure kept', async () => {
    seerr.state.nextRequest = { status: 500, data: { message: 'down' } };
    const req = await ask(admin, '949', 'Heat');
    assert.equal(req.status, 'accepted_pending');
    assert.equal(req.forward_state, 'failed');
    const again = await call('POST', `/requests/${req.id}/forward`, admin);
    assert.equal(again.body.request.forward_state, 'sent');
  });
});
