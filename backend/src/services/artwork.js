import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { getThumbnailPath } from './thumbnails.js';
import { invalidateCoverCache } from '../routes/media.js';
import { searchExternalMetadata, getTmdbApiKey } from './externalMetadata.js';
import { logger } from './logger.js';

import sharp from 'sharp';
import { looksLikeImageBuffer } from '../utils/imageFile.js';

// Only fetch covers from the CDN hosts our own metadata providers actually return —
// `coverUrl` can be client-supplied, and without this the server would happily turn it into
// an arbitrary outbound HTTP request (SSRF against internal services / cloud metadata
// endpoints).
const ALLOWED_COVER_HOSTS = new Set([
  'uploads.mangadex.org',
  'mangadex.org',
  'books.google.com',
  'books.googleusercontent.com',
  'covers.openlibrary.org',
  'openlibrary.org',
  'image.tmdb.org',
  'themoviedb.org'
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

export function isAllowedCoverHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return ALLOWED_COVER_HOSTS.has(host) ||
    ALLOWED_COVER_EXACT_HOSTS.has(host) ||
    ALLOWED_COVER_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Downloads and verifies image bytes from an approved metadata provider.
 */
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

  const res = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'Plinthio/1.4.1 (https://github.com/OddOmens/Plinthio)' },
    signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS)
  });
  if (!res.ok) {
    throw new Error(`Cover download failed with status ${res.status}`);
  }
  const finalHost = res.url ? new URL(res.url).hostname : parsed.hostname;
  if (!isAllowedCoverHost(finalHost)) {
    throw new Error('Cover URL redirected off the approved provider host');
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_COVER_BYTES) {
    throw new Error('Cover image is too large');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/') && !looksLikeImageBuffer(buffer)) {
    throw new Error('Cover URL did not return an image');
  }

  return buffer;
}

/**
 * Normalizes an image buffer with sharp and saves as standardized JPEG for an item.
 */
export async function saveCoverJpeg(buffer, itemId) {
  const coverFilename = `${itemId}.jpg`;
  const fullPath = path.join(config.coversDir, coverFilename);
  await sharp(buffer)
    .rotate()
    .resize(1200, 1800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(fullPath);

  for (const width of [180, 360, 720]) {
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

/**
 * Best-effort poster art for a movie/show/anime from TMDB. Returns the cover filename, or
 * null if TMDB isn't configured or nothing matched — callers treat it as optional polish,
 * never a scan failure.
 */
// Whether TMDB lookups can run at all — i.e. whether an admin has supplied a key. The
// scanner uses this to decide if a provisional video-frame cover is worth retrying.
export async function isVideoArtworkAvailable() {
  return !!(await getTmdbApiKey());
}

export async function fetchVideoArtwork({ itemId, title, series, mediaType, year }) {
  const apiKey = await getTmdbApiKey();
  if (!apiKey) return null;

  // Episodes match far better against the show name than an "S01E03: ..." episode title.
  const query = cleanSearchTitle(mediaType === 'movie' ? title : (series || title));
  if (!query) return null;

  try {
    const results = await searchExternalMetadata(mediaType, query, year);
    if (!results || results.length === 0) return null;

    // Prefer a result whose release year matches the filename's, when we have one.
    const match = (year && results.find((r) => (r.releaseDate || '').startsWith(String(year)))) || results[0];
    if (!match?.coverUrl) return null;

    return await downloadCover(match.coverUrl, itemId);
  } catch (err) {
    logger.warn('scan', `TMDB artwork lookup failed for "${query}": ${err.message}`);
    return null;
  }
}
