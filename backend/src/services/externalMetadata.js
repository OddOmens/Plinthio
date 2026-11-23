import { getDb } from '../config/database.js';
import { htmlToText, normalizeIsbn, normalizeLanguage } from './bookMetadata.js';
import { fetchJson } from './providerHttp.js';
import { searchAniList } from './anilist.js';
import { searchTvmaze, fetchTvmazeEpisodes } from './tvmaze.js';
import { searchAudible, fetchAudibleDetails } from './audible.js';
import { searchComicVine, fetchComicVineDetails, fetchComicVineIssueCovers, getComicVineKeyInfo } from './comicvine.js';
import { getSetting } from './settings.js';

// Providers can be switched off in Admin → Metadata; one that's off is never asked for anything.
export const METADATA_PROVIDERS = ['tmdb', 'tvmaze', 'anilist', 'mangadex', 'comicvine', 'open-library', 'google-books', 'audible'];

export async function providersOff() {
  const db = await getDb();
  const value = await getSetting(db, 'metadata_providers_off');
  try {
    const list = JSON.parse(value || '[]');
    return new Set(Array.isArray(list) ? list.filter((p) => METADATA_PROVIDERS.includes(p)) : []);
  } catch {
    return new Set();
  }
}

function providerOffError() {
  const err = new Error('This metadata source is turned off in Admin → Metadata.');
  err.code = 'PROVIDER_OFF';
  return err;
}

function providerFailure(err) {
  if (err?.status === 429) return 'quota';
  if (err?.status === 400 || err?.status === 401 || err?.status === 403) return 'rejected';
  return 'unreachable';
}

/**
 * Runs one search across sources { id, search, ready, keyed }. `ready`: its required key is
 * set; `keyed`: the admin's own key is in use. All ready sources run in parallel, results in
 * the given order; `firstOnly` runs them in turn and stops at the first with results.
 * Returns { results, unavailable } with a reason per failed source.
 */
async function searchSources(sources, { firstOnly = false } = {}) {
  const off = await providersOff();
  const on = sources.filter((s) => !off.has(s.id));
  if (!on.length) throw providerOffError();
  const ready = [];
  let notReady = null;
  for (const source of on) {
    if (!source.ready || await source.ready()) ready.push(source);
    else notReady ||= source;
  }
  // Every remaining source needs a key that isn't set.
  if (!ready.length) throw notReady.missingKeyError();

  const results = [];
  const unavailable = [];
  const failures = [];
  const settle = async (source, outcome) => {
    if (outcome.status === 'fulfilled') results.push(...(outcome.value || []));
    else {
      failures.push(outcome.reason);
      unavailable.push({
        provider: source.id,
        reason: providerFailure(outcome.reason),
        ...(source.keyed ? { keyed: await source.keyed().catch(() => false) } : {})
      });
    }
  };
  if (firstOnly) {
    for (const source of ready) {
      const [outcome] = await Promise.allSettled([source.search()]);
      await settle(source, outcome);
      if (results.length) break;
    }
  } else {
    const outcomes = await Promise.allSettled(ready.map((s) => s.search()));
    for (const [i, outcome] of outcomes.entries()) await settle(ready[i], outcome);
  }
  if (!results.length && failures.length === ready.length) {
    // With one source, surface its own error (rejected key, timeout).
    if (ready.length === 1) throw failures[0];
    throw new Error('Metadata providers are currently unavailable');
  }
  return { results, unavailable };
}

// MangaDex: free, no key. https://api.mangadex.org/docs/
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
    // Titles can credit several authors/artists; collect all of them.
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
      // safe/suggestive/erotica/pornographic; the search route uses it to hide adult titles.
      contentRating: attrs.contentRating || null,
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
 * Google Books: works keyless, but the shared keyless quota often runs out (429), so an
 * admin can add their own key. https://developers.google.com/books/docs/v1/using
 *
 * `terms` is free text or { title, author, isbn }, mapped to intitle:/inauthor:/isbn:
 * qualifiers, which beat a bare title (otherwise study guides rank first).
 */
function googleQuery(terms) {
  if (typeof terms === 'string') return terms;
  if (terms.isbn) return `isbn:${terms.isbn}`;
  return [
    terms.title ? `intitle:${terms.title}` : '',
    terms.author ? `inauthor:${terms.author}` : ''
  ].filter(Boolean).join(' ');
}

// Strip the page-curl effect and force https for a clean cover.
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
  const key = await getSetting(db, 'google_books_api_key');
  if (key) return { key, source: 'custom' };
  if (process.env.GOOGLE_BOOKS_API_KEY) return { key: process.env.GOOGLE_BOOKS_API_KEY, source: 'environment' };
  return { key: null, source: null };
}

// After a 429 the daily quota is spent, so pause Google for a while. Tracked per key, so a
// newly saved key takes effect at once.
const GOOGLE_QUOTA_PAUSE_MS = 15 * 60 * 1000;
let googleQuotaSpent = null; // { key, until }

async function googleBooksJson(pathAndQuery) {
  const { key } = await getGoogleBooksKeyInfo();
  if (googleQuotaSpent && googleQuotaSpent.key === key && Date.now() < googleQuotaSpent.until) {
    const err = new Error('Google Books has used up its daily quota');
    err.status = 429;
    throw err;
  }
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  try {
    return await fetchJson(`https://www.googleapis.com/books/v1/${pathAndQuery}${key ? `${separator}key=${encodeURIComponent(key)}` : ''}`);
  } catch (err) {
    if (err.status === 429) googleQuotaSpent = { key, until: Date.now() + GOOGLE_QUOTA_PAUSE_MS };
    throw err;
  }
}

// One real lookup, so a bad key or disabled API is reported when the key is saved.
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
  const data = await googleBooksJson(`volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`);
  return (data.items || []).map(googleResult);
}

// Open Library: free, no key. https://openlibrary.org/dev/docs/api/search
// The search returns works, each with its best edition (`editions.*`): the one matching the
// ISBN, else one in the requested language.
const OPEN_LIBRARY_FIELDS = [
  'key,title,subtitle,author_name,first_publish_year,subject,cover_i,language,number_of_pages_median',
  'editions,editions.key,editions.isbn,editions.publisher,editions.language,editions.publish_date,editions.cover_i'
].join(',');

const openLibraryCover = (id) => (id > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null);
const yearOf = (date) => String(date || '').match(/\b(1[5-9]|20)\d{2}\b/)?.[0] || null;

function openLibraryResult(book, isbn = null) {
  // A work's ISBN and publisher lists mix all editions, so take both from the returned edition.
  const edition = book.editions?.docs?.[0] || null;
  const editionIsbn = (edition?.isbn || []).map(normalizeIsbn).find(Boolean) || null;
  const editionLanguages = edition?.language || [];
  return {
    source: 'open-library',
    externalId: book.key,
    title: book.title || 'Untitled',
    subtitle: book.subtitle || null,
    author: (book.author_name || []).join(', ') || null,
    series: null,
    releaseDate: (isbn && yearOf(edition?.publish_date?.[0])) || (book.first_publish_year ? String(book.first_publish_year) : null),
    overview: null,
    genres: (book.subject || []).filter((s) => s.length <= 40 && !/^(fiction|accessible book|protected daisy|in library|large type books)/i.test(s)).slice(0, 6),
    publisher: edition?.publisher?.[0] || null,
    status: null,
    // A search by ISBN only finds works with that ISBN, so the result is that edition.
    isbn: isbn || editionIsbn,
    // ISO 639-2 ("eng"); the edition's, else the work's when it exists in one language.
    language: normalizeLanguage(editionLanguages.length === 1 ? editionLanguages[0] : (book.language?.length === 1 ? book.language[0] : null)),
    pageCount: book.number_of_pages_median || null,
    // Covers by id always exist; one asked for by ISBN is missing for many editions.
    coverUrl: openLibraryCover(edition?.cover_i) || openLibraryCover(book.cover_i)
  };
}

async function searchOpenLibrary(terms, language = null) {
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
  // `lang` takes ISO 639-1 ("de"): which edition comes back, not which works.
  const lang = String(language || '').split('-')[0].toLowerCase();
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}&limit=12${/^[a-z]{2}$/.test(lang) ? `&lang=${lang}` : ''}&fields=${OPEN_LIBRARY_FIELDS}`);
  return (data.docs || []).map((book) => openLibraryResult(book, typeof terms === 'object' ? terms.isbn : null));
}

/**
 * Both book providers at once; free text that's an ISBN is searched as one. `language`
 * ("de") picks Open Library's edition. Returns { results, unavailable } (see searchSources).
 */
export async function searchBooks(terms, { language } = {}) {
  if (typeof terms === 'string') {
    const isbn = normalizeIsbn(terms);
    if (isbn) terms = { isbn };
  }
  return searchSources([
    { id: 'google-books', search: () => searchGoogleBooks(terms), keyed: async () => !!(await getGoogleBooksKeyInfo()).key },
    { id: 'open-library', search: () => searchOpenLibrary(terms, language) }
  ]);
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
// Nor is an omnibus listed as "The Martian / Artemis / Project Hail Mary".
const NOT_THE_BOOK = /\b(summary|study guide|analysis|sparknotes|cliffsnotes|workbook|companion|boxed set|box set|collection)\b|\s\/\s/i;

// Moves those to the end rather than dropping them, unless the query itself asks for one.
export function putNotTheBookLast(results, query) {
  if (NOT_THE_BOOK.test(query || '')) return results;
  const isBook = (r) => !NOT_THE_BOOK.test(r.title || '');
  return [...results.filter(isBook), ...results.filter((r) => !isBook(r))];
}

// Scores results against the file's known metadata, best first. ISBN wins outright; then main
// title and author, with small tie-breakers for cover and blurb.
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

// Automatic-match book search: by ISBN, else title + author, else title. Returns ranked results.
export async function findBookMatches({ title, author, isbn, language }) {
  const known = { title, author: author && author !== 'Unknown Author' ? author : null, isbn };
  const search = async (terms) => (await searchBooks(terms, { language })).results;
  if (isbn) {
    const byIsbn = (await search({ isbn }).catch(() => [])).filter((r) => r.isbn === isbn);
    if (byIsbn.length) return rankBookResults(byIsbn, known);
  }
  // Search by main title only (full titles with subtitles often find nothing); ranking sees the whole title.
  const mainTitle = String(title || '').split(/:|\s[-–]\s|\(/)[0].trim() || title;
  let results = known.author ? await search({ title: mainTitle, author: known.author }).catch(() => []) : [];
  if (!results.length) results = await search({ title: mainTitle });
  return rankBookResults(results, known);
}

// Best-effort fill-in from the full record (Google's larger covers and full description;
// Open Library's work description and edition details). Returns the result unchanged on failure.
export async function fetchBookDetails(result) {
  if ((await providersOff()).has(result.source)) return result;
  try {
    if (result.source === 'google-books' && result.externalId) {
      const book = await googleBooksJson(`volumes/${encodeURIComponent(result.externalId)}`);
      const full = googleResult(book);
      return { ...result, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))), score: result.score };
    }
    if (result.source === 'open-library') {
      const details = { ...result };
      const [work, edition] = await Promise.all([
        /^\/works\/OL\d+W$/.test(result.externalId || '') && !result.overview
          ? fetchJson(`https://openlibrary.org${result.externalId}.json`).catch(() => null) : null,
        result.isbn && !result.publisher ? fetchJson(`https://openlibrary.org/isbn/${result.isbn}.json`).catch(() => null) : null
      ]);
      if (work) {
        const description = typeof work.description === 'string' ? work.description : work.description?.value;
        // Open Library descriptions are Markdown-ish, with a "----------" line before links.
        details.overview = htmlToText(description?.split(/\n-{3,}/)[0]) || null;
        details.coverUrl ||= openLibraryCover(work.covers?.find((c) => c > 0));
      }
      if (edition) {
        details.publisher = edition.publishers?.[0] || null;
        details.pageCount = edition.number_of_pages || details.pageCount;
        const lang = edition.languages?.length === 1 ? edition.languages[0].key?.split('/').pop() : null;
        details.language = normalizeLanguage(lang) || details.language;
        details.releaseDate = yearOf(edition.publish_date) || details.releaseDate;
        details.coverUrl = openLibraryCover(edition.covers?.find((c) => c > 0)) || details.coverUrl;
      }
      return details;
    }
  } catch (e) {
    // keep what the search gave
  }
  return result;
}

// TMDB issues two credential types that authenticate differently:
//
//   "API Key"                (v3) 32 hex characters, sent as an ?api_key= query parameter
//   "API Read Access Token"  (v4) a long JWT, sent as an Authorization: Bearer header
//
// Sending one as the other returns 401, so the style is picked from the credential's shape.
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

// Genre id → name, cached per endpoint.
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

async function fetchTmdbCredits(tmdbId, endpoint, apiKey) {
  try {
    const creditsEndpoint = endpoint === 'movie' ? 'credits' : 'aggregate_credits';
    const req = tmdbRequest(
      `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/${creditsEndpoint}`,
      apiKey
    );
    const data = await fetchJson(req.url, req.options);

    const directors = (data.crew || [])
      .filter((c) => c.job === 'Director' || c.known_for_department === 'Directing' && c.jobs?.some((j) => j.job === 'Director'))
      .map((c) => c.name)
      .filter(Boolean)
      .slice(0, 3);

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

  // Retry without the year, which can differ slightly (festival vs theatrical release).
  if (results.length === 0 && year) {
    try {
      const fallbackReq = tmdbRequest(
        `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(query)}&include_adult=false`,
        apiKey
      );
      const fallbackData = await fetchJson(fallbackReq.url, fallbackReq.options);
      results = fallbackData.results || [];
    } catch (e) {
      // Keep the empty result.
    }
  }

  // Exact year matches first.
  if (year && results.length > 1) {
    results.sort((a, b) => {
      const dateA = a.release_date || a.first_air_date || '';
      const dateB = b.release_date || b.first_air_date || '';
      const matchA = dateA.startsWith(String(year)) ? 1 : 0;
      const matchB = dateB.startsWith(String(year)) ? 1 : 0;
      return matchB - matchA;
    });
  }

  // Credits for the top 5 only; rating lookups skip this to save five requests.
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
      // `author` holds directors and `artists` cast; the frontend relabels them for video.
      author: credits.directors.join(', ') || null,
      artists: credits.cast.join(', ') || null,
      series: endpoint === 'tv' ? title : null,
      releaseDate: date || null,
      overview: r.overview || null,
      genres,
      publisher: null,
      status: null,
      coverUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      // Community score (0–10); 0 with no votes means unrated.
      rating: r.vote_count > 0 && typeof r.vote_average === 'number' ? r.vote_average : null,
      ratingVotes: r.vote_count > 0 ? r.vote_count : null
    };
  });
}

// Verifies a TMDB credential with a real call and reports its auth style.
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

// Release images bake in a key (a build-arg secret) so new servers work with no setup; source
// builds have none. Read per call so tests can blank it.
function builtinTmdbKey() {
  return (process.env.PLINTHIO_BUILTIN_TMDB_KEY || '').trim();
}

// Periodically verify the built-in key so a revoked one shows as "needs a TMDB key". Only an
// explicit rejection counts; a network failure keeps it.
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

// The TMDB key in use and its source, by priority: "custom", "environment", "builtin".
export async function getTmdbKeyInfo() {
  const db = await getDb();
  const key = await getSetting(db, 'tmdb_api_key');
  if (key) return { key, source: 'custom' };
  if (process.env.TMDB_API_KEY) return { key: process.env.TMDB_API_KEY, source: 'environment' };
  const builtin = builtinTmdbKey();
  if (builtin && await builtinKeyUsable(builtin)) return { key: builtin, source: 'builtin' };
  return { key: null, source: null };
}

export function hasBuiltinTmdbKey() {
  return !!builtinTmdbKey();
}

// A switched-off TMDB reports no key, so callers skip it quietly.
export async function getTmdbApiKey() {
  if ((await providersOff()).has('tmdb')) return null;
  return (await getTmdbKeyInfo()).key;
}

// { rating, votes }, or null if unknown. Throws MISSING_API_KEY so callers can tell "unknown"
// from "can't check".
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

// Crew jobs shown on a title page, in display order.
const CREW_JOBS = ['Director', 'Screenplay', 'Writer', 'Story', 'Novel', 'Characters', 'Producer', 'Executive Producer', 'Original Music Composer', 'Director of Photography', 'Editor'];
const CAST_LIMIT = 24;

// Full credits and details for one TMDB title.
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

  // Title logo: English, then language-neutral, then any. SVGs skipped as they render inconsistently.
  const logos = (data.images?.logos || []).filter((l) => l.file_path && !l.file_path.endsWith('.svg'));
  const logo = logos.find((l) => l.iso_639_1 === 'en') || logos.find((l) => !l.iso_639_1) || logos[0];

  return {
    tmdbId: String(data.id),
    tagline: data.tagline || null,
    // Path only; the page picks the size.
    backdropPath: data.backdrop_path || null,
    logoPath: logo?.file_path || null,
    studios: (data.production_companies || []).map((s) => s.name).filter(Boolean),
    networks: (data.networks || []).map((n) => n.name).filter(Boolean),
    creators: (data.created_by || []).map((c) => c.name).filter(Boolean),
    // TV airing state ("Returning Series", "Ended"); movies are always "Released".
    status: isMovie ? null : (data.status || null),
    collection: isMovie ? (data.belongs_to_collection?.name || null) : null,
    collectionId: isMovie ? (data.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null) : null,
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
    // For the pause screen. TMDB reports unknown money as 0, so 0 becomes null.
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

// Every film in a TMDB collection, including unreleased, in release order.
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
 * The TMDB id behind an IMDb or TVDB id (read from a folder tag or .nfo), or null. TMDB's
 * /find answers for films and shows at once; only the kind asked for counts.
 */
export async function findTmdbIdByExternalId(mediaType, { imdbId = null, tvdbId = null } = {}) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) {
    const err = new Error('TMDB API key is not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const list = mediaType === 'movie' ? 'movie_results' : 'tv_results';
  for (const [id, source] of [[imdbId, 'imdb_id'], [tvdbId, 'tvdb_id']]) {
    if (!id) continue;
    const req = tmdbRequest(
      `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?external_source=${source}`,
      apiKey
    );
    const data = await fetchJson(req.url, req.options);
    const found = data?.[list]?.[0]?.id;
    if (found) return String(found);
  }
  return null;
}

/** A title's poster URL by TMDB id, or null. */
export async function fetchTmdbPosterUrl(tmdbId, mediaType) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey || !tmdbId) return null;
  const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
  const req = tmdbRequest(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(tmdbId)}`, apiKey);
  const data = await fetchJson(req.url, req.options);
  return data?.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
}

function missingTmdbKeyError() {
  const err = new Error('TMDB API key is not configured. An admin must add one in Admin → Metadata.');
  err.code = 'MISSING_API_KEY';
  return err;
}

function missingComicVineKeyError() {
  const err = new Error('Comic Vine needs an API key: an admin can add one in Admin → Metadata.');
  err.code = 'MISSING_API_KEY';
  err.provider = 'comicvine';
  return err;
}

/**
 * Searches the enabled sources for a media type, in preference order:
 *   movie      TMDB
 *   show       TMDB, TVmaze
 *   anime      TMDB, AniList, TVmaze
 *   manga      MangaDex, AniList, Comic Vine (with a key)
 *   book       Google Books, Open Library
 *   audiobook  Audible
 * `language` ("de") picks Open Library's edition and Audible's country. Returns { results,
 * unavailable } (see searchSources); `firstOnly` stops at the first source with results.
 */
export async function searchMetadata(mediaType, query, { year = null, language = null, firstOnly = false } = {}) {
  if (!query || !query.trim()) {
    throw new Error('A search query is required');
  }
  const tmdb = {
    id: 'tmdb',
    search: async () => searchTMDB(query, mediaType, await getTmdbApiKey(), year),
    ready: async () => !!(await getTmdbKeyInfo()).key,
    missingKeyError: missingTmdbKeyError
  };
  const tvmaze = { id: 'tvmaze', search: () => searchTvmaze(query) };
  const anilist = (type) => ({ id: 'anilist', search: () => searchAniList(query, type) });

  switch (mediaType) {
    case 'movie':
      return searchSources([tmdb], { firstOnly });
    case 'show':
      return searchSources([tmdb, tvmaze], { firstOnly });
    case 'anime':
      return searchSources([tmdb, anilist('ANIME'), tvmaze], { firstOnly });
    case 'manga':
      return searchSources([
        { id: 'mangadex', search: () => searchMangaDex(query) },
        anilist('MANGA'),
        {
          id: 'comicvine',
          search: () => searchComicVine(query),
          ready: async () => !!(await getComicVineKeyInfo()).key,
          keyed: async () => true,
          missingKeyError: missingComicVineKeyError
        }
      ], { firstOnly });
    case 'book': {
      const found = await searchBooks(query, { language });
      return { ...found, results: putNotTheBookLast(found.results, query) };
    }
    case 'audiobook':
      return searchSources([{ id: 'audible', search: () => searchAudible(query, { language }) }], { firstOnly });
    default:
      throw new Error(`No metadata provider available for media type "${mediaType}"`);
  }
}

// Automatic-match search: results from the first source with any.
export async function searchExternalMetadata(mediaType, query, year = null) {
  return (await searchMetadata(mediaType, query, { year, firstOnly: true })).results;
}

// Best-effort extra details for one result from its source's full record.
export async function fetchResultDetails(result) {
  if ((await providersOff()).has(result.source)) return result;
  switch (result.source) {
    case 'audible': return fetchAudibleDetails(result);
    case 'comicvine': return fetchComicVineDetails(result);
    case 'open-library':
    case 'google-books': return fetchBookDetails(result);
    default: return result;
  }
}

/** Comic Vine issue covers by number, or an empty map when Comic Vine is off. */
export async function fetchComicIssueCovers(volumeId) {
  if ((await providersOff()).has('comicvine')) return new Map();
  return fetchComicVineIssueCovers(volumeId);
}

/** A show's TVmaze episodes ("1x2" → episode), or an empty map when TVmaze is off. */
export async function fetchShowEpisodes(showId) {
  if ((await providersOff()).has('tvmaze')) return new Map();
  return fetchTvmazeEpisodes(showId);
}

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

// Map of volume string → cover URL.
export async function fetchMangaDexVolumeCovers(mangaId) {
  if ((await providersOff()).has('mangadex')) return new Map();
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

