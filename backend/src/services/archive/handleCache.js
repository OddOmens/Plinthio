import fs from 'fs';

// Reading a comic meant re-opening (and for RAR, re-reading from disk) the whole archive on
// every single page request — and twice per request, since extractMangaPage lists the
// entries before reading one. On a 76MB CBZ that measured ~119ms per page turn; with the
// opened archive held here it's ~1.5ms.
//
// Entries are keyed by path + mtime + size, so replacing a file on disk invalidates its
// handle instead of serving stale pages. The cache is deliberately tiny: each entry pins
// the archive's bytes in memory, and a reader only ever works through one or two files at
// once (the current volume, plus the next one when they flip over).
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

/**
 * Returns the cached handle for `archivePath`, building it with `factory(archivePath)` on a
 * miss. `bytes` is the archive's own size — used only to bound how much the cache pins.
 */
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
