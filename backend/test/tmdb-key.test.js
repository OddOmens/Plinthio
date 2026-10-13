import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// No network needed: none of these cases checks a key with TMDB. A built-in key is checked
// with TMDB on first use, so it isn't set here.
const status = async (server, admin) => (await fetch(`${server.baseUrl}/api/settings/metadata-providers`, { headers: authed(admin.token) })).json();

describe('TMDB key status', () => {
  let server;
  let admin;

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: '' } });
    admin = await setupAdmin(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test('no key anywhere: not configured, no source, no built-in key', async () => {
    assert.deepEqual(await status(server, admin), { tmdbConfigured: false, tmdbSource: null, tmdbBuiltIn: false });
  });

  test('clearing the key reports the same status', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/metadata-providers/tmdb-key`, {
      method: 'PUT', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.tmdbConfigured, false);
    assert.equal(body.tmdbSource, null);
  });
});

describe('TMDB key from the environment', () => {
  let server;
  let admin;

  before(async () => {
    server = await startTestServer({ env: { TMDB_API_KEY: 'from-the-environment' } });
    admin = await setupAdmin(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test('TMDB_API_KEY is reported as the environment, never as the key', async () => {
    const body = await status(server, admin);
    assert.deepEqual(body, { tmdbConfigured: true, tmdbSource: 'environment', tmdbBuiltIn: false });
    assert.ok(!JSON.stringify(body).includes('from-the-environment'));
  });
});
