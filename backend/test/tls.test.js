import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import https from 'https';
import { execFileSync } from 'child_process';
import { startTestServer } from './helpers/server.js';

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

// A plain-HTTP request as if the server were reached at `host` (fetch won't set Host).
function httpVisitAs(baseUrl, host) {
  const { port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { host } }, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

describe('built-in HTTPS', { skip: !hasOpenssl && 'openssl is not installed' }, () => {
  let server; let httpsPort; let ca;

  before(async () => {
    httpsPort = 30000 + Math.floor(Math.random() * 20000);
    server = await startTestServer({ env: { HTTPS_PORT: String(httpsPort), TLS_HOSTNAMES: 'media.lan' } });
    // The HTTPS listener starts just after HTTP.
    for (let i = 0; i < 50 && !(await fetch(`${server.baseUrl}/api/tls`).then((r) => r.json())).enabled; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    ca = await (await fetch(`${server.baseUrl}/api/tls/ca.crt`)).text();
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

  test('no HSTS, which would lock browsers out of the plain-HTTP port', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), null);
  });

  test('learns a local address from a plain-HTTP visit, but never a public name', async () => {
    await assert.rejects(httpsGet(httpsPort, ca, 'nas.local'));
    await httpVisitAs(server.baseUrl, 'nas.local:8088');
    await httpVisitAs(server.baseUrl, 'example.com');
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 200));
      ok = await httpsGet(httpsPort, ca, 'nas.local').then(() => true, () => false);
    }
    assert.ok(ok, 'nas.local was added to the certificate');
    await assert.rejects(httpsGet(httpsPort, ca, 'example.com'));
  });
});
