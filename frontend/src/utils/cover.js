import { getMediaToken } from './mediaToken';
// Covers are served `immutable`, but the art behind an id can change (a scan or an upload),
// so the URL carries a version derived from updated_at.
export function coverVersion(item) {
  const stamp = item?.updated_at || item?.cover_path || '';
  // Timestamps and filenames both reduce to a short, stable token.
  return String(stamp).replace(/\D/g, '').slice(-12) || '0';
}

export function coverUrl(item, { width, raw = false } = {}) {
  if (!item?.id) return '';

  const token = getMediaToken() || '';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (width) params.set('w', String(width));
  if (raw) params.set('raw', 'true');
  params.set('v', coverVersion(item));

  return `/api/media/cover/${item.id}?${params.toString()}`;
}

// A frame from the video itself. If the server can't grab one the image errors and the
// caller falls back to coverUrl().
export function stillUrl(item) {
  if (!item?.id) return '';
  const params = new URLSearchParams();
  const token = getMediaToken() || '';
  if (token) params.set('token', token);
  params.set('v', coverVersion(item));
  return `/api/media/still/${item.id}?${params.toString()}`;
}

// A book's own file (EPUB, PDF …): opened in a new tab, or handed to the e-book reader.
export function bookFileUrl(id) {
  return `/api/media/book/${id}/file?token=${getMediaToken()}`;
}

// The server's intro clip; `version` changes whenever an admin uploads a new one.
export function introUrl(version) {
  const params = new URLSearchParams({ v: version || '1' });
  const token = getMediaToken();
  if (token) params.set('token', token);
  return `/api/media/intro?${params}`;
}
