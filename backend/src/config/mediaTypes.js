// Every media type the scanner can produce (items.media_type). New accounts see all of them;
// a type missing here is invisible in the UI. Mirrored in frontend src/constants/media.js.
export const ALL_MEDIA_TYPES = ['audiobook', 'manga', 'book', 'show', 'movie', 'anime'];

// Lists are grouped into categories, each covering one or more media types. "Read" spans
// books and manga; "Listen" is audiobooks. Mirrored on the frontend in src/constants/media.js.
export const LIST_CATEGORIES = {
  movies: ['movie'],
  shows: ['show'],
  anime: ['anime'],
  read: ['book', 'manga'],
  listen: ['audiobook']
};

export function categoryForMediaType(mediaType) {
  return Object.keys(LIST_CATEGORIES).find((c) => LIST_CATEGORIES[c].includes(mediaType)) || null;
}
