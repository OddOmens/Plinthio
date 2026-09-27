// The token used in media URLs (<img>, <video>, <track>, downloads). It is deliberately NOT
// the session token: the server only accepts it on /api/media/* and it expires within a
// day, so a URL that leaks via history, a proxy log or a copied link can't drive the API.
// The auth store keeps it fresh (see refreshSession / keepMediaTokenFresh).
const KEY = 'plinthio_media_token';

export function getMediaToken() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setMediaToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch (e) {
    // Storage unavailable (private mode) — media simply won't authenticate until it is.
  }
}
