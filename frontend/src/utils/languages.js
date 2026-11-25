// Telling which language an audio or subtitle track is in. Files tag tracks in several ways
// ("eng", "en", "en-US", "English"), and the player needs one answer to compare with the
// viewer's own language.

// Languages offered for subtitles, as ISO 639-1 codes: the interface's own, then the rest
// A–Z by code. Kept in step with SUBTITLE_LANGUAGES in backend/src/routes/customization.js.
export const SUBTITLE_LANGUAGES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ja', 'ko', 'zh',
  'ar', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hu', 'id', 'no', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi'];

// Three-letter codes (ISO 639-2, both spellings where there are two) and English names.
const ALIASES = {
  en: ['eng', 'english'],
  de: ['ger', 'deu', 'german', 'deutsch'],
  es: ['spa', 'spanish', 'espanol', 'español', 'castilian'],
  fr: ['fre', 'fra', 'french', 'francais', 'français'],
  it: ['ita', 'italian', 'italiano'],
  nl: ['dut', 'nld', 'dutch', 'nederlands'],
  pl: ['pol', 'polish', 'polski'],
  pt: ['por', 'pob', 'portuguese', 'portugues', 'português', 'brazilian'],
  ja: ['jpn', 'japanese', 'jp'],
  ko: ['kor', 'korean'],
  zh: ['chi', 'zho', 'chinese', 'mandarin', 'cantonese', 'cmn', 'yue', 'chs', 'cht'],
  ar: ['ara', 'arabic'],
  cs: ['cze', 'ces', 'czech'],
  da: ['dan', 'danish'],
  el: ['gre', 'ell', 'greek'],
  fi: ['fin', 'finnish'],
  he: ['heb', 'hebrew', 'iw'],
  hi: ['hin', 'hindi'],
  hu: ['hun', 'hungarian'],
  id: ['ind', 'indonesian'],
  no: ['nor', 'nob', 'nno', 'norwegian', 'nb', 'nn'],
  ro: ['rum', 'ron', 'romanian'],
  ru: ['rus', 'russian'],
  sv: ['swe', 'swedish'],
  th: ['tha', 'thai'],
  tr: ['tur', 'turkish'],
  uk: ['ukr', 'ukrainian'],
  vi: ['vie', 'vietnamese']
};

const BY_TAG = new Map();
for (const [code, names] of Object.entries(ALIASES)) {
  BY_TAG.set(code, code);
  for (const name of names) BY_TAG.set(name, code);
}

/**
 * The two-letter code for a track's language tag, or null when it says nothing usable
 * (missing, "und", or a language this list doesn't know). "en-US" and "pt_BR" count as
 * their language.
 */
export function languageCode(tag) {
  const text = String(tag || '').trim().toLowerCase();
  if (!text || text === 'und' || text === 'unknown') return null;
  return BY_TAG.get(text) || BY_TAG.get(text.split(/[-_ ]/)[0]) || null;
}

/** Whether a track is in the given language (a two-letter code). */
export function isLanguage(track, code) {
  return !!code && languageCode(track?.language) === code;
}
