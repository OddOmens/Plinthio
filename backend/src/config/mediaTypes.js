// Every media type the scanner can produce (items.media_type). New accounts default to
// seeing all of them — a type that's indexed but missing from this list is invisible in the
// UI even though the content is there, which is exactly how video stayed hidden despite
// being scanned. Mirrored on the frontend in src/constants/media.js.
export const ALL_MEDIA_TYPES = ['audiobook', 'manga', 'book', 'show', 'movie', 'anime'];
