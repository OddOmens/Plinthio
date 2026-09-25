import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const TINY_MP4 = path.join(testDir, 'fixtures/tiny.mp4');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-art-'));
process.env.DATA_DIR = dataDir;

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
})();

const { findCoverInFolder, looksLikeImage, isJunkFilename } = await import('../src/utils/imageFile.js');
const { extractVideoFrameCover } = await import('../src/services/videoFrame.js');
const { config } = await import('../src/config/env.js');
const { getDb } = await import('../src/config/database.js');
const { scanLibrary } = await import('../src/services/scanner.js');

let workDir;

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Minimal but genuinely decodable JPEG/PNG headers — enough for the magic-byte check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
// What a folder copied off a Mac actually contains next to the real artwork.
const APPLE_DOUBLE = Buffer.concat([Buffer.from([0x00, 0x05, 0x16, 0x07]), Buffer.from('Mac OS X        '), Buffer.alloc(4076)]);

describe('cover art discovery', () => {
  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-art-media-'));
  });

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test('recognises real images and rejects impostors', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'magic-'));
    fs.writeFileSync(path.join(dir, 'real.jpg'), JPEG);
    fs.writeFileSync(path.join(dir, 'fake.jpg'), APPLE_DOUBLE);

    assert.equal(looksLikeImage(path.join(dir, 'real.jpg')), true);
    assert.equal(looksLikeImage(path.join(dir, 'fake.jpg')), false, 'an AppleDouble sidecar is not an image');
    assert.equal(looksLikeImage(path.join(dir, 'missing.jpg')), false);
  });

  test('treats macOS and Windows sidecars as junk', () => {
    assert.equal(isJunkFilename('._www.YTS.MX.jpg'), true);
    assert.equal(isJunkFilename('.DS_Store'), true);
    assert.equal(isJunkFilename('Thumbs.db'), true);
    assert.equal(isJunkFilename('www.YTS.MX.jpg'), false);
  });

  test('skips the AppleDouble sidecar that sorts ahead of the real artwork', () => {
    // This exact shape — `._www.YTS.MX.jpg` before `www.YTS.MX.jpg` — is what left a real
    // movie library showing blank cards: the 4KB sidecar was copied in as the cover.
    const dir = fs.mkdtempSync(path.join(workDir, 'yts-'));
    fs.writeFileSync(path.join(dir, '._www.YTS.MX.jpg'), APPLE_DOUBLE);
    fs.writeFileSync(path.join(dir, 'www.YTS.MX.jpg'), JPEG);

    assert.equal(path.basename(findCoverInFolder(dir)), 'www.YTS.MX.jpg');
  });

  test('prefers a conventionally named cover over other images', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'named-'));
    fs.writeFileSync(path.join(dir, 'screenshot.png'), Buffer.concat([PNG, Buffer.alloc(9000)]));
    fs.writeFileSync(path.join(dir, 'poster.jpg'), JPEG);

    assert.equal(path.basename(findCoverInFolder(dir)), 'poster.jpg', 'a named poster wins even when smaller');
  });

  test('otherwise picks the largest image, not the first one listed', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'largest-'));
    fs.writeFileSync(path.join(dir, 'aaa-banner.jpg'), JPEG);
    fs.writeFileSync(path.join(dir, 'zzz-artwork.jpg'), Buffer.concat([JPEG, Buffer.alloc(50000)]));

    assert.equal(path.basename(findCoverInFolder(dir)), 'zzz-artwork.jpg');
  });

  test('returns null for a folder with no usable image', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'empty-'));
    fs.writeFileSync(path.join(dir, '._junk.jpg'), APPLE_DOUBLE);
    assert.equal(findCoverInFolder(dir), null);
  });
});

describe('artwork backfill during a scan', () => {
  let mediaRoot;

  before(() => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-art-lib-'));
  });

  after(() => {
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  test('fills covers for items that had none, from folder art', async () => {
    const filmDir = path.join(mediaRoot, 'Some Film (2020)');
    fs.mkdirSync(filmDir, { recursive: true });
    fs.copyFileSync(TINY_MP4, path.join(filmDir, 'Some.Film.2020.mp4'));
    fs.writeFileSync(path.join(filmDir, '._poster.jpg'), APPLE_DOUBLE);
    fs.writeFileSync(path.join(filmDir, 'poster.jpg'), JPEG);

    const db = await getDb();
    await db.run('INSERT OR REPLACE INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
      ['art-lib', 'Art', mediaRoot, 'movies']);

    await scanLibrary('art-lib');

    const item = await db.get('SELECT cover_path FROM items WHERE library_id = ?', ['art-lib']);
    assert.ok(item.cover_path, 'the scan should have found the folder poster');

    const stored = path.join(config.coversDir, item.cover_path);
    assert.equal(looksLikeImage(stored), true, 'the stored cover must be a real image, not the sidecar');
    assert.equal(fs.statSync(stored).size, JPEG.length, 'the real poster is what got copied');
  });

  test('re-derives a cover whose stored file is not a usable image', async () => {
    const db = await getDb();
    const item = await db.get('SELECT id, cover_path FROM items WHERE library_id = ?', ['art-lib']);

    // Simulate the broken state a previous version left behind: a cover row pointing at junk.
    fs.writeFileSync(path.join(config.coversDir, item.cover_path), APPLE_DOUBLE);

    await scanLibrary('art-lib');

    const after = await db.get('SELECT cover_path FROM items WHERE id = ?', [item.id]);
    assert.equal(looksLikeImage(path.join(config.coversDir, after.cover_path)), true,
      'a scan should repair a cover that no longer decodes');
  });

  test('falls back to a frame from the video when there is no artwork at all',
    { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, async () => {
    const bareDir = path.join(mediaRoot, 'No Art (2021)');
    fs.mkdirSync(bareDir, { recursive: true });
    fs.copyFileSync(TINY_MP4, path.join(bareDir, 'No.Art.2021.mp4'));

    const db = await getDb();
    await scanLibrary('art-lib');

    const item = await db.get("SELECT cover_path FROM items WHERE path LIKE '%No.Art.2021%'");
    assert.ok(item.cover_path, 'a keyless install must still get a cover');
    assert.equal(looksLikeImage(path.join(config.coversDir, item.cover_path)), true);
  });
});

describe('video frame extraction', () => {
  test('writes a decodable JPEG', { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, async () => {
    const result = await extractVideoFrameCover(TINY_MP4, 'frame-test-item', 2);
    assert.ok(result, 'a frame should be produced');

    const stored = path.join(config.coversDir, result);
    assert.equal(looksLikeImage(stored), true);
    assert.ok(fs.statSync(stored).size > 0);
  });

  test('returns null instead of throwing for a file that is not video', async () => {
    const notVideo = path.join(os.tmpdir(), `plinthio-not-video-${Date.now()}.mp4`);
    fs.writeFileSync(notVideo, 'this is not a video');
    assert.equal(await extractVideoFrameCover(notVideo, 'bad-item', 10), null);
    fs.rmSync(notVideo, { force: true });
  });

  test('returns null for a missing file', async () => {
    assert.equal(await extractVideoFrameCover('/nope/missing.mkv', 'missing-item', 10), null);
  });
});
