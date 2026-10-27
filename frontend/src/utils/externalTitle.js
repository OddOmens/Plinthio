// The fields of an external metadata search result that lists and requests store.
export function externalTitlePayload(result, mediaType) {
  return {
    mediaType,
    source: result.source,
    externalId: result.externalId,
    title: result.title,
    subtitle: result.subtitle || null,
    author: result.author || null,
    releaseDate: result.releaseDate || null,
    overview: result.overview || null,
    coverUrl: result.coverUrl || null
  };
}

export const SOURCE_LABELS = {
  tmdb: 'TMDB',
  tvmaze: 'TVmaze',
  anilist: 'AniList',
  mangadex: 'MangaDex',
  comicvine: 'Comic Vine',
  'google-books': 'Google Books',
  'open-library': 'Open Library',
  audible: 'Audible'
};
