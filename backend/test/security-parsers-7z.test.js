import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// The same checks as security-parsers.test.js, against the real 7-Zip: archives are built
// with it here, then read back through the comic reader. The Docker image and CI have the
// `7zip` package; a dev machine without it skips these.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-7z-'));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-7z-work-'));
process.env.DATA_DIR = dataDir;

const { getMangaPagesList, extractMangaPage, readArchiveEntry } = await import('../src/services/archive.js');
const { findSevenZip, runSevenZip, parseSevenZipListing, sevenZipRefusal } = await import('../src/services/archive/sevenZipBackend.js');
const { config } = await import('../src/config/env.js');

let sevenZip = null;
try { sevenZip = findSevenZip(); } catch { sevenZip = null; }

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('7z archives, with the real 7-Zip', { skip: !sevenZip && '7-Zip (the 7zip package: 7zz, 7z or 7za) is not installed' }, () => {
  const cacheDir = path.join(config.cacheDir, 'archives');
  const cached = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
  let source;

  // Packs `names` (relative to `cwd`) into `target` with whatever extra switches are given.
  const pack = (target, cwd, names, switches = []) => {
    execFileSync(sevenZip, ['a', '-bd', '-bso0', '-bsp0', ...switches, '--', target, ...names], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    return target;
  };

  before(() => {
    source = path.join(workDir, 'source');
    fs.mkdirSync(path.join(source, 'pages'), { recursive: true });
    for (const n of [3, 1, 2, 10]) fs.writeFileSync(path.join(source, 'pages', `page-${n}.jpg`), `image-data-for-page-${n}`.repeat(64));
    fs.writeFileSync(path.join(source, 'ComicInfo.xml'), '<ComicInfo><Series>Real</Series></ComicInfo>');
  });

  test('a real .cb7 lists and reads, pages in natural order', async () => {
    const archive = pack(path.join(workDir, 'Volume 01.cb7'), source, ['pages', 'ComicInfo.xml']);
    assert.deepEqual(await getMangaPagesList(archive), ['pages/page-1.jpg', 'pages/page-2.jpg', 'pages/page-3.jpg', 'pages/page-10.jpg']);
    const page = await extractMangaPage(archive, 3);
    assert.ok(page.data.toString().startsWith('image-data-for-page-10'));
    assert.equal(page.totalPages, 4);
    assert.match((await readArchiveEntry(archive, 'ComicInfo.xml')).toString(), /<Series>Real<\/Series>/);
    assert.ok(!cached().some((d) => d.endsWith('.tmp')));
  });

  test('the listing of a real archive parses cleanly', async () => {
    const archive = pack(path.join(workDir, 'listing.7z'), source, ['pages', 'ComicInfo.xml']);
    const listing = parseSevenZipListing(await runSevenZip(['l', '-slt', '-t7z', '-sccUTF-8', '--', archive]));
    assert.ok(listing.version, 'the version line was recognised');
    assert.deepEqual(listing.types, ['7z']);
    assert.equal(listing.malformed, false);
    assert.equal(listing.entries.filter((e) => /\.jpg$/.test(e.path)).length, 4);
    assert.equal(listing.entries.find((e) => e.path === 'ComicInfo.xml').size, 44);
    assert.equal(sevenZipRefusal(listing), null);
  });

  test('an archive whose name starts with a dash is still just a file', async () => {
    const archive = pack(path.join(workDir, '-oDanger.cb7'), source, ['pages']);
    assert.equal((await getMangaPagesList(archive)).length, 4);
  });

  test('an archive holding a symbolic link is refused, and nothing is unpacked', async (t) => {
    const dir = path.join(workDir, 'with-link');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001.jpg'), 'page');
    fs.symlinkSync('/etc/hostname', path.join(dir, '002.jpg'));
    // -snl stores the link as a link rather than the file it points to.
    let archive;
    try {
      archive = pack(path.join(workDir, 'link.cb7'), dir, ['001.jpg', '002.jpg'], ['-snl']);
    } catch {
      return t.skip('this 7-Zip build cannot store links in a 7z archive');
    }
    const before = cached().length;
    await assert.rejects(getMangaPagesList(archive), /Could not extract 7z archive: it contains a (symbolic )?link/);
    assert.equal(cached().length, before);
  });

  test('a tar (or zip) dressed up as .cb7 is not opened by the 7z reader', async () => {
    // No 7z signature, so the extension sends it to this backend, which insists on 7z.
    const archive = pack(path.join(workDir, 'really-a-tar.cb7'), source, ['pages'], ['-ttar']);
    await assert.rejects(getMangaPagesList(archive), /Could not extract 7z archive/);
  });

  test('a password-protected archive says so', async () => {
    const names = pack(path.join(workDir, 'locked.cb7'), source, ['pages'], ['-psecret']);
    await assert.rejects(getMangaPagesList(names), /password-protected/);
    const headers = pack(path.join(workDir, 'locked-headers.cb7'), source, ['pages'], ['-psecret', '-mhe=on']);
    await assert.rejects(getMangaPagesList(headers), /password-protected/);
  });

  test('a damaged archive is an error, not a hang or a half-unpacked folder', async () => {
    const good = pack(path.join(workDir, 'good.cb7'), source, ['pages']);
    const bytes = fs.readFileSync(good);
    const broken = path.join(workDir, 'broken.cb7');
    fs.writeFileSync(broken, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const before = cached().length;
    await assert.rejects(getMangaPagesList(broken), /Could not extract 7z archive/);
    assert.equal(cached().length, before);
  });
});
