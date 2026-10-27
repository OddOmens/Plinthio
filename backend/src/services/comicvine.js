import { getDb } from '../config/database.js';
import { fetchJson } from './providerHttp.js';
import { htmlToText } from './bookMetadata.js';

/**
 * Comic Vine — free, but every request needs a key of your own: a free account at
 * comicvine.gamespot.com, then comicvine.gamespot.com/api. Western comics: series ("volumes"
 * there), publishers, creators and each issue's cover. 200 requests an hour per kind of
 * lookup are allowed, so answers are kept for a while.
 */
const CACHE_MS = 60 * 60 * 1000;
const API = 'https://comicvine.gamespot.com/api';

export async function getComicVineKeyInfo() {
  const db = await getDb();
  const row = await db.get("SELECT value FROM settings WHERE key = 'comicvine_api_key'");
  if (row?.value) return { key: row.value, source: 'custom' };
  if (process.env.COMICVINE_API_KEY) return { key: process.env.COMICVINE_API_KEY, source: 'environment' };
  return { key: null, source: null };
}

// Comic Vine answers a bad key with status_code 100 (and HTTP 401); anything but 1 is an error.
async function comicVineJson(resource, params, key = null) {
  const apiKey = key || (await getComicVineKeyInfo()).key;
  const query = new URLSearchParams({ api_key: apiKey || '', format: 'json', ...params });
  const data = await fetchJson(`${API}/${resource}/?${query}`, { cacheMs: key ? 0 : CACHE_MS });
  if (data.status_code !== 1) {
    const err = new Error(`Comic Vine: ${data.error || 'request refused'}`);
    err.status = data.status_code === 100 ? 401 : 502;
    throw err;
  }
  return data.results;
}

function comicVineResult(volume) {
  return {
    source: 'comicvine',
    externalId: String(volume.id),
    title: volume.name || 'Untitled',
    subtitle: null,
    author: null,
    artists: null,
    series: volume.name || null,
    releaseDate: volume.start_year ? String(volume.start_year) : null,
    // The deck is a line or two; the description is a long wiki article.
    overview: htmlToText(volume.deck) || htmlToText(volume.description),
    genres: [],
    themes: [],
    publisher: volume.publisher?.name || null,
    status: null,
    issueCount: volume.count_of_issues ?? null,
    coverUrl: volume.image?.original_url || volume.image?.medium_url || null
  };
}

export async function searchComicVine(query) {
  const results = await comicVineJson('search', {
    query,
    resources: 'volume',
    limit: '10',
    field_list: 'id,name,start_year,publisher,image,deck,description,count_of_issues'
  });
  return (results || []).map(comicVineResult);
}

/** The series' most credited creators, which the search leaves out. */
export async function fetchComicVineDetails(result) {
  try {
    const volume = await comicVineJson(`volume/4050-${encodeURIComponent(result.externalId)}`, { field_list: 'people,deck,description' });
    const people = [...(volume.people || [])].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    return {
      ...result,
      author: result.author || people.slice(0, 3).map((p) => p.name).filter(Boolean).join(', ') || null,
      overview: result.overview || htmlToText(volume.deck) || htmlToText(volume.description)
    };
  } catch {
    return result;
  }
}

/** Each issue's cover by its number ("1", "12.1"), for matching a library of issues. */
export async function fetchComicVineIssueCovers(volumeId) {
  try {
    const issues = await comicVineJson('issues', {
      filter: `volume:${volumeId}`,
      field_list: 'issue_number,image',
      sort: 'issue_number:asc',
      limit: '100'
    });
    const covers = new Map();
    for (const issue of issues || []) {
      const url = issue.image?.original_url || issue.image?.medium_url;
      if (issue.issue_number != null && url && !covers.has(String(issue.issue_number))) covers.set(String(issue.issue_number), url);
    }
    return covers;
  } catch {
    return new Map();
  }
}

/** One real lookup with the key, so a wrong one is reported when it's saved. */
export async function verifyComicVineKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'No API key provided' };
  try {
    await comicVineJson('types', {}, key);
    return { ok: true };
  } catch (err) {
    if (err.status === 401) {
      return { ok: false, rejected: true, reason: 'Comic Vine rejected this key. Copy it whole from comicvine.gamespot.com/api while signed in.' };
    }
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'Timed out reaching Comic Vine. Check the container has outbound internet access.' };
    }
    return { ok: false, reason: `Could not verify the key with Comic Vine (${err.message}).` };
  }
}
