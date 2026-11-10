import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, authed } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import { totpAt, base32Decode, currentStep } from '../src/services/twoFactor.js';

// Accounts, sessions, API keys and what a restricted account can find out, over HTTP against
// a real server. As in access-and-2fa.test.js the server trusts 127.0.0.1 as its proxy, so
// each request says where it "comes from" with X-Forwarded-For.
const JWT_SECRET = 'test-secret-not-used-anywhere-real'; // what helpers/server.js starts it with
let homeCounter = 1;
let outsideCounter = 1;
// Fresh addresses, so the per-address rate limits never decide a test.
const home = () => `192.168.7.${homeCounter++}`;
const outside = () => `203.0.113.${outsideCounter++}`;

describe('accounts, keys and restricted views', () => {
  let server;
  let base;
  let db;

  const req = async (method, url, { from = '192.168.1.20', token, apiKey, body, headers: extra = {} } = {}) => {
    const headers = { 'x-forwarded-for': from, ...extra };
    if (token) Object.assign(headers, authed(token));
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: data, headers: res.headers };
  };
  const login = (username, password, from = home()) => req('POST', '/auth/login', { from, body: { username, password } });
  const codeFor = (secret, offset = 0) => totpAt(base32Decode(secret), currentStep() + offset);
  const logText = async () => JSON.stringify((await req('GET', '/admin/logs?limit=300', { token: adminToken })).body);

  const ADMIN = { username: 'owner', password: 'owner-password-1' };
  let adminToken;
  let adminId;
  const users = {};

  // An account made by the admin and signed in at home.
  async function account(username, extra = {}) {
    const password = `${username}-password-1`;
    const made = await req('POST', '/users', { token: adminToken, body: { username, password } });
    const id = made.body.user.id;
    if (Object.keys(extra).length) {
      const patched = await req('PATCH', `/users/${id}`, { token: adminToken, body: extra });
      assert.equal(patched.status, 200, JSON.stringify(patched.body));
    }
    const session = await login(username, password);
    users[username] = { id, username, password, token: session.body.token, mediaToken: session.body.mediaToken };
    return users[username];
  }

  // One more title, written straight into the catalog like helpers/seed.js does.
  const VIDEO_ID = 'a'.repeat(32);
  const addItem = (id, libraryId, fields = {}) => db.run(
    `INSERT INTO items (id, library_id, title, series, path, media_type, format, age_rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, libraryId, fields.title || id, fields.series || null, `/tmp/seeded/${id}.bin`, fields.mediaType || 'manga', fields.format || 'cbz', fields.ageRating || null]
  );

  before(async () => {
    server = await startTestServer({ env: { TRUST_PROXY: 'loopback' } });
    base = server.baseUrl;
    const setup = await req('POST', '/auth/setup', { body: { ...ADMIN } });
    assert.equal(setup.status, 200);
    adminToken = setup.body.token;
    adminId = setup.body.user.id;
    // seed-00000 … seed-00021, in series "Series 0" … "Series 10", one library.
    await seedItems(server.dataDir, 22);
    db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    // A film in its own library, so the counts for the seeded one stay round.
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('films', 'Films', '/tmp/films', 'movies')");
    await addItem(VIDEO_ID, 'films', { title: 'A Film', mediaType: 'movie', format: 'mp4' });
  });
  after(async () => {
    await db.close();
    await server.stop();
  });

  // ─── Avatars (while the server is still home-only) ─────────────────────────────────────
  test('a home-only server gives no avatars to the internet', async () => {
    const away = await req('GET', `/users/${adminId}/avatar`, { from: outside() });
    assert.equal(away.status, 403);
    assert.equal(away.body.code, 'P109');
    // At home it answers without a sign-in, as <img> needs (this account just has none).
    assert.equal((await req('GET', `/users/${adminId}/avatar`)).status, 404);
  });

  // ─── Session and media tokens ──────────────────────────────────────────────────────────
  test('session tokens say what they are; ones from before the update still work', async () => {
    const payload = jwt.verify(adminToken, JWT_SECRET);
    assert.equal(payload.typ, 'session');

    const legacy = jwt.sign({ userId: adminId, username: ADMIN.username, role: 'admin', tokenVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await req('GET', '/auth/me', { token: legacy })).status, 200, 'nobody is signed out by updating');
    // Refreshing swaps it for a labelled one.
    const refreshed = await req('POST', '/auth/refresh', { token: legacy });
    assert.equal(jwt.verify(refreshed.body.token, JWT_SECRET).typ, 'session');
  });

  test('a token of any other kind is not a sign-in, even with a user id in it', async () => {
    for (const typ of ['komga', 'something-new']) {
      const other = jwt.sign({ userId: adminId, tokenVersion: 0, typ }, JWT_SECRET, { expiresIn: '1h' });
      const res = await req('GET', '/auth/me', { token: other });
      assert.equal(res.status, 401, typ);
      assert.equal(res.body.code, 'P102');
    }
    const noUser = jwt.sign({ keyId: 'abc' }, JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await req('GET', '/auth/me', { token: noUser })).body.code, 'P102');
  });

  test('a media token only reads, apart from telling the player to stop', async () => {
    const media = (await req('POST', '/auth/media-token', { token: adminToken })).body.mediaToken;
    const id = VIDEO_ID;
    const write = await req('PUT', `/media/video/${id}/markers?token=${media}`, { body: { intro: null } });
    assert.equal(write.status, 401);
    assert.equal(write.body.code, 'P102');
    // The video player's goodbye as the page closes (navigator.sendBeacon, which can't send
    // a header) is the one thing it may POST.
    const stop = await req('POST', `/media/video/${id}/hls/stop?token=${media}`);
    assert.equal(stop.status, 200);
    // And it still isn't a session.
    assert.equal((await req('GET', '/auth/me', { token: media })).body.code, 'P102');
  });

  // ─── Passwords, API keys, signing out everywhere ───────────────────────────────────────
  test('making an API key needs the password, and is logged without the key', async () => {
    const u = await account('keymaker');
    const none = await req('POST', '/keys', { token: u.token, body: { name: 'Phone' } });
    assert.equal(none.status, 401);
    assert.equal(none.body.code, 'P107');
    assert.equal((await req('POST', '/keys', { token: u.token, body: { name: 'Phone', password: 'wrong' } })).body.code, 'P107');
    assert.equal((await req('GET', '/keys', { token: u.token })).body.keys.length, 0);
    // A wrong password there doesn't end the session.
    assert.equal((await req('GET', '/auth/me', { token: u.token })).status, 200);

    const made = await req('POST', '/keys', { token: u.token, body: { name: 'Phone', password: u.password } });
    assert.equal(made.status, 200);
    u.key = made.body.key.key;
    assert.equal((await req('GET', '/items', { apiKey: u.key })).status, 200);

    const logs = await logText();
    assert.match(logs, /\\"keymaker\\" made an API key named \\"Phone\\"/);
    assert.match(logs, /keymaker\\" gave a wrong password while making an API key/);
    assert.ok(!logs.includes(u.key), 'the key itself is never logged');
  });

  test('changing the password: sessions only, keys kept unless asked, and it says how many', async () => {
    const u = users.keymaker;
    const viaKey = await req('PATCH', '/users/password', { apiKey: u.key, body: { currentPassword: u.password, newPassword: 'another-password-1' } });
    assert.equal(viaKey.status, 403, 'an API key can\'t change the password');

    const wrong = await req('PATCH', '/users/password', { token: u.token, body: { currentPassword: 'nope', newPassword: 'another-password-1' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'P107', 'a code the app does not treat as a dead session');

    const kept = await req('PATCH', '/users/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'another-password-1' } });
    assert.equal(kept.status, 200);
    assert.equal(kept.body.apiKeys, 1);
    assert.equal(kept.body.apiKeysRevoked, 0);
    assert.equal((await req('GET', '/auth/me', { token: u.token })).body.code, 'P101', 'old sessions are signed out');
    assert.equal((await req('GET', '/items', { apiKey: u.key })).status, 200, 'reading apps carry on');

    const again = await login(u.username, 'another-password-1');
    const revoked = await req('PATCH', '/users/password', {
      token: again.body.token, body: { currentPassword: 'another-password-1', newPassword: u.password, revokeApiKeys: true }
    });
    assert.equal(revoked.body.apiKeysRevoked, 1);
    assert.equal(revoked.body.apiKeys, 0);
    assert.equal((await req('GET', '/items', { apiKey: u.key })).body.code, 'P104');
    assert.match(await logText(), /keymaker\\" changed their password and revoked 1 API key/);
  });

  test('guessing the current password from a signed-in session stops after ten tries', async () => {
    const u = await account('guessed');
    for (let i = 0; i < 10; i++) {
      const res = await req('PATCH', '/users/password', { token: u.token, body: { currentPassword: `guess-${i}`, newPassword: 'whatever-password-1' } });
      assert.equal(res.body.code, 'P107');
    }
    const held = await req('PATCH', '/users/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'whatever-password-1' } });
    assert.equal(held.status, 429, 'even the right password waits');
    assert.equal(held.body.code, 'P108');
    // The same hold covers the other places a password is asked for again.
    assert.equal((await req('POST', '/keys', { token: u.token, body: { name: 'x', password: u.password } })).body.code, 'P108');
    assert.equal((await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } })).body.code, 'P108');
    // Signing in is not affected: nobody is locked out of the server.
    assert.equal((await login(u.username, u.password)).status, 200);
    assert.match(await logText(), /guessed\\" gave a wrong password while changing their password, 10 times running/);
  });

  test('"sign out of all devices" is for sessions to ask, and takes the API keys with it', async () => {
    const u = await account('everywhere');
    const key = (await req('POST', '/keys', { token: u.token, body: { name: 'Tablet', password: u.password } })).body.key.key;
    assert.equal((await req('POST', '/auth/sign-out-everywhere', { apiKey: key })).status, 403);
    assert.equal((await req('GET', '/auth/me', { token: u.token })).status, 200, 'a key can\'t sign its owner out');

    const out = await req('POST', '/auth/sign-out-everywhere', { token: u.token });
    assert.equal(out.status, 200);
    assert.equal(out.body.apiKeysRevoked, 1);
    assert.equal((await req('GET', '/auth/me', { token: u.token })).body.code, 'P101');
    assert.equal((await req('GET', '/items', { apiKey: key })).body.code, 'P104');
  });

  // ─── What ends up in the sign-in history ───────────────────────────────────────────────
  test('a password typed into the username box is not kept', async () => {
    const typed = 'hunter2-my-real-password';
    assert.equal((await login(typed, 'whatever')).body.code, 'P107');
    assert.equal((await login(ADMIN.username, 'not-it')).body.code, 'P107');

    const history = JSON.stringify((await req('GET', '/activity/admin?limit=500', { token: adminToken })).body);
    const logs = await logText();
    for (const text of [history, logs]) {
      assert.ok(!text.includes(typed), 'the full text is nowhere');
      assert.ok(!text.includes('hunter2'));
      assert.match(text, /hu… \(24 characters, no such account\)/);
    }
    // A real account's name is still recorded as it is.
    assert.match(history, /"username":"owner","success":0/);
  });

  // ─── Away from home ────────────────────────────────────────────────────────────────────
  test('from outside, an expired account answers like a wrong password; at home it says why', async () => {
    await req('PATCH', '/admin/network', { token: adminToken, body: { remoteAccess: true } });
    const u = await account('lapsed');
    await db.run("UPDATE users SET expires_at = '2001-01-01T00:00:00.000Z' WHERE id = ?", [u.id]);
    const away = await login(u.username, u.password, outside());
    assert.equal(away.status, 401);
    assert.equal(away.body.code, 'P107');
    assert.equal((await login(u.username, u.password)).body.code, 'P103');
  });

  test("two-factor away from home can't be switched on from outside by an admin without it", async () => {
    const from = outside();
    const res = await req('PATCH', '/admin/network', { from, token: adminToken, body: { require2faOutside: true } });
    assert.equal(res.status, 400, 'it would end the session asking for it');
    assert.equal((await req('GET', '/admin/network', { token: adminToken })).body.settings.require2faOutside, false);
  });

  test('wrong two-factor codes are counted per account, across challenges and addresses', async () => {
    const u = await account('coded');
    const start = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    const secret = start.body.secret;
    const on = await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(secret) } });
    assert.equal(on.status, 200);

    // Ten wrong codes from outside: two fresh challenges of five tries, every request from a
    // different address, so neither the per-challenge nor the per-address limit sees it all.
    for (let round = 0; round < 2; round++) {
      const first = await login(u.username, u.password, outside());
      assert.equal(first.body.twoFactorRequired, true);
      for (let i = 0; i < 5; i++) {
        const wrong = await req('POST', '/auth/login/2fa', { from: outside(), body: { challenge: first.body.challenge, code: '000000' } });
        assert.equal(wrong.body.code, 'P111');
      }
    }
    // Outside, the account is now held altogether: whoever was trying had the password.
    assert.equal((await login(u.username, u.password, outside())).body.code, 'P108');
    assert.match(await logText(), /10 wrong two-factor codes for \\"coded\\" from outside/);

    // At home the owner still signs in: the internet can't lock a household out.
    const atHome = await login(u.username, u.password);
    assert.equal(atHome.body.twoFactorRequired, true);
    const ok = await req('POST', '/auth/login/2fa', { from: home(), body: { challenge: atHome.body.challenge, code: codeFor(secret, 1) } });
    assert.equal(ok.status, 200);
  });

  test('ten wrong codes at home hold code entry at home', async () => {
    const u = await account('homecoded');
    const start = await req('POST', '/auth/2fa/setup', { token: u.token, body: { password: u.password } });
    await req('POST', '/auth/2fa/enable', { token: u.token, body: { code: codeFor(start.body.secret) } });
    for (let round = 0; round < 2; round++) {
      const first = await login(u.username, u.password);
      for (let i = 0; i < 5; i++) {
        await req('POST', '/auth/login/2fa', { from: home(), body: { challenge: first.body.challenge, code: '000000' } });
      }
    }
    const next = await login(u.username, u.password);
    const held = await req('POST', '/auth/login/2fa', { from: home(), body: { challenge: next.body.challenge, code: codeFor(start.body.secret, 1) } });
    assert.equal(held.status, 429);
    assert.equal(held.body.code, 'P108');
  });

  test('an API key is not held to "two-factor away from home"; a session is', async () => {
    const u = await account('roamer');
    const key = (await req('POST', '/keys', { token: u.token, body: { name: 'Reader', password: u.password } })).body.key.key;
    await req('PATCH', '/admin/network', { token: adminToken, body: { require2faOutside: true } });
    assert.equal((await req('GET', '/items', { from: outside(), token: u.token })).body.code, 'P112');
    assert.equal((await req('GET', `/media/cover/seed-00000?token=${u.mediaToken}`, { from: outside() })).body.code, 'P112');
    assert.equal((await req('GET', '/items', { from: outside(), apiKey: key })).status, 200);
    assert.equal((await req('GET', '/items', { token: u.token })).status, 200, 'home is unaffected');
    await req('PATCH', '/admin/network', { token: adminToken, body: { require2faOutside: false } });
  });

  // ─── Hidden and restricted titles ──────────────────────────────────────────────────────
  test("a title hidden from everyone can't be found out by its id", async () => {
    const u = await account('viewer');
    // The viewer hid seed-00002 for themselves before the admin hid it from everyone.
    assert.equal((await req('POST', '/items/seed-00002/hide', { token: u.token })).status, 200);
    for (const id of ['seed-00001', 'seed-00002']) {
      assert.equal((await req('POST', `/items/${id}/hide`, { token: adminToken, body: { global: true } })).status, 200);
    }

    const start = await req('POST', '/activity/start', { token: u.token, body: { itemId: 'seed-00001' } });
    assert.equal(start.status, 404);
    assert.equal((await req('POST', '/items/seed-00001/hide', { token: u.token })).status, 404);
    const hidden = (await req('GET', '/items/hidden', { token: u.token })).body.hiddenItems;
    assert.deepEqual(hidden.map((i) => i.id), [], 'not listed back with its title');
    const mine = JSON.stringify((await req('GET', '/activity/me', { token: u.token })).body);
    assert.ok(!mine.includes('Seeded Title 00001'));

    // The admin still manages them.
    const adminHidden = (await req('GET', '/items/hidden', { token: adminToken })).body.hiddenItems.map((i) => i.id);
    assert.ok(adminHidden.includes('seed-00001'));
    // And an ordinary title works as before.
    assert.equal((await req('POST', '/activity/start', { token: u.token, body: { itemId: 'seed-00003' } })).status, 200);
  });

  test('progress, bookmarks and view sessions are only kept for titles that exist and can be seen', async () => {
    const u = users.viewer;
    const send = (url, body) => req('POST', url, { token: u.token, body });
    assert.equal((await send('/progress/no-such-title', { currentPage: 1, totalPages: 10 })).status, 404);
    assert.equal((await send('/progress/seed-00001', { currentPage: 1, totalPages: 10 })).status, 404, 'hidden from everyone');
    assert.equal((await send('/progress/seed-00003', { currentPage: 1, totalPages: 10 })).status, 200);
    assert.equal((await send('/activity/start', { itemId: 'no-such-title' })).status, 404);
    assert.equal((await send('/bookmarks', { itemId: 'no-such-title', type: 'manga', position: 1 })).status, 404);
    assert.equal((await send('/bookmarks', { itemId: 'seed-00001', type: 'manga', position: 1 })).status, 404);
    assert.equal((await send('/highlights', { itemId: 'no-such-title', cfiRange: 'epubcfi(/6/2)' })).status, 404);

    const rows = await db.get("SELECT (SELECT COUNT(*) FROM user_progress WHERE item_id = 'no-such-title') AS p, (SELECT COUNT(*) FROM view_sessions WHERE item_id = 'no-such-title') AS v");
    assert.deepEqual(rows, { p: 0, v: 0 });
  });

  test('bookmarks have a size and a count', async () => {
    const u = users.viewer;
    const ok = await req('POST', '/bookmarks', { token: u.token, body: { itemId: 'seed-00003', type: 'manga', position: 4, title: 'Here', notes: 'x'.repeat(5000) } });
    assert.equal(ok.status, 201);
    const long = await req('POST', '/bookmarks', { token: u.token, body: { itemId: 'seed-00003', type: 'manga', position: 4, notes: 'x'.repeat(5001) } });
    assert.equal(long.status, 400);
    assert.equal((await req('PATCH', `/bookmarks/${ok.body.bookmark.id}`, { token: u.token, body: { title: 'y'.repeat(301) } })).status, 400);
    assert.equal((await req('PATCH', `/bookmarks/${ok.body.bookmark.id}`, { token: u.token, body: { title: null } })).status, 200);

    await db.run('BEGIN');
    for (let i = 0; i < 499; i++) {
      await db.run("INSERT INTO bookmarks (id, user_id, item_id, type, position) VALUES (?, ?, 'seed-00003', 'manga', ?)", [`fill-${i}`, u.id, i]);
    }
    await db.run('COMMIT');
    const full = await req('POST', '/bookmarks', { token: u.token, body: { itemId: 'seed-00003', type: 'manga', position: 9 } });
    assert.equal(full.status, 400, '500 on one title is the limit');
    assert.equal((await req('POST', '/bookmarks', { token: u.token, body: { itemId: 'seed-00004', type: 'manga', position: 9 } })).status, 201, 'other titles are unaffected');
  });

  test('preferences take any key, up to a size', async () => {
    const u = users.viewer;
    const patch = (body) => req('PATCH', '/users/preferences', { token: u.token, body });
    const fine = await patch({ theme: 'light', someNewAppKey: { nested: { list: [1, 2, 3] } }, hiddenLibraries: [] });
    assert.equal(fine.status, 200);
    assert.equal(fine.body.preferences.someNewAppKey.nested.list.length, 3);

    assert.equal((await patch({ big: 'x'.repeat(70 * 1024) })).status, 400);
    let deep = 'end';
    for (let i = 0; i < 12; i++) deep = { deeper: deep };
    assert.equal((await patch({ deep })).status, 400);
    // Growing it a bit at a time stops at the same ceiling.
    let stopped = null;
    for (let i = 0; i < 12 && !stopped; i++) {
      const res = await patch({ [`chunk${i}`]: 'y'.repeat(8 * 1024) });
      if (res.status !== 200) stopped = res.status;
    }
    assert.equal(stopped, 400);
    const stored = (await req('GET', '/auth/me', { token: u.token })).body.user.preferences;
    assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= 64 * 1024);
    assert.equal(stored.theme, 'light', 'what was there is kept');
  });

  test('a Kids Mode or age-limited account only hears about libraries it can see into', async () => {
    const other = await seedItems(server.dataDir, 0, { libraryId: 'grown-ups' });
    await db.run("UPDATE libraries SET name = 'Late Night' WHERE id = ?", [other.libraryId]);
    await addItem('late-1', 'grown-ups', { title: 'Late Film', series: 'Late Series', ageRating: 'Mature' });
    const kid = await account('kid', { kidsMode: true });
    const teen = await account('teen', { maxAgeRating: 'Teen' });

    const names = async (token) => (await req('GET', '/libraries', { token })).body.libraries.map((l) => `${l.name}:${l.item_count}`);
    assert.deepEqual(await names(kid.token), [], 'nothing is kids-safe yet');
    // seed-00001 and seed-00002 are hidden from everyone, so a limited account's count leaves
    // them out; an unrestricted account gets the totals it always has.
    assert.deepEqual(await names(teen.token), ['Films:1', 'Seeded:20'], 'not the library that is all above its rating');
    assert.deepEqual((await names(users.viewer.token)).sort(), ['Films:1', 'Late Night:1', 'Seeded:22']);

    assert.equal((await req('POST', '/kids/titles', { token: adminToken, body: { itemId: 'seed-00005' } })).status, 201);
    assert.deepEqual(await names(kid.token), ['Seeded:1'], 'counted by what the account can see');
  });

  test("a series the account can't see answers like one that doesn't exist", async () => {
    const put = await req('PUT', '/series/grown-ups/Late%20Series/settings', { token: adminToken, body: { readingDirection: 'rtl', ageRating: 'Mature' } });
    assert.equal(put.status, 200);
    const settings = async (token, lib, name) => (await req('GET', `/series/${lib}/${encodeURIComponent(name)}/settings`, { token })).body.settings;
    const blank = { readingDirection: null, ageRating: null, titleOverride: null };
    assert.deepEqual(await settings(users.viewer.token, 'grown-ups', 'Late Series'), { readingDirection: 'rtl', ageRating: 'Mature', titleOverride: null });
    assert.deepEqual(await settings(users.teen.token, 'grown-ups', 'Late Series'), blank);
    assert.deepEqual(await settings(users.kid.token, 'grown-ups', 'Late Series'), blank);
    assert.deepEqual(await settings(users.kid.token, 'grown-ups', 'No Such Series'), blank, 'the same answer');
  });

  test('searching outside the library: not in Kids Mode, and limited per account', async () => {
    // "nonsense" is a media type with no provider, so nothing here leaves the machine.
    const search = (token) => req('GET', '/metadata/search?mediaType=nonsense&query=anything', { token });
    const kid = await search(users.kid.token);
    assert.equal(kid.status, 403);
    assert.equal(kid.body.code, 'P003');
    assert.equal((await req('GET', '/metadata/details?source=google-books&externalId=abc', { token: users.kid.token })).status, 403);

    let limited = null;
    for (let i = 0; i < 35 && !limited; i++) {
      const res = await search(users.teen.token);
      assert.notEqual(res.status, 403, 'an ordinary account may search (for requests and lists)');
      if (res.status === 429) limited = res.body.code;
    }
    assert.equal(limited, 'P005', 'thirty a minute');
    // One account's searching doesn't use up another's, and editors aren't limited.
    assert.notEqual((await search(users.viewer.token)).status, 429);
    for (let i = 0; i < 35; i++) assert.notEqual((await search(adminToken)).status, 429);
  });

  test("a Kids Mode account can't be an editor, and one that already is can't edit", async () => {
    const kid = users.kid;
    assert.equal((await req('PATCH', `/users/${kid.id}`, { token: adminToken, body: { role: 'editor' } })).status, 400);
    assert.equal((await req('PATCH', `/users/${kid.id}/role`, { token: adminToken, body: { role: 'editor' } })).status, 400);
    const ed = await account('helper', { role: 'editor' });
    assert.equal((await req('PATCH', `/users/${ed.id}`, { token: adminToken, body: { kidsMode: true } })).status, 400);
    assert.equal((await req('PATCH', `/users/${ed.id}`, { token: adminToken, body: { kidsMode: true, role: 'viewer' } })).status, 200, 'both at once is fine');

    // An account left as both by an earlier version (written straight to the database, before
    // it signs in): the role no longer lets it widen its own Kids Mode.
    const made = await req('POST', '/users', { token: adminToken, body: { username: 'legacy', password: 'legacy-password-1' } });
    await db.run("UPDATE users SET kids_mode = 1, role = 'editor' WHERE id = ?", [made.body.user.id]);
    const legacy = await login('legacy', 'legacy-password-1');
    const add = await req('POST', '/kids/titles', { token: legacy.body.token, body: { itemId: 'late-1' } });
    assert.equal(add.status, 403);
    assert.equal(add.body.code, 'P106');
    assert.equal((await req('PATCH', '/libraries/grown-ups', { token: legacy.body.token, body: { kidsAllowed: true } })).status, 403);
    assert.equal((await req('GET', '/items/late-1', { token: legacy.body.token })).status, 404, 'still can\'t see it');
  });
});

describe('the guess limit behind them', () => {
  test('ten failures hold the key, and each further hold lasts twice as long', async () => {
    const { FailureLock } = await import('../src/middleware/auth.js');
    const lock = new FailureLock({ max: 3, windowMs: 1000, lockMs: 1000, maxLockMs: 3000 });
    let now = 0;
    assert.equal(lock.fail('a', now).held, false);
    assert.equal(lock.fail('a', now).held, false);
    assert.equal(lock.heldFor('a', now), 0);
    assert.equal(lock.fail('a', now).held, true);
    assert.equal(lock.heldFor('a', now), 1000);
    assert.equal(lock.heldFor('b', now), 0, 'other keys are unaffected');

    now = 1500;
    assert.equal(lock.heldFor('a', now), 0, 'the hold runs out');
    for (let i = 0; i < 3; i++) lock.fail('a', now);
    assert.equal(lock.heldFor('a', now), 2000, 'the second hold is twice the first');
    now = 4000;
    for (let i = 0; i < 3; i++) lock.fail('a', now);
    assert.equal(lock.heldFor('a', now), 3000, 'up to the ceiling');

    // Failures spread wider than the window never add up, and a success clears the count.
    const slow = new FailureLock({ max: 3, windowMs: 1000, lockMs: 1000 });
    for (let t = 0; t < 10; t++) assert.equal(slow.fail('s', t * 600).held, false);
    const mixed = new FailureLock({ max: 3, windowMs: 1000, lockMs: 1000 });
    mixed.fail('m', 0); mixed.fail('m', 1); mixed.succeed('m');
    assert.equal(mixed.fail('m', 2).held, false);
  });
});
