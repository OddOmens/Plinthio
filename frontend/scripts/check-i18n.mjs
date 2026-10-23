// Checks the translations: every language has exactly English's keys, keeps the same
// {placeholders}, and every t('…') key the code uses exists in English.
//   node scripts/check-i18n.mjs            → all namespaces
//   node scripts/check-i18n.mjs title docs → only those
// Exits 1 on any problem, so CI catches a half-finished translation.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const localesDir = join(root, 'locales');
const only = process.argv.slice(2);
const problems = [];

const languages = readdirSync(localesDir).filter((d) => statSync(join(localesDir, d)).isDirectory());
const namespaces = readdirSync(join(localesDir, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .filter((ns) => !only.length || only.includes(ns));

const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const isPlural = (v) => v && typeof v === 'object' && 'other' in v && Object.keys(v).every((k) => PLURAL.has(k));

function flatten(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPlural(value)) out[path] = value;
    else if (value && typeof value === 'object') flatten(value, path, out);
    else problems.push(`${path}: not a string, plural object or group`);
  }
  return out;
}

// The plural forms each language must give: whatever Intl.PluralRules can pick for it,
// except the "many" that French, Spanish, Italian and Portuguese use only for round
// millions — "other" reads fine there. Polish needs one/few/many/other; Japanese only other.
const ROUND_MILLIONS_MANY = new Set(['fr', 'es', 'it', 'pt']);
function requiredPluralForms(lang) {
  return new Intl.PluralRules(lang).resolvedOptions().pluralCategories
    .filter((c) => !(c === 'many' && ROUND_MILLIONS_MANY.has(lang)));
}

function placeholders(value) {
  const text = typeof value === 'string' ? value : Object.values(value).join(' ');
  return [...new Set(text.match(/\{\w+\}/g) || [])].sort().join(' ');
}

function read(lang, ns) {
  const file = join(localesDir, lang, `${ns}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${lang}/${ns}.json: ${err.code === 'ENOENT' ? 'missing' : err.message}`);
    return null;
  }
}

const english = {};
for (const ns of namespaces) {
  const en = read('en', ns);
  if (!en) continue;
  const flat = flatten(en);
  for (const [k, v] of Object.entries(flat)) english[`${ns}.${k}`] = v;
  for (const lang of languages.filter((l) => l !== 'en')) {
    const other = read(lang, ns);
    if (!other) continue;
    const theirs = flatten(other);
    for (const key of Object.keys(flat)) {
      if (!(key in theirs)) problems.push(`${lang}/${ns}: missing ${key}`);
      else if (placeholders(theirs[key]) !== placeholders(flat[key])) {
        problems.push(`${lang}/${ns}: ${key} placeholders ${placeholders(theirs[key]) || '(none)'} ≠ English ${placeholders(flat[key]) || '(none)'}`);
      } else if (isPlural(flat[key]) && isPlural(theirs[key])) {
        const missing = requiredPluralForms(lang).filter((form) => !(form in theirs[key]));
        if (missing.length) problems.push(`${lang}/${ns}: ${key} needs plural form(s) ${missing.join(', ')}`);
      }
    }
    for (const key of Object.keys(theirs)) {
      if (!(key in flat)) problems.push(`${lang}/${ns}: extra key ${key} (not in English)`);
    }
  }
}

// Keys used in code. Only literal keys can be checked; t(`x.${y}`) is skipped.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === 'locales' || entry === 'i18n') continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(vue|js)$/.test(entry)) out.push(path);
  }
  return out;
}
const used = /(?:\$t|\bt|\$te|\bte)\(\s*['"]([\w.-]+)['"]|keypath="([\w.-]+)"/g;
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(used)) {
    const key = m[1] || m[2];
    const ns = key.split('.')[0];
    if (only.length && !only.includes(ns)) continue;
    if (!(key in english) && !Object.keys(english).some((k) => k.startsWith(`${key}.`))) {
      problems.push(`${file.slice(root.length + 1)}: uses unknown key ${key}`);
    }
  }
}

// Server messages: serverErrors.json mirrors the backend's catalog, and every fixed message
// it lists must still be sent somewhere, so an edited server message can't silently lose its
// translations. (frontend/src/i18n/serverErrors.js explains the file.)
if (!only.length || only.includes('serverErrors')) {
  const backend = join(root, '..', '..', 'backend', 'src');
  const { ERROR_CODES } = await import(join(backend, 'errors.js'));
  const en = JSON.parse(readFileSync(join(localesDir, 'en', 'serverErrors.json'), 'utf8'));
  for (const [code, entry] of Object.entries(ERROR_CODES)) {
    for (const field of ['title', 'message', 'meaning', 'fix']) {
      if (en.codes?.[code]?.[field] !== entry[field]) problems.push(`en/serverErrors: codes.${code}.${field} differs from backend/src/errors.js`);
    }
  }
  for (const code of Object.keys(en.codes || {})) {
    if (!ERROR_CODES[code]) problems.push(`en/serverErrors: codes.${code} is not in backend/src/errors.js`);
  }
  const sources = walk(backend).map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const [key, text] of Object.entries(en.messages || {})) {
    const quoted = [`'${text.replace(/'/g, "\\'")}'`, `"${text}"`, `'${text}'`];
    if (!quoted.some((q) => sources.includes(q))) problems.push(`en/serverErrors: messages.${key} is no longer sent by the server ("${text}")`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`i18n OK — ${namespaces.length} namespace(s), ${Object.keys(english).length} messages, ${languages.length} languages.`);
