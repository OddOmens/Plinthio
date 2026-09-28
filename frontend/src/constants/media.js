// Every media type Plinthio can index. Used as the fallback whenever a user's stored
// `enabledMediaTypes` preference is missing — defaulting to "show everything" means adding
// a library of a new type just works, instead of the content being indexed but invisible
// because the type wasn't in a hardcoded three-item default.
export const ALL_MEDIA_TYPES = ['audiobook', 'manga', 'book', 'show', 'movie', 'anime'];

// List categories and the media types each one holds. `searchTypes` are the metadata
// providers' media types the "add from search" panel can query for that category —
// audiobooks have no dedicated provider, so Listen searches the book providers.
// Mirrored on the backend in config/mediaTypes.js.
export const LIST_CATEGORIES = [
  { id: 'movies', label: 'Movies', mediaTypes: ['movie'], searchTypes: [{ id: 'movie', label: 'Movies' }] },
  { id: 'shows', label: 'Shows', mediaTypes: ['show'], searchTypes: [{ id: 'show', label: 'Shows' }] },
  { id: 'anime', label: 'Anime', mediaTypes: ['anime'], searchTypes: [{ id: 'anime', label: 'Anime' }] },
  {
    id: 'read',
    label: 'Read',
    mediaTypes: ['book', 'manga'],
    searchTypes: [{ id: 'book', label: 'Books' }, { id: 'manga', label: 'Manga' }]
  },
  { id: 'listen', label: 'Listen', mediaTypes: ['audiobook'], searchTypes: [{ id: 'audiobook', label: 'Audiobooks', provider: 'book' }] }
];

export const MEDIA_TYPE_LABELS = {
  movie: 'Movie',
  show: 'Show',
  anime: 'Anime',
  book: 'Book',
  manga: 'Manga',
  audiobook: 'Audiobook'
};

export const REQUEST_STATUSES = {
  pending: { label: 'Pending', tone: 'bg-amber-500/15 text-amber-500' },
  accepted_pending: { label: 'Accepted · Pending add', tone: 'bg-sky-500/15 text-sky-500' },
  accepted_added: { label: 'Accepted · Added', tone: 'bg-emerald-500/15 text-emerald-500' },
  rejected: { label: 'Rejected', tone: 'bg-destructive/15 text-destructive' }
};
