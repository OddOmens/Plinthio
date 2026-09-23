// Every media type Plinthio can index. Used as the fallback whenever a user's stored
// `enabledMediaTypes` preference is missing — defaulting to "show everything" means adding
// a library of a new type just works, instead of the content being indexed but invisible
// because the type wasn't in a hardcoded three-item default.
export const ALL_MEDIA_TYPES = ['audiobook', 'manga', 'book', 'show', 'movie', 'anime'];
