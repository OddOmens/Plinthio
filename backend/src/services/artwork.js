import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { getThumbnailPath, THUMB_WIDTHS } from './thumbnails.js';
import { invalidateCoverCache } from '../routes/media.js';
import { searchExternalMetadata, getTmdbApiKey } from './externalMetadata.js';
import { logger } from './logger.js';
import { USER_AGENT } from './providerHttp.js';

import sharp from 'sharp';
import { looksLikeImageBuffer } from '../utils/imageFile.js';

// `coverUrl` can be client-supplied, so only provider CDN hosts are fetched (prevents SSRF).
const ALLOWED_COVER_HOSTS = new Set([
  'uploads.mangadex.org',
  'mangadex.org',
  'books.google.com',
  'books.googleusercontent.com',
  'covers.openlibrary.org',
  'openlibrary.org',
  'image.tmdb.org',
  'themoviedb.org',
  's4.anilist.co',
  'static.tvmaze.com',
  'm.media-amazon.com',
  'comicvine.gamespot.com'
]);
// Open Library covers 302 through archive.org to a numbered `iaNNNNNN.us.archive.org`
// mirror that varies per request. Google Books redirects to `lh*.googleusercontent.com`.
const ALLOWED_COVER_HOST_SUFFIXES = [
  '.archive.org',
  '.googleusercontent.com',
  '.mangadex.org',
  '.tmdb.org',
  '.themoviedb.org'
];
const ALLOWED_COVER_EXACT_HOSTS = new Set(['archive.org']);
const MAX_COVER_BYTES = 15 * 1024 * 1024; // 15MB
const COVER_FETCH_TIMEOUT_MS = 15000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// The same hosts as CSP img-src sources (index.js), so the editor can preview any cover the
// server would save. Derived here so the two lists can't drift.
export const COVER_CSP_SOURCES = [
  ...ALLOWED_COVER_HOSTS,
  ...ALLOWED_COVER_EXACT_HOSTS,
  ...ALLOWED_COVER_HOST_SUFFIXES.map((suffix) => `*${suffix}`)
];

export function isAllowedCoverHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return ALLOWED_COVER_HOSTS.has(host) ||
    ALLOWED_COVER_EXACT_HOSTS.has(host) ||
    ALLOWED_COVER_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function downloadCoverBuffer(coverUrl) {
  let parsed;
  try {
    parsed = new URL(coverUrl);
  } catch (e) {
    throw new Error('Invalid cover URL');
  }
  if (parsed.protocol !== 'https:' || !isAllowedCoverHost(parsed.hostname)) {
    throw new Error('Cover URL is not from an approved metadata provider');
  }

  // Redirects are followed by hand so every hop must also be an approved https host.
  // The body is read with a running size cap.
  let url = parsed;
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS)
    });
    const location = REDIRECT_STATUSES.has(res.status) && res.headers.get('location');
    if (!location) break;
    if (hop >= 5) throw new Error('Cover URL redirected too many times');
    url = new URL(location, url);
    if (url.protocol !== 'https:' || !isAllowedCoverHost(url.hostname)) {
      throw new Error('Cover URL redirected off the approved provider host');
    }
  }
  if (!res.ok) {
    throw new Error(`Cover download failed with status ${res.status}`);
  }

  if (Number(res.headers.get('content-length')) > MAX_COVER_BYTES) throw new Error('Cover image is too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body || []) {
    size += chunk.length;
    if (size > MAX_COVER_BYTES) throw new Error('Cover image is too large');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/') && !looksLikeImageBuffer(buffer)) {
    throw new Error('Cover URL did not return an image');
  }

  return buffer;
}

export async function saveCoverJpeg(buffer, itemId) {
  const coverFilename = `${itemId}.jpg`;
  const fullPath = path.join(config.coversDir, coverFilename);
  await sharp(buffer)
    .rotate()
    .resize(1200, 1800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(fullPath);

  for (const width of THUMB_WIDTHS) {
    const thumbPath = getThumbnailPath(itemId, width);
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
    }
  }
  invalidateCoverCache(itemId);

  return coverFilename;
}

export async function downloadCover(coverUrl, itemId) {
  const buffer = await downloadCoverBuffer(coverUrl);
  return await saveCoverJpeg(buffer, itemId);
}

export { cleanSearchTitle } from './titleCleaner.js';
import { cleanSearchTitle } from './titleCleaner.js';

// Whether a TMDB key is set; the scanner uses it to decide if a video-frame cover is worth retrying.
export async function isVideoArtworkAvailable() {
  return !!(await getTmdbApiKey());
}

// Best-effort TMDB poster: the cover filename, or null if unconfigured or unmatched.
export async function fetchVideoArtwork({ itemId, title, series, mediaType, year }) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) return null;

  // Episodes match far better against the show name than an "S01E03: ..." episode title.
  const query = cleanSearchTitle(mediaType === 'movie' ? title : (series || title));
  if (!query) return null;

  try {
    const results = await searchExternalMetadata(mediaType, query, year);
    if (!results || results.length === 0) return null;

    // Prefer a result whose release year matches the filename's.
    const match = (year && results.find((r) => (r.releaseDate || '').startsWith(String(year)))) || results[0];
    if (!match?.coverUrl) return null;

    return await downloadCover(match.coverUrl, itemId);
  } catch (err) {
    logger.warn('scan', `TMDB artwork lookup failed for "${query}": ${err.message}`);
    return null;
  }
}
