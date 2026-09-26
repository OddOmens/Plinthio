// Plinthio service worker.
//
// The previous version registered, intercepted every request, and cached nothing — its only
// fallback was `caches.match()` against a cache no code ever wrote to. So an installed PWA
// with no connection showed the browser's offline page.
//
// Three caches, each with its own policy, because the content types could not be more
// different:
//
//   shell    the built app (hashed /assets/* files and the HTML entry point) — cache-first,
//            since a hashed filename's contents can never change
//   images   covers and comic pages — cache-first with a cap, so a volume you've read stays
//            readable on a plane
//   (none)   API JSON, video and audio — always network. Progress, listings and streams
//            must never be served stale.

const VERSION = 'v4';
const SHELL_CACHE = `plinthio-shell-${VERSION}`;
const IMAGE_CACHE = `plinthio-images-${VERSION}`;
// Downloads the user explicitly asked for. Deliberately NOT versioned: a service worker
// update must never throw away someone's offline library. Only the app removes entries
// (per item, or all of them on sign-out).
const OFFLINE_CACHE = 'plinthio-offline';
const CURRENT_CACHES = new Set([SHELL_CACHE, IMAGE_CACHE, OFFLINE_CACHE]);

// Roughly a couple of comic volumes' worth of pages. Entries are evicted oldest-first.
const MAX_IMAGE_ENTRIES = 600;

const SHELL_URLS = ['/', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // One bad URL shouldn't fail the whole install, so they're added individually.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith('plinthio-') && !CURRENT_CACHES.has(n))
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Caches are unordered maps, but keys() returns insertion order — so the first keys are the
// oldest entries and trimming from the front is a serviceable LRU.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

function isImageEndpoint(url) {
  // Covers and single comic pages: content-addressed by item id and page index, and served
  // with a long max-age already, so they're safe to keep.
  return /\/api\/media\/cover\//.test(url.pathname) ||
    /\/api\/media\/manga\/[^/]+\/page\//.test(url.pathname);
}

// ─── Offline downloads ───────────────────────────────────────────────────────
// Media URLs carry a per-session ?token=; the offline cache is keyed without it (plus the
// cover's w/v params), so a download made under one session still plays under the next.
// The page (src/stores/downloads.js) writes entries under the same keys.
function offlineKey(url) {
  const keep = new URLSearchParams();
  for (const name of ['w', 'v']) {
    if (url.searchParams.has(name)) keep.set(name, url.searchParams.get(name));
  }
  const qs = keep.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

function isDownloadableMedia(url) {
  return /^\/api\/media\/(book\/[^/]+\/file|stream\/[^/]+|manga\/[^/]+\/page\/\d+|cover\/[^/]+)$/.test(url.pathname);
}

// JSON the readers fetch on open. Always tried on the network first (it can change); the
// downloaded copy is only a fallback for when there is no network.
function isOfflineJson(url) {
  return /^\/api\/(media\/manga\/[^/]+\/pages|items\/[^/]+\/chapters|series\/[^/]+\/[^/]+\/settings|bookmarks\/[^/]+)$/.test(url.pathname);
}

// <audio> seeks with Range requests, and Safari won't play at all without 206 support,
// so a cached whole file is sliced to the requested range here.
async function rangeResponse(cached, rangeHeader) {
  const blob = await cached.blob();
  const size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match || (match[1] === '' && match[2] === '')) return cached;
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - parseInt(match[2], 10));
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  }
  if (start >= size || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

// Which downloadable keys are actually downloaded. Kept in memory so the fetch handler can
// decide *synchronously* to leave a non-downloaded audio/book request alone entirely —
// routing ordinary streaming through the worker buys nothing and some browsers handle
// media range requests through a service worker poorly. Rebuilt on startup and whenever
// the page reports a change.
let offlineIndex = null;
function rebuildOfflineIndex() {
  return caches.open(OFFLINE_CACHE)
    .then((cache) => cache.keys())
    .then((keys) => { offlineIndex = new Set(keys.map((r) => r.url)); })
    .catch(() => { offlineIndex = new Set(); });
}
rebuildOfflineIndex();

async function matchOffline(url) {
  const cache = await caches.open(OFFLINE_CACHE);
  return cache.match(offlineKey(url));
}

async function cacheFirst(request, cacheName, { trim = 0 } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (trim) trimCache(cacheName, trim);
  }
  return response;
}

// Covers and single comic pages the user merely viewed (not downloaded): cache-first with a
// size cap, keyed without the per-session token.
async function imageCacheFirst(request, url) {
  // Drop the per-session token from the cache key (it would fragment the cache for no
  // benefit — the bytes are identical either way) but KEEP the `v` version parameter:
  // that's what distinguishes a stale placeholder from the poster that replaced it.
  const key = new Request(offlineKey(url), { headers: request.headers });
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone());
    trimCache(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a deployed update is picked up immediately, falling back
  // to the cached shell when offline. Vue Router handles the path from there.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || Response.error();
      })
    );
    return;
  }

  if (isDownloadableMedia(url)) {
    // Known not to be downloaded, and not an image the viewing cache handles: straight to
    // the network without the worker in the way.
    if (!isImageEndpoint(url) && offlineIndex && !offlineIndex.has(offlineKey(url))) return;
    const rangeHeader = request.headers.get('range');
    event.respondWith((async () => {
      const offline = await matchOffline(url);
      if (offline) return rangeHeader ? rangeResponse(offline, rangeHeader) : offline;
      if (isImageEndpoint(url)) return imageCacheFirst(request, url);
      return fetch(request);
    })());
    return;
  }

  if (isOfflineJson(url)) {
    event.respondWith(
      fetch(request).catch(async () => (await matchOffline(url)) || Response.error())
    );
    return;
  }

  // Hashed build output — the filename changes whenever the contents do.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else — API JSON, video and audio streams — goes straight to the network.
  // Range requests in particular must never be answered from a cache.
});

// Covers and pages are cached by path with the auth token stripped, which is right for one
// person's browser but wrong across a sign-out: the next account to use this browser must
// not be served art for items it may not be allowed to see. The app posts this on logout.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'offline-changed') {
    event.waitUntil(rebuildOfflineIndex());
  }
  if (event.data?.type === 'clear-media-cache') {
    // Downloads go too: they belong to the account that made them.
    event.waitUntil(Promise.all([caches.delete(IMAGE_CACHE), caches.delete(OFFLINE_CACHE)]).then(rebuildOfflineIndex));
  }
});
