import fs from 'fs';

// Keeps opened archives so each page turn doesn't re-open (or re-read) the whole file.
// Keyed by path + mtime + size so a replaced file is never served stale. Kept tiny because
// each entry pins the archive's bytes, and a reader only uses one or two files at once.
const MAX_ENTRIES = 3;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;

// Insertion-ordered, so the first key is the least recently used (re-set on every hit).
const cache = new Map();
let totalBytes = 0;

function evict(key) {
  const entry = cache.get(key);
  if (!entry) return;
  totalBytes -= entry.bytes;
  cache.delete(key);
}

function evictExpired(now) {
  for (const [key, entry] of cache) {
    if (now - entry.usedAt > TTL_MS) evict(key);
  }
}

function evictUntilWithinLimits() {
  while (cache.size > MAX_ENTRIES || (totalBytes > MAX_TOTAL_BYTES && cache.size > 1)) {
    evict(cache.keys().next().value);
  }
}

// The most one entry (a page) may unpack to; only stops crafted entries that inflate to GBs.
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

// Limits for archives unpacked whole (7z): total size and entry count. Anything past these
// is a bomb meant to fill the cache disk, not a comic.
export const MAX_ARCHIVE_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10000;

// Returns the cached handle for `archivePath`, building it with `factory(archivePath)` on a miss.
export async function getArchiveHandle(archivePath, factory) {
  let stat;
  try {
    stat = fs.statSync(archivePath);
  } catch (err) {
    // Unreadable/missing file — let the backend surface the real error uncached.
    return factory(archivePath);
  }

  const key = `${archivePath}::${stat.mtimeMs}::${stat.size}`;
  const now = Date.now();
  evictExpired(now);

  const hit = cache.get(key);
  if (hit) {
    hit.usedAt = now;
    // Re-insert to move it to the most-recently-used end of the iteration order.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  }

  // Any older handle for the same path (a replaced file) is now dead weight.
  for (const existing of cache.keys()) {
    if (existing.startsWith(`${archivePath}::`)) evict(existing);
  }

  const value = await factory(archivePath);
  cache.set(key, { value, bytes: stat.size, usedAt: now });
  totalBytes += stat.size;
  evictUntilWithinLimits();

  return value;
}

export function clearArchiveHandles() {
  cache.clear();
  totalBytes = 0;
}
