import { Headphones, FileImage, Book, Film, Tv, Sparkles } from '@lucide/vue';
import { t, d, n } from '../i18n';

// Shared by the Settings and Admin sections: how a media type is named and drawn, and how
// dates, sizes and durations read. Labels are getters so they follow the current language
// (spreading an entry copies today's wording).

const mediaType = (id, icon) => ({
  icon,
  get label() { return t(`settings.mediaTypes.${id}.label`); },
  get desc() { return t(`settings.mediaTypes.${id}.desc`); }
});
export const MEDIA_TYPE_INFO = {
  movie: mediaType('movie', Film),
  show: mediaType('show', Tv),
  anime: mediaType('anime', Sparkles),
  book: mediaType('book', Book),
  manga: mediaType('manga', FileImage),
  audiobook: mediaType('audiobook', Headphones)
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
  const date = parseServerDate(value);
  return date ? d(date, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export function formatDateTime(value) {
  const date = parseServerDate(value);
  return date ? d(date, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

export function formatFullDateTime(value) {
  const date = parseServerDate(value);
  return date ? d(date, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (!bytes) return t('settings.format.size', { value: n(0), unit: t('settings.format.units.B') });
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return t('settings.format.size', { value: n(bytes / Math.pow(1024, i), ONE_DECIMAL), unit: t(`settings.format.units.${units[i]}`) });
}

export function formatDurationShort(seconds) {
  if (!seconds) return t('settings.format.seconds', { value: n(0) });
  if (seconds < 60) return t('settings.format.seconds', { value: n(seconds) });
  const mins = Math.round(seconds / 60);
  if (mins < 60) return t('settings.format.minutes', { value: n(mins) });
  return t('settings.format.hours', { value: n(seconds / 3600, ONE_DECIMAL) });
}

export function formatHours(seconds) {
  if (!seconds) return t('settings.format.hours', { value: n(0) });
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const minutes = t('settings.format.minutes', { value: n(m) });
  return h ? t('settings.format.hoursMinutes', { hours: t('settings.format.hours', { value: n(h) }), minutes }) : minutes;
}
