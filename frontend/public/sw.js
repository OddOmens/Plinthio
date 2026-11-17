// Plinthio service worker. Caches:
//   shell    built app (hashed /assets/* and the HTML entry) — cache-first
//   images   covers and comic pages viewed — cache-first with a cap
//   offline  explicit downloads
// API JSON, video and audio always go to the network so they're never stale.

const VERSION = 'v5';
const SHELL_CACHE = `plinthio-shell-${VERSION}`;
const IMAGE_CACHE = `plinthio-images-${VERSION}`;
// Not versioned, so a worker update never throws away someone's downloads.
const OFFLINE_CACHE = 'plinthio-offline';
const CURRENT_CACHES = new Set([SHELL_CACHE, IMAGE_CACHE, OFFLINE_CACHE]);

// Roughly a couple of comic volumes' worth of pages.
const MAX_IMAGE_ENTRIES = 600;

const SHELL_URLS = ['/', '/manifest.json', '/icons/icon.svg', '/icons/logo.svg'];

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

// keys() returns insertion order, so trimming from the front drops the oldest entries.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

function isImageEndpoint(url) {
  // Content-addressed by item id and page index, so safe to keep.
  return /\/api\/media\/(cover|still)\//.test(url.pathname) ||
    /\/api\/media\/manga\/[^/]+\/page\//.test(url.pathname);
}

// Cache key without the per-session ?token= (keeping w/v), so a download made under one
// session still plays under the next. src/stores/downloads.js writes the same keys.
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

// JSON the readers fetch on open: network first, the downloaded copy only when offline.
function isOfflineJson(url) {
  return /^\/api\/(media\/manga\/[^/]+\/pages|items\/[^/]+\/chapters|series\/[^/]+\/[^/]+\/settings|bookmarks\/[^/]+|highlights\/[^/]+)$/.test(url.pathname);
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

// Keys actually downloaded, kept in memory so the fetch handler can decide synchronously to
// leave ordinary streaming alone (some browsers handle range requests through a worker poorly).
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
  const hit = await cache.match(offlineKey(url));
  if (hit || !url.searchParams.has('w') || !/\/api\/media\/manga\//.test(url.pathname)) return hit;
  // The reader asks for pages sized to the screen (?w=1080); a download stores the full-size
  // page without it, which serves just as well offline.
  return cache.match(`${url.origin}${url.pathname}`);
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

// Viewed (not downloaded) images. The key drops the session token but keeps `v`, which
// tells a stale placeholder from the poster that replaced it.
async function imageCacheFirst(request, url) {
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

  // Network first so a deployed update is picked up immediately; cached shell when offline.
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
    // Not downloaded and not a cached image type: let the browser handle it directly.
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

  // Everything else goes to the network; range requests must never come from a cache.
});

// Cached art is keyed without the token, so it's cleared on sign-out: the next account must
// not see art for items it may not be allowed to see.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'offline-changed') {
    event.waitUntil(rebuildOfflineIndex());
  }
  if (event.data?.type === 'clear-media-cache') {
    // Downloads go too: they belong to the account that made them.
    event.waitUntil(Promise.all([caches.delete(IMAGE_CACHE), caches.delete(OFFLINE_CACHE)]).then(rebuildOfflineIndex));
  }
});
