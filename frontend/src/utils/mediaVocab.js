// How the UI talks about each media type: what one entry in a series is called, what you
// do with it, and who made it. One place, so the shelf, series pages and cards agree.
const VOCAB = {
  manga: { unit: 'Volume', units: 'Volumes', short: 'Vol', verb: 'Read', verbing: 'Reading', done: 'Read', creator: 'Author', series: 'Manga Series', type: 'Manga' },
  book: { unit: 'Book', units: 'Books', short: 'Book', verb: 'Read', verbing: 'Reading', done: 'Read', creator: 'Author', series: 'Book Series', type: 'Books' },
  audiobook: { unit: 'Book', units: 'Books', short: 'Book', verb: 'Listen', verbing: 'Listening', done: 'Listened', creator: 'Author', series: 'Audiobook Series', type: 'Audiobooks' },
  show: { unit: 'Episode', units: 'Episodes', short: 'Ep', verb: 'Watch', verbing: 'Watching', done: 'Watched', creator: 'Creator', series: 'TV Series', type: 'Shows' },
  anime: { unit: 'Episode', units: 'Episodes', short: 'Ep', verb: 'Watch', verbing: 'Watching', done: 'Watched', creator: 'Studio', series: 'Anime Series', type: 'Anime' },
  movie: { unit: 'Movie', units: 'Movies', short: 'Part', verb: 'Watch', verbing: 'Watching', done: 'Watched', creator: 'Director', series: 'Movie Collection', type: 'Movies' }
};

export function vocabFor(mediaType) {
  return VOCAB[mediaType] || VOCAB.book;
}

export const VIDEO_TYPES = ['movie', 'show', 'anime'];
export const isVideo = (mediaType) => VIDEO_TYPES.includes(mediaType);
export const isTimeBased = (mediaType) => mediaType === 'audiobook' || isVideo(mediaType);

// The "Creator" shelf view's label for the type being browsed ("All" mixes them).
export function creatorLabel(mediaType) {
  return !mediaType || mediaType === 'all' ? 'Creator' : vocabFor(mediaType).creator;
}

// "Vol 3", "S2 · E5" (episodes store season + episode/1000 in `volume`), "Book 2".
export function entryLabel(item) {
  if (item?.volume == null) return item?.title || '';
  const v = Number(item.volume);
  if (item.media_type === 'show' || item.media_type === 'anime') {
    const season = Math.floor(v);
    const episode = Math.round((v - season) * 1000);
    return episode > 0 ? `S${season} · E${episode}` : `S${season}`;
  }
  const n = v % 1 === 0 ? Math.trunc(v) : v;
  return `${vocabFor(item.media_type).short} ${n}`;
}

// Where clicking a title goes: its series page, or its own page when it has no series.
// Everything opens a detail page first; reading/listening/watching starts from there.
export function detailRoute(item) {
  if (item?.series) {
    return {
      path: `/series/${encodeURIComponent(item.series)}`,
      query: { library: item.library_id || item.libraryId, type: item.media_type || item.mediaType }
    };
  }
  return { path: `/title/${item.id}` };
}
