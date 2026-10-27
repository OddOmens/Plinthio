import { fetchJson } from './providerHttp.js';
import { htmlToText, normalizeIsbn, normalizeLanguage } from './bookMetadata.js';

/**
 * Audible's catalog — free, no key, but not an official API: it's the one Audible's own apps
 * use (Audiobookshelf reads it too), so it could change without notice. It has the narrators,
 * series and number in it, publisher, blurb and cover. Details (the ISBN, tidier genres)
 * come from Audnexus, a free community service built on the same catalog. https://audnex.us
 */
const CACHE_MS = 30 * 60 * 1000;

// Audible keeps a catalog per country; the book's language (or the reader's) picks one.
export const AUDIBLE_REGIONS = {
  us: 'api.audible.com',
  uk: 'api.audible.co.uk',
  ca: 'api.audible.ca',
  au: 'api.audible.com.au',
  in: 'api.audible.in',
  de: 'api.audible.de',
  fr: 'api.audible.fr',
  it: 'api.audible.it',
  es: 'api.audible.es',
  jp: 'api.audible.co.jp'
};

function regionFor(language) {
  const [lang, country] = String(language || '').toLowerCase().split('-');
  if (lang === 'en') return { gb: 'uk', uk: 'uk', ca: 'ca', au: 'au', in: 'in' }[country] || 'us';
  return { de: 'de', fr: 'fr', it: 'it', es: 'es', ja: 'jp' }[lang] || 'us';
}

// Audible names languages in English words ("english").
const LANGUAGE_NAMES = {
  english: 'en', german: 'de', french: 'fr', spanish: 'es', italian: 'it', japanese: 'ja',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', chinese: 'zh', mandarin_chinese: 'zh', korean: 'ko',
  swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', russian: 'ru'
};

const names = (people) => (people || []).map((p) => p.name).filter(Boolean).join(', ') || null;
// Audible lists translators and editors among the authors, as "Ken Liu - translator".
const writers = (people) => names((people || []).filter((p) => !/\s-\s\S/.test(p.name || '')));

// Amazon image links carry a size ("…._SL500_.jpg"); without it they serve the original.
const fullSize = (url) => (url ? url.replace(/\._[A-Z0-9,_]+_(\.\w+)$/i, '$1') : null);

function audibleResult(product, region) {
  const series = (product.series || []).find((s) => s.title);
  const ladderNames = (product.category_ladders || []).flatMap((c) => (c.ladder || []).map((step) => step.name));
  return {
    source: 'audible',
    externalId: product.asin,
    region,
    title: product.title || 'Untitled',
    subtitle: product.subtitle || null,
    author: writers(product.authors),
    // Narrators, in the field that holds a manga's artists or a film's cast.
    artists: names(product.narrators),
    series: series?.title || null,
    seriesNumber: Number.parseFloat(series?.sequence) || null,
    releaseDate: product.release_date || null,
    overview: htmlToText(product.publisher_summary || product.merchandising_summary),
    genres: [...new Set(ladderNames.filter(Boolean))].slice(0, 6),
    themes: [],
    publisher: product.publisher_name || null,
    status: null,
    language: LANGUAGE_NAMES[String(product.language || '').toLowerCase()] || normalizeLanguage(product.language),
    coverUrl: fullSize(Object.values(product.product_images || {})[0])
  };
}

/** `terms` is free text or { title, author }. Adult titles are left out. */
export async function searchAudible(terms, { language } = {}) {
  const region = regionFor(language);
  const params = new URLSearchParams({
    num_results: '10',
    products_sort_by: 'Relevance',
    response_groups: 'contributors,product_desc,media,series,product_attrs,category_ladders'
  });
  if (typeof terms === 'string') params.set('keywords', terms);
  else {
    if (terms.title) params.set('title', terms.title);
    if (terms.author) params.set('author', terms.author);
  }
  const data = await fetchJson(`https://${AUDIBLE_REGIONS[region]}/1.0/catalog/products?${params}`, { cacheMs: CACHE_MS });
  return (data.products || []).filter((p) => p.asin && !p.is_adult_product).map((p) => audibleResult(p, region));
}

/** What Audnexus adds to a result: the ISBN, genres and tags, and a full-size cover. */
export async function fetchAudibleDetails(result) {
  try {
    const region = AUDIBLE_REGIONS[result.region] ? result.region : 'us';
    const book = await fetchJson(`https://api.audnex.us/books/${encodeURIComponent(result.externalId)}?region=${region}`, { cacheMs: CACHE_MS });
    const genres = (book.genres || []).filter((g) => g.type === 'genre').map((g) => g.name);
    const tags = (book.genres || []).filter((g) => g.type === 'tag').map((g) => g.name);
    return {
      ...result,
      isbn: result.isbn || normalizeIsbn(book.isbn),
      genres: genres.length ? genres : result.genres,
      themes: tags.length ? [...new Set(tags)].slice(0, 6) : result.themes,
      overview: result.overview || htmlToText(book.description || book.summary),
      coverUrl: book.image || result.coverUrl
    };
  } catch {
    return result;
  }
}
