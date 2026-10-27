import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// Express 5 behaviours the routes rely on being smoothed over (see index.js and SEND_OPTS in
// utils/fileStream.js).
describe('Request handling', () => {
  let server; let admin; let parent;

  before(async () => {
    // A data directory inside a dot folder, like ~/.local/share/plinthio.
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-test-'));
    const dataDir = path.join(parent, '.plinthio');
    fs.mkdirSync(dataDir);
    server = await startTestServer({ dataDir });
    admin = await setupAdmin(server.baseUrl);
  });
  after(async () => {
    await server.stop();
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test('a POST with no body is a bad request, not a server error', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, { method: 'POST' });
    assert.equal(res.status, 400);
  });

  test('files under a dot folder are still served', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/backup`, {
      headers: authed(admin.token), signal: AbortSignal.timeout(5000)
    });
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  });
});
