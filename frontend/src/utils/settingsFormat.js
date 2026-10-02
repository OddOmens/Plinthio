import { Headphones, FileImage, Book, Film, Tv, Sparkles } from '@lucide/vue';

// Shared by the Settings and Admin sections: how a media type is named and drawn, and how
// dates, sizes and durations read.

export const MEDIA_TYPE_INFO = {
  movie: { label: 'Movies', desc: 'Feature films', icon: Film },
  show: { label: 'TV Shows', desc: 'Series and episodes', icon: Tv },
  anime: { label: 'Anime', desc: 'Anime series and films', icon: Sparkles },
  book: { label: 'Books', desc: 'EPUB, PDF and text', icon: Book },
  manga: { label: 'Manga & Comics', desc: 'CBZ, CBR and graphic novels', icon: FileImage },
  audiobook: { label: 'Audiobooks', desc: 'Spoken word and audio dramas', icon: Headphones }
};
export const MEDIA_TYPE_ORDER = ['movie', 'show', 'anime', 'book', 'manga', 'audiobook'];

export const mediaTypeLabel = (type) => MEDIA_TYPE_INFO[type]?.label || type;
export const mediaTypeIcon = (type) => MEDIA_TYPE_INFO[type]?.icon || Book;

// SQLite's CURRENT_TIMESTAMP is UTC but stored without a timezone marker
// ("YYYY-MM-DD HH:MM:SS"), which the JS Date constructor otherwise misreads as local time.
export function parseServerDate(value) {
  if (!value) return null;
  const iso = value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(iso);
}

export function formatDate(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export function formatDateTime(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

export function formatFullDateTime(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDurationShort(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function formatHours(seconds) {
  if (!seconds) return '0h';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h.toLocaleString()}h ${m}m` : `${m}m`;
}
