import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-archive-'));
process.env.DATA_DIR = dataDir;

const { getMangaPagesList, extractMangaPage } = await import('../src/services/archive.js');
const { clearArchiveHandles } = await import('../src/services/archive/handleCache.js');

let workDir;
let cbzPath;

// Pages are deliberately added out of order, and mixed with the non-image entries a real
// comic archive carries, so the sort and filter are actually exercised.
function buildCbz(target, pageCount) {
  const zip = new AdmZip();
  const order = [...Array(pageCount).keys()].reverse();
  for (const i of order) {
    const label = String(i + 1).padStart(3, '0');
    zip.addFile(`pages/page-${label}.jpg`, Buffer.from(`image-data-for-page-${label}`.repeat(64)));
  }
  zip.addFile('ComicInfo.xml', Buffer.from('<ComicInfo><Series>Test</Series></ComicInfo>'));
  zip.addFile('__MACOSX/._junk.jpg', Buffer.from('resource fork junk'));
  zip.writeZip(target);
}

describe('comic archive reading', () => {
  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-cbz-'));
    cbzPath = path.join(workDir, 'Volume 01.cbz');
    buildCbz(cbzPath, 12);
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test('lists only image pages, in natural order', async () => {
    const pages = await getMangaPagesList(cbzPath);
    assert.equal(pages.length, 12, 'ComicInfo.xml and __MACOSX junk are not pages');
    assert.deepEqual(pages, [...pages].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    assert.ok(pages[0].endsWith('page-001.jpg'));
  });

  test('returns the right bytes for a given page index', async () => {
    const page = await extractMangaPage(cbzPath, 4);
    assert.equal(page.pageNumber, 5);
    assert.equal(page.totalPages, 12);
    assert.equal(page.mimeType, 'image/jpeg');
    assert.ok(page.data.toString().startsWith('image-data-for-page-005'));
  });

  test('out-of-range page indexes return null rather than throwing', async () => {
    assert.equal(await extractMangaPage(cbzPath, 999), null);
    assert.equal(await extractMangaPage(cbzPath, -1), null);
  });

  test('reading many pages reuses the opened archive', async () => {
    // Before the handle cache every page re-opened and re-parsed the whole archive — twice,
    // since listing precedes reading — which measured ~119ms per page on a 76MB CBZ.
    clearArchiveHandles();

    const coldStart = Date.now();
    await extractMangaPage(cbzPath, 0);
    const cold = Date.now() - coldStart;

    const warmStart = Date.now();
    for (let i = 1; i < 12; i++) await extractMangaPage(cbzPath, i);
    const warmPerPage = (Date.now() - warmStart) / 11;

    assert.ok(warmPerPage <= Math.max(cold, 5), `cached page turns (${warmPerPage}ms) should not cost more than the first open (${cold}ms)`);
  });

  test('replacing the file on disk invalidates the cached handle', async () => {
    await extractMangaPage(cbzPath, 0); // prime the cache

    // Same path, different contents — a stale handle would keep serving the old pages.
    buildCbz(cbzPath, 3);
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(cbzPath, future, future);

    const pages = await getMangaPagesList(cbzPath);
    assert.equal(pages.length, 3, 'the rebuilt archive must be re-read, not served from cache');
  });
});
