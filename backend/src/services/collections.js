import { fetchTmdbCollection } from './externalMetadata.js';
import { ensureCredits } from './credits.js';
import { latestRequestStatuses } from './listMatching.js';
import { accessSql } from './visibility.js';
import { logger } from './logger.js';

// A film's whole TMDB collection — the films the library has and the ones it doesn't — for
// the collection page and a film's "More in …" row. Missing films are shown (greyed, with a
// Request button) unless the admin turns that off.
const SHOW_MISSING_KEY = 'collections_show_missing';
const COLLECTION_MAX_AGE_DAYS = 7;
const inFlight = new Map();

export async function getShowMissingFilms(db) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [SHOW_MISSING_KEY]);
  return row ? row.value !== 'false' : true;
}

export async function saveShowMissingFilms(db, value) {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [SHOW_MISSING_KEY, value ? 'true' : 'false']
  );
}

// The collection's films from the cache, or from TMDB when it's missing or a week old.
// A TMDB failure falls back to a stale copy rather than showing nothing.
async function loadCollection(db, collectionId) {
  const cached = await db.get('SELECT * FROM tmdb_collections WHERE id = ?', [collectionId]);
  const fresh = cached && await db.get(
    `SELECT 1 FROM tmdb_collections WHERE id = ? AND fetched_at > datetime('now', ?)`,
    [collectionId, `-${COLLECTION_MAX_AGE_DAYS} days`]
  );
  if (fresh) return { name: cached.name, parts: JSON.parse(cached.parts_json) };

  if (!inFlight.has(collectionId)) {
    inFlight.set(collectionId, (async () => {
      try {
        const data = await fetchTmdbCollection(collectionId);
        await db.run(
          `INSERT INTO tmdb_collections (id, name, parts_json, fetched_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, parts_json = excluded.parts_json, fetched_at = CURRENT_TIMESTAMP`,
          [collectionId, data.name, JSON.stringify(data.parts)]
        );
        return { name: data.name, parts: data.parts };
      } catch (err) {
        if (err.code !== 'MISSING_API_KEY') logger.warn('metadata', `TMDB collection ${collectionId} lookup failed: ${err.message}`);
        return cached ? { name: cached.name, parts: JSON.parse(cached.parts_json) } : null;
      }
    })().finally(() => inFlight.delete(collectionId)));
  }
  return inFlight.get(collectionId);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Every film in `film`'s TMDB collection, in release order. Each part has `itemId` when
 * the library has it (and this user can see it); a missing one has `requestStatus` and
 * `upcoming` (not released yet). Returns null when the film isn't in a collection or
 * nothing is known about it.
 */
export async function getFilmCollection(db, film, user) {
  if (film.media_type !== 'movie') return null;
  const credits = await ensureCredits(db, film);
  if (!credits?.collectionId) return null;
  const collection = await loadCollection(db, credits.collectionId);
  if (!collection?.parts?.length) return null;

  // The library's copies: by TMDB id first, then by title + year for films matched before
  // TMDB ids were kept.
  const owned = await db.all(
    `SELECT i.id, i.title, i.release_date, i.tmdb_id, i.library_id FROM items i
     WHERE i.media_type = 'movie' AND i.extra_type IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM item_visibility v WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
     )${accessSql(user, 'i')}`,
    [user.id]
  );
  // Prefer a copy in the film's own library when the same film sits in several.
  owned.sort((a, b) => (b.library_id === film.library_id) - (a.library_id === film.library_id));
  const byTmdb = new Map();
  const byTitleYear = new Map();
  for (const it of owned) {
    if (it.tmdb_id && !byTmdb.has(it.tmdb_id)) byTmdb.set(it.tmdb_id, it.id);
    const key = `${norm(it.title)}:${(it.release_date || '').slice(0, 4)}`;
    if (!byTitleYear.has(key)) byTitleYear.set(key, it.id);
  }

  const showMissing = await getShowMissingFilms(db);
  const today = new Date().toISOString().slice(0, 10);
  const parts = collection.parts.map((p) => ({
    ...p,
    itemId: byTmdb.get(p.tmdbId) || byTitleYear.get(`${norm(p.title)}:${(p.releaseDate || '').slice(0, 4)}`) || null
  }));
  // The film being viewed is always in it, even if TMDB's ids and ours disagree.
  if (!parts.some((p) => p.itemId === film.id)) {
    const self = parts.find((p) => p.tmdbId === film.tmdb_id);
    if (self) self.itemId = film.id;
  }

  const missing = parts.filter((p) => !p.itemId);
  const statuses = await latestRequestStatuses(db, missing.map((p) => ({ source: 'tmdb', external_id: p.tmdbId })));
  for (const p of missing) {
    p.requestStatus = statuses.get(`tmdb:${p.tmdbId}`) || null;
    p.upcoming = !p.releaseDate || p.releaseDate > today;
  }

  return {
    id: credits.collectionId,
    name: collection.name || credits.collection,
    showMissing,
    parts: showMissing ? parts : parts.filter((p) => p.itemId)
  };
}
