import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// Video a device can't decode (AV1 on most Apple hardware): converted as it streams when
// the client says which codecs it plays, and converted once into an H.264 copy on request.
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
