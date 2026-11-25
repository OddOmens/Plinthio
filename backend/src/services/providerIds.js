import fs from 'fs';
import path from 'path';

// Provider ids a library can carry on disk, so a title is identified exactly instead of by a
// title search: tags in folder and file names, and .nfo files next to the video.
//
// Tags: {tmdb-603}  [tmdbid-603]  [tmdbid=603]  {imdb-tt0133093}  [imdbid-tt0133093]
//       {tvdb-81189}  [tvdbid-81189]
const TAG_SOURCE = String.raw`[[{]\s*(tmdb|imdb|tvdb)(?:id)?\s*[-=:]\s*(tt\d{6,10}|\d{1,10})\s*[\]}]`;
const tagPattern = () => new RegExp(TAG_SOURCE, 'gi');

const VIDEO_TYPES = new Set(['movie', 'show', 'anime']);
const MAX_NFO_BYTES = 512 * 1024;

const emptyIds = () => ({ tmdb: null, imdb: null, tvdb: null });

function valid(kind, value) {
  if (kind === 'imdb') return /^tt\d{6,10}$/.test(value);
  return /^\d{1,10}$/.test(value) && Number(value) > 0;
}

/** Ids from the tags in a name; the first tag of each kind wins. */
export function parseProviderIdTags(text) {
  const ids = emptyIds();
  for (const match of String(text || '').matchAll(tagPattern())) {
    const kind = match[1].toLowerCase();
    const value = match[2].toLowerCase();
    if (!ids[kind] && valid(kind, value)) ids[kind] = value;
  }
  return ids;
}

export function hasProviderIdTag(text) {
  return tagPattern().test(String(text || ''));
}

/** The name without its id tags. */
export function stripProviderIdTags(text) {
  return String(text || '').replace(tagPattern(), ' ').replace(/\s+/g, ' ').trim();
}

// Folder names between the library root and the file, nearest first.
function foldersAbove(filePath, libraryRoot) {
  const root = path.resolve(libraryRoot);
  const folders = [];
  let dir = path.dirname(path.resolve(filePath));
  while (dir !== root && dir.startsWith(root + path.sep)) {
    folders.push(dir);
    dir = path.dirname(dir);
  }
  return folders;
}

function tagIdsForFile(filePath, mediaType, libraryRoot) {
  const ids = emptyIds();
  // An episode's file name could only carry an episode id; a show's ids sit on its folder.
  const names = mediaType === 'movie' ? [path.basename(filePath)] : [];
  names.push(...foldersAbove(filePath, libraryRoot).map((dir) => path.basename(dir)));
  for (const name of names) {
    const found = parseProviderIdTags(name);
    for (const kind of Object.keys(ids)) ids[kind] = ids[kind] || found[kind];
  }
  return ids;
}

// One listing per folder per scan: lower-cased name → real name.
function listFolder(dir, folderCache) {
  if (folderCache.has(dir)) return folderCache.get(dir);
  const names = new Map();
  try {
    for (const name of fs.readdirSync(dir)) names.set(name.toLowerCase(), name);
  } catch (e) {
    // Unreadable folder: no .nfo.
  }
  folderCache.set(dir, names);
  return names;
}

// The .nfo describing this title: `<file>.nfo` or `movie.nfo` beside a film, `tvshow.nfo` in
// the show's folder. Never the library root's own, which would describe every title in it.
function findNfo(filePath, mediaType, libraryRoot, folderCache) {
  const folders = foldersAbove(filePath, libraryRoot);
  const pick = (dir, name) => {
    const real = listFolder(dir, folderCache).get(name.toLowerCase());
    return real ? path.join(dir, real) : null;
  };
  if (mediaType === 'movie') {
    const dir = path.dirname(path.resolve(filePath));
    const base = path.basename(filePath, path.extname(filePath));
    return pick(dir, `${base}.nfo`) || (folders.length ? pick(dir, 'movie.nfo') : null);
  }
  for (const dir of folders) {
    const found = pick(dir, 'tvshow.nfo');
    if (found) return found;
  }
  return null;
}

/** Ids from an .nfo's text: Kodi-style XML, or a bare link to the title's provider page. */
export function parseNfoIds(text, mediaType) {
  const ids = emptyIds();
  const xml = String(text || '');
  // An episode's .nfo holds the episode's ids, not the show's.
  if (/<episodedetails[\s>]/i.test(xml)) return ids;
  const set = (kind, value) => {
    const v = String(value || '').trim().toLowerCase();
    if (!ids[kind] && valid(kind, v)) ids[kind] = v;
  };

  for (const m of xml.matchAll(/<uniqueid\b([^>]*)>\s*([^<\s]+)\s*<\/uniqueid>/gi)) {
    const type = m[1].match(/\btype\s*=\s*["']?\s*(tmdb|imdb|tvdb)\b/i);
    if (type) set(type[1].toLowerCase(), m[2]);
  }
  for (const m of xml.matchAll(/<(tmdb|imdb|tvdb)_?id>\s*([^<\s]+)\s*<\/\1_?id>/gi)) {
    set(m[1].toLowerCase(), m[2]);
  }
  // A bare <id> is the IMDb id in film .nfo files; a number there depends on the tool that wrote it.
  const bareId = xml.match(/<id>\s*(tt\d{6,10})\s*<\/id>/i);
  if (bareId) set('imdb', bareId[1]);

  const tmdbLink = xml.match(/themoviedb\.org\/(movie|tv)\/(\d{1,10})/i);
  if (tmdbLink && (tmdbLink[1].toLowerCase() === 'movie') === (mediaType === 'movie')) set('tmdb', tmdbLink[2]);
  const imdbLink = xml.match(/imdb\.com\/title\/(tt\d{6,10})/i);
  if (imdbLink) set('imdb', imdbLink[1]);
  if (mediaType !== 'movie') {
    const tvdbLink = xml.match(/thetvdb\.com\/(?:\?[^\s"'<]*\bid=|dereferrer\/series\/)(\d{1,10})/i);
    if (tvdbLink) set('tvdb', tvdbLink[1]);
  }
  return ids;
}

function readNfoIds(nfoPath, mediaType) {
  try {
    const fd = fs.openSync(nfoPath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_NFO_BYTES);
      const length = fs.readSync(fd, buffer, 0, MAX_NFO_BYTES, 0);
      return parseNfoIds(buffer.subarray(0, length).toString('utf8'), mediaType);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return emptyIds();
  }
}

/**
 * What the disk says about a video file's ids. `key` changes whenever that answer could have
 * (a tag added, an .nfo written or edited), so the scanner applies the ids once per change and
 * a match made by hand afterwards isn't undone on the next scan. `ids()` reads the .nfo.
 */
export function fileProviderIds(filePath, mediaType, libraryRoot, folderCache = new Map()) {
  if (!VIDEO_TYPES.has(mediaType)) return { key: '', ids: emptyIds };

  const tags = tagIdsForFile(filePath, mediaType, libraryRoot);
  let nfoPath = findNfo(filePath, mediaType, libraryRoot, folderCache);
  let nfoStamp = '';
  if (nfoPath) {
    // A regular file only: a link could point anywhere on the server.
    const stat = fs.lstatSync(nfoPath, { throwIfNoEntry: false });
    if (stat?.isFile()) nfoStamp = `${path.basename(nfoPath)}:${Math.round(stat.mtimeMs)}:${stat.size}`;
    else nfoPath = null;
  }

  const tagKey = Object.entries(tags).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(',');
  const key = [tagKey, nfoStamp].filter(Boolean).join('|');
  return {
    key,
    ids: () => {
      if (!nfoPath) return tags;
      const fromNfo = readNfoIds(nfoPath, mediaType);
      // The name is what the admin sees and edits, so its tags win over the .nfo.
      return { tmdb: tags.tmdb || fromNfo.tmdb, imdb: tags.imdb || fromNfo.imdb, tvdb: tags.tvdb || fromNfo.tvdb };
    }
  };
}
