import { getMediaToken } from './mediaToken';
// Cover URLs carry a version derived from the item's updated_at.
//
// Covers are served `immutable` with a year-long max-age, which is right for the bytes but
// wrong for the URL: the artwork behind `/api/media/cover/<id>` genuinely does change — a
// scan replaces a placeholder with a real poster, or an editor uploads their own. Without a
// version in the URL the browser (and the service worker) keep serving whatever they cached
// first, so a library that once rendered blank stays blank until the cache ages out.
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
