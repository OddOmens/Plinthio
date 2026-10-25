import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';

// Book metadata is read in-process against a throwaway DATA_DIR, like the scanner tests. No
// network: provider lookups are only exercised through the pure ranking function.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-books-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { getDb } = await import('../src/config/database.js');
const { scanLibrary } = await import('../src/services/scanner.js');
const { parseOpf, normalizeIsbn, normalizeLanguage, stripSeriesFromTitle, htmlToText, BOOK_META_VERSION } = await import('../src/services/bookMetadata.js');
const { rankBookResults } = await import('../src/services/externalMetadata.js');

// Calibre's layout: <item href> before <item id>, the cover named by <meta name="cover">,
// an HTML blurb escaped inside <dc:description>, series in calibre:* metas.
const CALIBRE_OPF = ({ title, series, index, isbn = '9780316387354', extra = '' }) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${title}</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Abercrombie, Joe">Joe Abercrombie</dc:creator>
    <dc:contributor opf:role="bkp">calibre (6.10.0)</dc:contributor>
    <dc:publisher>Orbit</dc:publisher>
    <dc:description>&lt;p&gt;&lt;strong&gt;The second novel&lt;/strong&gt; in the trilogy.&lt;/p&gt;&lt;p&gt;Superior Glokta has a problem &amp;amp; a stick.&lt;/p&gt;&lt;p&gt;**&lt;/p&gt;</dc:description>
    <dc:date opf:event="modification">2020-01-01</dc:date>
    <dc:date>2015-09-08T00:00:00+00:00</dc:date>
    <dc:language>eng</dc:language>
    <dc:identifier opf:scheme="uuid">4b0a8f12-f1d2-4809-a8a5-4b9266425fc6</dc:identifier>
    <dc:identifier opf:scheme="ISBN">${isbn}</dc:identifier>
    <dc:subject>Fiction</dc:subject>
    <dc:subject>Fiction / Fantasy / Epic</dc:subject>
    <dc:subject>Grimdark</dc:subject>
    ${series ? `<meta name="calibre:series" content="${series}"/>` : ''}
    ${index ? `<meta name="calibre:series_index" content="${index}"/>` : ''}
    <meta name="cover" content="cover"/>
    ${extra}
  </metadata>
  <manifest>
    <item href="titlepage.xhtml" id="titlepage" media-type="application/xhtml+xml"/>
    <item href="images/cover1.jpeg" id="cover" media-type="image/jpeg"/>
  </manifest>
</package>`;

const EPUB3_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t1">Leviathan Wakes</dc:title>
    <meta refines="#t1" property="title-type">main</meta>
    <dc:title id="t2">Book One of the Expanse</dc:title>
    <meta refines="#t2" property="title-type">subtitle</meta>
    <dc:creator id="c1">James S. A. Corey</dc:creator>
    <meta refines="#c1" property="role" scheme="marc:relators">aut</meta>
    <dc:creator id="c2">Jefferson Mays</dc:creator>
    <meta refines="#c2" property="role" scheme="marc:relators">nrt</meta>
    <dc:identifier id="pub-id">urn:isbn:0-316-12908-9</dc:identifier>
    <dc:language>en-US</dc:language>
    <meta property="belongs-to-collection" id="col">The Expanse</meta>
    <meta refines="#col" property="collection-type">series</meta>
    <meta refines="#col" property="group-position">1</meta>
  </metadata>
  <manifest>
    <item id="img" href="Images/front.png" media-type="image/png" properties="cover-image"/>
  </manifest>
</package>`;

let coverJpeg;
after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

function writeEpub(file, opf, { opfPath = 'OEBPS/content.opf', coverEntry = 'OEBPS/images/cover1.jpeg' } = {}) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`
  ));
  zip.addFile(opfPath, Buffer.from(opf));
  if (coverEntry) zip.addFile(coverEntry, coverJpeg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

describe('reading a book\'s own metadata', () => {
  test('Calibre OPF: every field, the cover with href before id, series and its number', () => {
    const opf = parseOpf(CALIBRE_OPF({ title: 'Before They Are Hanged (The First Law)', series: 'First Law', index: '2.0' }));
    assert.equal(opf.title, 'Before They Are Hanged (The First Law)');
    assert.deepEqual(opf.authors, ['Joe Abercrombie']); // the calibre "bkp" contributor isn't an author
    assert.equal(opf.publisher, 'Orbit');
    assert.equal(opf.releaseDate, '2015-09-08'); // the modification date is skipped
    assert.equal(opf.language, 'en');
    assert.equal(opf.isbn, '9780316387354');
    assert.deepEqual(opf.genres, ['Epic', 'Grimdark']); // "Fiction" is filler; BISAC paths keep their last part
    assert.equal(opf.series, 'First Law');
    assert.equal(opf.seriesIndex, 2);
    assert.equal(opf.coverHref, 'images/cover1.jpeg');
    assert.equal(opf.description, 'The second novel in the trilogy.\n\nSuperior Glokta has a problem & a stick.');
  });

  test('EPUB 3: main title, roles, cover-image, belongs-to-collection, ISBN-10', () => {
    const opf = parseOpf(EPUB3_OPF);
    assert.equal(opf.title, 'Leviathan Wakes');
    assert.equal(opf.subtitle, 'Book One of the Expanse');
    assert.deepEqual(opf.authors, ['James S. A. Corey']); // the narrator isn't
    assert.equal(opf.isbn, '9780316129084');
    assert.equal(opf.language, 'en-US');
    assert.equal(opf.series, 'The Expanse');
    assert.equal(opf.seriesIndex, 1);
    assert.equal(opf.coverHref, 'Images/front.png');
  });

  test('a broken package still gives what it had', () => {
    const opf = parseOpf('<package><metadata><dc:title>Half a Book</dc:title><dc:creator>Someone');
    assert.equal(opf.title, 'Half a Book');
  });

  test('ISBNs: check digits, ISBN-10 to 13, junk rejected', () => {
    assert.equal(normalizeIsbn('978-0-316-38735-4'), '9780316387354');
    assert.equal(normalizeIsbn('urn:isbn:080442957X'), '9780804429573');
    assert.equal(normalizeIsbn('9780316387355'), null);
    assert.equal(normalizeIsbn('4b0a8f12-f1d2'), null);
    assert.equal(normalizeIsbn(''), null);
  });

  test('language codes come out canonical', () => {
    assert.equal(normalizeLanguage('eng'), 'en');
    assert.equal(normalizeLanguage('pt_br'), 'pt-BR');
    assert.equal(normalizeLanguage('und'), null);
    assert.equal(normalizeLanguage('English'), null);
  });

  test('the series in a title\'s brackets goes once it\'s stored on its own', () => {
    assert.equal(stripSeriesFromTitle('Before They Are Hanged (The First Law)', 'First Law'), 'Before They Are Hanged');
    assert.equal(stripSeriesFromTitle('Dune (Dune Chronicles, #1)', 'Dune Chronicles'), 'Dune');
    assert.equal(stripSeriesFromTitle('Leviathan Wakes [The Expanse 1]', 'The Expanse'), 'Leviathan Wakes');
    assert.equal(stripSeriesFromTitle('Talk (Revised Edition)', 'Talk Series'), 'Talk (Revised Edition)');
    assert.equal(stripSeriesFromTitle('No Series (Here)', null), 'No Series (Here)');
  });

  test('HTML blurbs become paragraphs of text', () => {
    assert.equal(htmlToText('<h3>From the Publisher</h3><p>One<br/>Two</p><ul><li>A</li><li>B</li></ul>'), 'From the Publisher\n\nOne\nTwo\n\n• A\n\n• B');
    assert.equal(htmlToText('&lt;p&gt;Escaped &amp;amp; fine&lt;/p&gt;'), 'Escaped & fine');
    assert.equal(htmlToText('   '), null);
  });
});

describe('ranking book search results', () => {
  const result = (over) => ({ source: 'google-books', title: 'X', author: null, coverUrl: null, overview: null, isbn: null, ...over });

  test('an ISBN match wins outright', () => {
    const ranked = rankBookResults([
      result({ externalId: 'a', title: 'Before They Are Hanged', author: 'Joe Abercrombie' }),
      result({ externalId: 'b', title: 'Before They Are Hanged', author: 'Joe Abercrombie', isbn: '9780316387354' })
    ], { title: 'Before They Are Hanged', author: 'Joe Abercrombie', isbn: '9780316387354' });
    assert.equal(ranked[0].externalId, 'b');
  });

  test('summaries and study guides lose to the book; the right author beats a namesake', () => {
    const ranked = rankBookResults([
      result({ externalId: 'guide', title: 'Summary of Four Thousand Weeks', author: 'Quick Reads', coverUrl: 'x', overview: 'y' }),
      result({ externalId: 'other', title: 'Four Thousand Weeks', author: 'Somebody Else' }),
      result({ externalId: 'book', title: 'Four Thousand Weeks: Time Management for Mortals', author: 'Oliver Burkeman' })
    ], { title: 'Four Thousand Weeks', author: 'Oliver Burkeman' });
    assert.deepEqual(ranked.map((r) => r.externalId), ['book', 'other', 'guide']);
  });

  test('an unrelated result scores below the auto-match bar', () => {
    const [top] = rankBookResults([result({ title: 'Cooking for Two', author: 'Chef' })], { title: 'Last Argument of Kings', author: 'Joe Abercrombie' });
    assert.ok(top.score < 35, `scored ${top.score}`);
  });
});

describe('scanning a book library', () => {
  let mediaRoot;
  const lib = 'lib-books';
  const item = async (fileName) => (await getDb()).get('SELECT * FROM items WHERE path LIKE ?', [`%${fileName}`]);

  before(async () => {
    coverJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#335' } }).jpeg().toBuffer();
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-bookmedia-'));
    const db = await getDb();
    await db.run('INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)', [lib, 'Books', mediaRoot, 'books']);

    writeEpub(path.join(mediaRoot, 'Joe Abercrombie/02. Before They Are Hanged/Before They Are Hanged.epub'),
      CALIBRE_OPF({ title: 'Before They Are Hanged (The First Law)', series: 'First Law', index: '2.0' }));
    // Book three names the series differently and has no number; its folder has one.
    writeEpub(path.join(mediaRoot, 'Joe Abercrombie/03. Last Argument of Kings/Last Argument of Kings.epub'),
      CALIBRE_OPF({ title: 'Last Argument of Kings', series: 'The First Law', isbn: '9780575077898' }));
    writeEpub(path.join(mediaRoot, 'James S. A. Corey/Leviathan Wakes.epub'), EPUB3_OPF, { opfPath: 'content.opf', coverEntry: 'Images/front.png' });
    // A Calibre library folder: the sidecar is what the owner curated, and wins.
    writeEpub(path.join(mediaRoot, 'Calibre/Some Book (12)/Some Book - Author.epub'),
      CALIBRE_OPF({ title: 'Wrong Embedded Title', series: null }));
    fs.writeFileSync(path.join(mediaRoot, 'Calibre/Some Book (12)/metadata.opf'),
      CALIBRE_OPF({ title: 'The Curated Title', series: 'Curated Series', index: '4' }));
  });

  after(() => { fs.rmSync(mediaRoot, { recursive: true, force: true }); });

  test('a scan stores the full record, the cover, and one series spelling', async () => {
    await scanLibrary(lib);

    const hanged = await item('Before They Are Hanged.epub');
    assert.equal(hanged.title, 'Before They Are Hanged');
    assert.equal(hanged.author, 'Joe Abercrombie');
    assert.equal(hanged.volume, 2);
    assert.equal(hanged.publisher, 'Orbit');
    assert.equal(hanged.release_date, '2015-09-08');
    assert.equal(hanged.language, 'en');
    assert.equal(hanged.isbn, '9780316387354');
    assert.equal(hanged.genres, 'Epic, Grimdark');
    assert.match(hanged.description, /^The second novel/);
    assert.ok(hanged.cover_path, 'the Calibre-style cover is found');
    assert.equal(hanged.book_meta_version, BOOK_META_VERSION);

    const kings = await item('Last Argument of Kings.epub');
    assert.equal(kings.volume, 3, 'number taken from the "03." folder');
    assert.equal(kings.series, hanged.series, '"First Law" and "The First Law" are one series');
    assert.equal(kings.series, 'The First Law');

    const leviathan = await item('Leviathan Wakes.epub');
    assert.equal(leviathan.series, 'The Expanse');
    assert.equal(leviathan.volume, 1);
    assert.ok(leviathan.cover_path, 'EPUB 3 cover-image is found');

    const curated = await item('Some Book - Author.epub');
    assert.equal(curated.title, 'The Curated Title');
    assert.equal(curated.series, 'Curated Series');
    assert.equal(curated.volume, 4);
  });

  test('a book scanned by an older version is filled in once, keeping edits', async () => {
    const db = await getDb();
    const hanged = await item('Before They Are Hanged.epub');
    // As 1.6 left it: raw title, nothing else, no cover.
    await db.run(
      `UPDATE items SET title = 'Before They Are Hanged (The First Law)', series = NULL, volume = NULL,
         description = NULL, publisher = NULL, isbn = NULL, language = NULL, genres = NULL, release_date = NULL,
         cover_path = NULL, book_meta_version = NULL WHERE id = ?`, [hanged.id]);
    const kings = await item('Last Argument of Kings.epub');
    await db.run(`UPDATE items SET title = 'My Own Title', description = 'My blurb', book_meta_version = NULL WHERE id = ?`, [kings.id]);

    await scanLibrary(lib);

    const refreshed = await item('Before They Are Hanged.epub');
    assert.equal(refreshed.title, 'Before They Are Hanged');
    assert.equal(refreshed.series, 'The First Law');
    assert.equal(refreshed.volume, 2);
    assert.equal(refreshed.isbn, '9780316387354');
    assert.ok(refreshed.cover_path);

    const edited = await item('Last Argument of Kings.epub');
    assert.equal(edited.title, 'My Own Title');
    assert.equal(edited.description, 'My blurb');
    assert.equal(edited.book_meta_version, BOOK_META_VERSION);
  });
});

describe('matching a book online', () => {
  let origFetch;
  const bookId = '9'.repeat(32);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });

  before(async () => {
    origFetch = globalThis.fetch;
    coverJpeg ||= await sharp({ create: { width: 40, height: 60, channels: 3, background: '#335' } }).jpeg().toBuffer();
    const db = await getDb();
    await db.run("INSERT OR IGNORE INTO libraries (id, name, path, type) VALUES ('lib-match', 'Books', '/tmp/match', 'books')");
    await db.run(
      `INSERT INTO items (id, library_id, title, author, path, media_type, format, isbn, description)
       VALUES (?, 'lib-match', 'Before They Are Hanged', 'Joe Abercrombie', '/tmp/match/Before They Are Hanged.epub', 'book', 'epub', '9780316387354', 'The blurb from the file')`,
      [bookId]
    );
  });
  after(() => { globalThis.fetch = origFetch; });

  // Google's keyless quota is out (as it often is); Open Library answers by ISBN.
  function mockProviders({ docs }) {
    const seen = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('googleapis.com')) return { ok: false, status: 429, json: async () => ({}) };
      if (u.includes('openlibrary.org/search.json')) return json({ docs });
      if (u.includes('openlibrary.org/isbn/')) return json({ publishers: ['Orbit'], publish_date: 'September 8, 2015', languages: [{ key: '/languages/eng' }] });
      if (u.includes('openlibrary.org/works/')) return json({ description: { value: 'Superior Glokta has a problem.\n----------\nSee also' } });
      if (u.includes('covers.openlibrary.org')) {
        return {
          ok: true, url: u,
          headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(coverJpeg.length) }),
          arrayBuffer: async () => coverJpeg.buffer.slice(coverJpeg.byteOffset, coverJpeg.byteOffset + coverJpeg.byteLength)
        };
      }
      throw new Error(`unexpected fetch ${u}`);
    };
    return seen;
  }

  test('by ISBN: fills the gaps from that edition and keeps what the file said', async () => {
    const seen = mockProviders({
      docs: [{ key: '/works/OL1W', title: 'Before They Are Hanged', author_name: ['Joe Abercrombie'], isbn: ['9780316387354', '9788420674292'], publisher: ['Alianza Editorial', 'Orbit'], first_publish_year: 2007, subject: ['Fantasy fiction'] }]
    });
    const { matchItemMetadata } = await import('../src/routes/metadata.js');
    const db = await getDb();
    const result = await matchItemMetadata(db, await db.get('SELECT * FROM items WHERE id = ?', [bookId]));

    assert.ok(seen.some((u) => u.includes('search.json?isbn=9780316387354')), 'searched by ISBN');
    assert.equal(result.item.title, 'Before They Are Hanged');
    assert.equal(result.item.description, 'The blurb from the file');
    assert.equal(result.item.publisher, 'Orbit', 'the edition\'s publisher, not the first one listed for the work');
    assert.equal(result.item.language, 'en');
    assert.equal(result.item.release_date, '2015');
    assert.equal(result.item.cover_source, 'open-library');
    assert.ok(result.posterUpdated);
  });

  test('without an ISBN, it searches by main title and author', async () => {
    const seen = mockProviders({ docs: [{ key: '/works/OL3W', title: 'Talk', author_name: ['Alison Wood Brooks'] }] });
    const { findBookMatches } = await import('../src/services/externalMetadata.js');
    const ranked = await findBookMatches({ title: 'Talk: The Science of Conversation and the Art of Being Ourselves', author: 'Alison Wood Brooks' });
    assert.ok(seen.some((u) => u.includes('search.json?title=Talk&author=Alison%20Wood%20Brooks')), seen.join('\n'));
    assert.equal(ranked[0].title, 'Talk');
    assert.ok(ranked[0].score >= 35);
  });

  test('a result that shares little with the book is not applied', async () => {
    mockProviders({ docs: [{ key: '/works/OL2W', title: 'Cooking for Two', author_name: ['A Chef'] }] });
    const { matchItemMetadata } = await import('../src/routes/metadata.js');
    const db = await getDb();
    await db.run("UPDATE items SET isbn = NULL WHERE id = ?", [bookId]);
    await assert.rejects(
      matchItemMetadata(db, await db.get('SELECT * FROM items WHERE id = ?', [bookId])),
      (err) => err.code === 'NO_METADATA_FOUND'
    );
  });
});
