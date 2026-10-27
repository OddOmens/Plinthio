import { fetchJson } from './providerHttp.js';
import { htmlToText } from './bookMetadata.js';

/**
 * AniList — free, no key. https://docs.anilist.co
 * Manga and anime: English and romaji titles, large covers, genres, tags and staff. About 90
 * requests a minute are allowed (fewer while AniList is under load), so answers are kept for
 * a while: a batch match asks once per series, not once per volume.
 */
const CACHE_MS = 30 * 60 * 1000;

const QUERY = `query ($search: String, $type: MediaType) {
  Page(perPage: 10) {
    media(search: $search, type: $type, isAdult: false, sort: SEARCH_MATCH) {
      id
      status
      title { romaji english native }
      description(asHtml: false)
      startDate { year month day }
      coverImage { extraLarge large }
      genres
      tags { name rank isMediaSpoiler isGeneralSpoiler }
      staff(perPage: 8, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`;

// In the words MangaDex results use, so the status field reads the same whichever source
// filled it.
const STATUS = {
  FINISHED: 'Completed',
  RELEASING: 'Ongoing',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'Hiatus'
};

function date({ year, month, day } = {}) {
  if (!year) return null;
  if (!month) return String(year);
  return [year, month, day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, '0') : n)).join('-');
}

// Staff whose role matches, in AniList's order of relevance, without repeats.
function staffNames(media, role) {
  const names = (media.staff?.edges || []).filter((e) => role.test(e.role || '')).map((e) => e.node?.name?.full);
  return [...new Set(names.filter(Boolean))].join(', ') || null;
}

function anilistResult(media, type) {
  const english = media.title?.english;
  const romaji = media.title?.romaji;
  const title = english || romaji || media.title?.native || 'Untitled';
  return {
    source: 'anilist',
    externalId: String(media.id),
    title,
    subtitle: english && romaji && romaji !== english ? romaji : (media.title?.native || null),
    // Manga credit "Story", "Art" or "Story & Art"; anime credit a director.
    author: type === 'MANGA' ? staffNames(media, /story|original creator/i) : staffNames(media, /^director$/i),
    artists: type === 'MANGA' ? staffNames(media, /\bart\b/i) : null,
    series: title,
    releaseDate: date(media.startDate),
    // AniList blurbs end with "(Source: …)" credits; the first paragraphs are the blurb.
    overview: htmlToText(String(media.description || '').replace(/\(Source:[^)]*\)\s*$/i, '')),
    genres: media.genres || [],
    themes: (media.tags || [])
      .filter((t) => !t.isMediaSpoiler && !t.isGeneralSpoiler && t.rank >= 60)
      .slice(0, 6)
      .map((t) => t.name),
    publisher: null,
    status: STATUS[media.status] || null,
    coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || null
  };
}

/** `type` is 'MANGA' or 'ANIME'. Adult titles are left out, as MangaDex's search does. */
export async function searchAniList(query, type) {
  const data = await fetchJson('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { search: query, type } }),
    cacheMs: CACHE_MS
  });
  return (data.data?.Page?.media || []).map((media) => anilistResult(media, type));
}
