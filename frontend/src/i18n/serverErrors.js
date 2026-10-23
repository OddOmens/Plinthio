// The server answers in English. Its errors carry a Plinthio code (backend/src/errors.js) and
// either the catalog's own message or one written for that spot; both are listed in
// locales/<lang>/serverErrors.json, so the web app can show them in the reader's language:
//   codes.P107.message     — the catalog message for a code
//   messages.<key>         — every fixed message a route sends, matched on its English text
//   patterns.<key>         — the few built at runtime ("Backup failed: {reason}")
// Anything not listed (a new message, an admin-only detail) stays in English rather than
// being lost. Regenerate the English file from the server's catalog when codes change.
import { t, te, locale, DEFAULT_LANGUAGE, englishNamespace } from './index';

let byText = null;
let patterns = null;

function tables() {
  if (byText) return;
  const en = englishNamespace('serverErrors');
  byText = new Map(Object.entries(en.messages || {}).map(([key, text]) => [text, key]));
  patterns = Object.entries(en.patterns || {}).map(([key, template]) => {
    const names = [];
    const source = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const name = part.match(/^\{(\w+)\}$/)?.[1];
        if (name) { names.push(name); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { key, names, regex: new RegExp(`^${source}$`) };
  });
}

// A media type the server names in English ("movies") becomes the reader's word for it.
function localParam(name, value) {
  if (name !== 'type') return value;
  const type = value.replace(/s$/, '');
  return te(`common.mediaTypes.${type}`) ? t(`common.mediaTypes.${type}`).toLowerCase() : value;
}

// `text` is what the server sent, `code` its Plinthio code (if any).
export function translateServerMessage(text, code) {
  if (typeof text !== 'string' || !text || locale.value === DEFAULT_LANGUAGE) return text;
  tables();
  const catalog = code && englishNamespace('serverErrors').codes?.[code];
  if (catalog && catalog.message === text) return t(`serverErrors.codes.${code}.message`);
  const key = byText.get(text);
  if (key) return t(`serverErrors.messages.${key}`);
  for (const { key: patternKey, names, regex } of patterns) {
    const match = text.match(regex);
    if (match) {
      const params = Object.fromEntries(names.map((name, i) => [name, localParam(name, match[i + 1])]));
      return t(`serverErrors.patterns.${patternKey}`, params);
    }
  }
  return text;
}

// An entry from /api/errors with its title, meaning and fix in the reader's language.
export function localizeErrorEntry(entry) {
  const field = (name) => (te(`serverErrors.codes.${entry.code}.${name}`) ? t(`serverErrors.codes.${entry.code}.${name}`) : entry[name]);
  return { ...entry, title: field('title'), meaning: field('meaning'), fix: field('fix') };
}
