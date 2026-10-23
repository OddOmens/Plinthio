// How the UI talks about each media type: what one entry in a series is called, what you
// do with it, and who made it. One place, so the shelf, series pages and cards agree.
// The words live in locales/<language>/vocab.json; every field is a getter, so it reads
// the current language each time it's used (spreading a vocab object freezes today's
// wording). `type` / `typeSingular` are the shared media type names from common.json.
import { t } from '../i18n';

const FIELDS = ['unit', 'units', 'short', 'verb', 'verbing', 'done', 'creator', 'series'];

function makeVocab(mediaType) {
  const vocab = {
    mediaType,
    get type() { return t(`common.mediaTypes.${mediaType}`); },
    get typeSingular() { return t(`common.mediaType.${mediaType}`); },
    // "3 volumes", "1 episode" — a count of this type's entries.
    count(count) { return t(`vocab.${mediaType}.count`, { count }); }
  };
  for (const field of FIELDS) {
    Object.defineProperty(vocab, field, { enumerable: true, get: () => t(`vocab.${mediaType}.${field}`) });
  }
  return vocab;
}

const VOCAB = Object.fromEntries(
  ['manga', 'book', 'audiobook', 'show', 'anime', 'movie'].map((type) => [type, makeVocab(type)])
);

export function vocabFor(mediaType) {
  return VOCAB[mediaType] || VOCAB.book;
}

export const VIDEO_TYPES = ['movie', 'show', 'anime'];
export const isVideo = (mediaType) => VIDEO_TYPES.includes(mediaType);
export const isTimeBased = (mediaType) => mediaType === 'audiobook' || isVideo(mediaType);

// The "Creator" shelf view's label for the type being browsed ("All" mixes them).
export function creatorLabel(mediaType) {
  return !mediaType || mediaType === 'all' ? t('vocab.anyCreator') : vocabFor(mediaType).creator;
}

// "Vol 3", "S2 · E5" (episodes store season + episode/1000 in `volume`), "Book 2".
export function entryLabel(item) {
  if (item?.volume == null) return item?.title || '';
  const v = Number(item.volume);
  if (item.media_type === 'show' || item.media_type === 'anime') {
    const season = Math.floor(v);
    const episode = Math.round((v - season) * 1000);
    return episode > 0
      ? t(`vocab.${item.media_type}.entry`, { season, episode })
      : t(`vocab.${item.media_type}.season`, { season });
  }
  const number = v % 1 === 0 ? Math.trunc(v) : v;
  return t(`vocab.${vocabFor(item.media_type).mediaType}.entry`, { number });
}

// Where clicking a title goes: its series page, or its own page when it has no series.
// A film always gets its own page, even inside a collection: clicking Shrek 2 means Shrek 2,
// and its page links on to the rest of the collection.
// Everything opens a detail page first; reading/listening/watching starts from there.
export function detailRoute(item) {
  if (item?.series && (item.media_type || item.mediaType) !== 'movie') {
    return {
      path: `/series/${encodeURIComponent(item.series)}`,
      query: { library: item.library_id || item.libraryId, type: item.media_type || item.mediaType }
    };
  }
  return { path: `/title/${item.id}` };
}

// The creator worth showing, or null. Without online metadata the scanner fills a video's
// creator with its folder name ("Quiet Harbor (2021)"), and books default to "Unknown
// Author" — neither says who made it, so neither is shown or grouped on.
export function realCreator(author, title) {
  const a = (author || '').trim();
  if (!a || /^unknown( author)?$/i.test(a)) return null;
  if (title && a.toLowerCase().startsWith(String(title).trim().toLowerCase())) return null;
  return a;
}
