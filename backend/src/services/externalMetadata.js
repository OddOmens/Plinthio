import { getDb } from '../config/database.js';

const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
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
const tmdbGenreCache = {};
async function getTmdbGenreMap(endpoint, apiKey) {
  if (tmdbGenreCache[endpoint]) return tmdbGenreCache[endpoint];
  try {
    const data = await fetchJson(`https://api.themoviedb.org/3/genre/${endpoint}/list`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });
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
async function searchTMDB(query, mediaType, apiKey) {
  const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(query)}&include_adult=false`;
  const [data, genreMap] = await Promise.all([
    fetchJson(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }),
    getTmdbGenreMap(endpoint, apiKey)
  ]);

  return (data.results || []).map((r) => {
    const title = r.title || r.name || 'Untitled';
    const date = r.release_date || r.first_air_date || null;
    const genres = (r.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean);
    return {
      source: 'tmdb',
      externalId: String(r.id),
      title,
      subtitle: null,
      author: null,
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
export async function searchExternalMetadata(mediaType, query) {
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
      return searchTMDB(query, mediaType, apiKey);
    }

    default:
      throw new Error(`No metadata provider available for media type "${mediaType}"`);
  }
}
