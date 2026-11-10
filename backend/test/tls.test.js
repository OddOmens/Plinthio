import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { execFileSync } from 'child_process';
import { startTestServer, freePort, setupAdmin } from './helpers/server.js';

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }

// Fetches over HTTPS trusting only the server's own CA, with `servername` as the name the
// certificate has to cover (connecting to 127.0.0.1 either way).
function httpsGet(port, ca, servername) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port, path: '/api/health', ca, servername, headers: { host: servername } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

// A plain-HTTP request as if the server were reached at `host` (fetch won't set Host), signed
// in when a session token is given.
function httpVisitAs(baseUrl, host, token) {
  const { port } = new URL(baseUrl);
  const headers = token ? { host, authorization: `Bearer ${token}` } : { host };
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: token ? '/api/auth/me' : '/api/health', headers }, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

describe('built-in HTTPS', { skip: !hasOpenssl && 'openssl is not installed' }, () => {
  let server; let httpsPort; let ca; let token;

  before(async () => {
    httpsPort = await freePort();
    server = await startTestServer({ env: { HTTPS_PORT: String(httpsPort), TLS_HOSTNAMES: 'media.lan,not a name' } });
    // The HTTPS listener starts just after HTTP.
    for (let i = 0; i < 50 && !(await fetch(`${server.baseUrl}/api/tls`).then((r) => r.json())).enabled; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    ca = await (await fetch(`${server.baseUrl}/api/tls/ca.crt`)).text();
    ({ token } = await setupAdmin(server.baseUrl));
  });
  after(async () => { await server.stop(); });

  test('status and the CA certificate are public', async () => {
    const status = await (await fetch(`${server.baseUrl}/api/tls`)).json();
    assert.deepEqual(status, { enabled: true, port: httpsPort, caAvailable: true });
    assert.match(ca, /BEGIN CERTIFICATE/);
  });

  test('serves HTTPS that the CA vouches for, for localhost and TLS_HOSTNAMES', async () => {
    assert.equal(await httpsGet(httpsPort, ca, 'localhost'), 200);
    assert.equal(await httpsGet(httpsPort, ca, 'media.lan'), 200);
  });

  test('ignores a TLS_HOSTNAMES entry that isn\'t a name, rather than writing it into the certificate', () => {
    assert.match(server.output(), /Ignoring "not a name" in TLS_HOSTNAMES/);
  });

  test('no HSTS, which would lock browsers out of the plain-HTTP port', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), null);
  });

  test('a visit from someone who isn\'t signed in teaches the certificate nothing', async () => {
    const file = path.join(server.dataDir, 'ssl', 'learned-names.json');
    for (let i = 0; i < 20; i++) await httpVisitAs(server.baseUrl, `stranger${i}.local`);
    // A token that isn't a real session doesn't count either.
    await httpVisitAs(server.baseUrl, 'forged.local', 'not-a-token');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, 'utf8')).length === 0, 'no slots used up');
    assert.doesNotMatch(server.output(), /Adding stranger\d+\.local/);
  });

  test('learns a local address from a signed-in visit, but never a public name', async () => {
    await assert.rejects(httpsGet(httpsPort, ca, 'nas.local'));
    await httpVisitAs(server.baseUrl, 'nas.local:8088', token);
    await httpVisitAs(server.baseUrl, 'example.com', token);
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 200));
      ok = await httpsGet(httpsPort, ca, 'nas.local').then(() => true, () => false);
    }
    assert.ok(ok, 'nas.local was added to the certificate');
    await assert.rejects(httpsGet(httpsPort, ca, 'example.com'));
  });

  test('never learns a ts.net name: that domain belongs to every Tailscale user', async () => {
    await httpVisitAs(server.baseUrl, 'box.tail1234.ts.net', token);
    await new Promise((r) => setTimeout(r, 2500));
    await assert.rejects(httpsGet(httpsPort, ca, 'box.tail1234.ts.net'));
  });

  test('stops learning at the cap instead of pushing out addresses devices already use', async () => {
    const file = path.join(server.dataDir, 'ssl', 'learned-names.json');
    for (let i = 0; i < 20; i++) await httpVisitAs(server.baseUrl, `flood${i}.local`, token);
    await new Promise((r) => setTimeout(r, 300));
    const learned = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(learned.length, 16);
    assert.ok(learned.includes('nas.local'), 'the address a real device used is kept');
    assert.ok(!learned.includes('flood19.local'), 'nothing past the cap is learned');
    assert.match(server.output(), /addresses are already learned/);
  });

  test('re-issuing for learned addresses doesn\'t stop the server answering', async () => {
    // The flood above set off a re-issue (a new 2048-bit key). It runs outside the server's
    // own thread, so requests made meanwhile are answered straight away.
    const started = Date.now();
    for (let i = 0; i < 20; i++) assert.equal((await fetch(`${server.baseUrl}/api/health`)).status, 200);
    assert.ok(Date.now() - started < 5000);
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 200));
      ok = await httpsGet(httpsPort, ca, 'flood0.local').then(() => true, () => false);
    }
    assert.ok(ok, 'the new certificate is in use');
  });
});
