import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import AdmZip from 'adm-zip';

// Everything here reads something a stranger wrote: a comic archive, an ebook, a playlist, a
// guide, a provider's answer. Each test hands the reader the worst version of it and checks
// that it is refused, or read quickly, rather than trusted.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-parsers-'));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-parsers-work-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'security-parsers-test-secret';

// A stand-in for 7-Zip (this file must pass on a machine without it; the real program is
// exercised in security-parsers-7z.test.js). It prints the listing it is told to and
// "unpacks" a fixed set of files, logging the arguments it was run with.
const fake7z = path.join(workDir, 'fake-7z');
const fakeLog = path.join(workDir, 'fake-7z.log');
const fakeListing = path.join(workDir, 'listing.txt');
fs.writeFileSync(fake7z, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_7Z_LOG, JSON.stringify(args) + '\\n');
const mode = process.env.FAKE_7Z_MODE || 'ok';
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (args[0] === 'l') {
  if (mode === 'encrypted-headers') { process.stderr.write('ERROR: Cannot open encrypted archive. Wrong password?\\n'); process.exit(2); }
  process.stdout.write(fs.readFileSync(process.env.FAKE_7Z_LISTING, 'utf8'));
} else if (args[0] === 'x') {
  const out = args.find((a) => a.startsWith('-o')).slice(2);
  fs.mkdirSync(path.join(out, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(out, 'pages', '002.jpg'), 'page two');
  fs.writeFileSync(path.join(out, 'pages', '001.jpg'), 'page one');
  fs.writeFileSync(path.join(out, 'ComicInfo.xml'), '<ComicInfo><Series>Fake</Series></ComicInfo>');
  if (mode === 'symlink') fs.symlinkSync('/etc/hostname', path.join(out, 'pages', '003.jpg'));
  if (mode === 'fail') { process.stderr.write('ERROR: Data Error : pages/002.jpg\\n'); process.exit(2); }
} else process.exit(7);
`);
fs.chmodSync(fake7z, 0o755);
process.env.PLINTHIO_7Z_BIN = fake7z;
process.env.FAKE_7Z_LOG = fakeLog;
process.env.FAKE_7Z_LISTING = fakeListing;

const { getMangaPagesList, extractMangaPage, readArchiveEntry } = await import('../src/services/archive.js');
const {
  parseSevenZipListing, sevenZipRefusal, largestDictionary, verifyUnpacked, runSevenZip, findSevenZip, forgetSevenZip
} = await import('../src/services/archive/sevenZipBackend.js');
const { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_TOTAL_BYTES } = await import('../src/services/archive/handleCache.js');
const { clampPageCount, MAX_PDF_PAGES } = await import('../src/services/pdf.js');
const { htmlToText, parseOpf, readEpubOpf, readSidecarOpf } = await import('../src/services/bookMetadata.js');
const { comicInfoField } = await import('../src/services/metadata.js');
const { parseM3u, parseM3uAsync, cleanChannelName, MAX_LINE_LENGTH, MAX_CHANNELS } = await import('../src/services/m3u.js');
const { guideTargets, channelPrivateHost, isLoopbackHost, refreshSource, sourceJson, isRefreshDue } = await import('../src/services/liveTv.js');
const { getDb, closeDb } = await import('../src/config/database.js');
const { fetchJson } = await import('../src/services/providerHttp.js');
const { config } = await import('../src/config/env.js');

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

// How long `fn` holds the thread, in ms.
function timed(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

// ─── 7z listings ────────────────────────────────────────────────────────────

// As 7-Zip 25.01 prints `7zz l -slt` for an archive made on Linux.
const HEADER = `
7-Zip (z) 25.01 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03
 64-bit locale=C.UTF-8 Threads:8 OPEN_MAX:1024, ASM

Scanning the drive for archives:
1 file, 1482113 bytes (1448 KiB)

Listing archive: /library/Volume 01.cb7

--
Path = /library/Volume 01.cb7
Type = 7z
Physical Size = 1482113
Headers Size = 226
Method = LZMA2:24
Solid = +
Blocks = 1

----------
`;

const entry = (name, { size = 1000, attributes = 'A -rw-r--r--', encrypted = '-', extra = '' } = {}) => `Path = ${name}
Size = ${size}
Packed Size = ${size}
Modified = 2026-01-02 03:04:05.1234567
Attributes = ${attributes}
CRC = 0A1B2C3D
Encrypted = ${encrypted}
Method = LZMA2:24
Block = 0
${extra}
`;

const folder = (name) => entry(name, { size: 0, attributes: 'D drwxr-xr-x' });
const listingOf = (...entries) => HEADER + entries.join('');
const refusal = (text, limits) => sevenZipRefusal(parseSevenZipListing(text), limits);

describe('7z archives: what the listing says decides whether it is unpacked', () => {
  test('an ordinary comic is read: its type, entries and sizes', () => {
    const listing = parseSevenZipListing(listingOf(folder('pages'), entry('pages/001.jpg', { size: 482113 }), entry('pages/002.jpg', { size: 500000 })));
    assert.equal(listing.version, '25.01');
    assert.deepEqual(listing.types, ['7z']);
    assert.equal(listing.malformed, false);
    assert.deepEqual(listing.entries.map((e) => [e.path, e.size]), [['pages', 0], ['pages/001.jpg', 482113], ['pages/002.jpg', 500000]]);
    assert.equal(sevenZipRefusal(listing), null);
  });

  test('the older p7zip layout (and Windows line endings) reads the same', () => {
    const old = `
7-Zip [64] 16.02 : Copyright (c) 1999-2016 Igor Pavlov : 2016-05-21
p7zip Version 16.02 (locale=en_US.UTF-8,Utf16=on,HugeFiles=on,64 bits,8 CPUs)

Listing archive: /library/old.cb7

--
Path = /library/old.cb7
Type = 7z
Method = LZMA:23
Solid = -

----------
Path = 001.jpg
Size = 10
Packed Size = 12
Modified = 2016-01-02 03:04:05
Attributes = A_ -rw-r--r--
CRC = 0A1B2C3D
Encrypted = -
Method = LZMA:23
Block = 0

Path = extras
Size = 0
Packed Size = 0
Modified = 2016-01-02 03:04:05
Attributes = D_ drwxr-xr-x
CRC =
Encrypted = -
Method =
Block =

`.replace(/\n/g, '\r\n');
    const listing = parseSevenZipListing(old);
    assert.equal(listing.version, '16.02');
    assert.equal(listing.entries.length, 2);
    assert.equal(sevenZipRefusal(listing), null);
  });

  test('anything 7-Zip opens as another format is refused', () => {
    // A tar renamed to .cb7: 7-Zip would happily unpack it, links and all.
    assert.match(refusal(listingOf(entry('001.jpg')).replace('Type = 7z', 'Type = tar')), /not a 7z archive \(it is tar\)/);
    // An archive whose own file name smuggles in a second "Type" line.
    assert.match(refusal(listingOf(entry('001.jpg')).replace('Type = 7z', 'Type = tar\nType = 7z')), /not a 7z archive/);
    assert.match(refusal('7-Zip (z) 25.01\n\nERROR: nothing here\n'), /could not be read/);
    assert.match(refusal(''), /could not be read/);
  });

  test('symbolic links, hard links, reparse points and special files are refused', () => {
    assert.match(refusal(listingOf(entry('001.jpg'), entry('pages', { attributes: 'A lrwxrwxrwx' }))), /symbolic link/);
    assert.match(refusal(listingOf(entry('link.jpg', { extra: 'Symbolic Link = /etc/passwd' }))), /a link/);
    assert.match(refusal(listingOf(entry('link.jpg', { extra: 'Hard Link = 001.jpg' }))), /a link/);
    assert.match(refusal(listingOf(entry('junction', { attributes: 'DL' }))), /reparse point/);
    assert.match(refusal(listingOf(entry('dev', { attributes: 'A crw-rw-rw-' }))), /special file/);
    assert.match(refusal(listingOf(entry('fifo', { attributes: 'A prw-r--r--' }))), /special file/);
    // An empty "Symbolic Link =" line (newer builds print it for every entry) is not a link.
    assert.equal(refusal(listingOf(entry('001.jpg', { extra: 'Symbolic Link = ' }))), null);
    assert.equal(refusal(listingOf(entry('001.jpg', { attributes: 'RHA -rwxr-xr-x' }))), null);
  });

  test('absolute paths and paths that climb out are refused', () => {
    for (const name of ['/etc/cron.d/x', '../outside.jpg', 'pages/../../outside.jpg', 'pages/..', '..', 'C:\\Windows\\x.jpg', '\\\\server\\share\\x', 'a\\..\\..\\b']) {
      assert.match(refusal(listingOf(entry(name))), /absolute path|leads outside/, name);
    }
    // Dots that aren't a ".." component are fine.
    assert.equal(refusal(listingOf(entry('Vol. 1/...and then/001..jpg'))), null);
  });

  test('a name with a line break in it cannot hide anything', () => {
    // 7-Zip prints names as they are, so this one entry reads as a harmless "cover.jpg"
    // followed by lines of the attacker's choosing.
    assert.match(refusal(listingOf(entry('cover.jpg\n../../outside.jpg'))), /cannot be trusted/);
    assert.match(refusal(listingOf(entry('cover.jpg\nComment = x/../../outside.jpg'))), /cannot be trusted/);
    // A whole invented entry: it is counted and checked like a real one.
    assert.match(refusal(listingOf(entry('cover.jpg\nSize = 1\n\nPath = ../x'))), /leads outside|cannot be trusted/);
    // Invented lines can only add: the real size line after them still counts.
    const padded = parseSevenZipListing(listingOf(entry('a.jpg\nSize = 0\nAttributes = A', { size: 5000 })));
    assert.equal(padded.entries[0].size, 5000);
  });

  test('too many files, too much data or too much memory is refused', () => {
    const many = listingOf(...Array.from({ length: 30 }, (_, i) => entry(`p${i}.jpg`)));
    assert.match(refusal(many, { maxEntries: 29 }), /more than 29 files/);
    assert.equal(refusal(many, { maxEntries: 30 }), null);

    // The classic bomb: a few KB that unpack to far more than any volume.
    const bomb = listingOf(...Array.from({ length: 20 }, (_, i) => entry(`zero${i}.bin`, { size: 1024 ** 3 })));
    assert.match(refusal(bomb), /would unpack to more than 4 GB/);
    assert.match(refusal(listingOf(entry('a.jpg', { size: 600 }), entry('b.jpg', { size: 600 })), { maxTotalBytes: 1000 }), /would unpack to more/);

    assert.match(refusal(listingOf(entry('a.jpg')).replaceAll('LZMA2:24', 'LZMA2:1536m')), /too much memory/);
    assert.equal(MAX_ARCHIVE_ENTRIES, 10000);
    assert.equal(MAX_ARCHIVE_TOTAL_BYTES, 4 * 1024 ** 3);
  });

  test('an encrypted archive is reported as password-protected', () => {
    assert.match(refusal(listingOf(entry('001.jpg', { encrypted: '+' }))), /password-protected/);
  });

  test('dictionary sizes are read from the method names', () => {
    assert.equal(largestDictionary(['LZMA2:24']), 2 ** 24);
    assert.equal(largestDictionary(['LZMA:48m', 'BCJ']), 48 * 1024 ** 2);
    assert.equal(largestDictionary(['LZMA2:26 7zAES:19', 'PPMD:o32:mem1g']), 1024 ** 3);
    assert.equal(largestDictionary(['Copy', '', 'Delta:4']), 16);
  });

  test('a huge listing is parsed quickly', () => {
    const text = listingOf(...Array.from({ length: 20000 }, (_, i) => entry(`pages/${i}.jpg`)));
    const ms = timed(() => assert.match(refusal(text), /more than 10000 files/));
    assert.ok(ms < 1000, `took ${ms.toFixed(0)}ms`);
  });
});

describe('7z archives: unpacking', () => {
  const cacheDir = path.join(config.cacheDir, 'archives');
  const leftovers = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
  const ranWith = () => fs.readFileSync(fakeLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let n = 0;
  // Each test gets its own archive file (and so its own cache folder).
  const newArchive = (name = `Volume ${++n}.cb7`) => {
    const file = path.join(workDir, name);
    fs.writeFileSync(file, `not really a 7z ${n}`);
    return file;
  };
  const setup = (mode, listing = listingOf(folder('pages'), entry('pages/001.jpg'), entry('pages/002.jpg'), entry('ComicInfo.xml'))) => {
    process.env.FAKE_7Z_MODE = mode;
    fs.writeFileSync(fakeListing, listing);
    fs.rmSync(fakeLog, { force: true });
  };

  test('lists, then unpacks, with arguments 7-Zip cannot misread', async () => {
    setup('ok');
    const archive = newArchive('-oops.cb7'); // a name that would be an option if it came first
    assert.deepEqual(await getMangaPagesList(archive), ['pages/001.jpg', 'pages/002.jpg']);
    assert.equal((await extractMangaPage(archive, 1)).data.toString(), 'page two');
    assert.equal((await readArchiveEntry(archive, 'ComicInfo.xml')).toString(), '<ComicInfo><Series>Fake</Series></ComicInfo>');

    const calls = ranWith();
    assert.equal(calls.length, 2, 'one listing and one unpack, however many pages are read');
    const [list, extract] = calls;
    assert.equal(list[0], 'l');
    assert.ok(list.includes('-slt') && list.includes('-t7z'));
    assert.equal(extract[0], 'x');
    assert.ok(extract.includes('-t7z') && extract.includes('-y'));
    for (const call of calls) {
      assert.deepEqual(call.slice(-2), ['--', archive], 'the archive comes last, after "--", as an absolute path');
      assert.ok(call.some((a) => a.startsWith('-p') && a.length > 2), 'a password is always given, so 7-Zip never asks');
    }
    assert.ok(!leftovers().some((d) => d.endsWith('.tmp')));
  });

  test('a refused listing means nothing is unpacked', async () => {
    setup('ok', listingOf(entry('001.jpg'), entry('evil', { attributes: 'A lrwxrwxrwx' })));
    const before = leftovers().length;
    await assert.rejects(getMangaPagesList(newArchive()), /Could not extract 7z archive: it contains a symbolic link/);
    assert.deepEqual(ranWith().map((c) => c[0]), ['l'], 'the unpack was never run');
    assert.equal(leftovers().length, before);
  });

  test('a link that turns up on disk anyway is caught, and the folder removed', async () => {
    setup('symlink');
    const before = leftovers().length;
    await assert.rejects(getMangaPagesList(newArchive()), /unpacked a link or special file/);
    assert.equal(leftovers().length, before, 'neither a cache folder nor a temp folder is left');
  });

  test('a failed unpack leaves nothing behind and is tried again next time', async () => {
    setup('fail');
    const archive = newArchive();
    const before = leftovers().length;
    await assert.rejects(getMangaPagesList(archive), /Could not extract 7z archive: 7-Zip reported a problem \(exit 2\): ERROR: Data Error/);
    assert.equal(leftovers().length, before);
    setup('ok');
    assert.equal((await getMangaPagesList(archive)).length, 2);
  });

  test('header-encrypted archives are reported as password-protected', async () => {
    setup('encrypted-headers');
    await assert.rejects(getMangaPagesList(newArchive()), /password-protected/);
  });

  test('two requests for the same archive share one unpack', async () => {
    setup('ok');
    const archive = newArchive();
    const [a, b] = await Promise.all([getMangaPagesList(archive), extractMangaPage(archive, 0)]);
    assert.equal(a.length, 2);
    assert.equal(b.data.toString(), 'page one');
    assert.deepEqual(ranWith().map((c) => c[0]), ['l', 'x']);
  });

  test('a replaced file is unpacked again', async () => {
    setup('ok');
    const archive = newArchive();
    await getMangaPagesList(archive);
    fs.writeFileSync(archive, 'a different file under the same name, and a different size');
    await getMangaPagesList(archive);
    assert.deepEqual(ranWith().map((c) => c[0]), ['l', 'x', 'l', 'x']);
  });

  test('7-Zip is killed when it runs over its time', async () => {
    setup('hang');
    const start = Date.now();
    await assert.rejects(runSevenZip(['l', '--', '/nowhere.7z'], { timeoutMs: 300 }), /stopped after/);
    assert.ok(Date.now() - start < 5000);
  });

  test('entry reads stay inside the unpacked folder and under the size asked for', async () => {
    setup('ok');
    const archive = newArchive();
    await getMangaPagesList(archive);
    assert.equal(await readArchiveEntry(archive, '../../../../etc/hostname'), null);
    assert.equal(await readArchiveEntry(archive, 'pages'), null);
    await assert.rejects(readArchiveEntry(archive, 'ComicInfo.xml', { maxBytes: 10 }), /too large/);
  });

  test('what was unpacked is checked: links, counts and sizes', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'unpacked-'));
    fs.mkdirSync(path.join(dir, 'a/b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a/b/1.jpg'), 'x'.repeat(600));
    fs.writeFileSync(path.join(dir, 'a/2.jpg'), 'x'.repeat(600));
    fs.chmodSync(path.join(dir, 'a/2.jpg'), 0o4755);
    assert.deepEqual(verifyUnpacked(dir), { count: 4, total: 1200 });
    assert.equal(fs.statSync(path.join(dir, 'a/2.jpg')).mode & 0o7777, 0o600, 'setuid and the rest are dropped');
    assert.throws(() => verifyUnpacked(dir, { maxEntries: 3 }), /more than 3 files/);
    assert.throws(() => verifyUnpacked(dir, { maxTotalBytes: 1000 }), /unpacked to more/);
    fs.symlinkSync('/etc', path.join(dir, 'a/b/etc'));
    assert.throws(() => verifyUnpacked(dir), /link or special file/);
  });

  test('without 7-Zip, the error says what to install', () => {
    const saved = { bin: process.env.PLINTHIO_7Z_BIN, path: process.env.PATH };
    try {
      forgetSevenZip();
      delete process.env.PLINTHIO_7Z_BIN;
      process.env.PATH = path.join(workDir, 'empty-bin');
      assert.throws(() => findSevenZip(), /CB7\/7z support needs the 7zip package/);
      process.env.PLINTHIO_7Z_BIN = path.join(workDir, 'no-such-7z');
      assert.throws(() => findSevenZip(), /PLINTHIO_7Z_BIN/);
      // Found on the PATH by name, 7zz before 7z.
      const bin = path.join(workDir, 'bin');
      fs.mkdirSync(bin);
      for (const name of ['7z', '7zz']) fs.copyFileSync(fake7z, path.join(bin, name));
      delete process.env.PLINTHIO_7Z_BIN;
      process.env.PATH = bin;
      assert.equal(findSevenZip(), path.join(bin, '7zz'));
    } finally {
      process.env.PLINTHIO_7Z_BIN = saved.bin;
      process.env.PATH = saved.path;
      forgetSevenZip();
    }
  });
});

// ─── PDFs ───────────────────────────────────────────────────────────────────

describe('PDF page counts', () => {
  test('a count from the file is clamped, and nonsense is zero', () => {
    assert.equal(clampPageCount('312'), 312);
    assert.equal(clampPageCount('2000000000'), MAX_PDF_PAGES);
    assert.equal(clampPageCount('-5'), 0);
    assert.equal(clampPageCount('lots'), 0);
    assert.equal(clampPageCount(null), 0);
    assert.equal(clampPageCount('1e9'), 1);
  });
});

// ─── Ebooks and ComicInfo ───────────────────────────────────────────────────

describe('book descriptions and ComicInfo: hostile text is read in linear time', () => {
  const big = (piece) => piece.repeat(Math.ceil(300 * 1024 / piece.length));

  test('htmlToText on 300 KB of unclosed markup', () => {
    for (const piece of ['<script', '<style>', '<', '<li', '<![CDATA[', '&lt;script', '\n* ', ' \n']) {
      const ms = timed(() => htmlToText(`<p>Blurb</p>${big(piece)}`));
      assert.ok(ms < 1000, `${JSON.stringify(piece)} took ${ms.toFixed(0)}ms`);
    }
  });

  test('htmlToText still does what it did', () => {
    assert.equal(htmlToText('<p>One</p><script>alert(1)</script><P>Two<br/>three</P><style>p{}</style>'), 'One\n\nTwo\nthree');
    assert.equal(htmlToText('<![CDATA[<p>In <b>CDATA</b></p>]]> after'), 'In CDATA\n\nafter');
    assert.equal(htmlToText('<SCRIPT>a</SCRIPT>kept<script>never closed'), 'keptnever closed');
    assert.equal(htmlToText('<ul><li class="x">a</li><li>b</li></ul>'), '• a\n\n• b');
    assert.equal(htmlToText('A blurb.\n\n* * *\n\n**'), 'A blurb.');
    assert.equal(htmlToText('Stars *in* the text **'), 'Stars *in* the text **');
    assert.equal(htmlToText('&lt;p&gt;Escaped&lt;/p&gt;'), 'Escaped');
  });

  test('ComicInfo fields: the same answers as before, without the slow pattern', () => {
    const xml = '<?xml version="1.0"?>\n<ComicInfo>\n  <Title>The Title</Title>\n  <series>Lower Case</series>\n  <Writer></Writer>\n  <Number>3</Number>\n  <Manga>YesAndRightToLeft</Manga>\n</ComicInfo>';
    assert.equal(comicInfoField(xml, 'Title')[1], 'The Title');
    assert.equal(comicInfoField(xml, 'Series')[1], 'Lower Case');
    assert.equal(comicInfoField(xml, 'Writer')[1], '');
    assert.equal(comicInfoField(xml, 'Number')[1], '3');
    assert.equal(comicInfoField(xml, 'AgeRating'), null);
    // Like the pattern it replaces, a value doesn't run over a line break: the first tag
    // that opens and closes on one line wins.
    assert.equal(comicInfoField('<Title>broken\n</Title>\n<Title>whole</Title>', 'Title')[1], 'whole');
    assert.equal(comicInfoField('<Title>a<Title>b</Title>', 'Title')[1], 'a<Title>b');
    assert.equal(comicInfoField('<Title>never closed', 'Title'), null);
    assert.equal(comicInfoField(`<Title>${'x'.repeat(5000)}</Title>`, 'Title')[1].length, 500);
    for (const hostile of [big('<Title>'), big('<Title>\n'), `${big('<Title>\n')}</Title>`]) {
      const ms = timed(() => { for (const tag of ['Title', 'Series', 'Writer', 'Number', 'Manga', 'AgeRating']) comicInfoField(hostile, tag); });
      assert.ok(ms < 1000, `took ${ms.toFixed(0)}ms`);
    }
  });

  test('a package document with endless lists is read quickly, and its text is clipped', () => {
    const many = Array.from({ length: 20000 }, (_, i) => `<dc:title id="t${i}">T${i}</dc:title><dc:creator id="c${i}">C${i}</dc:creator><meta property="role" refines="#x${i}">aut</meta>`).join('');
    let opf;
    const ms = timed(() => { opf = parseOpf(`<package><metadata>${many}<dc:publisher>${'P'.repeat(50000)}</dc:publisher></metadata></package>`); });
    assert.ok(ms < 1500, `took ${ms.toFixed(0)}ms`);
    assert.equal(opf.title, 'T0');
    assert.equal(opf.authors.length, 200);
    assert.equal(opf.publisher.length, 2000);
  });
});

describe('EPUBs: nothing is inflated past its limit', () => {
  const container = '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
  const opfXml = (extra = '') => `<package><metadata><dc:title>Capped</dc:title><meta name="cover" content="cover"/>${extra}</metadata>`
    + '<manifest><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest></package>';
  const build = (name, files) => {
    const zip = new AdmZip();
    for (const [entryName, data] of Object.entries(files)) zip.addFile(entryName, Buffer.isBuffer(data) ? data : Buffer.from(data));
    const file = path.join(workDir, name);
    zip.writeZip(file);
    return file;
  };

  test('an ordinary book reads as before', () => {
    const book = readEpubOpf(build('ok.epub', { 'META-INF/container.xml': container, 'OEBPS/content.opf': opfXml(), 'OEBPS/cover.jpg': 'jpeg bytes' }));
    assert.equal(book.title, 'Capped');
    assert.equal(book.coverData.toString(), 'jpeg bytes');
  });

  test('an oversized package document is refused before it is inflated', () => {
    // 3 MB of spaces is a few KB of zip.
    const file = build('big-opf.epub', { 'META-INF/container.xml': container, 'OEBPS/content.opf': opfXml(' '.repeat(3 * 1024 * 1024)) });
    assert.ok(fs.statSync(file).size < 100 * 1024);
    assert.throws(() => readEpubOpf(file), /too large/);
  });

  test('an oversized cover is left out; an oversized container.xml is ignored', () => {
    const book = readEpubOpf(build('big-cover.epub', {
      'META-INF/container.xml': `${container}${' '.repeat(2 * 1024 * 1024)}`,
      'OEBPS/content.opf': opfXml(),
      'OEBPS/cover.jpg': Buffer.alloc(16 * 1024 * 1024)
    }));
    assert.equal(book.title, 'Capped', 'the .opf is still found by its name');
    assert.equal(book.coverData, null);
  });

  test('an oversized Calibre sidecar is ignored', () => {
    const dir = fs.mkdtempSync(path.join(workDir, 'calibre-'));
    fs.writeFileSync(path.join(dir, 'Book.epub'), '');
    fs.writeFileSync(path.join(dir, 'metadata.opf'), opfXml());
    assert.equal(readSidecarOpf(path.join(dir, 'Book.epub')).title, 'Capped');
    fs.writeFileSync(path.join(dir, 'metadata.opf'), opfXml(' '.repeat(3 * 1024 * 1024)));
    assert.equal(readSidecarOpf(path.join(dir, 'Book.epub')), null);
  });
});

// ─── Live TV ────────────────────────────────────────────────────────────────

describe('M3U playlists: hostile lines', () => {
  const playlist = (...lines) => ['#EXTM3U', ...lines].join('\n');

  test('an 80 KB line of anything is skipped, well under a second', () => {
    for (const filler of ['a', 'a=', '"', '[', ' ', 'a-', 'tvg-id=', ',', '=""']) {
      const hostile = `#EXTINF:-1 ${filler.repeat(Math.ceil(80 * 1024 / filler.length))},Bad`;
      let parsed;
      const ms = timed(() => { parsed = parseM3u(playlist(hostile, 'http://x.example/bad.m3u8', '#EXTINF:-1 tvg-id="ok",Good', 'http://x.example/good.m3u8')); });
      assert.ok(ms < 500, `${JSON.stringify(filler)} took ${ms.toFixed(0)}ms`);
      assert.equal(parsed.skippedLines, 1);
      assert.deepEqual(parsed.channels.map((c) => c.name), ['Good'], 'the address after a skipped line is not given to another channel');
    }
  });

  test('lines just under the limit are parsed in linear time', () => {
    for (const filler of ['a', 'a=', '"', '[', ' ', '[ ', 'a-', '=', 'a="', '] [']) {
      const line = `#EXTINF:-1 ${filler.repeat(Math.floor((MAX_LINE_LENGTH - 20) / filler.length))},N`;
      const text = playlist(...Array.from({ length: 500 }, () => [line, 'http://x.example/a.m3u8']).flat());
      const ms = timed(() => parseM3u(text));
      assert.ok(ms < 1500, `${JSON.stringify(filler)}: 4 MB took ${ms.toFixed(0)}ms`);
    }
    for (const name of ['['.repeat(8000), ' '.repeat(8000), '[ '.repeat(4000), `${'[a;'.repeat(2500)}]`]) {
      const ms = timed(() => cleanChannelName(name));
      assert.ok(ms < 200, `cleanChannelName took ${ms.toFixed(0)}ms`);
    }
  });

  test('an over-long stream address is dropped with its channel', () => {
    const parsed = parseM3u(playlist('#EXTINF:-1,Long', `http://x.example/${'a'.repeat(MAX_LINE_LENGTH)}`, '#EXTINF:-1,Short', 'http://x.example/s.m3u8'));
    assert.deepEqual(parsed.channels.map((c) => c.name), ['Short']);
    assert.equal(parseM3u('x'.repeat(MAX_LINE_LENGTH + 1)), null);
    assert.equal(parseM3u(`${'x'.repeat(MAX_LINE_LENGTH + 1)}\n#EXTM3U`), null);
  });

  test('tags and attributes still come out as they did', () => {
    assert.deepEqual(cleanChannelName('News 24 (720p) [Geo-blocked]'), { name: 'News 24 (720p)', geoBlocked: true });
    assert.deepEqual(cleanChannelName('Kids[Not 24/7;HD]  [Geo-Blocked] One'), { name: 'Kids [HD] One', geoBlocked: true });
    assert.deepEqual(cleanChannelName('Plain [HD] Name'), { name: 'Plain [HD] Name', geoBlocked: false });
    const { channels } = parseM3u(playlist('#EXTINF:-1 tvg-id="A.us" tvg-logo="https://x.example/a.png" group-title="News;Local" tvg-language=en,A, the "Channel"', 'http://x.example/a.m3u8'));
    assert.equal(channels[0].tvgId, 'A.us');
    assert.deepEqual(channels[0].groups, ['News', 'Local']);
    assert.deepEqual(channels[0].languages, ['en']);
    assert.equal(channels[0].name, 'A, the "Channel"');
  });

  test('a playlist is cut off at the channel limit', () => {
    const lines = [];
    for (let i = 0; i < MAX_CHANNELS + 5; i++) lines.push(`#EXTINF:-1,C${i}`, `http://x.example/${i}.m3u8`);
    const parsed = parseM3u(`#EXTM3U\n${lines.join('\n')}`);
    assert.equal(parsed.channels.length, MAX_CHANNELS);
    assert.equal(parsed.truncated, true);
  });

  test('the sliced parse gives the same answer and lets other work run meanwhile', async () => {
    const lines = [];
    for (let i = 0; i < 30000; i++) lines.push(`#EXTINF:-1 tvg-id="c${i}" group-title="G",Channel ${i} [Geo-blocked]`, `http://x.example/${i}.m3u8`);
    const text = `\uFEFF${playlist(...lines)}\r\n`;
    let turns = 0;
    const ticker = setInterval(() => { turns++; }, 0);
    const sliced = await parseM3uAsync(text);
    clearInterval(ticker);
    assert.deepEqual(sliced, parseM3u(text));
    assert.equal(sliced.channels.length, 30000);
    assert.ok(turns >= 5, `other timers ran ${turns} times during the parse`);
    assert.equal(await parseM3uAsync('<html>not a playlist</html>'), null);
  });
});

describe('Live TV: names for this machine are not LAN hosts', () => {
  const ch = (stream, list) => channelPrivateHost({ source_kind: 'm3u', stream_url: stream, source_playlist_url: list });
  const lan = 'http://192.168.1.50/list.m3u';

  test('every spelling of loopback is recognised', () => {
    for (const host of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '::ffff:7f00:1', 'ip6-localhost', 'ip6-loopback',
      'localhost.localdomain', 'foo.localhost', os.hostname().toLowerCase(), '64:ff9b::7f00:1', '::ffff:a00:1']) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ['192.168.1.50', '10.0.0.2', 'tuner.local', 'nas.lan', 'iptvbox-not-this-machine', 'fd12::5']) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });

  test('a LAN playlist cannot point the relay at this machine under another name', () => {
    assert.equal(ch('http://ip6-localhost:2019/config/', lan), null);
    assert.equal(ch('http://localhost.localdomain:2019/config/', lan), null);
    assert.equal(ch(`http://${os.hostname()}:8080/api/`, lan), null);
    assert.equal(ch('http://[::ffff:127.0.0.1]:2019/', lan), null);
    assert.equal(ch('http://[::1]:2019/', lan), null);
    assert.equal(ch('http://127.1:2019/', lan), null);
    // What worked before still does.
    assert.equal(ch('http://192.168.1.60:5004/auto/v1', lan), '192.168.1.60');
    assert.equal(ch('http://tuner.local/ch/2', 'http://nas.lan/iptv.m3u'), 'tuner.local');
    assert.equal(ch('http://[fd12::5]/ch/2', lan), 'fd12::5');
    assert.equal(ch('http://localhost:8000/ch1', 'http://localhost:8000/list.m3u'), 'localhost');
    assert.equal(ch('http://ip6-localhost:8000/ch1', 'http://ip6-localhost:8000/list.m3u'), 'ip6-localhost');
  });
});

describe('XMLTV guides: what is remembered per channel id is bounded', () => {
  test('past the limit ids are still answered, just not remembered', () => {
    let asked = 0;
    const targets = guideTargets(['A.us@SD', 'B.us'], () => { asked++; return false; }, { maxRemembered: 2 });
    assert.deepEqual(targets('A.us'), ['A.us@SD']);
    assert.deepEqual(targets('x1'), []);
    assert.deepEqual(targets('B.us'), ['B.us'], 'the third distinct id is past the limit');
    asked = 0;
    assert.deepEqual(targets('A.us'), ['A.us@SD']);
    assert.equal(asked, 0, 'remembered: nothing is worked out again');
    for (let i = 0; i < 1000; i++) assert.deepEqual(targets(`junk${i}`), []);
    assert.deepEqual(targets('B.us'), ['B.us']);
    // A very long id is answered but never kept, whatever room there is.
    const roomy = guideTargets(['A.us'], () => false);
    assert.deepEqual(roomy('z'.repeat(60000)), []);
    assert.deepEqual(roomy('A.us'), ['A.us']);
  });
});

describe('Live TV refreshes: a hostile playlist is survived, a failed one backs off', () => {
  let server;
  let base;
  let db;
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hostile.m3u') {
        res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 20; i++) lines.push(`#EXTINF:-1 ${'a'.repeat(80 * 1024)},Bad ${i}`, `http://127.0.0.1/bad${i}.m3u8`);
        lines.push('#EXTINF:-1 tvg-id="good",Good', 'http://127.0.0.1/good.m3u8');
        return res.end(lines.join('\n'));
      }
      res.writeHead(500);
      res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    db = await getDb();
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await closeDb();
  });

  const refreshed = async (id, url) => {
    await db.run("INSERT INTO live_sources (id, kind, name, playlist_url) VALUES (?, 'm3u', ?, ?)", [id, id, url]);
    assert.equal(refreshSource(id), true);
    while (sourceJson({ id }).refreshing) await new Promise((r) => setTimeout(r, 20));
    return db.get('SELECT * FROM live_sources WHERE id = ?', [id]);
  };
  const attempts = async () => JSON.parse((await db.get("SELECT value FROM settings WHERE key = 'live_tv_refresh_attempts'"))?.value || '{}');

  test('twenty 80 KB lines cost milliseconds, and the good channel is kept', async () => {
    const start = Date.now();
    const row = await refreshed('hostile', `${base}/hostile.m3u`);
    assert.ok(Date.now() - start < 3000, `the refresh took ${Date.now() - start}ms`);
    assert.equal(row.last_error, null);
    assert.equal(row.channel_count, 1);
    assert.ok(row.last_refreshed_at);
    assert.equal((await attempts()).hostile, undefined, 'a refresh that finished leaves no attempt behind');
  });

  test('a failed refresh is written down, so a restart does not retry it at once', async () => {
    const row = await refreshed('broken', `${base}/broken.m3u`);
    assert.match(row.last_error, /HTTP 500/);
    assert.equal(row.last_refreshed_at, null);
    const at = (await attempts()).broken;
    assert.ok(Date.now() - at < 5000, 'when it was tried is kept in settings, where a restart finds it');
    // What the schedule does with that after a restart: nothing for an hour.
    assert.equal(isRefreshDue(row.last_refreshed_at, at), false);
    assert.equal(isRefreshDue(row.last_refreshed_at, at, at + 61 * 60 * 1000), true);
  });
});

// ─── Metadata providers ─────────────────────────────────────────────────────

describe('provider requests: the whole exchange is timed and capped', () => {
  let server;
  let base;
  const open = new Set();
  before(async () => {
    server = http.createServer((req, res) => {
      open.add(res);
      res.on('close', () => open.delete(res));
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ hello: 'world', n: [1, 2, 3] }));
      }
      if (req.url === '/stall') {
        // Headers and the start of a body, then nothing.
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.write('{"never":');
      }
      if (req.url === '/huge-declared') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': 50 * 1024 * 1024 });
        return res.write('{');
      }
      if (req.url === '/huge-chunked') {
        res.writeHead(200, { 'content-type': 'application/json' });
        const chunk = Buffer.alloc(256 * 1024, 0x20);
        const more = () => {
          while (!res.destroyed && res.write(chunk));
          if (!res.destroyed) res.once('drain', more);
        };
        return more();
      }
      if (req.url === '/missing') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end('{"error":"no"}');
      }
      res.writeHead(500);
      res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    for (const res of open) res.destroy();
    await new Promise((r) => server.close(r));
  });

  test('an ordinary answer is parsed', async () => {
    assert.deepEqual(await fetchJson(`${base}/ok`), { hello: 'world', n: [1, 2, 3] });
  });

  test('a body that never finishes is given up on', async () => {
    const start = Date.now();
    await assert.rejects(fetchJson(`${base}/stall`, { timeoutMs: 300 }), (err) => err.name === 'AbortError');
    assert.ok(Date.now() - start < 3000);
  });

  test('a body that is too large is refused, declared or not', async () => {
    await assert.rejects(fetchJson(`${base}/huge-declared`), /too large/);
    await assert.rejects(fetchJson(`${base}/huge-chunked`), /too large/);
  });

  test('a failure still carries its status', async () => {
    await assert.rejects(fetchJson(`${base}/missing`), (err) => err.status === 404);
  });
});
