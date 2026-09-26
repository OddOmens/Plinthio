import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
// A 4KB real MP4 checked in as a fixture, so the suite runs on a machine without ffmpeg.
// Duration assertions still need ffprobe (that's the code path under test) and skip without it.
const TINY_MP4 = path.join(testDir, 'fixtures/tiny.mp4');
const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
})();

// The scanner reaches straight into the DB, so it's exercised in-process against a
// throwaway DATA_DIR rather than over HTTP.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-scan-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { getDb } = await import('../src/config/database.js');
const { scanLibrary, isLibraryScanning } = await import('../src/services/scanner.js');

let mediaRoot;

function makeVideo(relPath) {
  const full = path.join(mediaRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(TINY_MP4, full);
  return full;
}

async function addLibrary(id, type, dir) {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
    [id, id, dir, type]);
}

describe('library scanner', () => {
  before(() => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-media-'));
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  test('an emptied library folder (unmounted drive) does not wipe the catalog', async () => {
    const dir = path.join(mediaRoot, 'Unmountable');
    makeVideo('Unmountable/Kept Film (2020)/Kept.Film.2020.mp4');
    await addLibrary('lib-unmount', 'movies', dir);
    await scanLibrary('lib-unmount');

    const db = await getDb();
    const before = await db.get("SELECT COUNT(*) AS n FROM items WHERE library_id = 'lib-unmount'");
    assert.equal(before.n, 1);

    // The mount point stays behind as an empty directory.
    fs.rmSync(path.join(dir, 'Kept Film (2020)'), { recursive: true, force: true });
    await assert.rejects(scanLibrary('lib-unmount'), /is the drive mounted/);

    const after = await db.get("SELECT COUNT(*) AS n FROM items WHERE library_id = 'lib-unmount'");
    assert.equal(after.n, 1);
  });

  test('finds movies in per-title subfolders', async () => {
    const dir = path.join(mediaRoot, 'Movies');
    makeVideo('Movies/Some Film (2019)/Some.Film.2019.1080p.mp4');
    makeVideo('Movies/Another Film (2021)/Another.Film.2021.mp4');
    await addLibrary('lib-movies', 'movies', dir);

    const result = await scanLibrary('lib-movies');
    assert.equal(result.status, 'completed');
    assert.equal(result.total, 2, 'both films must be discovered');
    assert.equal(result.added, 2);

    const db = await getDb();
    const rows = await db.all('SELECT media_type, duration FROM items WHERE library_id = ?', ['lib-movies']);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.media_type === 'movie'));
  });

  test('extracts duration without reading the whole file', { skip: hasFfprobe ? false : 'ffprobe not installed' }, async () => {
    // The original implementation parsed the entire container to find the duration, which
    // took ~2.5 minutes per multi-GB file and made a scan look like it had hung. This
    // asserts both that duration is populated and that getting it is fast.
    const db = await getDb();
    const started = Date.now();
    await scanLibrary('lib-movies');
    const elapsed = Date.now() - started;

    const rows = await db.all('SELECT duration FROM items WHERE library_id = ?', ['lib-movies']);
    assert.ok(rows.every((r) => r.duration > 0), 'every video should have a duration');
    assert.ok(elapsed < 20000, `a two-file rescan should be fast, took ${elapsed}ms`);
  });

  test('records when a library was last scanned', async () => {
    const db = await getDb();
    const row = await db.get('SELECT last_scanned_at FROM libraries WHERE id = ?', ['lib-movies']);
    assert.ok(row.last_scanned_at, 'automatic scanning schedules off this column');
  });

  test('a rename re-links the existing row instead of duplicating it', async () => {
    const db = await getDb();
    const before = await db.get('SELECT COUNT(*) c FROM items WHERE library_id = ?', ['lib-movies']);

    const from = path.join(mediaRoot, 'Movies/Some Film (2019)');
    const to = path.join(mediaRoot, 'Movies/Some Film (2019) [1080p]');
    fs.renameSync(from, to);

    const result = await scanLibrary('lib-movies');
    const after = await db.get('SELECT COUNT(*) c FROM items WHERE library_id = ?', ['lib-movies']);

    assert.equal(after.c, before.c, 'a renamed folder must not create a second row');
    assert.equal(result.renamed, 1);
  });

  test('deleted files are pruned', async () => {
    fs.rmSync(path.join(mediaRoot, 'Movies/Another Film (2021)'), { recursive: true, force: true });
    const result = await scanLibrary('lib-movies');
    assert.equal(result.removed, 1);
  });

  describe('scan locking', () => {
    test('is per library, not global', async () => {
      const otherDir = path.join(mediaRoot, 'Shows');
      makeVideo('Shows/A Show/A.Show.S01E01.mp4');
      await addLibrary('lib-shows', 'shows', otherDir);

      const movies = scanLibrary('lib-movies');
      const shows = scanLibrary('lib-shows');
      const moviesAgain = scanLibrary('lib-movies');

      const [a, b, c] = await Promise.all([movies, shows, moviesAgain]);

      assert.equal(a.status, 'completed');
      assert.equal(b.status, 'completed', 'a different library must not be blocked');
      assert.equal(c.status, 'busy', 'the same library must not scan twice at once');
    });

    test('releases the lock when a scan fails', async () => {
      await addLibrary('lib-missing', 'movies', path.join(mediaRoot, 'does-not-exist'));
      await assert.rejects(() => scanLibrary('lib-missing'));
      assert.equal(isLibraryScanning('lib-missing'), false, 'a thrown scan must not wedge the lock');
    });
  });
});
