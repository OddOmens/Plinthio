import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';

const MOVIE = 'a'.repeat(32);
const EPISODE = 'b'.repeat(32);
const MATURE = 'c'.repeat(32);

async function seedVideo(dataDir, libraryId) {
  const db = await open({ filename: path.join(dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 5000');
  const insert = (id, title, type, ageRating = null) => db.run(
    `INSERT INTO items (id, library_id, title, path, media_type, format, age_rating) VALUES (?, ?, ?, ?, ?, 'mkv', ?)`,
    [id, libraryId, title, `/tmp/seeded/${id}.mkv`, type, ageRating]
  );
  await insert(MOVIE, 'Some Film', 'movie', 'Everyone');
  await insert(EPISODE, 'Pilot', 'show', 'Everyone');
  await insert(MATURE, 'Grim Film', 'movie', 'Mature');
  await db.close();
}

async function send(baseUrl, method, url, token, body) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return (await res.json()).token;
}

// Opens a party's event stream and collects its events; `next(pred)` waits for one.
function connect(baseUrl, code, token, clientId) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const ready = fetch(`${baseUrl}/api/party/${code}/events?clientId=${clientId}`, {
    headers: authed(token),
    signal: controller.signal
  }).then(async (res) => {
    if (res.status !== 200) return res.status;
    (async () => {
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const event = JSON.parse(line.slice(6));
            events.push(event);
            for (const w of [...waiters]) {
              if (w.pred(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event); }
            }
          }
        }
      } catch (e) { /* aborted */ }
    })();
    return 200;
  });
  return {
    ready,
    events,
    next(pred, timeout = 3000) {
      const found = events.find(pred);
      if (found) { events.splice(events.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (e) => { events.splice(events.indexOf(e), 1); clearTimeout(t); resolve(e); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timed out waiting for event')); }, timeout);
        waiters.push(w);
      });
    },
    close() { controller.abort(); }
  };
}

describe('/api/party', () => {
  let server;
  let admin;
  let viewer;
  let teen;

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    ({ token: admin } = await setupAdmin(server.baseUrl));
    const { libraryId } = await seedItems(server.dataDir, 1);
    await seedVideo(server.dataDir, libraryId);
    await send(server.baseUrl, 'POST', '/users', admin, { username: 'viewer', password: 'viewer-password-1' });
    viewer = await login(server.baseUrl, 'viewer', 'viewer-password-1');
    const created = await send(server.baseUrl, 'POST', '/users', admin, { username: 'teen', password: 'teen-password-1' });
    const teenId = created.body.user?.id || created.body.id;
    await send(server.baseUrl, 'PATCH', `/users/${teenId}`, admin, { maxAgeRating: 'Teen' });
    teen = await login(server.baseUrl, 'teen', 'teen-password-1');
  });

  after(async () => { await server.stop(); });

  test('is off until an admin turns it on', async () => {
    const off = await send(server.baseUrl, 'POST', '/party', admin, { itemId: MOVIE });
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'P600');
    const custom = await getJson(server.baseUrl, '/customization', admin);
    assert.equal(custom.body.partyModeEnabled, false);

    const on = await send(server.baseUrl, 'PATCH', '/customization', admin, { partyModeEnabled: true });
    assert.equal(on.body.partyModeEnabled, true);
  });

  test('only a movie or episode can be watched together', async () => {
    const res = await send(server.baseUrl, 'POST', '/party', admin, { itemId: 'seed-00000' });
    assert.equal(res.status, 400);
  });

  test('host and guest stay in step; guests can\'t control until allowed', async () => {
    const created = await send(server.baseUrl, 'POST', '/party', admin, { itemId: MOVIE });
    assert.equal(created.status, 201);
    const { code } = created.body.party;
    assert.match(code, /^[A-Z2-9]{6}$/);

    const host = connect(server.baseUrl, code, admin, 'host-client-1');
    assert.equal(await host.ready, 200);
    const snap = await host.next((e) => e.type === 'snapshot');
    assert.equal(snap.party.itemId, MOVIE);

    const guest = connect(server.baseUrl, code, viewer, 'guest-client-1');
    assert.equal(await guest.ready, 200);
    await guest.next((e) => e.type === 'snapshot');
    const presence = await host.next((e) => e.type === 'presence' && e.members.length === 2);
    assert.deepEqual(presence.members.map((m) => m.name), ['admin', 'viewer']);

    // The host plays at 42s: the guest hears it; the host (who did it) is told it was them.
    await send(server.baseUrl, 'POST', `/party/${code}/action`, admin, { action: 'play', position: 42, clientId: 'host-client-1' });
    const played = await guest.next((e) => e.type === 'state' && e.state.playing);
    assert.equal(played.state.position, 42);
    assert.equal(played.by, 'host-client-1');

    const denied = await send(server.baseUrl, 'POST', `/party/${code}/action`, viewer, { action: 'pause', position: 50 });
    assert.equal(denied.body.code, 'P602');

    await send(server.baseUrl, 'POST', `/party/${code}/settings`, admin, { controlMode: 'everyone' });
    const allowed = await send(server.baseUrl, 'POST', `/party/${code}/action`, viewer, { action: 'pause', position: 50 });
    assert.equal(allowed.status, 200);
    const paused = await host.next((e) => e.type === 'state' && !e.state.playing);
    assert.equal(paused.state.position, 50);

    // Buffering holds everyone, and letting go resumes.
    await send(server.baseUrl, 'POST', `/party/${code}/action`, admin, { action: 'play', position: 50 });
    await guest.next((e) => e.type === 'state' && e.state.playing);
    await send(server.baseUrl, 'POST', `/party/${code}/buffering`, viewer, { buffering: true });
    const held = await host.next((e) => e.type === 'state' && e.held);
    assert.equal(held.state.playing, false);
    await send(server.baseUrl, 'POST', `/party/${code}/buffering`, viewer, { buffering: false });
    const resumed = await host.next((e) => e.type === 'state' && !e.held && e.state.playing);
    assert.ok(resumed);

    await send(server.baseUrl, 'POST', `/party/${code}/chat`, viewer, { text: 'popcorn ready' });
    const chat = await host.next((e) => e.type === 'chat');
    assert.equal(chat.message.text, 'popcorn ready');
    assert.equal(chat.message.name, 'viewer');

    // The host leaves: the guest takes over.
    host.close();
    const handover = await guest.next((e) => e.type === 'presence' && e.members.length === 1);
    assert.equal(handover.hostId, handover.members[0].userId);

    const ended = await send(server.baseUrl, 'DELETE', `/party/${code}`, viewer);
    assert.equal(ended.status, 200);
    await guest.next((e) => e.type === 'ended');
    assert.equal((await getJson(server.baseUrl, `/party/${code}`, viewer)).body.code, 'P601');
  });

  test('content limits apply: joining, and switching titles', async () => {
    const mature = await send(server.baseUrl, 'POST', '/party', admin, { itemId: MATURE });
    const blocked = await getJson(server.baseUrl, `/party/${mature.body.party.code}`, teen);
    assert.equal(blocked.body.code, 'P603');

    const created = await send(server.baseUrl, 'POST', '/party', admin, { itemId: MOVIE });
    const { code } = created.body.party;
    const host = connect(server.baseUrl, code, admin, 'host-client-2');
    const guest = connect(server.baseUrl, code, teen, 'teen-client-1');
    await host.ready;
    await guest.ready;
    await host.next((e) => e.type === 'presence' && e.members.length === 2);

    const refused = await send(server.baseUrl, 'POST', `/party/${code}/item`, admin, { itemId: MATURE });
    assert.equal(refused.body.code, 'P604');
    const switched = await send(server.baseUrl, 'POST', `/party/${code}/item`, admin, { itemId: EPISODE });
    assert.equal(switched.status, 200);
    const item = await guest.next((e) => e.type === 'item');
    assert.equal(item.itemId, EPISODE);
    host.close();
    guest.close();
  });

  test('turning the feature off ends running parties', async () => {
    const created = await send(server.baseUrl, 'POST', '/party', admin, { itemId: MOVIE });
    const { code } = created.body.party;
    const host = connect(server.baseUrl, code, admin, 'host-client-3');
    await host.ready;
    await send(server.baseUrl, 'PATCH', '/customization', admin, { partyModeEnabled: false });
    const ended = await host.next((e) => e.type === 'ended');
    assert.equal(ended.reason, 'disabled');
    host.close();
  });
});
