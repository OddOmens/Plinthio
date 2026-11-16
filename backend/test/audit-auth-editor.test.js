import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';
import { seedItems } from './helpers/seed.js';
import { canEditLibrary } from '../src/middleware/auth.js';

// An account with a content limit is treated like a Kids Mode one for editor rights: an
// editor can change age ratings, so a limited editor could lift its own limit.
test('canEditLibrary: admins always; editors only without Kids Mode or a content limit', () => {
  assert.equal(canEditLibrary(null), false);
  assert.equal(canEditLibrary({ role: 'admin' }), true);
  assert.equal(canEditLibrary({ role: 'admin', max_age_rating: 'Teen' }), true);
  assert.equal(canEditLibrary({ role: 'editor' }), true);
  assert.equal(canEditLibrary({ role: 'editor', max_age_rating: null, kids_mode: 0 }), true);
  assert.equal(canEditLibrary({ role: 'editor', max_age_rating: 'Teen' }), false);
  assert.equal(canEditLibrary({ role: 'editor', kids_mode: 1 }), false);
  assert.equal(canEditLibrary({ role: 'editor', kids_mode: true }), false);
  assert.equal(canEditLibrary({ role: 'viewer' }), false);
});

describe('editors with a content limit', () => {
  let server;
  let admin;
  let db;
  let libraryId;

  const send = async (method, url, token, body) => {
    const res = await fetch(`${server.baseUrl}/api${url}`, {
      method,
      headers: { ...authed(token), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const login = async (username, password) => (await send('POST', '/auth/login', null, { username, password })).body.token;
  const makeUser = async (username, role = 'viewer') => {
    const made = await send('POST', '/users', admin.token, { username, password: `${username}-password-1`, role });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    return made.body.user.id;
  };

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    admin = await setupAdmin(server.baseUrl);
    ({ libraryId } = await seedItems(server.dataDir, 3));
    db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
  });

  after(async () => {
    await db?.close();
    await server?.stop();
  });

  test('the users routes refuse the editor role together with a content limit', async () => {
    const editorId = await makeUser('ed', 'editor');
    const limitEditor = await send('PATCH', `/users/${editorId}`, admin.token, { maxAgeRating: 'Teen' });
    assert.equal(limitEditor.status, 400);
    assert.match(limitEditor.body.error, /content limit/);

    const viewerId = await makeUser('teen');
    assert.equal((await send('PATCH', `/users/${viewerId}`, admin.token, { maxAgeRating: 'Teen' })).status, 200);
    assert.equal((await send('PATCH', `/users/${viewerId}`, admin.token, { role: 'editor' })).status, 400);
    const viaRole = await send('PATCH', `/users/${viewerId}/role`, admin.token, { role: 'editor' });
    assert.equal(viaRole.status, 400);
    assert.match(viaRole.body.error, /content limit/);
    assert.equal((await db.get('SELECT role FROM users WHERE id = ?', [viewerId])).role, 'viewer');

    // Changing both halves at once to something allowed is fine, either way round.
    assert.equal((await send('PATCH', `/users/${editorId}`, admin.token, { role: 'viewer', maxAgeRating: 'Teen' })).status, 200);
    assert.equal((await send('PATCH', `/users/${viewerId}`, admin.token, { role: 'editor', maxAgeRating: null })).status, 200);
    // And removing the limit first, then the role, works through the role route too.
    assert.equal((await send('PATCH', `/users/${editorId}`, admin.token, { maxAgeRating: null })).status, 200);
    assert.equal((await send('PATCH', `/users/${editorId}/role`, admin.token, { role: 'editor' })).status, 200);
  });

  test('an editor left with a content limit by an earlier version cannot edit the library', async () => {
    const id = await makeUser('legacyed', 'editor');
    // Both at once, as an earlier version allowed; written before it signs in.
    await db.run("UPDATE users SET max_age_rating = 'Teen' WHERE id = ?", [id]);
    const token = await login('legacyed', 'legacyed-password-1');

    const tries = [
      ['POST', '/metadata/apply/seed-00000', { ageRating: 'Everyone' }],
      ['POST', '/metadata/apply-series', { series: 'Series 0', ageRating: 'Everyone' }],
      ['PUT', `/series/${libraryId}/${encodeURIComponent('Series 0')}/settings`, { ageRating: 'Everyone' }],
      ['GET', '/metadata/admin/items', undefined]
    ];
    for (const [method, url, body] of tries) {
      const res = await send(method, url, token, body);
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal(res.body.code, 'P106', `${method} ${url}`);
    }

    // Once an admin removes the limit, the same account edits again.
    assert.equal((await send('PATCH', `/users/${id}`, admin.token, { maxAgeRating: null })).status, 200);
    assert.equal((await send('GET', '/metadata/admin/items', token)).status, 200);
  });
});
