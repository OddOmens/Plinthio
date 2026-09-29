import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mime from 'mime-types';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { userForApiKey, userForApiKeyId, basicAuthApiKey, blockedByNetwork } from '../middleware/auth.js';
import { accessSql } from '../services/visibility.js';
import { getMangaPagesList, extractMangaPage } from '../services/archive.js';
import { sendError } from '../errors.js';
import { serverError } from '../utils/http.js';
import { logger } from '../services/logger.js';

// A Komga-compatible slice of the API, so Mihon (and other Tachiyomi forks) can browse and
// read Plinthio's comics, manga and PDFs with their Komga extension, and sync what's read
// back with Mihon's built-in Komga tracker. Mounted at /api/v1 and /api/v2, which is where
// the extension looks once it's given the server address.
//
// Only what those two clients call is implemented, shaped exactly like the DTOs they parse
// (keiyoushi/extensions-source src/all/komga, mihonapp/mihon data/track/komga):
//   GET  /api/v1/libraries                      GET /api/v1/series/:id/books
//   GET  /api/v1/series[?search,library_id,…]   GET /api/v1/books[?search,…]
//   GET  /api/v1/series/:id(/thumbnail)         GET /api/v1/books/:id(/thumbnail)
//   GET  /api/v1/books/:id/pages(/:number)      GET /api/v1/{genres,tags,publishers,authors}
//   GET  /api/v1/{collections,readlists}        GET|PUT /api/v2/series/:id/read-progress/tachiyomi
//
// Sign-in is the same as OPDS: your username and a Plinthio API key as the password (HTTP
// Basic), or the key alone in X-API-Key. Mihon's tracker sends no credentials of its own —
// with real Komga it rides on the session cookie the extension's sign-in left behind — so a
// successful sign-in here sets one too, tied to the API key it came from.
export const komgaV1 = express.Router();
export const komgaV2 = express.Router();

const COOKIE = 'plinthio_komga';
const COOKIE_TTL_DAYS = 30;
const PAGE_FORMATS = ['cbz', 'cbr', 'cb7', 'zip', 'rar', '7z', 'pdf'];
const BOOK_TYPES = ['manga', 'book'];

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function challenge(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Plinthio"');
  return res.status(401).json({ error: 'Sign in with your username and a Plinthio API key as the password', code: 'P100' });
}

async function komgaAuth(req, res, next) {
  try {
    const rawKey = req.headers['x-api-key'] || basicAuthApiKey(req);
    let found = null;
    if (rawKey) {
      found = await userForApiKey(rawKey);
      if (!found) return challenge(res);
      // (Re)issue the session cookie the tracker will ride on.
      const cookie = jwt.sign({ keyId: found.keyId, typ: 'komga' }, config.jwtSecret, { expiresIn: `${COOKIE_TTL_DAYS}d` });
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(cookie)}; Path=/api; Max-Age=${COOKIE_TTL_DAYS * 86400}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
    } else {
      const cookie = readCookie(req, COOKIE);
      if (!cookie) return challenge(res);
      let payload;
      try {
        payload = jwt.verify(cookie, config.jwtSecret);
      } catch (e) {
        return challenge(res);
      }
      if (payload.typ !== 'komga') return challenge(res);
      found = await userForApiKeyId(payload.keyId); // gone once the key is deleted
      if (!found) return challenge(res);
    }
    if (found.expired) return sendError(req, res, 'P103');
    if (await blockedByNetwork(req, res, found.user)) return;
    req.user = found.user;
    next();
  } catch (err) {
    serverError(req, res, err);
  }
}

komgaV1.use(komgaAuth);
komgaV2.use(komgaAuth);

// ─── Loading what this person can read ───────────────────────────────────────────────────
// Everything page-readable they can see, with their progress, grouped into series in JS.
// Komga's queries are all "a page of series/books matching X", and building the groups
// from one query keeps the ids stable and the visibility rules in one place.

// Komga ids are opaque strings. A series is a (library, series name) pair — or, for a
// standalone title, the title itself — so its id is a hash of that.
const seriesKey = (row) => (row.series ? `s:${row.library_id}:${row.series}` : `i:${row.id}`);
const seriesIdFor = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);

// SQLite's "2024-05-01 10:00:00" → the "2024-05-01T10:00:00" Komga sends (the extension
// parses it without a zone).
const komgaDateTime = (v) => (v ? String(v).replace(' ', 'T').slice(0, 19) : '1970-01-01T00:00:00');
const komgaDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? String(v).slice(0, 10) : (v && /^\d{4}$/.test(v) ? `${v}-01-01` : null));
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function humanSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let n = bytes || 0;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n.toFixed(u ? 1 : 0)} ${units[u]}`;
}

async function loadLibrary(db, user) {
  const rows = await db.all(`
    SELECT i.id, i.library_id, i.title, i.author, i.artists, i.series, i.volume, i.path,
           i.total_pages, i.file_size, i.format, i.media_type, i.description, i.release_date,
           i.genres, i.themes, i.publisher, i.status, i.created_at, i.updated_at,
           p.is_finished, p.is_skipped, p.progress_percent, p.current_page,
           ss.title_override, ss.reading_direction, ss.age_rating AS series_age_rating
    FROM items i
    LEFT JOIN user_progress p ON p.item_id = i.id AND p.user_id = ?
    LEFT JOIN series_settings ss ON ss.library_id = i.library_id AND ss.series_name = i.series
    WHERE i.media_type IN (${BOOK_TYPES.map(() => '?').join(',')})
      AND lower(i.format) IN (${PAGE_FORMATS.map(() => '?').join(',')})
      AND i.extra_type IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${accessSql(user, 'i')}
  `, [user.id, ...BOOK_TYPES, ...PAGE_FORMATS, user.id]);

  const groups = new Map();
  for (const row of rows) {
    const key = seriesKey(row);
    if (!groups.has(key)) groups.set(key, { key, id: seriesIdFor(key), books: [] });
    groups.get(key).books.push(row);
  }
  for (const g of groups.values()) {
    g.books.sort((a, b) => {
      if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title, undefined, { numeric: true });
      if (a.volume == null) return 1;
      if (b.volume == null) return -1;
      return a.volume - b.volume;
    });
    // Komga's numberSort: the volume number where there is one, else the position.
    g.books.forEach((b, i) => { b.numberSort = b.volume != null ? Number(b.volume) : i + 1; });
    const first = g.books[0];
    g.libraryId = first.library_id;
    g.name = first.series ? (first.title_override || first.series) : first.title;
    g.created = g.books.reduce((m, b) => (b.created_at < m ? b.created_at : m), first.created_at);
    g.lastModified = g.books.reduce((m, b) => (b.updated_at > m ? b.updated_at : m), first.updated_at);
  }
  return groups;
}

const isRead = (b) => b.is_finished === 1 || b.is_skipped === 1;
const inProgress = (b) => !isRead(b) && (b.progress_percent > 0 || b.current_page > 0);

// ─── DTOs ────────────────────────────────────────────────────────────────────────────────
const STATUS = { ongoing: 'ONGOING', completed: 'ENDED', ended: 'ENDED', hiatus: 'HIATUS', cancelled: 'ABANDONED', abandoned: 'ABANDONED' };
const DIRECTION = { rtl: 'RIGHT_TO_LEFT', ltr: 'LEFT_TO_RIGHT', webtoon: 'WEBTOON' };
const AGE = { everyone: 0, teen: 13, mature: 18 };

function authorsOf(book) {
  return [
    ...splitList(book.author).filter((a) => a !== 'Unknown Author').map((name) => ({ name, role: 'writer' })),
    ...splitList(book.artists).map((name) => ({ name, role: 'penciller' }))
  ];
}

function seriesDto(g) {
  const first = g.books[0];
  const withText = g.books.find((b) => b.description) || first;
  const authors = [];
  const seen = new Set();
  for (const b of g.books) {
    for (const a of authorsOf(b)) {
      if (!seen.has(`${a.role}:${a.name}`)) { seen.add(`${a.role}:${a.name}`); authors.push(a); }
    }
  }
  const read = g.books.filter(isRead).length;
  const progressing = g.books.filter(inProgress).length;
  const created = komgaDateTime(g.created);
  const lastModified = komgaDateTime(g.lastModified);
  const direction = DIRECTION[first.reading_direction] || (first.media_type === 'manga' ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT');
  return {
    id: g.id,
    libraryId: g.libraryId,
    name: g.name,
    url: first.series ? path.dirname(first.path) : first.path,
    created,
    lastModified,
    fileLastModified: lastModified,
    booksCount: g.books.length,
    booksReadCount: read,
    booksUnreadCount: g.books.length - read - progressing,
    booksInProgressCount: progressing,
    deleted: false,
    oneshot: !first.series,
    metadata: {
      status: STATUS[String(first.status || '').toLowerCase()] || 'ONGOING',
      statusLock: false,
      created,
      lastModified,
      title: g.name,
      titleLock: false,
      titleSort: g.name,
      titleSortLock: false,
      summary: withText.description || '',
      summaryLock: false,
      readingDirection: direction,
      readingDirectionLock: false,
      publisher: first.publisher || '',
      publisherLock: false,
      ageRating: AGE[String(first.series_age_rating || '').toLowerCase()] ?? null,
      ageRatingLock: false,
      language: '',
      languageLock: false,
      genres: splitList(first.genres),
      genresLock: false,
      tags: splitList(first.themes),
      tagsLock: false,
      totalBookCount: null,
      totalBookCountLock: false,
      sharingLabels: [],
      links: [],
      alternateTitles: []
    },
    booksMetadata: {
      authors,
      tags: [],
      releaseDate: komgaDate(first.release_date),
      summary: withText.description || '',
      summaryNumber: '',
      created,
      lastModified
    }
  };
}

function bookDto(g, b) {
  const created = komgaDateTime(b.created_at);
  const lastModified = komgaDateTime(b.updated_at);
  const number = b.volume != null ? String(Number(b.volume)) : String(b.numberSort);
  return {
    id: b.id,
    seriesId: g.id,
    seriesTitle: g.name,
    libraryId: b.library_id,
    name: b.title,
    url: b.path,
    number: b.numberSort,
    created,
    lastModified,
    fileLastModified: lastModified,
    sizeBytes: b.file_size || 0,
    size: humanSize(b.file_size),
    media: {
      status: 'READY',
      mediaType: String(b.format).toLowerCase() === 'pdf' ? 'application/pdf' : 'application/zip',
      pagesCount: b.total_pages || 0,
      mediaProfile: 'DIVINA',
      epubDivinaCompatible: false,
      comment: ''
    },
    metadata: {
      title: b.title,
      titleLock: false,
      summary: b.description || '',
      summaryLock: false,
      number,
      numberLock: false,
      numberSort: b.numberSort,
      numberSortLock: false,
      releaseDate: komgaDate(b.release_date),
      releaseDateLock: false,
      authors: authorsOf(b),
      authorsLock: false,
      tags: [],
      tagsLock: false,
      isbn: '',
      isbnLock: false,
      links: [],
      linksLock: false,
      created,
      lastModified
    },
    readProgress: isRead(b) || inProgress(b)
      ? { page: b.is_finished ? (b.total_pages || 0) : (b.current_page || 0), completed: isRead(b), readDate: lastModified, created, lastModified }
      : null,
    deleted: false,
    fileHash: '',
    oneshot: !b.series
  };
}

// Spring-style page of results.
function paged(req, all) {
  const unpaged = req.query.unpaged === 'true';
  const size = unpaged ? Math.max(all.length, 1) : Math.min(500, Math.max(1, parseInt(req.query.size, 10) || 20));
  const number = unpaged ? 0 : Math.max(0, parseInt(req.query.page, 10) || 0);
  const content = all.slice(number * size, number * size + size);
  const totalPages = Math.max(1, Math.ceil(all.length / size));
  return {
    content,
    pageable: { pageNumber: number, pageSize: size, offset: number * size, paged: !unpaged, unpaged },
    empty: content.length === 0,
    first: number === 0,
    last: number >= totalPages - 1,
    number,
    numberOfElements: content.length,
    size,
    totalElements: all.length,
    totalPages,
    sort: { empty: true, sorted: false, unsorted: true }
  };
}

// Query params may repeat (read_status=UNREAD&read_status=IN_PROGRESS) or be comma lists.
function multi(req, name) {
  const raw = req.query[name];
  if (raw == null) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
}

function sortBy(list, req, { title, created, modified }) {
  const [field = '', dir = 'asc'] = String(req.query.sort || '').split(',');
  const sign = dir.toLowerCase() === 'desc' ? -1 : 1;
  if (field === 'random') {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  const key = field === 'createdDate' ? created : field === 'lastModifiedDate' ? modified : title;
  return list.sort((a, b) => sign * String(key(a)).localeCompare(String(key(b)), undefined, { numeric: true, sensitivity: 'base' }));
}

function matchesSeries(g, req) {
  const search = String(req.query.search || '').trim().toLowerCase();
  if (search && !g.name.toLowerCase().includes(search) &&
      !g.books.some((b) => b.title.toLowerCase().includes(search) || String(b.author || '').toLowerCase().includes(search))) {
    return false;
  }
  const libs = multi(req, 'library_id');
  if (libs.length && !libs.includes(g.libraryId)) return false;
  const first = g.books[0];
  const statuses = multi(req, 'status');
  if (statuses.length && !statuses.includes(STATUS[String(first.status || '').toLowerCase()] || 'ONGOING')) return false;
  const genres = multi(req, 'genre');
  if (genres.length && !splitList(first.genres).some((x) => genres.includes(x))) return false;
  const tags = multi(req, 'tag');
  if (tags.length && !splitList(first.themes).some((x) => tags.includes(x))) return false;
  const publishers = multi(req, 'publisher');
  if (publishers.length && !publishers.includes(first.publisher || '')) return false;
  const authorParams = Array.isArray(req.query.author) ? req.query.author : (req.query.author ? [req.query.author] : []);
  if (authorParams.length) {
    const names = authorParams.map((a) => String(a).split(',')[0]);
    if (!g.books.some((b) => authorsOf(b).some((a) => names.includes(a.name)))) return false;
  }
  const readStatus = multi(req, 'read_status');
  if (readStatus.length) {
    const read = g.books.filter(isRead).length;
    const state = read === g.books.length ? 'READ' : (read > 0 || g.books.some(inProgress) ? 'IN_PROGRESS' : 'UNREAD');
    if (!readStatus.includes(state)) return false;
  }
  return true;
}

async function findSeries(req, res) {
  const db = await getDb();
  const groups = await loadLibrary(db, req.user);
  const g = [...groups.values()].find((x) => x.id === req.params.id);
  if (!g) {
    sendError(req, res, 'P300');
    return null;
  }
  return { db, g };
}

async function findBook(req, res) {
  const db = await getDb();
  const groups = await loadLibrary(db, req.user);
  for (const g of groups.values()) {
    const b = g.books.find((x) => x.id === req.params.id);
    if (b) return { db, g, b };
  }
  sendError(req, res, 'P300');
  return null;
}

function sendCover(res, itemId) {
  const file = path.join(config.coversDir, `${itemId}.jpg`);
  return getDb()
    .then((db) => db.get('SELECT cover_path FROM items WHERE id = ?', [itemId]))
    .then((row) => {
      const cover = row?.cover_path ? path.join(config.coversDir, row.cover_path) : file;
      if (!fs.existsSync(cover)) return res.status(404).end();
      res.setHeader('Content-Type', mime.lookup(cover) || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(cover);
    });
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────
komgaV1.get('/libraries', async (req, res) => {
  try {
    const db = await getDb();
    const groups = await loadLibrary(db, req.user);
    const ids = new Set([...groups.values()].map((g) => g.libraryId));
    const libs = ids.size
      ? await db.all(`SELECT id, name FROM libraries WHERE id IN (${[...ids].map(() => '?').join(',')}) ORDER BY name`, [...ids])
      : [];
    res.json(libs.map((l) => ({ id: l.id, name: l.name, unavailable: false })));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/series', async (req, res) => {
  try {
    const db = await getDb();
    const groups = [...(await loadLibrary(db, req.user)).values()].filter((g) => matchesSeries(g, req));
    sortBy(groups, req, { title: (g) => g.name, created: (g) => g.created, modified: (g) => g.lastModified });
    res.json(paged(req, groups.map(seriesDto)));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/series/:id', async (req, res) => {
  try {
    const found = await findSeries(req, res);
    if (found) res.json(seriesDto(found.g));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/series/:id/thumbnail', async (req, res) => {
  try {
    const found = await findSeries(req, res);
    if (found) await sendCover(res, found.g.books[0].id);
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/series/:id/books', async (req, res) => {
  try {
    const found = await findSeries(req, res);
    if (!found) return;
    const books = found.g.books.map((b) => bookDto(found.g, b));
    if (String(req.query.sort || '').includes('desc')) books.reverse();
    res.json(paged(req, books));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/books', async (req, res) => {
  try {
    const db = await getDb();
    const search = String(req.query.search || '').trim().toLowerCase();
    const libs = multi(req, 'library_id');
    const all = [];
    for (const g of (await loadLibrary(db, req.user)).values()) {
      if (libs.length && !libs.includes(g.libraryId)) continue;
      for (const b of g.books) {
        if (search && !b.title.toLowerCase().includes(search) && !g.name.toLowerCase().includes(search)) continue;
        all.push({ g, b });
      }
    }
    sortBy(all, req, { title: (x) => x.b.title, created: (x) => x.b.created_at, modified: (x) => x.b.updated_at });
    res.json(paged(req, all.map(({ g, b }) => bookDto(g, b))));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/books/:id', async (req, res) => {
  try {
    const found = await findBook(req, res);
    if (found) res.json(bookDto(found.g, found.b));
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/books/:id/thumbnail', async (req, res) => {
  try {
    const found = await findBook(req, res);
    if (found) await sendCover(res, found.b.id);
  } catch (err) {
    serverError(req, res, err);
  }
});

komgaV1.get('/books/:id/pages', async (req, res) => {
  try {
    const found = await findBook(req, res);
    if (!found) return;
    if (!fs.existsSync(found.b.path)) return sendError(req, res, 'P301');
    const names = await getMangaPagesList(found.b.path);
    res.json(names.map((name, i) => ({
      number: i + 1,
      fileName: path.basename(name),
      mediaType: mime.lookup(name) || 'image/jpeg'
    })));
  } catch (err) {
    sendError(req, res, err?.plinthioCode || 'P302', { err });
  }
});

// Komga pages are numbered from 1. `?convert=png` is asked for formats a phone can't show;
// every format Plinthio serves (JPEG, PNG, WebP, GIF, AVIF) already is one, so it's ignored.
komgaV1.get('/books/:id/pages/:number', async (req, res) => {
  try {
    const found = await findBook(req, res);
    if (!found) return;
    const n = parseInt(req.params.number, 10);
    if (!Number.isInteger(n) || n < 1) return sendError(req, res, 'P306', { message: 'Invalid page number' });
    const page = await extractMangaPage(found.b.path, n - 1);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.setHeader('Content-Type', page.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.send(page.data);
  } catch (err) {
    sendError(req, res, err?.plinthioCode || 'P302', { err });
  }
});

// Filter data the extension asks for once when it's set up.
async function distinctValues(req, pick) {
  const db = await getDb();
  const out = new Set();
  for (const g of (await loadLibrary(db, req.user)).values()) {
    for (const v of pick(g)) out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}
komgaV1.get('/genres', async (req, res) => {
  try { res.json(await distinctValues(req, (g) => splitList(g.books[0].genres))); } catch (err) { serverError(req, res, err); }
});
komgaV1.get('/tags', async (req, res) => {
  try { res.json(await distinctValues(req, (g) => splitList(g.books[0].themes))); } catch (err) { serverError(req, res, err); }
});
komgaV1.get('/publishers', async (req, res) => {
  try { res.json(await distinctValues(req, (g) => (g.books[0].publisher ? [g.books[0].publisher] : []))); } catch (err) { serverError(req, res, err); }
});
komgaV1.get('/authors', async (req, res) => {
  try {
    const db = await getDb();
    const seen = new Map();
    for (const g of (await loadLibrary(db, req.user)).values()) {
      for (const b of g.books) for (const a of authorsOf(b)) seen.set(`${a.role}:${a.name}`, a);
    }
    res.json([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    serverError(req, res, err);
  }
});

// Collections and read lists aren't mapped (Plinthio's Lists mix media types and outside
// titles); empty pages keep the extension's filters happy.
komgaV1.get('/collections', (req, res) => res.json(paged(req, [])));
komgaV1.get('/readlists', (req, res) => res.json(paged(req, [])));
komgaV1.get('/readlists/:id', (req, res) => sendError(req, res, 'P300'));

// ─── Tracker (Mihon → Plinthio progress) ─────────────────────────────────────────────────
function readProgressV2(g) {
  const read = g.books.filter(isRead).length;
  const progressing = g.books.filter(inProgress).length;
  let lastContinuous = 0;
  for (const b of g.books) {
    if (!isRead(b)) break;
    lastContinuous = b.numberSort;
  }
  return {
    booksCount: g.books.length,
    booksReadCount: read,
    booksUnreadCount: g.books.length - read - progressing,
    booksInProgressCount: progressing,
    lastReadContinuousNumberSort: lastContinuous,
    maxNumberSort: g.books.reduce((m, b) => Math.max(m, b.numberSort), 0)
  };
}

komgaV2.get('/series/:id/read-progress/tachiyomi', async (req, res) => {
  try {
    const found = await findSeries(req, res);
    if (found) res.json(readProgressV2(found.g));
  } catch (err) {
    serverError(req, res, err);
  }
});

// "I've read up to chapter N": every book numbered N or lower is marked read. Nothing is
// ever marked unread from here — Mihon only moves forward.
komgaV2.put('/series/:id/read-progress/tachiyomi', async (req, res) => {
  const upTo = Number(req.body?.lastBookNumberSortRead);
  if (!Number.isFinite(upTo)) return sendError(req, res, 'P001', { message: 'lastBookNumberSortRead must be a number' });
  try {
    const found = await findSeries(req, res);
    if (!found) return;
    const { db, g } = found;
    const toMark = g.books.filter((b) => b.numberSort <= upTo && !b.is_finished);
    await db.run('BEGIN TRANSACTION');
    try {
      for (const b of toMark) {
        const pages = b.total_pages || 0;
        await db.run(`
          INSERT INTO user_progress (user_id, item_id, current_page, total_pages, progress_percent, is_finished, is_skipped, updated_at)
          VALUES (?, ?, ?, ?, 100, 1, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            current_page = excluded.current_page, progress_percent = 100, is_finished = 1, is_skipped = 0,
            updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, b.id, pages, pages]);
        b.is_finished = 1;
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
    if (toMark.length) logger.info('sync', `Mihon marked ${toMark.length} of "${g.name}" read for ${req.user.username}`);
    res.status(204).end();
  } catch (err) {
    serverError(req, res, err);
  }
});
