// Token for media URLs. Not the session token: it only works on /api/media/* and expires
// within a day, so a leaked URL can't drive the API.
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
    // Storage unavailable (private mode).
  }
}
