import { getDb } from '../config/database.js';

const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
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
 * Google Books — free, no API key required for basic search.
 * https://developers.google.com/books/docs/v1/using
 */
async function searchGoogleBooks(query) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12`;
  const data = await fetchJson(url);

  return (data.items || []).map((book) => {
    const info = book.volumeInfo || {};
    return {
      source: 'google-books',
      externalId: book.id,
      title: info.title || 'Untitled',
      subtitle: info.subtitle || null,
      author: (info.authors || []).join(', ') || null,
      series: null,
      releaseDate: info.publishedDate || null,
      overview: info.description || null,
      genres: info.categories || [],
      publisher: info.publisher || null,
      status: null,
      coverUrl: info.imageLinks?.thumbnail?.replace('http://', 'https://') || null
    };
  });
}

/**
 * Open Library — free, no API key required.
 * https://openlibrary.org/dev/docs/api/search
 */
async function searchOpenLibrary(query) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=12`;
  const data = await fetchJson(url);

  return (data.docs || []).map((book) => ({
    source: 'open-library',
    externalId: book.key,
    title: book.title || 'Untitled',
    subtitle: null,
    author: (book.author_name || []).join(', ') || null,
    series: null,
    releaseDate: book.first_publish_year ? String(book.first_publish_year) : null,
    overview: null,
    genres: (book.subject || []).slice(0, 6),
    publisher: (book.publisher || [])[0] || null,
    status: null,
    coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : null
  }));
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

async function searchTMDB(query, mediaType, apiKey, year = null) {
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
  const creditsMap = new Map();
  await Promise.allSettled(
    results.slice(0, 5).map(async (r) => {
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
      coverUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null
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
      return { ok: false, reason: 'TMDB rejected this key. Copy either the "API Key" or the "API Read Access Token" from your TMDB account settings.' };
    }
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'Timed out reaching TMDB — check the container has outbound internet access.' };
    }
    return { ok: false, reason: `Could not verify the key with TMDB (${err.message}).` };
  }
}

export async function getTmdbApiKey() {
  const db = await getDb();
  const row = await db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'");
  return row?.value || process.env.TMDB_API_KEY || null;
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

    case 'book': {
      const [google, openLibrary] = await Promise.allSettled([
        searchGoogleBooks(query),
        searchOpenLibrary(query)
      ]);
      const results = [];
      if (google.status === 'fulfilled') results.push(...google.value);
      if (openLibrary.status === 'fulfilled') results.push(...openLibrary.value);
      if (results.length === 0 && google.status === 'rejected' && openLibrary.status === 'rejected') {
        throw new Error('Book metadata providers are currently unavailable');
      }
      return results;
    }

    case 'movie':
    case 'show':
    case 'anime': {
      const apiKey = await getTmdbApiKey();
      if (!apiKey) {
        const err = new Error('TMDB API key is not configured. An admin must add one in Server Settings.');
        err.code = 'MISSING_API_KEY';
        throw err;
      }
      return searchTMDB(query, mediaType, apiKey, year);
    }

    default:
      throw new Error(`No metadata provider available for media type "${mediaType}"`);
  }
}
