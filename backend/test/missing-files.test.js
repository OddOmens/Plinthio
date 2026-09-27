import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const TINY_MP4 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny.mp4');

// A file that disappears is kept (hidden) until an admin removes it, and comes back by
// itself if the file does.
describe('missing files are kept, not deleted', () => {
  let server; let admin; let libId; let media; let keep; let vanish;
  const post = (url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(body || {})
  }).then((r) => r.json());
  // Creating a library starts its first scan in the background; wait for any scan in
  // flight so each call here is a real, complete scan.
  const scan = async () => {
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${libId}/scan`);
      if (r.status !== 'busy') return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('scan never ran');
  };
  const titles = async () => (await getJson(server.baseUrl, '/items', admin.token)).body.items.map((i) => i.title).sort();

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    media = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-missing-'));
    keep = path.join(media, 'Keeper (2020)', 'Keeper.2020.mp4');
    vanish = path.join(media, 'Vanishing (2021)', 'Vanishing.2021.mp4');
    for (const f of [keep, vanish]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(TINY_MP4, f); }
    const lib = await post('/libraries', { name: 'Movies', path: media, type: 'movies' });
    libId = lib.library.id;
    await scan();
  });
  after(async () => { await server.stop(); fs.rmSync(media, { recursive: true, force: true }); });

  test('a vanished file is hidden but kept; Library Health lists it', async () => {
    assert.deepEqual(await titles(), ['Keeper', 'Vanishing']);
    const moved = `${vanish}.away`;
    fs.renameSync(vanish, moved);
    const result = await scan();
    assert.equal(result.removed, 1);
    assert.deepEqual(await titles(), ['Keeper']);
    const health = (await getJson(server.baseUrl, '/admin/health', admin.token)).body;
    assert.deepEqual(health.missingFiles.map((i) => i.title), ['Vanishing']);
    assert.ok(health.missingFiles[0].missing_since);

    // It comes back on its own when the file does.
    fs.renameSync(moved, vanish);
    const back = await scan();
    assert.equal(back.restored, 1);
    assert.deepEqual(await titles(), ['Keeper', 'Vanishing']);
  });

  test('an admin removes missing titles for good — but never one whose file is back', async () => {
    fs.rmSync(path.dirname(vanish), { recursive: true, force: true });
    await scan();
    const purge = await post('/admin/health/remove-missing');
    assert.equal(purge.removed, 1);
    const health = (await getJson(server.baseUrl, '/admin/health', admin.token)).body;
    assert.equal(health.missingFiles.length, 0);
    assert.deepEqual(await titles(), ['Keeper']);
  });
});
