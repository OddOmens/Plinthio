// Plinthio's translations. Strings live in src/locales/<language>/<namespace>.json and are
// looked up as t('namespace.key.path'). English ships in the main bundle and is the
// fallback for anything a translation hasn't caught up with yet; the other languages load
// on demand, so nobody downloads five languages they never read.
//
// Messages use {name} placeholders. A message that depends on a number is an object keyed
// by plural category ({ "one": "{count} episode", "other": "{count} episodes" }), picked
// with Intl.PluralRules from params.count — Japanese and Korean only need "other".
//
// Hand-rolled rather than vue-i18n: it's a few dozen lines, and the Content-Security-Policy
// forbids the eval that vue-i18n's runtime message compiler can fall back on.
import { ref, shallowRef, computed } from 'vue';

// Matched on the browser's base language, so pt-PT gets Brazilian Portuguese and zh-TW gets
// Simplified Chinese rather than English. Each name is written in its own language.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português (Brasil)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '简体中文' }
];
export const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'plinthio_language';

function bundle(modules) {
  const out = {};
  for (const [file, messages] of Object.entries(modules)) {
    out[file.split('/').pop().replace(/\.json$/, '')] = messages;
  }
  return out;
}

const english = bundle(import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' }));
const lazy = import.meta.glob(['../locales/*/*.json', '!../locales/en/*.json'], { import: 'default' });

// language code → { namespace → messages }
const loaded = shallowRef({ en: english });
export const locale = ref(DEFAULT_LANGUAGE);

function isSupported(code) {
  return LANGUAGES.some((l) => l.code === code);
}

// 'auto' (or nothing) follows the browser: the first of its languages we have, else English.
export function resolveLanguage(choice) {
  if (choice && choice !== 'auto' && isSupported(choice)) return choice;
  const wanted = typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language]);
  for (const tag of wanted) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

async function load(code) {
  if (loaded.value[code]) return;
  const files = Object.entries(lazy).filter(([file]) => file.split('/').at(-2) === code);
  const modules = await Promise.all(files.map(async ([file, importer]) => [file, await importer()]));
  loaded.value = { ...loaded.value, [code]: bundle(Object.fromEntries(modules)) };
}

// The choice a device remembers before anyone signs in ('auto' or a language code).
export function storedLanguageChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'auto';
  } catch (e) {
    return 'auto';
  }
}

// Switches the whole UI. `choice` is 'auto' or a language code; it's remembered on this
// device so the sign-in page already speaks it. Saving it to the account is the caller's job.
export async function setLanguage(choice) {
  try {
    if (choice && choice !== 'auto') localStorage.setItem(STORAGE_KEY, choice);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Storage unavailable — the choice still applies until the page reloads.
  }
  const code = resolveLanguage(choice);
  try {
    await load(code);
  } catch (err) {
    console.error(`Couldn't load the ${code} translation:`, err);
    return;
  }
  locale.value = code;
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

function lookup(code, key) {
  const [namespace, ...path] = key.split('.');
  let node = loaded.value[code]?.[namespace];
  for (const part of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

const pluralRules = {};
function pluralCategory(code, count) {
  pluralRules[code] ||= new Intl.PluralRules(code);
  return pluralRules[code].select(count);
}

function format(message, params) {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name) => (params[name] ?? match).toString());
}

function pick(message, code, params) {
  if (message && typeof message === 'object') {
    const count = Number(params?.count);
    return message[pluralCategory(code, Number.isFinite(count) ? count : 0)] ?? message.other;
  }
  return message;
}

// t('title.play') → "Play"; t('title.episodes', { count: 3 }) → "3 episodes".
// Falls back to English, then to the key itself so a gap shows up rather than a blank.
export function t(key, params) {
  const code = locale.value;
  let message = pick(lookup(code, key), code, params);
  if (typeof message !== 'string' && code !== DEFAULT_LANGUAGE) {
    message = pick(lookup(DEFAULT_LANGUAGE, key), DEFAULT_LANGUAGE, params);
  }
  if (typeof message !== 'string') {
    if (import.meta.env.DEV) console.warn(`[i18n] missing message: ${key}`);
    return key;
  }
  return format(message, params);
}

// True when the key exists (in the current language or English) — for optional messages.
export function te(key) {
  return lookup(locale.value, key) !== undefined || lookup(DEFAULT_LANGUAGE, key) !== undefined;
}

// Dates and numbers use the browser's own regional variant when it's the same language
// (en-GB keeps its 24-hour clock and day-first dates, fr-CA its own), else the plain language.
function formatLocale() {
  const code = locale.value;
  const wanted = typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language]);
  return wanted.find((tag) => String(tag || '').toLowerCase().split('-')[0] === code) || code;
}

// Numbers and dates in the reader's language: n(1234) → "1,234" / "1 234" / "1.234".
export function n(value, options) {
  return new Intl.NumberFormat(formatLocale(), options).format(value);
}

export function d(value, options) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(formatLocale(), options).format(date);
}

// "3 days ago", "in 2 hours" — `value` in `unit`s, negative for the past.
export function relative(value, unit, options = { numeric: 'auto' }) {
  return new Intl.RelativeTimeFormat(formatLocale(), options).format(value, unit);
}

// A list joined the local way: ["A", "B", "C"] → "A, B and C" / "A、B、C".
export function list(items, options = { type: 'conjunction' }) {
  return new Intl.ListFormat(formatLocale(), options).format(items);
}

export function useI18n() {
  return { t, te, n, d, relative, list, locale, languages: LANGUAGES, setLanguage, current: computed(() => locale.value) };
}

export default {
  install(app) {
    app.config.globalProperties.$t = t;
    app.config.globalProperties.$te = te;
    app.config.globalProperties.$n = n;
    app.config.globalProperties.$d = d;
  }
};
