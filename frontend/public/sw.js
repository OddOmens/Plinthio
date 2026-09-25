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

const VERSION = 'v3';
const SHELL_CACHE = `plinthio-shell-${VERSION}`;
const IMAGE_CACHE = `plinthio-images-${VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, IMAGE_CACHE]);

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

  // Hashed build output — the filename changes whenever the contents do.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isImageEndpoint(url)) {
    // Drop the per-session token from the cache key (it would fragment the cache for no
    // benefit — the bytes are identical either way) but KEEP the `v` version parameter:
    // that's what distinguishes a stale placeholder from the poster that replaced it.
    const version = url.searchParams.get('v');
    const width = url.searchParams.get('w');
    const keyParams = new URLSearchParams();
    if (width) keyParams.set('w', width);
    if (version) keyParams.set('v', version);
    const keyUrl = keyParams.toString()
      ? `${url.origin}${url.pathname}?${keyParams.toString()}`
      : `${url.origin}${url.pathname}`;
    const key = new Request(keyUrl, { headers: request.headers });
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const hit = await cache.match(key);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(key, response.clone());
          trimCache(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
        }
        return response;
      })()
    );
    return;
  }

  // Everything else — API JSON, video and audio streams — goes straight to the network.
  // Range requests in particular must never be answered from a cache.
});

// Covers and pages are cached by path with the auth token stripped, which is right for one
// person's browser but wrong across a sign-out: the next account to use this browser must
// not be served art for items it may not be allowed to see. The app posts this on logout.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-media-cache') {
    event.waitUntil(caches.delete(IMAGE_CACHE));
  }
});
