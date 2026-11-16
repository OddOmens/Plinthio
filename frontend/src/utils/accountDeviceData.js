// What one account leaves on a device, and how it's removed. Shared by the auth store
// (sign-out, a different or unknown account signing in) and the API client (a session the
// server ended).

const OWNER_KEY = 'plinthio_device_owner';

// Which account the downloads and cached media on this device belong to. Kept apart from
// plinthio_user (which goes with the session) so it survives a session that expired, and a
// different account signing in afterwards can be told apart from the same one coming back.
export function deviceDataOwner() {
  try { return localStorage.getItem(OWNER_KEY) || null; } catch (e) { return null; }
}

export function setDeviceDataOwner(userId) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, String(userId));
    else localStorage.removeItem(OWNER_KEY);
  } catch (e) { /* storage unavailable */ }
}

const MEDIA_CACHES = (name) => name === 'plinthio-offline' || name.startsWith('plinthio-images-');

// Drops cached art and downloads. Done by the page as well as the service worker, in case no
// worker controls the page.
async function clearOfflineMediaCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-media-cache' });
  } catch (e) {
    // No service worker (unsupported browser, or a plain HTTP origin).
  }
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(names.filter(MEDIA_CACHES).map((n) => caches.delete(n)));
    // Let a running worker rebuild its index of what's downloaded.
    navigator.serviceWorker?.controller?.postMessage({ type: 'offline-changed' });
  } catch (e) {
    // Cache API unavailable (plain HTTP): nothing was cached.
  }
}

// Its downloads, its queued offline progress, the manga reader's per-device memory of
// series it has read, and the note of whose they were. Resolves once the caches are gone.
export function clearAccountDeviceData() {
  for (const key of ['plinthio_downloads', 'plinthio_progress_queue', 'plinthio_reader', OWNER_KEY]) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }
  return clearOfflineMediaCache();
}

// Called as a session is stored: device data left by another account, or by an account
// nobody recorded, is cleared before `userId` can use it. Better to drop a download than to
// hand it to someone else. `fallbackOwner` is the account in plinthio_user, for data left
// before the owner note existed.
export function claimDeviceData(userId, fallbackOwner = null) {
  if (!userId) return;
  const owner = deviceDataOwner() || fallbackOwner || null;
  if (String(owner) !== String(userId)) clearAccountDeviceData();
  setDeviceDataOwner(userId);
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
