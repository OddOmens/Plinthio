import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.js';

const setup = (baseUrl, body) => fetch(`${baseUrl}/api/auth/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

describe('first-run setup', () => {
  let server;

  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  test('two setups racing each other create exactly one admin', async () => {
    const results = await Promise.all([
      setup(server.baseUrl, { username: 'owner', password: 'owner-password-1' }),
      setup(server.baseUrl, { username: 'intruder', password: 'intruder-password-1' })
    ]);
    const ok = results.filter((r) => r.status === 200);
    assert.equal(ok.length, 1, 'only one of the concurrent setups may succeed');

    const again = await setup(server.baseUrl, { username: 'late', password: 'late-password-1' });
    assert.equal(again.status, 400, 'setup stays closed once an admin exists');

    const status = await (await fetch(`${server.baseUrl}/api/auth/setup-status`)).json();
    assert.equal(status.isSetup, true);
  });
});

describe('setup with a repeated extra username', () => {
  let server;

  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  test('skips the duplicate instead of failing half way', async () => {
    const res = await setup(server.baseUrl, {
      username: 'admin',
      password: 'admin-password-1',
      extraUsers: [
        { username: 'kid', password: 'kid-password-1' },
        { username: 'kid', password: 'other-password-1' },
        { username: 'admin', password: 'clash-password-1' }
      ]
    });
    assert.equal(res.status, 200);
    const { token } = await res.json();

    const users = await (await fetch(`${server.baseUrl}/api/users`, { headers: { authorization: `Bearer ${token}` } })).json();
    const names = (users.users || users).map((u) => u.username).sort();
    assert.deepEqual(names, ['admin', 'kid']);

    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'kid-password-1' })
    });
    assert.equal(login.status, 200, 'the first definition of a repeated name wins');
  });

  test('rejects a non-string password without a server error', async () => {
    const res = await setup(server.baseUrl, { username: 'x', password: ['aaaaaaaa'] });
    assert.equal(res.status, 400);
  });
});
