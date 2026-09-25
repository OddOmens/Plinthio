import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { getThumbnailPath } from './thumbnails.js';
import { invalidateCoverCache } from '../routes/media.js';
import { searchExternalMetadata, getTmdbApiKey } from './externalMetadata.js';
import { logger } from './logger.js';

// Only fetch covers from the CDN hosts our own metadata providers actually return —
// `coverUrl` can be client-supplied, and without this the server would happily turn it into
// an arbitrary outbound HTTP request (SSRF against internal services / cloud metadata
// endpoints).
const ALLOWED_COVER_HOSTS = new Set([
  'uploads.mangadex.org',
  'books.google.com',
  'books.googleusercontent.com',
  'covers.openlibrary.org',
  'image.tmdb.org'
]);
// Open Library covers 302 through archive.org to a numbered `iaNNNNNN.us.archive.org`
// mirror that varies per request, so it can't be pinned to one exact hostname.
const ALLOWED_COVER_HOST_SUFFIXES = ['.archive.org'];
const ALLOWED_COVER_EXACT_HOSTS = new Set(['archive.org']);
const MAX_COVER_BYTES = 15 * 1024 * 1024; // 15MB
const COVER_FETCH_TIMEOUT_MS = 15000;

export function isAllowedCoverHost(hostname) {
  return ALLOWED_COVER_HOSTS.has(hostname) ||
    ALLOWED_COVER_EXACT_HOSTS.has(hostname) ||
    ALLOWED_COVER_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export async function downloadCover(coverUrl, itemId) {
  let parsed;
  try {
    parsed = new URL(coverUrl);
  } catch (e) {
    throw new Error('Invalid cover URL');
  }
  if (parsed.protocol !== 'https:' || !isAllowedCoverHost(parsed.hostname)) {
    throw new Error('Cover URL is not from an approved metadata provider');
  }

  // Bounded, like every other outbound call: the scanner downloads covers one item at a
  // time while holding the scan lock, so a CDN that accepts the connection and then stalls
  // would hang the whole library scan rather than just losing one poster.
  const res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Cover download failed with status ${res.status}`);
  }
  // Re-check after redirects: a provider host could 30x to somewhere off the allowlist.
  const finalHost = new URL(res.url).hostname;
  if (!isAllowedCoverHost(finalHost)) {
    throw new Error('Cover URL redirected off the approved provider host');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error('Cover URL did not return an image');
  }
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_COVER_BYTES) {
    throw new Error('Cover image is too large');
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_COVER_BYTES) {
    throw new Error('Cover image is too large');
  }

  const coverFilename = `${itemId}.jpg`;
  fs.writeFileSync(path.join(config.coversDir, coverFilename), buffer);

  // Invalidate any cached thumbnails so the new cover is regenerated on next request
  for (const width of [180, 360, 720]) {
    const thumbPath = getThumbnailPath(itemId, width);
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
    }
  }
  // Also drop the in-memory cover_path lookup cache in media.js — otherwise /cover/:id
  // keeps serving the old cover_path (and thus the old image) until the process restarts.
  invalidateCoverCache(itemId);

  return coverFilename;
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
