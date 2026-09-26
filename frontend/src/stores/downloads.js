import { defineStore } from 'pinia';
import { getMediaToken } from '../utils/mediaToken';
import { coverUrl } from '../utils/cover';

// Offline downloads. Files are written into the service worker's 'plinthio-offline' cache
// under token-free keys (see public/sw.js offlineKey), which the worker then serves when
// the network isn't there. The list of what's downloaded — including each item's row, so
// the Downloads page can render and open it with no API — lives in localStorage.
//
// Video is intentionally not offered: files run to several GB, past what browsers will
// reliably grant a web app, and most need transcoding the server does on the fly.

const OFFLINE_CACHE = 'plinthio-offline';
const MANIFEST_KEY = 'plinthio_downloads';
const PAGE_CONCURRENCY = 4;
const COVER_WIDTHS = [180, 360, 720];

function loadManifest() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANIFEST_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveManifest(entries) {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries));
  } catch (e) {
    // Quota or private mode — the files are cached regardless; the list just won't persist.
  }
}

function notifyWorker() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'offline-changed' });
  } catch (e) {
    // No worker controlling the page yet — it rebuilds its index on next start anyway.
  }
}

// Must produce exactly the key the service worker computes for the same request.
function offlineKey(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const name of ['w', 'v']) {
    if (params[name] != null) url.searchParams.set(name, String(params[name]));
  }
  return url.toString();
}

export function downloadKind(item) {
  if (!item) return null;
  if (item.media_type === 'audiobook') return 'audio';
  if (item.media_type === 'manga') return 'pages';
  if (item.media_type === 'book') {
    // Comic archives shelved as books still read page-by-page.
    return ['cbz', 'cbr', 'cb7', 'zip', 'rar', '7z'].includes((item.format || '').toLowerCase()) ? 'pages' : 'file';
  }
  return null;
}

// Strip per-user progress so the stored copy is just "what this item is".
function storedItem(item) {
  const { current_time, current_page, progress_percent, is_finished, current_page_cfi, progress_updated_at, ...rest } = item;
  return { ...rest, current_time, current_page, progress_percent, is_finished, current_page_cfi };
}

export const useDownloadsStore = defineStore('downloads', {
  state: () => ({
    entries: loadManifest(),
    // id -> { received, total, done, error } for downloads in flight.
    active: {},
    usage: null,
    quota: null
  }),

  getters: {
    supported: () => typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator,
    list: (state) => Object.values(state.entries).sort((a, b) => (b.downloadedAt || '').localeCompare(a.downloadedAt || '')),
    totalBytes: (state) => Object.values(state.entries).reduce((sum, e) => sum + (e.bytes || 0), 0)
  },

  actions: {
    isDownloaded(id) {
      return !!this.entries[id];
    },

    isDownloading(id) {
      return !!this.active[id] && !this.active[id].error;
    },

    canDownload(item) {
      return this.supported && !!downloadKind(item);
    },

    async refreshUsage() {
      try {
        const estimate = await navigator.storage?.estimate?.();
        this.usage = estimate?.usage ?? null;
        this.quota = estimate?.quota ?? null;
      } catch (e) {
        this.usage = null;
      }
    },

    // Fetches `path` with the media token and writes it to the offline cache, streaming the
    // body through a counter instead of buffering it — an audiobook can be hundreds of MB.
    async putMedia(cache, id, path, params = {}, signal) {
      const url = new URL(path, window.location.origin);
      url.searchParams.set('token', getMediaToken());
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);

      const progress = this.active[id];
      const counter = new TransformStream({
        transform: (chunk, controller) => {
          if (progress) progress.received += chunk.byteLength;
          controller.enqueue(chunk);
        }
      });
      const headers = new Headers();
      for (const name of ['content-type', 'content-length']) {
        if (res.headers.get(name)) headers.set(name, res.headers.get(name));
      }
      const body = res.body ? res.body.pipeThrough(counter) : null;
      await cache.put(offlineKey(path, params), new Response(body, { status: 200, headers }));
      return parseInt(res.headers.get('content-length') || '0', 10);
    },

    // Small JSON the readers ask for on open (page count, chapters, reading direction,
    // bookmarks). Uses the session token in a header like the app's own API calls.
    async putJson(cache, path, signal) {
      const token = localStorage.getItem('plinthio_token');
      const res = await fetch(path, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return;
      await cache.put(offlineKey(path), res);
    },

    async download(item) {
      const kind = downloadKind(item);
      if (!kind || !this.supported || this.active[item.id]?.done === false) return;

      const controller = new AbortController();
      this.active[item.id] = { title: item.title, received: 0, total: item.file_size || 0, done: false, error: null, controller };
      // Ask the browser not to evict this under storage pressure (best-effort; Chrome
      // grants it to installed PWAs, Safari decides for itself).
      navigator.storage?.persist?.().catch(() => {});

      const cache = await caches.open(OFFLINE_CACHE);
      const { signal } = controller;
      const id = item.id;

      try {
        for (const width of COVER_WIDTHS) {
          const url = new URL(coverUrl(item, { width }), window.location.origin);
          await this.putMedia(cache, id, url.pathname, { w: width, v: url.searchParams.get('v') }, signal).catch(() => {});
        }

        if (kind === 'file') {
          await this.putMedia(cache, id, `/api/media/book/${id}/file`, {}, signal);
        } else if (kind === 'audio') {
          await this.putMedia(cache, id, `/api/media/stream/${id}`, {}, signal);
          await this.putJson(cache, `/api/items/${id}/chapters`, signal);
        } else {
          const pagesPath = `/api/media/manga/${id}/pages`;
          const token = localStorage.getItem('plinthio_token');
          const res = await fetch(pagesPath, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!res.ok) throw new Error(`Could not read page list (${res.status})`);
          const { totalPages = 0 } = await res.clone().json();
          await cache.put(offlineKey(pagesPath), res);
          this.active[id].pages = { done: 0, total: totalPages };

          let next = 0;
          const worker = async () => {
            while (next < totalPages) {
              const index = next++;
              await this.putMedia(cache, id, `/api/media/manga/${id}/page/${index}`, {}, signal);
              this.active[id].pages.done++;
            }
          };
          await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, totalPages) }, worker));
          if (item.library_id && item.series) {
            await this.putJson(cache, `/api/series/${item.library_id}/${encodeURIComponent(item.series)}/settings`, signal).catch(() => {});
          }
        }
        await this.putJson(cache, `/api/bookmarks/${id}`, signal).catch(() => {});

        this.entries[id] = {
          id,
          kind,
          item: storedItem(item),
          bytes: this.active[id].received,
          downloadedAt: new Date().toISOString()
        };
        saveManifest(this.entries);
        delete this.active[id];
        notifyWorker();
        this.refreshUsage();
      } catch (err) {
        await this.purge(id);
        if (err.name === 'AbortError') {
          delete this.active[id];
        } else {
          this.active[id].error = err.message || 'Download failed';
          this.active[id].done = true;
        }
      }
    },

    cancel(id) {
      this.active[id]?.controller?.abort();
    },

    dismissError(id) {
      delete this.active[id];
    },

    // Every cached URL for an item has the item id as a path segment.
    async purge(id) {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        const keys = await cache.keys();
        await Promise.all(keys.filter((req) => new URL(req.url).pathname.split('/').includes(id)).map((req) => cache.delete(req)));
      } catch (e) {
        // Cache API unavailable — nothing was stored.
      }
    },

    async remove(id) {
      await this.purge(id);
      delete this.entries[id];
      saveManifest(this.entries);
      notifyWorker();
      this.refreshUsage();
    },

    // Keep the stored row's progress roughly current, so reopening offline resumes near
    // where the reader actually was.
    updateStoredProgress(id, patch) {
      if (!this.entries[id]) return;
      this.entries[id].item = { ...this.entries[id].item, ...patch };
      saveManifest(this.entries);
    },

    // Sign-out: the service worker drops the files (see auth logout); this drops the list.
    forgetAll() {
      this.entries = {};
      this.active = {};
      try { localStorage.removeItem(MANIFEST_KEY); } catch (e) { /* ignore */ }
    }
  }
});
