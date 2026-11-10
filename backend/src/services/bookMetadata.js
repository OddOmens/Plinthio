import fs from 'fs';
import path from 'path';
import sax from 'sax';
import AdmZip from 'adm-zip';

// What an ebook says about itself. An EPUB's package document (the .opf) carries the same
// Dublin Core record a library catalogue does — title, authors, publisher, date, language,
// ISBN, subjects, a blurb — and Calibre adds the series and its number. Calibre's library
// folders also keep a copy beside the file (metadata.opf), which is the curated one: what
// the owner edited in Calibre, even when the EPUB inside was never rewritten.
//
//   <dc:title>Before They Are Hanged (The First Law)</dc:title>
//   <dc:creator opf:role="aut">Joe Abercrombie</dc:creator>
//   <dc:identifier opf:scheme="ISBN">9780316387354</dc:identifier>
//   <meta name="calibre:series" content="First Law"/>  <meta name="calibre:series_index" content="2.0"/>
//   <meta name="cover" content="cover"/> … <item href="cover1.jpeg" id="cover" media-type="image/jpeg"/>
//
// EPUB 3 says the same things differently (cover-image property, belongs-to-collection with
// a group-position, roles as refining <meta>s), so both forms are read.

// Bump when extraction learns something new: books scanned with an older version are read
// again once (see the scanner), filling only the fields that are still empty.
export const BOOK_META_VERSION = 1;

const MAX_DESCRIPTION = 6000;

// A book is a file somebody downloaded, so what it says about itself is read within limits.
// Sizes are checked against what the zip declares before anything is inflated (a few KB of
// zip can claim to hold gigabytes), and text is clipped before any pattern is run over it.
const MAX_CONTAINER_BYTES = 1024 * 1024; // META-INF/container.xml is a few hundred bytes
const MAX_OPF_BYTES = 2 * 1024 * 1024; // a big anthology's package document is ~200 KB
const MAX_COVER_BYTES = 15 * 1024 * 1024; // the same limit an uploaded cover gets
// A blurb is cut to MAX_DESCRIPTION characters of text; this is how much markup is read to
// find them.
const MAX_HTML_INPUT = 200 * 1000;
const MAX_FIELD_TEXT = 2000; // a title, a name, a subject
// How many of each thing a package document may list before the rest are ignored. Several
// lookups below compare one list against another, so the lists can't be left open-ended.
const MAX_LISTED = { titles: 50, creators: 200, identifiers: 50, subjects: 500, metas: 2000, manifest: 20000, guide: 200 };
const MAX_SUBJECTS = 8;
// Catalogue filler that says nothing about the book.
const EMPTY_SUBJECTS = new Set(['general', 'fiction', 'nonfiction', 'non-fiction', 'ebook', 'ebooks', 'book', 'books']);
// Names a PDF tool writes into the Title field when nobody set one.
const JUNK_PDF_TITLE = /^(untitled|microsoft word|document\d*$|doc\d*$|.*\.(docx?|rtf|odt|indd|pages|tex|dvi)$)/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// The two functions below do by hand what /<!\[CDATA\[([\s\S]*?)\]\]>/ and
// /<(script|style)[\s\S]*?<\/\1>/ would. Those patterns search to the end of the text again
// from every opening that has no closing, so a description made of 40,000 "<script"s took
// 23 seconds; these read the text once.
function unwrapCdata(text) {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = text.indexOf('<![CDATA[', pos);
    if (start === -1) break;
    const end = text.indexOf(']]>', start + 9);
    if (end === -1) break;
    out += text.slice(pos, start) + text.slice(start + 9, end);
    pos = end + 3;
  }
  return pos ? out + text.slice(pos) : text;
}

function stripScriptAndStyle(text) {
  const opening = /<(script|style)/gi;
  const closing = { script: /<\/script>/gi, style: /<\/style>/gi };
  const unclosed = new Set(); // tags with no closing anywhere further on
  let out = '';
  let pos = 0;
  let m;
  while ((m = opening.exec(text))) {
    const tag = m[1].toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = closing[tag];
    close.lastIndex = opening.lastIndex;
    const end = close.exec(text);
    if (!end) {
      unclosed.add(tag);
      if (unclosed.size === 2) break;
      continue;
    }
    out += text.slice(pos, m.index);
    pos = close.lastIndex;
    opening.lastIndex = pos;
  }
  return pos ? out + text.slice(pos) : text;
}

/**
 * A blurb as plain text with its paragraphs kept. Descriptions arrive as HTML (Calibre and
 * publishers both write it), sometimes escaped a second time, and the title page shows text.
 */
export function htmlToText(html) {
  if (!html) return null;
  let text = String(html).slice(0, MAX_HTML_INPUT);
  // Escaped markup ("&lt;p&gt;") is markup once decoded.
  if (!/<[a-z!/]/i.test(text) && /&lt;\/?[a-z]/i.test(text)) text = decodeEntities(text);
  // A tag runs from "<" to the next ">" with no "<" between: without that, a run of "<"s
  // with no ">" is searched to the end once per "<".
  text = stripScriptAndStyle(unwrapCdata(text))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^<>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr)>/gi, '\n\n')
    .replace(/<[^<>]+>/g, '');
  text = decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // A lone "**" or "* * *" left at the end of a publisher blurb is a scene-break ornament:
  // everything from the first line break in the trailing run of asterisks and spaces goes.
  let tail = text.length;
  while (tail > 0 && (text[tail - 1] === '*' || /\s/.test(text[tail - 1]))) tail--;
  const ornament = text.indexOf('\n', tail);
  if (ornament !== -1 && ornament < text.length - 1) text = text.slice(0, ornament).trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, '')}…` : text;
}

/** An ISBN-10 or -13 with a valid check digit, as 13 digits; null for anything else. */
export function normalizeIsbn(value) {
  const raw = String(value || '').replace(/^urn:isbn:/i, '').replace(/^isbn[:\s]*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(raw)) {
    const sum = [...raw].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 && /^97[89]/.test(raw) ? raw : null;
  }
  if (/^\d{9}[\dX]$/.test(raw)) {
    const sum = [...raw].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const core = `978${raw.slice(0, 9)}`;
    const check = (10 - ([...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return `${core}${check}`;
  }
  return null;
}

// "2015-09-08T00:00:00+00:00" → "2015-09-08"; "2008" stays "2008". Calibre writes year 101
// for "unknown", which isn't a date.
function normalizeDate(value) {
  const m = String(value || '').trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m || Number(m[1]) < 1000) return null;
  return [m[1], m[2], m[3]].filter(Boolean).join('-');
}

/** A language tag in its canonical form: "eng" and "en_US" become "en" and "en-US". */
export function normalizeLanguage(value) {
  const lang = String(value || '').trim().replace(/_/g, '-');
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang) || /^(und|mul|zxx)$/i.test(lang)) return null;
  try {
    return Intl.getCanonicalLocales(lang)[0] || null;
  } catch {
    return null;
  }
}

function seriesNumber(value) {
  const n = parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n < 100000 ? n : null;
}

const METADATA_FIELDS = new Set(['title', 'creator', 'identifier', 'subject', 'meta', 'description', 'publisher', 'date', 'language']);

const localName = (name) => name.slice(name.lastIndexOf(':') + 1);
const attr = (attrs, name) => {
  for (const [key, value] of Object.entries(attrs)) {
    if (localName(key) === name) return value;
  }
  return undefined;
};

/**
 * Reads an OPF package document. Everything is optional; missing fields come back null.
 */
export function parseOpf(xml) {
  const parser = sax.parser(false, { lowercase: true, trim: false, normalize: false });
  const titles = []; // { id, text }
  const creators = []; // { id, text, role }
  const identifiers = []; // { scheme, text }
  const subjects = [];
  const metas = []; // EPUB 3 <meta property refines>text</meta>
  const named = {}; // EPUB 2 <meta name content>
  const manifest = [];
  const guide = [];
  const dc = {};
  let section = null;
  let open = null; // element whose text is being collected

  parser.onopentag = (node) => {
    const name = localName(node.name);
    const a = node.attributes;
    if (name === 'metadata' || name === 'manifest' || name === 'guide') { section = name; return; }
    if (section === 'manifest' && name === 'item') {
      if (manifest.length < MAX_LISTED.manifest) manifest.push({ id: a.id, href: a.href, type: (a['media-type'] || '').toLowerCase(), properties: a.properties || '' });
      return;
    }
    if (section === 'guide' && name === 'reference') {
      if (guide.length < MAX_LISTED.guide) guide.push({ type: (a.type || '').toLowerCase(), href: a.href });
      return;
    }
    // Markup nested in a field (an unescaped <p> in a description) only adds its text.
    if (section !== 'metadata' || open) return;
    if (name === 'meta' && a.name) {
      named[a.name.toLowerCase()] = a.content ?? '';
      return;
    }
    if (!METADATA_FIELDS.has(name)) return; // e.g. OPF 1's <dc-metadata> wrapper
    open = { name, id: a.id || null, role: attr(a, 'role'), scheme: attr(a, 'scheme'), event: attr(a, 'event'), property: a.property, refines: a.refines, text: '' };
  };
  // Only a description is long; the rest are names, and stop growing once they clearly aren't.
  const collect = (text) => {
    if (open && open.text.length < (open.name === 'description' ? MAX_HTML_INPUT : MAX_FIELD_TEXT)) open.text += text;
  };
  parser.ontext = collect;
  parser.oncdata = collect;
  parser.onclosetag = (tagName) => {
    const name = localName(tagName);
    if (name === 'metadata' || name === 'manifest' || name === 'guide') { section = null; return; }
    if (!open || name !== open.name) return;
    const el = open;
    open = null;
    const text = (el.name === 'description' ? el.text : el.text.slice(0, MAX_FIELD_TEXT)).trim();
    if (!text && el.name !== 'description') return;
    const room = (list, key) => list.length < MAX_LISTED[key];
    switch (el.name) {
      case 'title': if (room(titles, 'titles')) titles.push({ id: el.id, text }); break;
      case 'creator': if (room(creators, 'creators')) creators.push({ id: el.id, text, role: el.role ? el.role.toLowerCase() : null }); break;
      case 'identifier': if (room(identifiers, 'identifiers')) identifiers.push({ scheme: (el.scheme || '').toLowerCase(), text }); break;
      case 'subject': if (room(subjects, 'subjects')) subjects.push(text); break;
      case 'meta': if (el.property && room(metas, 'metas')) metas.push({ property: el.property, refines: (el.refines || '').replace(/^#/, ''), id: el.id, text }); break;
      case 'date':
        // EPUB 2 can list several (creation, modification…); the publication date is wanted.
        if (/modif|creat/i.test(el.event || '')) break;
        if (!dc.date) dc.date = text;
        break;
      case 'description': case 'publisher': case 'language':
        if (!dc[el.name] && text) dc[el.name] = text;
        break;
      default: break;
    }
  };
  parser.onerror = () => { parser.error = null; parser.resume(); };
  try {
    parser.write(xml).close();
  } catch (e) {
    // A broken package still yields whatever was read before the break.
  }

  const refining = (id, property) => metas.find((m) => m.refines === id && m.property === property)?.text;

  // EPUB 3 can mark which title is the main one; otherwise it's the first.
  const mainTitle = titles.find((t) => t.id && refining(t.id, 'title-type') === 'main') || titles[0];
  const subtitle = titles.find((t) => t.id && refining(t.id, 'title-type') === 'subtitle');

  const roleOf = (c) => c.role || (c.id ? refining(c.id, 'role') : null) || null;
  const authors = creators.filter((c) => !roleOf(c) || roleOf(c) === 'aut');
  const authorNames = [...new Set((authors.length ? authors : creators).map((c) => decodeEntities(c.text)))];

  let isbn = null;
  for (const id of identifiers) {
    const looksIsbn = id.scheme === 'isbn' || /^urn:isbn:/i.test(id.text) || /^isbn/i.test(id.text) || /^97[89][\d-]{10,14}$/.test(id.text);
    if (looksIsbn && (isbn = normalizeIsbn(id.text))) break;
  }

  // Series: Calibre's two <meta>s, else EPUB 3's belongs-to-collection (a "series" one, or
  // any collection if none is typed), with its group-position.
  let series = named['calibre:series'] || null;
  let seriesIndex = series ? seriesNumber(named['calibre:series_index']) : null;
  if (!series) {
    const collections = metas.filter((m) => m.property === 'belongs-to-collection');
    const chosen = collections.find((c) => c.id && refining(c.id, 'collection-type') === 'series') || collections[0];
    if (chosen) {
      series = chosen.text;
      seriesIndex = chosen.id ? seriesNumber(refining(chosen.id, 'group-position')) : null;
    }
  }

  const seenSubjects = new Set();
  const genres = [];
  for (const raw of subjects) {
    // "Fiction / Fantasy / Epic" (BISAC) → its most specific part.
    const s = decodeEntities(raw).split(/\s*\/\s*/).pop().trim();
    const key = s.toLowerCase();
    if (!s || s.length > 60 || EMPTY_SUBJECTS.has(key) || seenSubjects.has(key)) continue;
    seenSubjects.add(key);
    genres.push(s);
    if (genres.length >= MAX_SUBJECTS) break;
  }

  // Cover, most explicit first: EPUB 3's property, EPUB 2's <meta name="cover"> (an id, or
  // now and then the path itself), then anything that calls itself a cover.
  const isImage = (item) => item && (item.type.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(item.href || ''));
  const coverMeta = named.cover;
  const cover = manifest.find((i) => /(^|\s)cover-image(\s|$)/.test(i.properties) && i.href)
    || (coverMeta && manifest.find((i) => i.id === coverMeta && isImage(i)))
    || (coverMeta && manifest.find((i) => i.href === coverMeta && isImage(i)))
    || manifest.find((i) => /cover/i.test(i.id || '') && isImage(i))
    || manifest.find((i) => /cover/i.test(i.href || '') && isImage(i))
    || (guide.find((g) => g.type === 'cover' && /\.(jpe?g|png|gif|webp)$/i.test(g.href || '')) || null);

  return {
    title: mainTitle ? decodeEntities(mainTitle.text) : null,
    subtitle: subtitle ? decodeEntities(subtitle.text) : null,
    authors: authorNames,
    description: htmlToText(dc.description),
    publisher: dc.publisher ? decodeEntities(dc.publisher) : null,
    releaseDate: normalizeDate(dc.date),
    language: normalizeLanguage(dc.language),
    isbn,
    genres,
    series: series ? decodeEntities(series).trim() || null : null,
    seriesIndex,
    coverHref: cover?.href ? decodeURIComponent(cover.href.split('#')[0]) : null
  };
}

const comparable = (s) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Calibre and store downloads often put the series in the title — "Before They Are Hanged
 * (The First Law)", "Dune (Dune Chronicles, #1)". With the series stored on its own, that's
 * repetition, so the bracket goes.
 */
export function stripSeriesFromTitle(title, series) {
  if (!title || !series) return title;
  const m = title.match(/^(.*\S)\s*[([]([^()[\]]+)[)\]]\s*$/);
  if (!m) return title;
  const inner = m[2].replace(/(?:,?\s*(?:#|book|vol\.?|volume|no\.?|part)\s*[\d.]+|\s+\d+(?:\.\d+)?)$/i, '');
  return comparable(inner) === comparable(series) ? m[1] : title;
}

// "02. Before They Are Hanged", "02 - Before…", "Book 2", "#2": a series number in a folder
// or file name, used only when the book names its series but not its place in it.
function numberFromName(name) {
  const m = name.match(/^(\d{1,3}(?:\.\d+)?)\s*[-–.)_]\s*\S/) || name.match(/(?:^|\s)(?:book|vol\.?|volume|#)\s*(\d{1,3}(?:\.\d+)?)\b/i);
  return m ? parseFloat(m[1]) : null;
}

const EBOOK_EXTS = new Set(['.epub', '.pdf', '.mobi', '.azw3', '.azw', '.kepub', '.fb2', '.djvu', '.cbz', '.cbr']);

/**
 * Calibre's metadata.opf from the book's folder, parsed — only when the folder holds a
 * single book (Calibre names every format of a book the same, so "Dune.epub" and "Dune.pdf"
 * count as one). In a shared folder the sidecar can't be tied to a file.
 */
export function readSidecarOpf(filePath) {
  const dir = path.dirname(filePath);
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const sidecar = names.find((n) => n.toLowerCase() === 'metadata.opf');
  if (!sidecar) return null;
  const books = new Set(names
    .filter((n) => !n.startsWith('.') && EBOOK_EXTS.has(path.extname(n).toLowerCase()))
    .map((n) => path.basename(n, path.extname(n)).toLowerCase()));
  if (books.size > 1) return null;
  try {
    const file = path.join(dir, sidecar);
    if (fs.statSync(file).size > MAX_OPF_BYTES) return null;
    return parseOpf(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// An entry's bytes, or null when it says it is bigger than `maxBytes`. The size is the one
// the zip declares, checked before inflating; the zip library stops inflating at that size,
// so an entry that lies about it comes out as an error rather than as gigabytes.
function readCapped(entry, maxBytes) {
  if (!entry || entry.isDirectory || entry.header.size > maxBytes) return null;
  return entry.getData();
}

/**
 * The OPF inside an EPUB, parsed, plus its cover image's bytes when it has one.
 */
export function readEpubOpf(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const byName = new Map(entries.map((e) => [e.entryName, e]));

  let opfPath = null;
  const container = byName.get('META-INF/container.xml');
  const containerXml = readCapped(container, MAX_CONTAINER_BYTES);
  if (containerXml) {
    const m = containerXml.toString('utf8').match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (m) opfPath = m[1];
  }
  if (!opfPath || !byName.has(opfPath)) opfPath = entries.find((e) => e.entryName.toLowerCase().endsWith('.opf'))?.entryName || null;
  if (!opfPath) return null;

  const opfXml = readCapped(byName.get(opfPath), MAX_OPF_BYTES);
  if (!opfXml) throw new Error('its package document (.opf) is too large to read');
  const opf = parseOpf(opfXml.toString('utf8'));
  let coverData = null;
  if (opf.coverHref) {
    const opfDir = path.posix.dirname(opfPath);
    const target = path.posix.normalize(opfDir === '.' ? opf.coverHref : `${opfDir}/${opf.coverHref}`).toLowerCase();
    const entry = entries.find((e) => e.entryName.toLowerCase() === target)
      || entries.find((e) => path.posix.basename(e.entryName).toLowerCase() === path.posix.basename(target));
    // A cover too big to read is left out; the rest of what the book says still counts.
    coverData = readCapped(entry, MAX_COVER_BYTES);
  }
  return { ...opf, coverData };
}

/**
 * Everything known about one book file, from (in order of trust) Calibre's sidecar, the
 * EPUB itself, and the PDF's info block. Returns plain fields; the caller writes the cover.
 */
export async function readBookMetadata(filePath, { pdfInfo = null } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  let embedded = null;
  if (ext === '.epub') {
    try {
      embedded = readEpubOpf(filePath);
    } catch (err) {
      console.warn(`Could not parse EPUB metadata for ${filePath}: ${err.message}`);
    }
  }

  let pdf = null;
  if (ext === '.pdf' && pdfInfo) {
    try {
      pdf = await pdfInfo(filePath);
    } catch (err) {
      console.warn(`Could not read PDF info for ${filePath}: ${err.message}`);
    }
  }

  const sidecar = readSidecarOpf(filePath);
  const pick = (key) => {
    const fromSidecar = sidecar?.[key];
    if (Array.isArray(fromSidecar) ? fromSidecar.length : fromSidecar != null && fromSidecar !== '') return fromSidecar;
    return embedded?.[key] ?? null;
  };

  let title = pick('title');
  if (!title && pdf?.title && !JUNK_PDF_TITLE.test(pdf.title.trim())) title = pdf.title.trim();
  const authors = pick('authors') || [];
  let author = authors.length ? authors.join(', ') : null;
  if (!author && pdf?.author) author = pdf.author;

  const series = pick('series');
  let seriesIndex = series ? (sidecar?.series ? sidecar.seriesIndex : embedded?.seriesIndex) : null;
  if (series && seriesIndex == null) {
    seriesIndex = numberFromName(path.basename(filePath, ext)) ?? numberFromName(path.basename(path.dirname(filePath)));
  }

  return {
    rawTitle: title,
    title: title ? stripSeriesFromTitle(title, series) : null,
    author,
    series,
    volume: seriesIndex,
    description: pick('description'),
    publisher: pick('publisher'),
    releaseDate: pick('releaseDate'),
    language: pick('language'),
    isbn: pick('isbn'),
    genres: pick('genres') || [],
    totalPages: pdf?.pages || 0,
    coverData: embedded?.coverData || null
  };
}
