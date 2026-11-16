import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import {
  createParty, addConnection, dropUser, recheckConnections, endParty
} from '../src/services/party.js';

// A watch-party stream is checked as it opens; these make sure revoking or restricting the
// account afterwards ends it, and that the periodic re-check catches what raises no event.
const MOVIE = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

// ─── The service on its own ──────────────────────────────────────────────────────────────
describe('party service: dropping connections', () => {
  const fakeConnection = () => {
    const got = [];
    return { got, send: (p) => got.push(p), closed: () => got.includes(null) };
  };

  test('dropUser closes every connection of that account and hands the party over', () => {
    const party = createParty({ host: { id: 'h', username: 'host' }, item: { id: MOVIE } });
    const host1 = fakeConnection();
    const host2 = fakeConnection();
    const guest = fakeConnection();
    addConnection(party, { id: 'h', username: 'host' }, 'c1', host1.send);
    addConnection(party, { id: 'h', username: 'host' }, 'c2', host2.send);
    addConnection(party, { id: 'g', username: 'guest' }, 'c3', guest.send);

    assert.equal(dropUser('h'), 2);
    assert.ok(host1.closed() && host2.closed());
    assert.ok(!guest.closed());
    assert.equal(party.members.has('h'), false);
    assert.equal(party.hostId, 'g', 'the guest takes over');
    const presence = guest.got.filter((e) => e?.type === 'presence').at(-1);
    assert.deepEqual(presence.members.map((m) => m.userId), ['g']);
    assert.equal(dropUser('nobody'), 0);
    endParty(party);
  });

  test('recheckConnections closes the connections whose check fails, and keeps one that throws', async () => {
    const party = createParty({ host: { id: 'a', username: 'a' }, item: { id: MOVIE } });
    const ok = fakeConnection();
    const bad = fakeConnection();
    const flaky = fakeConnection();
    const legacy = fakeConnection();
    addConnection(party, { id: 'a', username: 'a' }, 'ok', ok.send, async () => true);
    addConnection(party, { id: 'b', username: 'b' }, 'bad', bad.send, async () => false);
    addConnection(party, { id: 'c', username: 'c' }, 'flaky', flaky.send, async () => { throw new Error('db busy'); });
    addConnection(party, { id: 'd', username: 'd' }, 'legacy', legacy.send);

    assert.equal(await recheckConnections(), 1);
    assert.ok(bad.closed());
    assert.ok(!ok.closed() && !flaky.closed() && !legacy.closed());
    assert.deepEqual([...party.members.keys()].sort(), ['a', 'c', 'd']);
    endParty(party);
  });
});

// ─── Over HTTP ───────────────────────────────────────────────────────────────────────────
describe('party streams end when the account is revoked or restricted', () => {
  let server;
  let admin;
  let db;

  const send = async (method, url, token, body) => {
    const res = await fetch(`${server.baseUrl}/api${url}`, {
      method,
      headers: { ...authed(token), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const login = async (username, password) => (await send('POST', '/auth/login', null, { username, password })).body.token;
  async function account(username) {
    const password = `${username}-password-1`;
    const made = await send('POST', '/users', admin.token, { username, password });
    return { id: made.body.user.id, username, password, token: await login(username, password) };
  }

  // Opens a party's event stream. `ended` resolves when the server closes it; `events` holds
  // what arrived.
  function connect(code, token, clientId) {
    const controller = new AbortController();
    const events = [];
    let resolveEnded;
    const ended = new Promise((r) => { resolveEnded = r; });
    const ready = fetch(`${server.baseUrl}/api/party/${code}/events?clientId=${clientId}`, {
      headers: authed(token), signal: controller.signal
    }).then((res) => {
      if (res.status !== 200) { resolveEnded('refused'); return res.status; }
      (async () => {
        const decoder = new TextDecoder();
        let buf = '';
        try {
          for await (const chunk of res.body) {
            buf += decoder.decode(chunk, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const line = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data: '));
              buf = buf.slice(idx + 2);
              if (line) events.push(JSON.parse(line.slice(6)));
            }
          }
          resolveEnded('closed');
        } catch {
          resolveEnded('aborted');
        }
      })();
      return 200;
    });
    return { ready, events, ended, close: () => controller.abort() };
  }
  const within = (promise, ms = 3000) => Promise.race([promise, new Promise((r) => setTimeout(() => r('still open'), ms))]);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  async function startParty(item = MOVIE) {
    const made = await send('POST', '/party', admin.token, { itemId: item });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const code = made.body.party.code;
    const host = connect(code, admin.token, `host-${code}`);
    assert.equal(await host.ready, 200);
    return { code, host };
  }

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    admin = await setupAdmin(server.baseUrl);
    const { libraryId } = await seedItems(server.dataDir, 1);
    db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    for (const [id, title] of [[MOVIE, 'Some Film'], [OTHER, 'Another Film']]) {
      await db.run(
        `INSERT INTO items (id, library_id, title, path, media_type, format, age_rating) VALUES (?, ?, ?, ?, 'movie', 'mkv', 'Everyone')`,
        [id, libraryId, title, `/tmp/seeded/${id}.mkv`]
      );
    }
    assert.equal((await send('PATCH', '/customization', admin.token, { partyModeEnabled: true })).status, 200);
  });

  after(async () => {
    await db?.close();
    await server?.stop();
  });

  test('deleting the account ends its stream, and later chat does not reach it', async () => {
    const guest = await account('gone');
    const { code, host } = await startParty();
    const stream = connect(code, guest.token, 'guest-gone-1');
    assert.equal(await stream.ready, 200);
    await settle();

    assert.equal((await send('DELETE', `/users/${guest.id}`, admin.token)).status, 200);
    assert.equal(await within(stream.ended), 'closed');
    assert.equal((await send('POST', `/party/${code}/chat`, admin.token, { text: 'still there?' })).status, 200);
    await settle();
    assert.ok(!stream.events.some((e) => e.type === 'chat'), 'nothing after the account went');
    const party = (await send('GET', `/party/${code}`, admin.token)).body.party;
    assert.deepEqual(party.members.map((m) => m.name), ['admin']);
    // And it can't come back.
    const again = connect(code, guest.token, 'guest-gone-2');
    assert.equal(await again.ready, 401);
    host.close();
  });

  test('a password reset, a password change and "sign out everywhere" each end the stream', async () => {
    const u = await account('signedout');
    const { code, host } = await startParty();

    let stream = connect(code, u.token, 'signedout-1');
    assert.equal(await stream.ready, 200);
    await settle();
    assert.equal((await send('PATCH', `/users/${u.id}/password`, admin.token, { newPassword: 'reset-password-1' })).status, 200);
    assert.equal(await within(stream.ended), 'closed', 'admin reset');

    let token = await login(u.username, 'reset-password-1');
    stream = connect(code, token, 'signedout-2');
    assert.equal(await stream.ready, 200);
    await settle();
    assert.equal((await send('PATCH', '/users/password', token, { currentPassword: 'reset-password-1', newPassword: 'changed-password-1' })).status, 200);
    assert.equal(await within(stream.ended), 'closed', 'own change');

    token = await login(u.username, 'changed-password-1');
    stream = connect(code, token, 'signedout-3');
    assert.equal(await stream.ready, 200);
    await settle();
    assert.equal((await send('POST', '/auth/sign-out-everywhere', token)).status, 200);
    assert.equal(await within(stream.ended), 'closed', 'sign out everywhere');
    host.close();
  });

  test('turning Kids Mode on ends the stream, and the account cannot rejoin a title it may not see', async () => {
    const kid = await account('kiddo');
    const { code, host } = await startParty();
    const stream = connect(code, kid.token, 'kiddo-client-1');
    assert.equal(await stream.ready, 200);
    await settle();
    assert.equal((await send('PATCH', `/users/${kid.id}`, admin.token, { kidsMode: true })).status, 200);
    assert.equal(await within(stream.ended), 'closed');
    assert.equal(await connect(code, kid.token, 'kiddo-client-2').ready, 403, 'P603 on the way back in');
    assert.equal(await within(host.ended, 200), 'still open', 'the host stays');
    host.close();
  });

  test('changing the title checks each member as the account is now, not as it joined', async () => {
    const member = await account('quietly');
    const { code, host } = await startParty();
    const stream = connect(code, member.token, 'quietly-client-1');
    assert.equal(await stream.ready, 200);
    await settle();
    // Restricted with no event the party hears of (straight in the database).
    await db.run('UPDATE users SET kids_mode = 1 WHERE id = ?', [member.id]);
    const change = await send('POST', `/party/${code}/item`, admin.token, { itemId: OTHER });
    assert.equal(change.status, 409, JSON.stringify(change.body));
    assert.equal(change.body.code, 'P604');
    stream.close();
    host.close();
  });
});
