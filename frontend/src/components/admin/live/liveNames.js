// Names for the countries and languages Live TV channels carry, in the reader's language.
// The server sends ISO codes (country "ES", language "spa") plus an English name for each
// language; the browser's Intl.DisplayNames knows most of them in every UI language.
import { locale } from '../../../i18n';

const cache = {};
function displayNames(type) {
  const key = `${locale.value}:${type}`;
  if (!(key in cache)) {
    try {
      cache[key] = new Intl.DisplayNames(locale.value, { type, fallback: 'code' });
    } catch (e) {
      cache[key] = null;
    }
  }
  return cache[key];
}

// The public lists use "UK" where ISO says "GB".
const regionCode = (code) => {
  const upper = String(code || '').toUpperCase();
  return upper === 'UK' ? 'GB' : upper;
};

// "ES" → "Spain" / "Spanien"; a code the browser doesn't know stays as it is.
export function countryName(code) {
  const region = regionCode(code);
  if (!region) return '';
  try {
    const name = displayNames('region')?.of(region);
    if (name && name !== region) return name;
  } catch (e) {
    // Not a valid region code (e.g. "INT").
  }
  return String(code).toUpperCase();
}

// "ES" → 🇪🇸, from the two regional-indicator letters. Empty for anything that isn't two letters.
export function flagEmoji(code) {
  const region = regionCode(code);
  if (!/^[A-Z]{2}$/.test(region)) return '';
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// "spa" → "Spanish" / "Spanisch"; when the browser doesn't know the code, the server's
// English name, else the code.
export function languageName(code, englishName) {
  const lower = String(code || '').toLowerCase();
  if (!lower) return englishName || '';
  try {
    const name = displayNames('language')?.of(lower);
    if (name && name.toLowerCase() !== lower) return name;
  } catch (e) {
    // Not a valid language code.
  }
  return englishName || lower;
}
