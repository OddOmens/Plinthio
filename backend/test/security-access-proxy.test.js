import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { startTestServer, authed } from './helpers/server.js';

// How the server decides where a request comes from when a reverse proxy is (or might be)
// in front, who may call the API from another website, and under which names first-run
// setup answers. Each `describe` is a server started with different settings.

// A request with full control of its headers, Host included (fetch won't set Host).
function send(baseUrl, method, path, { headers = {}, body } = {}) {
  const { port } = new URL(baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  const all = { ...headers };
  if (payload) {
    all['content-type'] = 'application/json';
    all['content-length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: `/api${path}`, headers: all }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ADMIN = { username: 'owner', password: 'owner-password-1' };

describe('a reverse proxy the server was never told about (TRUST_PROXY unset)', () => {
  let server;
  let base;
  let token;

  before(async () => {
    server = await startTestServer();
    base = server.baseUrl;
  });
  after(async () => { await server.stop(); });

  const where = async (headers) => (await send(base, 'GET', '/auth/access', { headers })).body.where;

  test('a request that says it was forwarded counts as outside, whatever address it claims', async () => {
    assert.equal(await where({}), 'home', 'a direct request from this machine is home');
    assert.equal(await where({ 'x-forwarded-for': '192.168.1.20' }), 'outside');
    assert.equal(await where({ 'x-forwarded-for': '127.0.0.1' }), 'outside');
    assert.equal(await where({ forwarded: 'for=192.168.1.20;proto=https' }), 'outside');
    assert.equal(await where({ 'x-real-ip': '10.0.0.5' }), 'outside');
    // The Tailscale Funnel rule is unchanged.
    assert.equal(await where({ 'tailscale-funnel-request': '?1' }), 'outside');
  });

  test("a fresh server can't be claimed through that proxy, and the answer says what to set", async () => {
    const res = await send(base, 'POST', '/auth/setup', { headers: { 'x-forwarded-for': '192.168.1.20' }, body: { ...ADMIN } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'P109');
    assert.match(res.body.error, /TRUST_PROXY/);
    assert.equal((await send(base, 'GET', '/auth/setup/browse', { headers: { 'x-forwarded-for': '10.1.1.1' } })).body.code, 'P109');
    assert.equal((await send(base, 'GET', '/auth/setup-status')).body.isSetup, false);
  });

  test('first-run setup only answers under an address nobody outside could point here', async () => {
    // DNS rebinding: a page on evil.example re-points its own name at this server, so the
    // browser calls the request same-origin. The Host header still says evil.example.
    for (const host of ['evil.example', 'evil.example:8088', 'plinthio.evil.example.com', 'local.evil.com']) {
      const rebind = await send(base, 'POST', '/auth/setup', {
        headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, body: { ...ADMIN }
      });
      assert.equal(rebind.status, 403, host);
      assert.equal(rebind.body.code, 'P003');
      assert.match(rebind.body.error, /IP address/);
      assert.equal((await send(base, 'GET', '/auth/setup/browse', { headers: { host } })).status, 403, host);
    }
    assert.equal((await send(base, 'GET', '/auth/setup-status')).body.isSetup, false);

    // The addresses people really set a server up by.
    for (const host of ['192.168.1.5:8088', '[fd00::5]:8088', 'localhost:8088', 'nas:8088', 'nas.local', 'plinthio.lan:8088', 'media.home.arpa', 'box.tail1234.ts.net']) {
      assert.equal((await send(base, 'GET', '/auth/setup/browse', { headers: { host } })).status, 200, host);
    }
  });

  test('setup itself still refuses a page on another site, and works from its own', async () => {
    const cross = await send(base, 'POST', '/auth/setup', { headers: { origin: 'https://evil.example' }, body: { ...ADMIN } });
    assert.equal(cross.status, 403);
    const sameSite = await send(base, 'POST', '/auth/setup', { headers: { 'sec-fetch-site': 'same-site' }, body: { ...ADMIN } });
    assert.equal(sameSite.status, 403, 'another port on the same machine is another site');

    const { port } = new URL(base);
    const ok = await send(base, 'POST', '/auth/setup', {
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }, body: { ...ADMIN }
    });
    assert.equal(ok.status, 200);
    token = ok.body.token;
  });

  test('a home-only server stays shut to everyone behind the untrusted proxy, and says why', async () => {
    const res = await send(base, 'GET', '/items', { headers: { ...authed(token), 'x-forwarded-for': '192.168.1.20' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'P109');
    assert.match(res.body.error, /TRUST_PROXY/);
    const signIn = await send(base, 'POST', '/auth/login', { headers: { 'x-forwarded-for': '192.168.1.20' }, body: { ...ADMIN } });
    assert.equal(signIn.body.code, 'P109');
    assert.match(signIn.body.error, /TRUST_PROXY/);
    // Reached directly, the admin is at home as before: nobody is locked out of their server.
    assert.equal((await send(base, 'GET', '/items', { headers: authed(token) })).status, 200);
  });

  test('Admin → Network reports the proxy', async () => {
    const report = (await send(base, 'GET', '/admin/network', { headers: authed(token) })).body;
    assert.equal(report.trustProxy, false);
    assert.ok(report.proxyWithoutTrust?.at, 'the warning is raised');
    assert.equal(report.proxyWithoutTrust.from, '127.0.0.1');
    assert.deepEqual(report.thisDevice, { where: 'home', away: false, ip: '127.0.0.1', untrustedProxy: false });
  });

  test('no other website may read the API by default', async () => {
    const evil = { origin: 'https://evil.example' };
    const health = await send(base, 'GET', '/health', { headers: evil });
    assert.equal(health.status, 200);
    assert.equal(health.headers['access-control-allow-origin'], undefined);
    const preflight = await send(base, 'OPTIONS', '/auth/login', {
      headers: { ...evil, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }
    });
    assert.equal(preflight.headers['access-control-allow-origin'], undefined, 'so a browser never sends the real request');
    const me = await send(base, 'GET', '/auth/me', { headers: { ...evil, ...authed(token) } });
    assert.equal(me.headers['access-control-allow-origin'], undefined);
  });

  test('video streams stay readable for a Chromecast, and only to read', async () => {
    const res = await send(base, 'GET', `/media/video/${'a'.repeat(32)}/stream`, { headers: { origin: 'https://www.gstatic.com' } });
    assert.equal(res.status, 401, 'still needs its media token');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    const preflight = await send(base, 'OPTIONS', `/media/video/${'a'.repeat(32)}/markers`, {
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' }
    });
    assert.doesNotMatch(String(preflight.headers['access-control-allow-methods'] || ''), /PUT|POST|DELETE/);
  });

  test('a page on another site is refused at sign-in when the browser says so', async () => {
    const cross = await send(base, 'POST', '/auth/login', { headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, body: { ...ADMIN } });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.code, 'P003');
    const twoFactor = await send(base, 'POST', '/auth/login/2fa', { headers: { 'sec-fetch-site': 'cross-site' }, body: { challenge: 'x', code: '000000' } });
    assert.equal(twoFactor.status, 403);
    // Plinthio's own page, also behind a proxy that rewrites Host (Origin and Host differ,
    // but the browser calls it same-origin), and apps that send no Origin at all.
    const own = await send(base, 'POST', '/auth/login', {
      headers: { host: 'plinthio:8080', origin: 'https://media.example.com', 'sec-fetch-site': 'same-origin' }, body: { ...ADMIN }
    });
    assert.equal(own.status, 200);
    assert.equal((await send(base, 'POST', '/auth/login', { body: { ...ADMIN } })).status, 200);
    // Plain http behind such a proxy sends no Sec-Fetch-Site; with CORS closed a cross-site
    // page couldn't have sent this at all, so it isn't second-guessed.
    const plain = await send(base, 'POST', '/auth/login', { headers: { host: 'plinthio:8080', origin: 'http://nas.lan' }, body: { ...ADMIN } });
    assert.equal(plain.status, 200);
  });

  test('the script policy names the Cast folders, not all of www.gstatic.com', async () => {
    const csp = (await send(base, 'GET', '/health')).headers['content-security-policy'];
    const scripts = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')).split(/\s+/).slice(1);
    assert.ok(scripts.includes("'self'"));
    assert.ok(scripts.includes('https://www.gstatic.com/cv/js/sender/'));
    assert.ok(!scripts.includes('https://www.gstatic.com'), 'not the whole host');
    for (const source of scripts.filter((x) => x.startsWith('http'))) {
      assert.match(source, /^https:\/\/www\.gstatic\.com\/[a-z/]+\/$/, `${source} is a folder`);
    }
  });
});

describe('a proxy the server trusts (TRUST_PROXY=loopback)', () => {
  let server;
  before(async () => { server = await startTestServer({ env: { TRUST_PROXY: 'loopback' } }); });
  after(async () => { await server.stop(); });
  const where = async (headers) => (await send(server.baseUrl, 'GET', '/auth/access', { headers })).body.where;

  test('its X-Forwarded-For is believed; a header Plinthio cannot read is not', async () => {
    assert.equal(await where({ 'x-forwarded-for': '192.168.1.20' }), 'home');
    assert.equal(await where({ 'x-forwarded-for': '100.100.1.2' }), 'tailscale');
    assert.equal(await where({ 'x-forwarded-for': '203.0.113.9' }), 'outside');
    assert.equal(await where({ 'x-forwarded-for': '192.168.1.20', 'x-real-ip': '192.168.1.20', forwarded: 'for=192.168.1.20' }), 'home');
    // Only Forwarded or X-Real-IP: the address in hand is still the proxy's own.
    assert.equal(await where({ forwarded: 'for=192.168.1.20' }), 'outside');
    assert.equal(await where({ 'x-real-ip': '192.168.1.20' }), 'outside');
    assert.equal(await where({}), 'home');
  });
});

describe('TRUST_PROXY set to some other address than the proxy in front', () => {
  let server;
  before(async () => { server = await startTestServer({ env: { TRUST_PROXY: '10.9.9.9' } }); });
  after(async () => { await server.stop(); });

  test('forwarded requests still count as outside', async () => {
    const res = await send(server.baseUrl, 'GET', '/auth/access', { headers: { 'x-forwarded-for': '192.168.1.20' } });
    assert.equal(res.body.where, 'outside');
    assert.equal((await send(server.baseUrl, 'GET', '/auth/access')).body.where, 'home');
  });
});

describe('CORS_ORIGIN=* (opened to every site by the admin)', () => {
  let server;
  let base;
  before(async () => {
    server = await startTestServer({ env: { CORS_ORIGIN: '*' } });
    base = server.baseUrl;
    assert.equal((await send(base, 'POST', '/auth/setup', { body: { ...ADMIN } })).status, 200);
  });
  after(async () => { await server.stop(); });

  test('other sites can read the API again', async () => {
    const res = await send(base, 'GET', '/health', { headers: { origin: 'https://anything.example' } });
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  test('but none of them may try to sign in', async () => {
    const { port } = new URL(base);
    const cross = await send(base, 'POST', '/auth/login', { headers: { origin: 'https://evil.example' }, body: { ...ADMIN } });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.code, 'P003');
    assert.equal((await send(base, 'POST', '/auth/login/2fa', { headers: { origin: 'https://evil.example' }, body: { challenge: 'x' } })).status, 403);
    const own = await send(base, 'POST', '/auth/login', { headers: { origin: `http://127.0.0.1:${port}` }, body: { ...ADMIN } });
    assert.equal(own.status, 200);
    assert.equal((await send(base, 'POST', '/auth/login', { body: { ...ADMIN } })).status, 200, 'apps send no Origin');
  });
});

describe('CORS_ORIGIN naming the sites allowed', () => {
  let server;
  let base;
  before(async () => {
    server = await startTestServer({ env: { CORS_ORIGIN: 'https://app.example, https://other.example/' } });
    base = server.baseUrl;
    assert.equal((await send(base, 'POST', '/auth/setup', { body: { ...ADMIN } })).status, 200);
  });
  after(async () => { await server.stop(); });

  test('those sites, and only those, are let in, sign-in included', async () => {
    const listed = await send(base, 'GET', '/health', { headers: { origin: 'https://other.example' } });
    assert.equal(listed.headers['access-control-allow-origin'], 'https://other.example');
    const unlisted = await send(base, 'GET', '/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(unlisted.headers['access-control-allow-origin'], undefined);

    const signIn = await send(base, 'POST', '/auth/login', { headers: { origin: 'https://app.example', 'sec-fetch-site': 'cross-site' }, body: { ...ADMIN } });
    assert.equal(signIn.status, 200);
    const evil = await send(base, 'POST', '/auth/login', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: { ...ADMIN } });
    assert.equal(evil.status, 403);
  });
});
