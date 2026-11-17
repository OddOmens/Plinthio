import { fetchJson } from './providerHttp.js';
import { htmlToText } from './bookMetadata.js';

// TVmaze (https://www.tvmaze.com/api): no key; CC BY-SA, credited in Admin → Metadata.
// Rate limited (20 req / 10s), so answers are cached.
const CACHE_MS = 30 * 60 * 1000;

function tvmazeResult(show) {
  return {
    source: 'tvmaze',
    externalId: String(show.id),
    title: show.name || 'Untitled',
    subtitle: null,
    author: null,
    artists: null,
    series: show.name || null,
    releaseDate: show.premiered || null,
    overview: htmlToText(show.summary),
    genres: show.genres || [],
    themes: [],
    publisher: null,
    status: show.status || null,
    coverUrl: show.image?.original || show.image?.medium || null
  };
}

export async function searchTvmaze(query) {
  const data = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, { cacheMs: CACHE_MS });
  return (Array.isArray(data) ? data : []).slice(0, 10).map((hit) => tvmazeResult(hit.show || {}));
}

/** Episodes keyed by "season x number" ("1x2"). */
export async function fetchTvmazeEpisodes(showId) {
  const episodes = await fetchJson(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}/episodes`, { cacheMs: CACHE_MS });
  return new Map((Array.isArray(episodes) ? episodes : []).map((e) => [`${e.season}x${e.number}`, {
    name: e.name || null,
    airdate: e.airdate || null,
    overview: htmlToText(e.summary),
    stillUrl: e.image?.original || e.image?.medium || null
  }]));
}
