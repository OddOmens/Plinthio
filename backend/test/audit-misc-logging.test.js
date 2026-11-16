import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// Text from a request must never start a line of its own in the server's output: the access
// log is written there too, and a line that looks like a request has to be one.

const unitDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-log-'));
process.env.DATA_DIR = unitDataDir;
process.env.JWT_SECRET = 'test-secret';
process.on('exit', () => fs.rmSync(unitDataDir, { recursive: true, force: true }));
const { oneLine, oneLineError } = await import('../src/services/logger.js');

test('oneLine escapes C0, DEL, C1 and the Unicode line separators', () => {
  assert.equal(oneLine('a\nb'), 'a\\u000ab');
  assert.equal(oneLine('a\r\nb'), 'a\\u000d\\u000ab');
  assert.equal(oneLine('\u001b[31mred'), '\\u001b[31mred');
  assert.equal(oneLine('x\u0085y\u2028z\u2029'), 'x\\u0085y\\u2028z\\u2029');
  assert.equal(oneLine('tab\there\u007f'), 'tab\\u0009here\\u007f');
  assert.equal(oneLine('plain text, ünïcode 日本'), 'plain text, ünïcode 日本');
  assert.equal(oneLine(42), '42');
});

test('oneLineError puts the message on one line and keeps the stack frames', () => {
  const err = new Error('bad "x\nGET /forged 200"');
  const text = oneLineError(err);
  const [first, ...rest] = text.split('\n');
  assert.equal(first, 'Error: bad "x\\u000aGET /forged 200"');
  assert.ok(rest.length > 0 && rest.every((l) => /^\s+at /.test(l)), 'only indented frames follow');
  assert.equal(oneLineError('a\nb'), 'a\\u000ab');
});

describe('server output stays one line per logged event', () => {
  let server; let admin;
  const FORGED = 'GET /api/forged-by-a-title 200 1.234 ms - 2';

  before(async () => {
    server = await startTestServer({ env: { UPDATE_CHECK: 'false' } });
    admin = await setupAdmin(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  const linesStartingWith = (prefix) => server.output().split(/\r?\n|\u2028|\u2029/).filter((l) => l.startsWith(prefix));

  test('a request title with line breaks is logged on one line and stored without them', async () => {
    const res = await fetch(`${server.baseUrl}/api/requests`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        mediaType: 'movie', source: 'tmdb', externalId: 'audit-1',
        title: `Innocent\n${FORGED}\r\n\u2028${FORGED}`
      })
    });
    assert.equal(res.status, 201);
    const { request } = await res.json();
    assert.doesNotMatch(request.title, /[\u0000-\u001f\u2028\u2029]/);
    assert.ok(request.title.startsWith('Innocent '));

    // Give the logger a moment to reach the pipe.
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(linesStartingWith(FORGED), [], 'no output line starts with the forged text');
    const logged = server.output().split('\n').filter((l) => l.includes('requested "Innocent'));
    assert.equal(logged.length, 1);
  });

  test('a title made only of control characters is refused', async () => {
    const res = await fetch(`${server.baseUrl}/api/requests`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ mediaType: 'movie', source: 'tmdb', externalId: 'audit-2', title: '\n\r\t' })
    });
    assert.equal(res.status, 400);
  });

  test('a malformed JSON body (quoted in the parse error) cannot start a line', async () => {
    const marker = 'GET /api/forged-by-a-body 200';
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `abc\n${marker}\nmore`
    });
    assert.equal(res.status, 400);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(linesStartingWith(marker), []);
  });
});
