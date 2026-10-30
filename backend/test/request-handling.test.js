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

  test('the browser may load every cover the server would save, redirect hops included', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    const imgSrc = (res.headers.get('content-security-policy') || '').split(';')
      .map((d) => d.trim().split(/\s+/)).find(([name]) => name === 'img-src')?.slice(1) || [];
    const allowed = (host) => imgSrc.some((src) => src === host || (src.startsWith('*.') && host.endsWith(src.slice(1))));
    // An Open Library cover goes covers.openlibrary.org → archive.org → iaNNNNNN.us.archive.org,
    // and the browser checks every hop; a Google Books cover can land on lh3.googleusercontent.com.
    for (const host of ['covers.openlibrary.org', 'archive.org', 'ia600404.us.archive.org',
      'books.google.com', 'lh3.googleusercontent.com', 'm.media-amazon.com', 's4.anilist.co']) {
      assert.ok(allowed(host), `img-src allows ${host}`);
    }
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
