import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// Files found by name beside a media file: folder cover art and Calibre's metadata.opf must
// really live inside a library folder, and a sidecar subtitle belongs to one video only.
// In-process against a throwaway DATA_DIR, like the scanner tests.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-audit-files-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { getDb } = await import('../src/config/database.js');
const { config } = await import('../src/config/env.js');
const { getLibraryRoots } = await import('../src/utils/libraryPath.js');
const {
  extractAudiobookMetadata, extractMangaMetadata, extractBookMetadata, extractVideoMetadata
} = await import('../src/services/metadata.js');
const { readBookMetadata } = await import('../src/services/bookMetadata.js');
const { findSidecarSubtitles } = await import('../src/services/subtitles.js');

let mediaRoot;
let outside;
let jpeg;

const OPF = (title) => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>
</package>`;

function write(rel, data = 'not really media') {
  const full = path.join(mediaRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
}

before(async () => {
  mediaRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-audit-media-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-audit-outside-')));
  jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#335' } }).jpeg().toBuffer();
  fs.writeFileSync(path.join(outside, 'private.jpg'), jpeg);
  fs.writeFileSync(path.join(outside, 'private.opf'), OPF('Private Outside Title'));
  const db = await getDb();
  await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('lib-files', 'Files', ?, 'movies')", [mediaRoot]);
  await getLibraryRoots({ fresh: true });
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(mediaRoot, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('F10: folder cover art must be a file inside the library', () => {
  const extractors = [
    ['audiobook', 'book.mp3', (f, idx) => extractAudiobookMetadata(f, idx)],
    ['manga', 'vol.cbz', (f, idx) => extractMangaMetadata(f, idx)],
    ['book', 'novel.epub', (f, idx) => extractBookMetadata(f, idx)],
    ['video', 'film.mkv', (f, idx) => extractVideoMetadata(f, idx, 'movie')]
  ];

  for (const [kind, name, extract] of extractors) {
    test(`${kind}: a poster linked to an image outside the library is not copied`, async () => {
      const file = write(`linked-${kind}/${name}`);
      fs.symlinkSync(path.join(outside, 'private.jpg'), path.join(path.dirname(file), 'poster.jpg'));
      const itemId = `linked-${kind}`;
      const result = await extract(file, itemId);
      assert.equal(result.coverPath ?? null, null);
      assert.ok(!fs.existsSync(path.join(config.coversDir, `${itemId}.jpg`)), 'nothing written to the covers folder');
    });

    test(`${kind}: a real poster inside the library is still used`, async () => {
      const file = write(`plain-${kind}/${name}`);
      fs.writeFileSync(path.join(path.dirname(file), 'poster.jpg'), jpeg);
      const itemId = `plain-${kind}`;
      const result = await extract(file, itemId);
      assert.equal(result.coverPath, `${itemId}.jpg`);
      assert.deepEqual(fs.readFileSync(path.join(config.coversDir, `${itemId}.jpg`)), jpeg);
    });
  }

  test('a link from one library folder to another inside the library still counts', async () => {
    const shared = write('shared-art/poster.jpg', jpeg);
    const file = write('linked-inside/film.mkv');
    fs.symlinkSync(shared, path.join(path.dirname(file), 'poster.jpg'));
    const result = await extractVideoMetadata(file, 'linked-inside', 'movie');
    assert.equal(result.coverPath, 'linked-inside.jpg');
  });

  test("Calibre's metadata.opf linked outside the library is not read", async () => {
    const linked = write('calibre-linked/Book.epub');
    fs.symlinkSync(path.join(outside, 'private.opf'), path.join(path.dirname(linked), 'metadata.opf'));
    assert.equal((await readBookMetadata(linked)).title, null);

    const plain = write('calibre-plain/Book.epub');
    fs.writeFileSync(path.join(path.dirname(plain), 'metadata.opf'), OPF('Curated Title'));
    assert.equal((await readBookMetadata(plain)).title, 'Curated Title');
  });
});

describe('F13: a sidecar subtitle belongs to the video with the longest matching name', () => {
  let dir;
  before(() => {
    dir = path.join(mediaRoot, 'Two Cuts');
    for (const f of ['Film.mkv', 'Film.Unrated.mp4', 'Film.en.srt', 'Film.Unrated.en.srt', 'Film.Unrated.srt', 'Film.Director.en.srt']) {
      write(`Two Cuts/${f}`, f.endsWith('.srt') ? '1\n00:00:01,000 --> 00:00:02,000\nhi\n' : 'video');
    }
  });

  test("the shorter-named video gets only its own files, not the longer one's", async () => {
    const tracks = await findSidecarSubtitles(path.join(dir, 'Film.mkv'));
    assert.deepEqual(tracks.map((t) => path.basename(t.path)), ['Film.Director.en.srt', 'Film.en.srt'],
      'a qualifier that names no other video still counts as this one\'s');
    assert.deepEqual(tracks.map((t) => t.index), [0, 1], 'indexes stay in step with the list');
  });

  test('the longer-named video keeps its own subtitles', async () => {
    const tracks = await findSidecarSubtitles(path.join(dir, 'Film.Unrated.mp4'));
    assert.deepEqual(tracks.map((t) => path.basename(t.path)), ['Film.Unrated.en.srt', 'Film.Unrated.srt']);
    assert.equal(tracks[0].language, 'en');
  });
});
