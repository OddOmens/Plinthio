import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// A stand-in for GitHub's "latest release" endpoint.
function fakeGithub(release) {
  const server = http.createServer((req, res) => {
    if (!release) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(release));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('update check', () => {
  let github;
  let server;
  let admin;

  before(async () => {
    github = await fakeGithub({
      tag_name: 'v99.1.0',
      name: 'Plinthio v99.1.0',
      html_url: 'https://github.com/OddOmens/Plinthio/releases/tag/v99.1.0',
      body: '### Added\n- Everything',
      draft: false,
      prerelease: false,
      published_at: '2030-01-01T00:00:00Z'
    });
    server = await startTestServer({ env: { UPDATE_CHECK_URL: `http://127.0.0.1:${github.address().port}/latest` } });
    admin = await setupAdmin(server.baseUrl);
  });

  after(async () => {
    await server.stop();
    github.close();
  });

  test('admins see a newer published release', async () => {
    const res = await getJson(server.baseUrl, '/system/update?refresh=1', admin.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.latest, '99.1.0');
    assert.equal(res.body.updateAvailable, true);
    assert.match(res.body.current, /^\d+\.\d+\.\d+/);
    assert.ok(res.body.releaseUrl.endsWith('v99.1.0'));
  });

  test('health reports the real version, not a hard-coded one', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal((await res.json()).version, pkg.version);
  });

  test('non-admins cannot read update status', async () => {
    await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    });
    const login = await (await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    })).json();
    const res = await getJson(server.baseUrl, '/system/update', login.token);
    assert.equal(res.status, 403);
  });
});

describe('upgrade safety', () => {
  test('the first start of a new version backs up the existing database', async () => {
    const first = await startTestServer();
    await setupAdmin(first.baseUrl);
    const dataDir = first.dataDir;
    // Pretend the previous run was an older version, then start again on the same data.
    fs.writeFileSync(path.join(dataDir, '.version'), '0.9.0\n');
    await first.stopKeepData();

    const second = await startTestServer({ dataDir });
    try {
      const backups = fs.readdirSync(path.join(dataDir, 'backups'));
      const pre = backups.filter((f) => /^plinthio-backup-before-.*-from-0\.9\.0-.*\.sqlite$/.test(f));
      assert.equal(pre.length, 1, `expected one pre-upgrade backup, found: ${backups.join(', ')}`);
      assert.ok(fs.statSync(path.join(dataDir, 'backups', pre[0])).size > 0);
      assert.notEqual(fs.readFileSync(path.join(dataDir, '.version'), 'utf8').trim(), '0.9.0');
    } finally {
      await second.stop();
    }
  });
});
