// Every media type Plinthio can index. Used as the fallback whenever a user's stored
// `enabledMediaTypes` preference is missing — defaulting to "show everything" means adding
// a library of a new type just works, instead of the content being indexed but invisible
// because the type wasn't in a hardcoded three-item default.
import { t } from '../i18n';

export const ALL_MEDIA_TYPES = ['audiobook', 'manga', 'book', 'show', 'movie', 'anime'];

// List categories and the media types each one holds. `searchTypes` are the metadata
// providers' media types the "add from search" panel can query for that category —
// audiobooks have no dedicated provider, so Listen searches the book providers.
// Mirrored on the backend in config/mediaTypes.js. Labels are getters so they follow the
// current language (spreading one copies today's wording).
const searchType = (id, extra = {}) => ({ id, ...extra, get label() { return t(`common.mediaTypes.${id}`); } });
const category = (id, mediaTypes, searchTypes) => ({
  id,
  mediaTypes,
  searchTypes,
  get label() { return t(`lists.categories.${id}`); }
});

export const LIST_CATEGORIES = [
  category('movies', ['movie'], [searchType('movie')]),
  category('shows', ['show'], [searchType('show')]),
  category('anime', ['anime'], [searchType('anime')]),
  category('read', ['book', 'manga'], [searchType('book'), searchType('manga')]),
  category('listen', ['audiobook'], [searchType('audiobook', { provider: 'book' })])
];

export const MEDIA_TYPE_LABELS = {
  get movie() { return t('common.mediaType.movie'); },
  get show() { return t('common.mediaType.show'); },
  get anime() { return t('common.mediaType.anime'); },
  get book() { return t('common.mediaType.book'); },
  get manga() { return t('common.mediaType.manga'); },
  get audiobook() { return t('common.mediaType.audiobook'); }
};

const status = (id, tone) => ({ tone, get label() { return t(`lists.requestStatus.${id}`); } });
export const REQUEST_STATUSES = {
  pending: status('pending', 'bg-amber-500/15 text-amber-500'),
  accepted_pending: status('accepted_pending', 'bg-sky-500/15 text-sky-500'),
  accepted_added: status('accepted_added', 'bg-emerald-500/15 text-emerald-500'),
  rejected: status('rejected', 'bg-destructive/15 text-destructive')
};
