// Small helpers shared by the Live TV screens (views/LiveView.vue, views/LivePlayerView.vue).
// Times always go through d() so the guide follows the reader's language and clock
// (24-hour for en-GB, de, fr…; 12-hour for en-US).
import { ref, onMounted, onUnmounted } from 'vue';
import { d } from '../../i18n';
import { getMediaToken } from '../../utils/mediaToken';

export function clock(ms) {
  return d(ms, { hour: 'numeric', minute: '2-digit' });
}

export function timeRange(start, stop) {
  return `${clock(start)} – ${clock(stop)}`;
}

// 0–100: how far through [start, stop) `now` is.
export function progressPercent(now, start, stop) {
  if (!start || !stop || stop <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (stop - start)) * 100));
}

export function minutesLeft(now, stop) {
  return Math.max(1, Math.ceil((stop - now) / 60000));
}

// "BBC One" → "BO", "CNN" → "CN", "3sat" → "3S". Shown when a channel has no logo, or its
// logo won't load.
export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// A logo served by Plinthio itself (under /api/media) needs the media token, like a cover.
export function logoUrl(logo) {
  if (!logo || typeof logo !== 'string') return '';
  if (logo.startsWith('/api/media/')) {
    const token = getMediaToken();
    return token ? `${logo}${logo.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : logo;
  }
  return /^(https?:)?\/\//i.test(logo) || logo.startsWith('/') ? logo : '';
}

// The programme on air at `now` and the one after it, from a channel's schedule.
export function nowAndNext(programmes, now) {
  const list = programmes || [];
  const i = list.findIndex((p) => p.start <= now && now < p.stop);
  if (i >= 0) return { now: list[i], next: list[i + 1] || null };
  return { now: null, next: list.find((p) => p.start > now) || null };
}

// A list item's programme on air at `now`. Between refreshes its "now" can run out; its
// "next" takes over until the next fetch brings the schedule up to date.
export function airingNow(ch, now) {
  if (ch?.now && ch.now.start <= now && now < ch.now.stop) return ch.now;
  if (ch?.next && ch.next.start <= now && now < ch.next.stop) return ch.next;
  return null;
}

export function upNextAfter(ch, now) {
  return ch?.next && ch.next.start > now ? ch.next : null;
}

// The current time, ticking every `everyMs` — enough to move progress bars and the
// guide's "now" line without a re-render every second.
export function useNow(everyMs = 30000) {
  const now = ref(Date.now());
  let timer = null;
  const tick = () => { now.value = Date.now(); };
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  onMounted(() => {
    timer = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', onVisible);
  });
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
  return now;
}
