import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const TINY_MP4 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny.mp4');

// Offloading: an admin removes files to free space but keeps the title as history, shown
// greyed on its page with everyone's progress, and restored if the files come back.
describe('offloaded titles', () => {
  let server; let admin; let libId; let media;
  const call = (method, url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method, headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }).then((r) => r.json());
  const post = (url, body) => call('POST', url, body || {});
  const scan = async () => {
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${libId}/scan`);
      if (r.status !== 'busy') return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('scan never ran');
  };
  const file = (rel) => path.join(media, rel);
  const put = (rel) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.copyFileSync(TINY_MP4, file(rel)); };
  const shelf = async () => (await getJson(server.baseUrl, '/items', admin.token)).body.items.map((i) => i.title).sort();
  const show = async () => (await getJson(server.baseUrl, `/items/series/${encodeURIComponent('Night Shift')}`, admin.token)).body.series;
  const health = async () => (await getJson(server.baseUrl, '/admin/health', admin.token)).body;

  const S1E1 = 'Night Shift/Season 1/Night.Shift.S01E01.mp4';
  const S1E2 = 'Night Shift/Season 1/Night.Shift.S01E02.mp4';
  const S2E1 = 'Night Shift/Season 2/Night.Shift.S02E01.mp4';

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    media = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-offload-'));
    for (const rel of [S1E1, S1E2, S2E1]) put(rel);
    const lib = await post('/libraries', { name: 'Shows', path: media, type: 'shows' });
    libId = lib.library.id;
    await scan();
  });
  after(async () => { await server.stop(); fs.rmSync(media, { recursive: true, force: true }); });

  test('deleted files show as a missing season that can be kept as history', async () => {
    const before = await show();
    assert.equal(before.volumes.length, 3);
    const s1e1 = before.volumes.find((v) => v.volume === 1.001);
    await post(`/progress/${s1e1.id}`, { currentTime: 100, duration: 100, isFinished: 1 });

    fs.rmSync(path.dirname(file(S1E1)), { recursive: true, force: true });
    await scan();
    const report = await health();
    assert.equal(report.summary.missingFiles, 2);
    const group = report.missingGroups.find((g) => g.season === 1);
    assert.equal(group.name, 'Night Shift');
    assert.equal(group.count, 2);

    const kept = await post('/admin/health/offload', { itemIds: group.ids });
    assert.equal(kept.offloaded, 2);

    const after = await health();
    assert.equal(after.summary.missingFiles, 0, 'offloaded is not missing');
    assert.equal(after.summary.offloaded, 2);
    assert.equal(after.offloadedGroups[0].awaitingDeletion, 0);
  });

  test('offloaded episodes stay on the title page with their progress, but nowhere to play', async () => {
    const page = await show();
    assert.equal(page.volumes.length, 3);
    assert.equal(page.offloadedCount, 2);
    const s1e1 = page.volumes.find((v) => v.volume === 1.001);
    assert.ok(s1e1.offloaded_at);
    assert.equal(s1e1.is_finished, 1, 'history is kept');
    assert.equal(page.nextVolume.volume, 2.001, 'next up skips offloaded episodes');
    assert.equal((await shelf()).filter((t) => /S01/.test(t)).length, 0, 'not on the shelf');
  });

  test('"remove all missing" never takes offloaded history', async () => {
    const res = await post('/admin/health/remove-missing');
    assert.equal(res.removed, 0);
    assert.equal((await show()).volumes.length, 3);
  });

  test('re-downloading an episode under a different name brings its history back', async () => {
    const before = (await show()).volumes.find((v) => v.volume === 1.001);
    put('Night Shift/Season 1/Night Shift - S01E01 - Pilot [1080p].mp4');
    await scan();
    const back = (await show()).volumes.find((v) => v.volume === 1.001);
    assert.equal(back.id, before.id, 'same entry, not a new one');
    assert.equal(back.offloaded_at, null);
    assert.equal(back.is_finished, 1);
    assert.equal((await health()).summary.offloaded, 1);
  });

  test('offloading ahead of deleting keeps it offloaded until undone', async () => {
    const s2e1 = (await show()).volumes.find((v) => v.volume === 2.001);
    await post('/admin/health/offload', { itemIds: [s2e1.id] });
    await scan();
    const page = await show();
    assert.ok(page.volumes.find((v) => v.id === s2e1.id).offloaded_at, 'file still there, still offloaded');
    const report = await health();
    assert.equal(report.offloadedGroups.find((g) => g.season === 2).awaitingDeletion, 1, 'flagged: delete the file to free space');

    await post('/admin/health/unoffload', { itemIds: [s2e1.id] });
    assert.equal((await show()).volumes.find((v) => v.id === s2e1.id).offloaded_at, null);
  });

  test('only admins offload, and ids are checked', async () => {
    const bad = await fetch(`${server.baseUrl}/api/admin/health/offload`, {
      method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: ['../etc'] })
    });
    assert.equal(bad.status, 400);
    const anon = await fetch(`${server.baseUrl}/api/admin/health/offload`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: [] })
    });
    assert.equal(anon.status, 401);
  });
});
