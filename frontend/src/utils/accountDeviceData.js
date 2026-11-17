// What one account leaves on a device (downloads, cached media, queued progress) and how
// it's removed: on sign-out, a server-ended session, or a different account signing in.

const OWNER_KEY = 'plinthio_device_owner';

// Owner of this device's downloads. Separate from plinthio_user so it survives an expired
// session and a different account signing in can be told from the same one returning.
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

// Done here as well as in the worker, in case no worker controls the page.
async function clearOfflineMediaCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-media-cache' });
  } catch (e) {
    // No service worker.
  }
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(names.filter(MEDIA_CACHES).map((n) => caches.delete(n)));
    navigator.serviceWorker?.controller?.postMessage({ type: 'offline-changed' });
  } catch (e) {
    // Cache API unavailable (plain HTTP): nothing was cached.
  }
}

// Resolves once the caches are gone.
export function clearAccountDeviceData() {
  for (const key of ['plinthio_downloads', 'plinthio_progress_queue', 'plinthio_reader', OWNER_KEY]) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }
  return clearOfflineMediaCache();
}

// Clears data left by another (or unrecorded) account before `userId` uses the device.
// `fallbackOwner` is plinthio_user's id, for data left before the owner note existed.
export function claimDeviceData(userId, fallbackOwner = null) {
  if (!userId) return;
  const owner = deviceDataOwner() || fallbackOwner || null;
  if (String(owner) !== String(userId)) clearAccountDeviceData();
  setDeviceDataOwner(userId);
}

// Reads the JWT's exp only; it doesn't verify the token.
export function tokenHasExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch (e) {
    // Unreadable: treat as ended rather than expired.
    return false;
  }
}
