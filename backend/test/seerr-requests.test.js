import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { startFakeSeerr, GOOD_KEY } from './helpers/fakeSeerr.js';


describe('sending accepted requests to Seerr', () => {
  let server;
  let seerr;
  let admin;
  let viewer;

  const call = async (method, path, token, body) => {
    const res = await fetch(`${server.baseUrl}/api${path}`, {
      method,
      headers: { ...authed(token), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  const ask = async (token, mediaType, source, externalId, title) =>
    (await call('POST', '/requests', token, { mediaType, source, externalId, title })).body.request;
  const accept = (id) => call('PATCH', `/requests/${id}`, admin, { status: 'accepted_pending' });
  const sentToSeerr = () => seerr.state.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/request');

  before(async () => {
    server = await startTestServer();
    seerr = await startFakeSeerr();
    admin = (await setupAdmin(server.baseUrl)).token;
    const made = await call('POST', '/users', admin, { username: 'viewer', password: 'viewer-password-1', role: 'viewer' });
    assert.ok(made.body.user?.id, JSON.stringify(made.body));
    const login = await call('POST', '/auth/login', null, { username: 'viewer', password: 'viewer-password-1' });
    viewer = login.body.token;
  });

  after(async () => {
    await server.stop();
    await seerr.stop();
  });

  test('with no Seerr set up, accepting a request sends nothing anywhere', async () => {
    const req = await ask(viewer, 'movie', 'tmdb', '11', 'Star Wars');
    const { body } = await accept(req.id);
    assert.equal(body.request.status, 'accepted_pending');
    assert.equal(body.request.forward_state, null);
    assert.equal(body.request.can_forward, false);
    assert.equal(seerr.state.calls.length, 0);
    // Nothing to send it to: asking to is refused.
    assert.equal((await call('POST', `/requests/${req.id}/forward`, admin)).body.reason, 'off');
  });

  test('the connection is checked before it is saved, and the key is never given back', async () => {
    const bad = await call('PUT', '/settings/seerr', admin, { url: seerr.url, apiKey: 'wrong' });
    assert.equal(bad.status, 502);
    assert.equal(bad.body.code, 'P507');
    assert.equal(bad.body.reason, 'unauthorized');
    assert.deepEqual((await getJson(server.baseUrl, '/settings/seerr', admin)).body, { url: '', hasKey: false, enabled: false });

    const notUrl = await call('PUT', '/settings/seerr', admin, { url: 'seerr:5055', apiKey: GOOD_KEY });
    assert.equal(notUrl.status, 400);
    assert.equal(notUrl.body.reason, 'invalid_url');

    // A trailing slash or the API path pasted along are tidied away.
    const good = await call('PUT', '/settings/seerr', admin, { url: `${seerr.url}/api/v1/`, apiKey: GOOD_KEY });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body, { url: seerr.url, hasKey: true, enabled: true, version: '3.5.0' });
    assert.ok(!JSON.stringify(good.body).includes(GOOD_KEY));
    assert.ok(!JSON.stringify((await getJson(server.baseUrl, '/settings/seerr', admin)).body).includes(GOOD_KEY));
    assert.equal((await call('POST', '/settings/seerr/test', admin)).body.ok, true);
    assert.ok(!server.output().includes(GOOD_KEY), 'the key is not written to the log');
  });

  test('the saved key is not sent to a different server', async () => {
    const moved = await call('PUT', '/settings/seerr', admin, { url: 'http://localhost:1' });
    assert.equal(moved.status, 400);
    assert.equal(moved.body.reason, 'key_required');
    // The same server without retyping the key is fine (switching it off and on, say).
    assert.equal((await call('PUT', '/settings/seerr', admin, { url: seerr.url })).status, 200);
  });

  test('only admins can see or change the connection', async () => {
    assert.equal((await getJson(server.baseUrl, '/settings/seerr', viewer)).status, 403);
    assert.equal((await call('PUT', '/settings/seerr', viewer, { url: seerr.url, apiKey: GOOD_KEY })).status, 403);
  });

  test('accepting a film sends its TMDB id; a show asks for every season', async () => {
    const film = await ask(viewer, 'movie', 'tmdb', '603', 'The Matrix');
    const accepted = await accept(film.id);
    assert.equal(accepted.body.request.forward_state, 'sent');
    assert.equal(accepted.body.request.forward_target, 'seerr');
    assert.equal(accepted.body.request.forward_ref, '41');
    assert.equal(accepted.body.request.can_forward, false);
    assert.deepEqual(sentToSeerr().at(-1).body, { mediaType: 'movie', mediaId: 603 });
    assert.equal(sentToSeerr().at(-1).key, GOOD_KEY);

    const show = await ask(viewer, 'anime', 'tmdb', '1396', 'Some Anime');
    await accept(show.id);
    assert.deepEqual(sentToSeerr().at(-1).body, { mediaType: 'tv', mediaId: 1396, seasons: 'all' });

    // Accepting it a second time (back to pending, accepted again) doesn't ask Seerr twice.
    const before = sentToSeerr().length;
    await call('PATCH', `/requests/${film.id}`, admin, { status: 'pending' });
    await accept(film.id);
    assert.equal(sentToSeerr().length, before);
  });

  test('only "accepted, still to add" sends: not rejected, and not "already added"', async () => {
    const before = sentToSeerr().length;
    const a = await ask(viewer, 'movie', 'tmdb', '100', 'Rejected Film');
    await call('PATCH', `/requests/${a.id}`, admin, { status: 'rejected' });
    const b = await ask(viewer, 'movie', 'tmdb', '101', 'Already Here');
    await call('PATCH', `/requests/${b.id}`, admin, { status: 'accepted_added' });
    assert.equal(sentToSeerr().length, before);
  });

  test('books, and titles found somewhere other than TMDB, stay in Plinthio', async () => {
    const before = sentToSeerr().length;
    const book = await ask(viewer, 'book', 'open-library', 'OL123W', 'A Book');
    const other = await ask(viewer, 'show', 'tvmaze', '82', 'A Show');
    for (const req of [book, other]) {
      const { body } = await accept(req.id);
      assert.equal(body.request.forward_state, null);
      assert.equal(body.request.can_forward, false);
    }
    assert.equal(sentToSeerr().length, before);
  });

  test('a title Seerr already has counts as passed on', async () => {
    seerr.state.nextRequest = { status: 409, data: { message: 'Request for this media already exists.' } };
    const req = await ask(viewer, 'movie', 'tmdb', '200', 'Requested Twice');
    assert.equal((await accept(req.id)).body.request.forward_state, 'exists');
  });

  test('a failure is kept on the request, the accept still stands, and it can be sent again', async () => {
    seerr.state.nextRequest = { status: 500, data: { message: 'Radarr is\nnot reachable' } };
    const req = await ask(viewer, 'movie', 'tmdb', '300', 'Unlucky Film');
    const failed = (await accept(req.id)).body.request;
    assert.equal(failed.status, 'accepted_pending');
    assert.equal(failed.forward_state, 'failed');
    assert.equal(failed.forward_reason, 'failed');
    assert.equal(failed.forward_detail, 'Radarr is not reachable');
    assert.equal(failed.can_forward, true);

    const again = await call('POST', `/requests/${req.id}/forward`, admin);
    assert.equal(again.status, 200);
    assert.equal(again.body.request.forward_state, 'sent');
    assert.equal(again.body.request.forward_reason, null);

    // A viewer can't send anything on.
    assert.equal((await call('POST', `/requests/${req.id}/forward`, viewer)).status, 403);
  });

  test('the requester sees the status, not where it was sent', async () => {
    const mine = (await getJson(server.baseUrl, '/requests', viewer)).body;
    assert.equal(mine.forwarding, undefined);
    const matrix = mine.requests.find((r) => r.title === 'The Matrix');
    assert.equal(matrix.status, 'accepted_pending');
    for (const field of ['forward_target', 'forward_state', 'forward_reason', 'forward_detail', 'forward_ref', 'can_forward']) {
      assert.ok(!(field in matrix), `${field} is not shown to the requester`);
    }
    const queue = (await getJson(server.baseUrl, '/requests?scope=all', admin)).body;
    assert.equal(queue.forwarding, 'seerr');
    assert.equal(queue.requests.find((r) => r.title === 'The Matrix').forward_state, 'sent');
  });

  test('an unreachable Seerr is reported as that, and switching it off stops sending', async () => {
    await seerr.stop();
    const req = await ask(viewer, 'movie', 'tmdb', '400', 'Offline Film');
    const failed = (await accept(req.id)).body.request;
    assert.equal(failed.forward_state, 'failed');
    assert.equal(failed.forward_reason, 'unreachable');
    assert.equal((await call('POST', '/settings/seerr/test', admin)).body.reason, 'unreachable');

    // Removing the address clears the key with it.
    const cleared = await call('PUT', '/settings/seerr', admin, { url: '' });
    assert.deepEqual(cleared.body, { url: '', hasKey: false, enabled: false });
    const later = await ask(viewer, 'movie', 'tmdb', '401', 'Later Film');
    assert.equal((await accept(later.id)).body.request.forward_state, null);
    seerr = await startFakeSeerr();
  });
});
