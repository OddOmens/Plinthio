// What one account leaves on a device, and how it's removed. Shared by the auth store
// (sign-out, a different account signing in) and the API client (a session the server ended).

// Asks the service worker to drop cached covers and comic pages, and the downloads. Cached
// art is keyed by path with the token stripped, so it must not outlive the session that
// fetched it.
function clearOfflineMediaCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-media-cache' });
  } catch (e) {
    // No service worker (unsupported browser, or a plain HTTP origin) — nothing cached.
  }
}

// Its downloads, its queued offline progress, and the manga reader's per-device memory of
// series it has read.
export function clearAccountDeviceData() {
  clearOfflineMediaCache();
  for (const key of ['plinthio_downloads', 'plinthio_progress_queue', 'plinthio_reader']) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }
}

// Whether a sign-in token has simply run out, going by the expiry time written inside it.
// Only the server can check a token is genuine; this just reads its date.
export function tokenHasExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch (e) {
    // Not a token we can read: treat it as ended rather than expired.
    return false;
  }
}
