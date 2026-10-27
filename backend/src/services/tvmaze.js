import { fetchJson } from './providerHttp.js';
import { htmlToText } from './bookMetadata.js';

/**
 * TVmaze — free, no key; its data is licensed CC BY-SA, so it's credited in Admin → Metadata.
 * https://www.tvmaze.com/api
 * Shows, with every episode's title, date, summary and still. At least 20 requests every 10
 * seconds are allowed; answers are kept for a while so matching a season's episodes asks
 * about the show once.
 */
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

/** A show's episodes by "season×number" ("1x2"), each with name, airdate, summary and still. */
export async function fetchTvmazeEpisodes(showId) {
  const episodes = await fetchJson(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}/episodes`, { cacheMs: CACHE_MS });
  return new Map((Array.isArray(episodes) ? episodes : []).map((e) => [`${e.season}x${e.number}`, {
    name: e.name || null,
    airdate: e.airdate || null,
    overview: htmlToText(e.summary),
    stillUrl: e.image?.original || e.image?.medium || null
  }]));
}
