import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// Video a device can't decode (AV1 on most Apple hardware, older formats everywhere):
// converted as it streams when the client says which codecs it plays, and converted once
// into an H.264 copy on request.
// Real files, real ffmpeg: skipped where this machine's ffmpeg can't make an AV1 file.
function makeAv1(file) {
  for (const encoder of [['libsvtav1', '-preset', '12'], ['libaom-av1', '-cpu-used', '8'], ['librav1e', '-speed', '10']]) {
    try {
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-c:v', encoder[0], ...encoder.slice(1), '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-shortest', file
      ], { stdio: 'pipe' });
      return true;
    } catch {
      // Try the next encoder.
    }
  }
  return false;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-compat-'));
const movies = path.join(root, 'Movies');
fs.mkdirSync(movies);
const original = path.join(movies, 'Big Test Film (2020).mkv');
const haveAv1 = makeAv1(original);

describe('AV1 on devices that cannot decode it', { skip: haveAv1 ? false : 'ffmpeg here cannot encode AV1' }, () => {
  let server; let admin; let libraryId; let film;

  const api = (url, init = {}) => fetch(`${server.baseUrl}/api${url}`, {
    ...init,
    headers: { ...authed(admin.token), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) }
  });
  const json = async (url, init) => (await api(url, init)).json();
  const send = (method, url, body) => api(url, { method, body: JSON.stringify(body || {}) });
  const scan = async () => {
    for (let i = 0; i < 100; i++) {
      const r = await (await send('POST', `/libraries/${libraryId}/scan`)).json();
      if (r.status !== 'busy') return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('scan never finished');
  };
  const films = async () => (await json('/items?limit=100')).items.filter((i) => i.media_type === 'movie');
  const until = async (what, check) => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((res) => setTimeout(res, 200));
    }
  };
  const apple = 'videoCodecs=h264,hevc&clientHevc=1';

  before(async () => {
    server = await startTestServer({ env: { COMPAT_TICK_MS: '200' } });
    admin = await setupAdmin(server.baseUrl);
    await send('PUT', '/settings/transcoding', { preference: 'none' });
    libraryId = (await (await send('POST', '/libraries', { name: 'Movies', path: movies, type: 'movies' })).json()).library.id;
    await scan();
    [film] = await films();
    assert.ok(film, 'the film was scanned');
  });

  after(async () => {
    await server?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a browser is sent the AV1 as it is; a device that lists its codecs gets a conversion', async () => {
    const browser = await json(`/media/video/${film.id}/playback-info`);
    assert.equal(browser.videoCodec, 'av1');
    assert.equal(browser.mode, 'remux');
    assert.equal(browser.compat.eligible, true);
    assert.equal(browser.compat.status, 'none');

    const device = await json(`/media/video/${film.id}/playback-info?${apple}`);
    assert.equal(device.mode, 'transcode');
    assert.ok(device.qualities.length > 0, 'there is a quality to ask for');
    assert.notEqual(device.qualities[0].name, 'source');

    const withAv1 = await json(`/media/video/${film.id}/playback-info?videoCodecs=h264,hevc,av1`);
    assert.equal(withAv1.mode, 'remux', 'a device that decodes AV1 still gets it untouched');
  });

  test('the conversion plays as H.264, and its segments carry the codec list', async () => {
    const { qualities } = await json(`/media/video/${film.id}/playback-info?${apple}`);
    const base = `/media/video/${film.id}/hls/${qualities[0].name}-a0`;
    const playlist = await api(`${base}/media.m3u8?${apple}`);
    assert.equal(playlist.status, 200);
    const text = await playlist.text();
    assert.match(text, /init\.mp4\?clientHevc=1&videoCodecs=h264%2Chevc/);

    const init = await api(`${base}/init.mp4?${apple}`);
    assert.equal(init.status, 200);
    const probe = path.join(root, 'init.mp4');
    fs.writeFileSync(probe, Buffer.from(await init.arrayBuffer()));
    const codec = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', probe], { encoding: 'utf8' }).trim();
    assert.equal(codec, 'h264');
    await send('POST', `/media/video/${film.id}/hls/stop`);
  });

  test('nothing is converted past the size limit', async () => {
    await send('PUT', '/settings/compat', { maxGb: 0 });
    const refused = await send('POST', `/media/video/${film.id}/compat`);
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'P311');
    const saved = await (await send('PUT', '/settings/compat', { maxGb: 5 })).json();
    assert.equal(saved.maxGb, 5);
    assert.equal(saved.replaceOriginal, false);
  });

  test('an H.264 copy is made on request and played instead, without a second title appearing', async () => {
    const asked = await send('POST', `/media/video/${film.id}/compat`);
    assert.equal(asked.status, 202);
    await until('the copy', async () => (await json(`/media/video/${film.id}/compat`)).status === 'done');

    const device = await json(`/media/video/${film.id}/playback-info?${apple}`);
    assert.equal(device.compatCopy, true);
    assert.equal(device.mode, 'direct');
    assert.equal(device.videoCodec, 'h264');
    assert.equal(device.audioCodec, 'aac');

    const stream = await api(`/media/video/${film.id}/stream?copy=1`, { headers: { range: 'bytes=0-11' } });
    assert.equal(stream.status, 206);
    assert.equal(Buffer.from(await stream.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');

    const browser = await json(`/media/video/${film.id}/playback-info`);
    assert.equal(browser.compatCopy, undefined, 'a browser that plays AV1 keeps the original');
    assert.equal(browser.videoCodec, 'av1');

    await scan();
    assert.equal((await films()).length, 1, 'still one film');
    assert.ok(fs.existsSync(original), 'the original is untouched');
    assert.deepEqual(fs.readdirSync(movies), [path.basename(original)], 'nothing was added to the library folder');

    const overview = await json('/settings/compat');
    assert.equal(overview.copies.length, 1);
    assert.equal(overview.copies[0].status, 'done');
    assert.ok(overview.usedBytes > 0);

    const logs = await json('/admin/logs');
    assert.match(JSON.stringify(logs), /The H\.264 copy of \\"Big Test Film\\" is ready/, 'the server log says what was made');
  });

  test('a copy can be deleted, and a whole library queued', async () => {
    assert.equal((await send('DELETE', `/media/video/${film.id}/compat`)).status, 200);
    assert.equal((await json(`/media/video/${film.id}/compat`)).status, 'none');
    assert.equal((await json(`/media/video/${film.id}/playback-info?${apple}`)).mode, 'transcode');

    assert.equal((await send('POST', '/settings/compat/queue', { libraryId })).status, 202);
    await until('the copy', async () => (await json(`/media/video/${film.id}/compat`)).status === 'done');
  });

  test('with "replace the original" on, the copy takes the AV1 file\'s place and the title stays one', async () => {
    await send('PUT', '/settings/compat', { replaceOriginal: true });
    const replaced = path.join(movies, 'Big Test Film (2020).mp4');
    await until('the original to be replaced', () => fs.existsSync(replaced) && !fs.existsSync(original));

    await until('the catalog to follow', async () => (await json('/settings/compat')).copies.length === 0);
    await scan();
    const after = await films();
    assert.equal(after.length, 1, 'still one film');
    assert.equal(after[0].id, film.id, 'the same title, so progress and art stay with it');
    assert.equal(after[0].path, replaced);
    assert.deepEqual(fs.readdirSync(movies), [path.basename(replaced)]);

    const device = await json(`/media/video/${film.id}/playback-info?${apple}`);
    assert.equal(device.mode, 'direct');
    assert.equal(device.videoCodec, 'h264');
    assert.equal(device.compat.eligible, false);
  });
});

// Older formats: MPEG-4 (Xvid, DivX) plays in no browser and on no Apple device, so it can
// have a copy too; H.264 needs none and says so with a code.
describe('converted copies of older formats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-compat-old-'));
  const folder = path.join(dir, 'Movies');
  fs.mkdirSync(folder);
  const make = (name, codec) => execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(folder, name)
  ], { stdio: 'pipe' });

  let server; let admin; let old; let modern;
  const api = (url, init = {}) => fetch(`${server.baseUrl}/api${url}`, {
    ...init,
    headers: { ...authed(admin.token), ...(init.body ? { 'content-type': 'application/json' } : {}) }
  });
  const send = (method, url, body) => api(url, { method, body: JSON.stringify(body || {}) });

  before(async () => {
    make('Old Film (1999).mkv', 'mpeg4');
    make('New Film (2021).mp4', 'libx264');
    server = await startTestServer({ env: { COMPAT_TICK_MS: '200' } });
    admin = await setupAdmin(server.baseUrl);
    await send('PUT', '/settings/transcoding', { preference: 'none' });
    const libraryId = (await (await send('POST', '/libraries', { name: 'Movies', path: folder, type: 'movies' })).json()).library.id;
    for (let i = 0; i < 100; i++) {
      if ((await (await send('POST', `/libraries/${libraryId}/scan`)).json()).status !== 'busy') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const items = (await (await api('/items?limit=100')).json()).items;
    old = items.find((i) => /Old Film/.test(i.path));
    modern = items.find((i) => /New Film/.test(i.path));
    assert.ok(old && modern, 'both films were scanned');
  });

  after(async () => {
    await server?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('H.264 needs no copy (P310); MPEG-4 gets one, found by "convert a library"', async () => {
    const refused = await send('POST', `/media/video/${modern.id}/compat`);
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'P310');

    const info = await (await api(`/media/video/${old.id}/playback-info`)).json();
    assert.equal(info.videoCodec, 'mpeg4');
    assert.equal(info.compat.eligible, true);

    // The way the title page asks, for a series' episodes: by id, the ones that need it.
    assert.equal((await send('POST', '/settings/compat/queue', { itemIds: 'all' })).status, 400);
    assert.equal((await send('POST', '/settings/compat/queue', { itemIds: [old.id, modern.id] })).status, 202);
    const deadline = Date.now() + 60000;
    let overview;
    do {
      await new Promise((res) => setTimeout(res, 200));
      overview = await (await api('/settings/compat')).json();
    } while (!(overview.copies.length === 1 && overview.copies[0].status === 'done') && Date.now() < deadline);
    assert.equal(overview.copies.length, 1, 'only the MPEG-4 film was queued');
    assert.equal(overview.copies[0].itemId, old.id);
    assert.equal(overview.copies[0].status, 'done');
    assert.equal(overview.copies[0].sourceCodec, 'mpeg4');

    const played = await (await api(`/media/video/${old.id}/playback-info`)).json();
    assert.equal(played.compatCopy, true, 'browsers are sent the copy too: none of them play MPEG-4');
    assert.equal(played.videoCodec, 'h264');

    assert.equal((await send('POST', '/settings/compat/retry')).status, 200);
  });
});
