import { getDb } from '../config/database.js';
import { htmlToText, normalizeIsbn, normalizeLanguage } from './bookMetadata.js';

const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': 'Plinthio/1.4.1 (https://github.com/OddOmens/Plinthio)', ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      // The status is attached, not just interpolated into the message, so callers can tell
      // "your key is wrong" (401/403) apart from "the server can't get out" — advice that
      // sends someone to debug their firewall over a rejected credential wastes their time.
      const err = new Error(`Request failed with status ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * MangaDex — free, no API key required.
 * https://api.mangadex.org/docs/
 */
async function searchMangaDex(query) {
  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=12&includes[]=cover_art&includes[]=author&includes[]=artist&order[relevance]=desc`;
  const data = await fetchJson(url);

  return (data.data || []).map((manga) => {
    const attrs = manga.attributes || {};
    const title = attrs.title?.en || Object.values(attrs.title || {})[0] || 'Untitled';
    const altTitle = (attrs.altTitles || [])
      .map((t) => Object.values(t)[0])
      .find(Boolean);

    const coverRel = (manga.relationships || []).find((r) => r.type === 'cover_art');
    // MangaDex can credit more than one author/artist (e.g. a writer duo) — collect all of
    // them rather than just the first relationship, matching what the site itself shows.
    const authorNames = (manga.relationships || [])
      .filter((r) => r.type === 'author')
      .map((r) => r.attributes?.name)
      .filter(Boolean);
    const artistNames = (manga.relationships || [])
      .filter((r) => r.type === 'artist')
      .map((r) => r.attributes?.name)
      .filter(Boolean);

    const coverUrl = coverRel?.attributes?.fileName
      ? `https://uploads.mangadex.org/covers/${manga.id}/${coverRel.attributes.fileName}.512.jpg`
      : null;

    const tagsByGroup = (group) => (attrs.tags || [])
      .filter((t) => t.attributes?.group === group)
      .map((t) => t.attributes?.name?.en || Object.values(t.attributes?.name || {})[0])
      .filter(Boolean);

    return {
      source: 'mangadex',
      externalId: manga.id,
      title,
      subtitle: altTitle || null,
      author: authorNames.join(', ') || null,
      artists: artistNames.join(', ') || null,
      series: title,
      releaseDate: attrs.year ? String(attrs.year) : null,
      overview: attrs.description?.en || Object.values(attrs.description || {})[0] || null,
      genres: tagsByGroup('genre'),
      themes: tagsByGroup('theme'),
      publisher: null,
      status: attrs.status ? attrs.status.charAt(0).toUpperCase() + attrs.status.slice(1) : null,
      coverUrl
    };
  });
}

/**
 * Google Books — free, and works without a key, but keyless requests share one daily quota
 * with everyone else on the internet and are often refused (429) by midday. An admin can add
 * a free key of their own (Admin → Metadata) to get a quota that's theirs.
 * https://developers.google.com/books/docs/v1/using
 *
 * `terms` is either free text or { title, author, isbn }, which become Google's intitle: /
 * inauthor: / isbn: qualifiers — far more precise than a bare title, which for a common
 * title returns study guides and summaries ahead of the book.
 */
function googleQuery(terms) {
  if (typeof terms === 'string') return terms;
  if (terms.isbn) return `isbn:${terms.isbn}`;
  return [
    terms.title ? `intitle:${terms.title}` : '',
    terms.author ? `inauthor:${terms.author}` : ''
  ].filter(Boolean).join(' ');
}

// Google's image links ask for a page-curl effect and a thumbnail size; without the curl,
// and over https, the same link serves a clean cover.
function googleCover(links) {
  const url = links?.extraLarge || links?.large || links?.medium || links?.small || links?.thumbnail || links?.smallThumbnail;
  return url ? url.replace(/^http:/, 'https:').replace(/&edge=curl/, '') : null;
}

function googleIsbn(info) {
  const ids = info.industryIdentifiers || [];
  return normalizeIsbn((ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10'))?.identifier);
}

function googleResult(book) {
  const info = book.volumeInfo || {};
  return {
    source: 'google-books',
    externalId: book.id,
    title: info.title || 'Untitled',
    subtitle: info.subtitle || null,
    author: (info.authors || []).join(', ') || null,
    series: null,
    releaseDate: info.publishedDate || null,
    overview: htmlToText(info.description),
    genres: [...new Set((info.categories || []).map((c) => c.split(/\s*\/\s*/).pop()).filter(Boolean))],
    publisher: info.publisher || null,
    status: null,
    isbn: googleIsbn(info),
    language: normalizeLanguage(info.language),
    pageCount: info.pageCount || null,
    coverUrl: googleCover(info.imageLinks)
  };
}

export async function getGoogleBooksKeyInfo() {
  const db = await getDb();
  const row = await db.get("SELECT value FROM settings WHERE key = 'google_books_api_key'");
  if (row?.value) return { key: row.value, source: 'custom' };
  if (process.env.GOOGLE_BOOKS_API_KEY) return { key: process.env.GOOGLE_BOOKS_API_KEY, source: 'environment' };
  return { key: null, source: null };
}

async function googleBooksUrl(pathAndQuery) {
  const { key } = await getGoogleBooksKeyInfo();
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  return `https://www.googleapis.com/books/v1/${pathAndQuery}${key ? `${separator}key=${encodeURIComponent(key)}` : ''}`;
}

/**
 * Checks a Google Books key with one real lookup, so a wrong key or an API that isn't
 * enabled on the key's project is reported when it's saved.
 */
export async function verifyGoogleBooksKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'No API key provided' };
  try {
    await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:9780141439518&maxResults=1&key=${encodeURIComponent(key)}`);
    return { ok: true };
  } catch (err) {
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      return { ok: false, rejected: true, reason: 'Google rejected this key. Check it was copied whole, and that the Books API is enabled for its project in Google Cloud Console.' };
    }
    if (err.status === 429) {
      return { ok: false, reason: 'Google says this key is over its quota. Try again later, or check its limits in Google Cloud Console.' };
    }
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'Timed out reaching Google Books. Check the container has outbound internet access.' };
    }
    return { ok: false, reason: `Could not verify the key with Google Books (${err.message}).` };
  }
}

async function searchGoogleBooks(terms) {
  const q = googleQuery(terms);
  if (!q) return [];
  const data = await fetchJson(await googleBooksUrl(`volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`));
  return (data.items || []).map(googleResult);
}

/**
 * Open Library — free, no API key required.
 * https://openlibrary.org/dev/docs/api/search
 */
const OPEN_LIBRARY_FIELDS = 'key,title,subtitle,author_name,first_publish_year,isbn,publisher,subject,cover_i,language,number_of_pages_median';

function openLibraryResult(book, isbn = null) {
  // The search returns a work, not an edition: its ISBNs and publishers are every
  // edition's, in no useful order (a Spanish translation's publisher for an English book).
  // So they're only used when the search was for one ISBN — that edition, whose own record
  // fetchBookDetails reads.
  const isbns = (book.isbn || []).map(normalizeIsbn).filter(Boolean);
  const edition = isbn && isbns.includes(isbn) ? isbn : null;
  return {
    source: 'open-library',
    externalId: book.key,
    title: book.title || 'Untitled',
    subtitle: book.subtitle || null,
    author: (book.author_name || []).join(', ') || null,
    series: null,
    releaseDate: book.first_publish_year ? String(book.first_publish_year) : null,
    overview: null,
    genres: (book.subject || []).filter((s) => s.length <= 40 && !/^(fiction|accessible book|protected daisy|in library|large type books)/i.test(s)).slice(0, 6),
    publisher: null,
    status: null,
    isbn: edition,
    // ISO 639-2 ("eng"); only kept when the work exists in a single language.
    language: book.language?.length === 1 ? normalizeLanguage(book.language[0]) : null,
    pageCount: book.number_of_pages_median || null,
    coverUrl: edition
      ? `https://covers.openlibrary.org/b/isbn/${edition}-L.jpg?default=false`
      : (book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : null)
  };
}

async function searchOpenLibrary(terms) {
  let params;
  if (typeof terms === 'string') params = `q=${encodeURIComponent(terms)}`;
  else if (terms.isbn) params = `isbn=${encodeURIComponent(terms.isbn)}`;
  else {
    params = [
      terms.title ? `title=${encodeURIComponent(terms.title)}` : '',
      terms.author ? `author=${encodeURIComponent(terms.author)}` : ''
    ].filter(Boolean).join('&');
  }
  if (!params) return [];
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}&limit=12&fields=${OPEN_LIBRARY_FIELDS}`);
  return (data.docs || []).map((book) => openLibraryResult(book, typeof terms === 'object' ? terms.isbn : null));
}

/**
 * Both book providers at once. Free text that's an ISBN is searched as one.
 */
async function searchBooks(terms) {
  if (typeof terms === 'string') {
    const isbn = normalizeIsbn(terms);
    if (isbn) terms = { isbn };
  }
  const [google, openLibrary] = await Promise.allSettled([searchGoogleBooks(terms), searchOpenLibrary(terms)]);
  const results = [];
  if (google.status === 'fulfilled') results.push(...google.value);
  if (openLibrary.status === 'fulfilled') results.push(...openLibrary.value);
  if (results.length === 0 && google.status === 'rejected' && openLibrary.status === 'rejected') {
    throw new Error('Book metadata providers are currently unavailable');
  }
  return results;
}

const bookWords = (s) => String(s || '').normalize('NFKD').toLowerCase()
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

// Share of `wanted`'s words found in `got` (0–1).
function overlap(wanted, got) {
  const want = bookWords(wanted);
  if (!want.length) return 0;
  const have = new Set(bookWords(got));
  return want.filter((w) => have.has(w)).length / want.length;
}

// Retellings, guides and summaries match a title word for word; they're never the book.
const NOT_THE_BOOK = /\b(summary|study guide|analysis|sparknotes|cliffsnotes|workbook|companion|boxed set|box set|collection)\b/i;

/**
 * Scores book search results against what's known about the file and returns them best
 * first, each with a `score`. A match on ISBN wins outright; otherwise title (main title, so
 * a subtitle doesn't count against it) and author carry it, with a little for having a cover
 * and a blurb to pick between editions of the same book.
 */
export function rankBookResults(results, { title, author, isbn } = {}) {
  const mainTitle = String(title || '').split(/[:(]/)[0];
  return results
    .map((r) => {
      let score = 0;
      if (isbn && r.isbn === isbn) score += 100;
      const resultTitle = r.title || '';
      const titleScore = Math.min(overlap(mainTitle, resultTitle), overlap(resultTitle.split(/[:(]/)[0], mainTitle));
      score += titleScore * 50;
      if (author && author !== 'Unknown Author') score += overlap(author.split(',')[0], r.author) * 30;
      if (NOT_THE_BOOK.test(resultTitle) && !NOT_THE_BOOK.test(title || '')) score -= 40;
      if (r.coverUrl) score += 5;
      if (r.overview) score += 5;
      if (r.source === 'google-books') score += 1; // carries a blurb and a language; Open Library's search doesn't
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * The book search an automatic match runs: by ISBN when the file has one, else by title and
 * author, else by title alone. Returns ranked results (see rankBookResults).
 */
export async function findBookMatches({ title, author, isbn }) {
  const known = { title, author: author && author !== 'Unknown Author' ? author : null, isbn };
  if (isbn) {
    const byIsbn = (await searchBooks({ isbn }).catch(() => [])).filter((r) => r.isbn === isbn);
    if (byIsbn.length) return rankBookResults(byIsbn, known);
  }
  let results = known.author ? await searchBooks({ title, author: known.author }).catch(() => []) : [];
  if (!results.length) results = await searchBooks({ title });
  return rankBookResults(results, known);
}

/**
 * Fills in what a search result leaves out: Google's full record has the larger cover
 * sizes and the whole description; an Open Library work has its description. Best-effort —
 * the result comes back as it was when the lookup fails.
 */
export async function fetchBookDetails(result) {
  try {
    if (result.source === 'google-books' && result.externalId) {
      const book = await fetchJson(await googleBooksUrl(`volumes/${encodeURIComponent(result.externalId)}`));
      const full = googleResult(book);
      return { ...result, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))), score: result.score };
    }
    if (result.source === 'open-library') {
      const details = { ...result };
      const [work, edition] = await Promise.all([
        /^\/works\/OL\d+W$/.test(result.externalId || '') && !result.overview
          ? fetchJson(`https://openlibrary.org${result.externalId}.json`).catch(() => null) : null,
        result.isbn ? fetchJson(`https://openlibrary.org/isbn/${result.isbn}.json`).catch(() => null) : null
      ]);
      if (work) {
        const description = typeof work.description === 'string' ? work.description : work.description?.value;
        // Open Library descriptions are Markdown-ish, with a "----------" line before links.
        details.overview = htmlToText(description?.split(/\n-{3,}/)[0]) || null;
      }
      if (edition) {
        details.publisher = edition.publishers?.[0] || null;
        details.pageCount = edition.number_of_pages || details.pageCount;
        const lang = edition.languages?.length === 1 ? edition.languages[0].key?.split('/').pop() : null;
        details.language = normalizeLanguage(lang) || details.language;
        const year = String(edition.publish_date || '').match(/\b(1[5-9]|20)\d{2}\b/);
        if (year) details.releaseDate = year[0];
      }
      return details;
    }
  } catch (e) {
    // keep what the search gave
  }
  return result;
}

/**
 * TMDB genre id → name lookup, cached per endpoint since the list rarely changes.
 */
// TMDB hands out two different credentials on the same settings page, and they authenticate
// in two different ways:
//
//   "API Key"                (v3) 32 hex characters, sent as an ?api_key= query parameter
//   "API Read Access Token"  (v4) a long JWT, sent as an Authorization: Bearer header
//
// Sending one as the other returns 401. Plinthio only ever sent Bearer, so the shorter v3
// key — the one most people copy, since it's listed first and literally labelled "API Key"
// — failed every request. Both are accepted now, decided by the shape of the credential.
function isReadAccessToken(apiKey) {
  return apiKey.startsWith('eyJ') || apiKey.split('.').length === 3;
}

function tmdbRequest(url, apiKey) {
  const headers = { Accept: 'application/json' };
  if (isReadAccessToken(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
    return { url, options: { headers } };
  }
  const separator = url.includes('?') ? '&' : '?';
  return { url: `${url}${separator}api_key=${encodeURIComponent(apiKey)}`, options: { headers } };
}

const tmdbGenreCache = {};
async function getTmdbGenreMap(endpoint, apiKey) {
  if (tmdbGenreCache[endpoint]) return tmdbGenreCache[endpoint];
  try {
    const req = tmdbRequest(`https://api.themoviedb.org/3/genre/${endpoint}/list`, apiKey);
    const data = await fetchJson(req.url, req.options);
    const map = new Map((data.genres || []).map((g) => [g.id, g.name]));
    tmdbGenreCache[endpoint] = map;
    return map;
  } catch (e) {
    return new Map();
  }
}

/**
 * TMDB — free tier, requires a personal API key (configured by an admin in Settings).
 * https://developer.themoviedb.org/docs
 */
async function fetchTmdbCredits(tmdbId, endpoint, apiKey) {
  try {
    const creditsEndpoint = endpoint === 'movie' ? 'credits' : 'aggregate_credits';
    const req = tmdbRequest(
      `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/${creditsEndpoint}`,
      apiKey
    );
    const data = await fetchJson(req.url, req.options);

    // Director(s) — movies have a flat crew array; TV aggregate_credits has the same shape.
    const directors = (data.crew || [])
      .filter((c) => c.job === 'Director' || c.known_for_department === 'Directing' && c.jobs?.some((j) => j.job === 'Director'))
      .map((c) => c.name)
      .filter(Boolean)
      .slice(0, 3);

    // Top billed cast (limit to avoid overwhelming the field)
    const cast = (data.cast || [])
      .slice(0, 5)
      .map((c) => c.name)
      .filter(Boolean);

    return { directors, cast };
  } catch (e) {
    return { directors: [], cast: [] };
  }
}

async function searchTMDB(query, mediaType, apiKey, year = null, { withCredits = true } = {}) {
  const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
  let yearParam = '';
  if (year) {
    yearParam = endpoint === 'movie' ? `&year=${encodeURIComponent(year)}` : `&first_air_date_year=${encodeURIComponent(year)}`;
  }
  const req = tmdbRequest(
    `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(query)}&include_adult=false${yearParam}`,
    apiKey
  );
  const [data, genreMap] = await Promise.all([
    fetchJson(req.url, req.options),
    getTmdbGenreMap(endpoint, apiKey)
  ]);

  let results = data.results || [];

  // If year-filtered search yielded no results, retry without the year constraint in case
  // of slight release year discrepancy (e.g. film festival year vs theatrical release)
  if (results.length === 0 && year) {
    try {
      const fallbackReq = tmdbRequest(
        `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(query)}&include_adult=false`,
        apiKey
      );
      const fallbackData = await fetchJson(fallbackReq.url, fallbackReq.options);
      results = fallbackData.results || [];
    } catch (e) {
      // ignore fallback failure
    }
  }

  // If year is specified, prioritize exact year matches at the front
  if (year && results.length > 1) {
    results.sort((a, b) => {
      const dateA = a.release_date || a.first_air_date || '';
      const dateB = b.release_date || b.first_air_date || '';
      const matchA = dateA.startsWith(String(year)) ? 1 : 0;
      const matchB = dateB.startsWith(String(year)) ? 1 : 0;
      return matchB - matchA;
    });
  }

  // Fetch credits for the top 5 results in parallel — beyond that the user rarely scrolls.
  // Callers that only want the score (the rating lookup) skip this — it's five extra
  // requests per search.
  const creditsMap = new Map();
  await Promise.allSettled(
    (withCredits ? results.slice(0, 5) : []).map(async (r) => {
      const credits = await fetchTmdbCredits(r.id, endpoint, apiKey);
      creditsMap.set(String(r.id), credits);
    })
  );

  return results.map((r) => {
    const title = r.title || r.name || 'Untitled';
    const date = r.release_date || r.first_air_date || null;
    const genres = (r.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean);
    const credits = creditsMap.get(String(r.id)) || { directors: [], cast: [] };
    return {
      source: 'tmdb',
      externalId: String(r.id),
      title,
      subtitle: null,
      // `author` maps to Director(s); `artists` maps to Cast — the frontend relabels
      // these fields for video media types so the user sees "Director" / "Actors".
      author: credits.directors.join(', ') || null,
      artists: credits.cast.join(', ') || null,
      series: endpoint === 'tv' ? title : null,
      releaseDate: date || null,
      overview: r.overview || null,
      genres,
      publisher: null,
      status: null,
      coverUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      // TMDB's community score (0–10). A title nobody has voted on reports 0, which isn't a
      // rating, so it's dropped rather than shown as a zero.
      rating: r.vote_count > 0 && typeof r.vote_average === 'number' ? r.vote_average : null,
      ratingVotes: r.vote_count > 0 ? r.vote_count : null
    };
  });
}

/**
 * Checks a TMDB credential by actually calling TMDB with it. Returns which auth style it
 * turned out to be, so the admin UI can confirm the key works at the moment it's saved
 * rather than leaving the first failure to surface during a scan.
 */
export async function verifyTmdbApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'No API key provided' };

  const req = tmdbRequest('https://api.themoviedb.org/3/configuration', key);
  try {
    await fetchJson(req.url, req.options);
    return { ok: true, authStyle: isReadAccessToken(key) ? 'read-access-token' : 'api-key' };
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return { ok: false, rejected: true, reason: 'TMDB rejected this key. Copy either the "API Key" or the "API Read Access Token" from your TMDB account settings.' };
    }
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'Timed out reaching TMDB — check the container has outbound internet access.' };
    }
    return { ok: false, reason: `Could not verify the key with TMDB (${err.message}).` };
  }
}

// Release images carry a key of their own (a GitHub secret passed in as a build argument), so a
// new server gets movie and show details with no setup, the way Jellyfin's does. Builds from
// source have none. Read per call so tests can turn it off with an empty variable.
function builtinTmdbKey() {
  return (process.env.PLINTHIO_BUILTIN_TMDB_KEY || '').trim();
}

// If TMDB ever revokes the built-in key, every lookup would fail as "something went wrong".
// Checking it once (and again every few hours) turns that into the usual "needs a TMDB key",
// which tells the admin to paste their own. Only TMDB saying no counts: a server that can't
// get out keeps the key.
const BUILTIN_RECHECK_MS = 6 * 60 * 60 * 1000;
let builtinCheck = null; // { usable: Promise<boolean>, at }

function builtinKeyUsable(key) {
  if (!builtinCheck || Date.now() - builtinCheck.at > BUILTIN_RECHECK_MS) {
    builtinCheck = {
      at: Date.now(),
      usable: verifyTmdbApiKey(key).then((check) => {
        if (check.rejected) console.warn('TMDB rejected the built-in key. Add your own under Admin → Metadata.');
        return !check.rejected;
      })
    };
  }
  return builtinCheck.usable;
}

/**
 * The TMDB key in use and where it came from: "custom" (saved in Admin → Metadata), then
 * "environment" (TMDB_API_KEY), then "builtin". { key: null, source: null } when there's none.
 */
export async function getTmdbKeyInfo() {
  const db = await getDb();
  const row = await db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'");
  if (row?.value) return { key: row.value, source: 'custom' };
  if (process.env.TMDB_API_KEY) return { key: process.env.TMDB_API_KEY, source: 'environment' };
  const builtin = builtinTmdbKey();
  if (builtin && await builtinKeyUsable(builtin)) return { key: builtin, source: 'builtin' };
  return { key: null, source: null };
}

export function hasBuiltinTmdbKey() {
  return !!builtinTmdbKey();
}

export async function getTmdbApiKey() {
  return (await getTmdbKeyInfo()).key;
}

/**
 * Looks up TMDB's community score for a movie/show/anime. Returns { rating, votes } on a
 * match, null when TMDB has nothing (or no score) for it, and throws MISSING_API_KEY when no
 * key is configured so callers can tell "unknown" from "can't check".
 */
export async function lookupTmdbRating(mediaType, query, year = null) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const results = await searchTMDB(query, mediaType, apiKey, year, { withCredits: false });
  const best = (year && results.find((r) => (r.releaseDate || '').startsWith(String(year)))) || results[0];
  if (!best || best.rating == null) return null;
  return { rating: best.rating, votes: best.ratingVotes };
}

// Crew jobs worth a line on a title page, in the order they're shown. Everything else
// (grips, caterers…) is noise next to them.
const CREW_JOBS = ['Director', 'Screenplay', 'Writer', 'Story', 'Novel', 'Characters', 'Producer', 'Executive Producer', 'Original Music Composer', 'Director of Photography', 'Editor'];
const CAST_LIMIT = 24;

/**
 * The full credits for one TMDB title — cast with their characters and photos, key crew,
 * studios, and (for TV) creators and networks. `tmdbId` comes from a search result's
 * externalId, or from a previous lookup stored on the item.
 */
export async function fetchTmdbDetails(tmdbId, mediaType) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const isMovie = mediaType === 'movie';
  const endpoint = isMovie ? 'movie' : 'tv';
  const creditsKey = isMovie ? 'credits' : 'aggregate_credits';
  const req = tmdbRequest(
    `https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(tmdbId)}?append_to_response=${creditsKey},keywords,images&include_image_language=en,null`,
    apiKey
  );
  const data = await fetchJson(req.url, req.options);
  const credits = data[creditsKey] || {};
  const profile = (p) => (p ? `https://image.tmdb.org/t/p/w185${p}` : null);

  // aggregate_credits lists a TV actor's roles/jobs as arrays; movie credits are flat.
  const cast = (credits.cast || []).slice(0, CAST_LIMIT).map((c) => ({
    name: c.name,
    character: c.character || (c.roles || []).map((r) => r.character).filter(Boolean).join(' / ') || null,
    photo: profile(c.profile_path)
  })).filter((c) => c.name);

  const crew = [];
  const seen = new Set();
  for (const c of credits.crew || []) {
    const jobs = c.job ? [c.job] : (c.jobs || []).map((j) => j.job);
    for (const job of jobs) {
      if (!CREW_JOBS.includes(job) || seen.has(`${c.name}:${job}`)) continue;
      seen.add(`${c.name}:${job}`);
      crew.push({ name: c.name, job, photo: profile(c.profile_path) });
    }
  }
  crew.sort((a, b) => CREW_JOBS.indexOf(a.job) - CREW_JOBS.indexOf(b.job));

  // The title's logo (its name as artwork) for the banner on its page: English first, then
  // one with no text language, then whatever there is. PNG, since SVG logos can't be
  // trusted to render the same everywhere.
  const logos = (data.images?.logos || []).filter((l) => l.file_path && !l.file_path.endsWith('.svg'));
  const logo = logos.find((l) => l.iso_639_1 === 'en') || logos.find((l) => !l.iso_639_1) || logos[0];

  return {
    tmdbId: String(data.id),
    tagline: data.tagline || null,
    // Wide artwork for the top of the title page. Paths only; the page picks the size.
    backdropPath: data.backdrop_path || null,
    logoPath: logo?.file_path || null,
    studios: (data.production_companies || []).map((s) => s.name).filter(Boolean),
    networks: (data.networks || []).map((n) => n.name).filter(Boolean),
    creators: (data.created_by || []).map((c) => c.name).filter(Boolean),
    // A TV show's airing state ("Returning Series", "Ended"); a movie's is always "Released".
    status: isMovie ? null : (data.status || null),
    // The film series it belongs to on TMDB ("Shrek Collection"); movies only.
    collection: isMovie ? (data.belongs_to_collection?.name || null) : null,
    collectionId: isMovie ? (data.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null) : null,
    // A show's seasons with their own posters, for the season picker on its page.
    seasons: isMovie ? null : (data.seasons || [])
      .filter((s) => Number.isInteger(s.season_number))
      .map((s) => ({
        number: s.season_number,
        name: s.name || null,
        posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
        airDate: s.air_date || null,
        episodeCount: s.episode_count || null
      })),
    cast,
    crew: crew.slice(0, 20),
    // Odds and ends for the player's pause screen. TMDB has no trivia as such, so these are
    // the facts it does keep. Money is 0 on TMDB when unknown, so 0 becomes null.
    facts: {
      originalTitle: data.original_title || data.original_name || null,
      originalLanguage: data.original_language || null,
      releaseDate: data.release_date || data.first_air_date || null,
      lastAirDate: isMovie ? null : (data.last_air_date || null),
      runtime: isMovie ? (data.runtime || null) : null,
      budget: isMovie && data.budget > 0 ? data.budget : null,
      revenue: isMovie && data.revenue > 0 ? data.revenue : null,
      seasons: isMovie ? null : (data.number_of_seasons || null),
      episodes: isMovie ? null : (data.number_of_episodes || null),
      countries: (data.production_countries || data.origin_country || [])
        .map((c) => (typeof c === 'string' ? c : c.iso_3166_1)).filter(Boolean).slice(0, 3)
    },
    keywords: ((data.keywords?.keywords || data.keywords?.results) || []).map((k) => k.name).filter(Boolean).slice(0, 8)
  };
}

/**
 * Every film in a TMDB collection ("Shrek Collection"), released or announced, in release
 * order — so a collection page can show the ones the library doesn't have.
 */
export async function fetchTmdbCollection(collectionId) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const req = tmdbRequest(`https://api.themoviedb.org/3/collection/${encodeURIComponent(collectionId)}`, apiKey);
  const data = await fetchJson(req.url, req.options);
  const parts = (data.parts || [])
    .filter((p) => p.title)
    .map((p) => ({
      tmdbId: String(p.id),
      title: p.title,
      releaseDate: p.release_date || null,
      overview: p.overview || null,
      posterUrl: p.poster_path ? `https://image.tmdb.org/t/p/w342${p.poster_path}` : null
    }))
    .sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));
  return { id: String(data.id), name: data.name || null, parts };
}

/**
 * The best TMDB match for a title, for callers that only have its name and year.
 */
export async function findTmdbId(mediaType, query, year = null) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const results = await searchTMDB(query, mediaType, apiKey, year, { withCredits: false });
  const best = (year && results.find((r) => (r.releaseDate || '').startsWith(String(year)))) || results[0];
  return best?.externalId || null;
}

/**
 * Search external metadata providers for a given media type + query.
 * Providers are chosen by media type, matching only free / keyless services
 * except TMDB (movies/shows/anime), which needs an admin-configured key.
 */
export async function searchExternalMetadata(mediaType, query, year = null) {
  if (!query || !query.trim()) {
    throw new Error('A search query is required');
  }

  switch (mediaType) {
    case 'manga':
      return searchMangaDex(query);

    case 'book':
      return searchBooks(query);

    case 'movie':
    case 'show':
    case 'anime': {
      const apiKey = await getTmdbApiKey();
      if (!apiKey) {
        const err = new Error('TMDB API key is not configured. An admin must add one in Admin → Metadata.');
        err.code = 'MISSING_API_KEY';
        throw err;
      }
      return searchTMDB(query, mediaType, apiKey, year);
    }

    default:
      throw new Error(`No metadata provider available for media type "${mediaType}"`);
  }
}

/**
 * Fetch season details from TMDB (includes all episodes for that season).
 */
export async function fetchTmdbSeason(tmdbId, seasonNumber, apiKey = null) {
  const key = apiKey || await getTmdbApiKey();
  if (!key) return null;
  try {
    const req = tmdbRequest(
      `https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(seasonNumber)}`,
      key
    );
    return await fetchJson(req.url, req.options);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch episode details from TMDB.
 */
export async function fetchTmdbEpisode(tmdbId, seasonNumber, episodeNumber, apiKey = null) {
  const seasonData = await fetchTmdbSeason(tmdbId, seasonNumber, apiKey);
  if (!seasonData || !Array.isArray(seasonData.episodes)) return null;

  const ep = seasonData.episodes.find((e) => Number(e.episode_number) === Number(episodeNumber));
  if (!ep) return null;

  const directors = (ep.crew || [])
    .filter((c) => c.job === 'Director')
    .map((c) => c.name)
    .filter(Boolean);

  const cast = (ep.guest_stars || [])
    .slice(0, 5)
    .map((c) => c.name)
    .filter(Boolean);

  return {
    episodeNumber: ep.episode_number,
    seasonNumber: ep.season_number,
    name: ep.name || null,
    overview: ep.overview || null,
    airDate: ep.air_date || null,
    stillUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
    rating: ep.vote_count > 0 && typeof ep.vote_average === 'number' ? ep.vote_average : null,
    ratingVotes: ep.vote_count > 0 ? ep.vote_count : null,
    director: directors.join(', ') || null,
    cast: cast.join(', ') || null
  };
}

/**
 * Fetch volume covers from MangaDex for a manga ID.
 * Returns a Map of volumeString -> coverUrl.
 */
export async function fetchMangaDexVolumeCovers(mangaId) {
  try {
    const url = `https://api.mangadex.org/cover?manga[]=${encodeURIComponent(mangaId)}&limit=100`;
    const data = await fetchJson(url);
    const map = new Map();
    for (const item of data.data || []) {
      const vol = item.attributes?.volume;
      const fileName = item.attributes?.fileName;
      if (vol && fileName && !map.has(vol)) {
        map.set(vol, `https://uploads.mangadex.org/covers/${mangaId}/${fileName}.512.jpg`);
      }
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

