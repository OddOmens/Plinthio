import { getDb } from '../config/database.js';
import { fetchTmdbDetails, findTmdbId, getTmdbApiKey } from './externalMetadata.js';
import { cleanSearchTitle, parseMediaTitle } from './titleCleaner.js';
import { logger } from './logger.js';

// Cast, crew and studios for a movie or show, as shown on its title page. Fetched from TMDB
// the first time the page is opened and kept on the item, the same way the world rating is
// (see ratings.js). Credits barely change, so a month between refreshes is plenty; a miss
// is remembered for the same span so an unknown title isn't searched on every open.
export const CREDIT_TYPES = new Set(['movie', 'show', 'anime']);
const CREDITS_MAX_AGE_DAYS = 30;
// A film's credits cached before the collection was recorded count as stale, so the film
// still gets grouped (json_type is NULL for a missing key, 'null' for a known-empty one).
const HAS_COLLECTION_FIELD = `(media_type != 'movie' OR credits_json IS NULL OR json_type(credits_json, '$.collectionId') IS NOT NULL)`;
// Likewise credits cached before the pause-screen facts were kept.
const HAS_FACTS_FIELD = `(credits_json IS NULL OR json_type(credits_json, '$.keywords') IS NOT NULL)`;
// And a show's credits cached before its season posters were.
const HAS_SEASONS_FIELD = `(media_type = 'movie' OR credits_json IS NULL OR json_type(credits_json, '$.seasons') IS NOT NULL)`;

// Episodes of one show share the show's credits, so opening several at once (or one from
// two tabs) collapses into a single lookup.
const inFlight = new Map();

function parse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

/**
 * Returns the item's credits, looking them up first if they're missing or stale. Never
 * throws — no key or a TMDB outage just means no credits this time. Returns null when
 * there are none.
 */
export async function ensureCredits(db, item) {
  if (!CREDIT_TYPES.has(item.media_type)) return null;

  const fresh = await db.get(
    `SELECT 1 FROM items WHERE id = ? AND credits_checked_at > datetime('now', ?) AND ${HAS_COLLECTION_FIELD} AND ${HAS_FACTS_FIELD} AND ${HAS_SEASONS_FIELD}`,
    [item.id, `-${CREDITS_MAX_AGE_DAYS} days`]
  );
  if (fresh) return withCollection(db, item, parse(item.credits_json));

  const isEpisode = item.media_type !== 'movie' && item.series;
  const key = `${item.media_type}:${isEpisode ? `series:${item.library_id}:${item.series}` : item.id}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, (async () => {
      let tmdbId = item.tmdb_id;
      if (!tmdbId && isEpisode) {
        // Another episode may already know which show this is (a match sets it on one).
        const known = await db.get(
          `SELECT tmdb_id FROM items WHERE media_type = ? AND library_id = ? AND series = ? AND tmdb_id IS NOT NULL LIMIT 1`,
          [item.media_type, item.library_id, item.series]
        );
        tmdbId = known?.tmdb_id || null;
      }

      let details = null;
      try {
        if (!tmdbId) {
          const rawTitle = isEpisode ? item.series : item.title;
          const query = cleanSearchTitle(rawTitle);
          if (!query) return;
          const year = isEpisode ? null : (item.release_date ? item.release_date.slice(0, 4) : parseMediaTitle(rawTitle).year);
          tmdbId = await findTmdbId(item.media_type, query, year);
        }
        if (tmdbId) details = await fetchTmdbDetails(tmdbId, item.media_type);
      } catch (err) {
        // No key, or TMDB unreachable: leave checked_at alone so a later open retries.
        if (err.code !== 'MISSING_API_KEY') {
          logger.warn('media', `TMDB credits lookup failed for "${item.series || item.title}": ${err.message}`);
        }
        return;
      }

      const params = [details ? JSON.stringify(details) : null, details?.tmdbId || tmdbId || null];
      if (isEpisode) {
        await db.run(
          `UPDATE items SET credits_json = ?, tmdb_id = ?, credits_checked_at = CURRENT_TIMESTAMP
           WHERE media_type = ? AND library_id = ? AND series = ?`,
          [...params, item.media_type, item.library_id, item.series]
        );
      } else {
        await db.run(
          `UPDATE items SET credits_json = ?, tmdb_id = ?, credits_checked_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...params, item.id]
        );
      }
    })().finally(() => inFlight.delete(key)));
  }
  await inFlight.get(key);

  const row = await db.get('SELECT credits_json FROM items WHERE id = ?', [item.id]);
  return withCollection(db, item, parse(row?.credits_json));
}

// A film not yet in a collection joins its TMDB one (if the library has two of it).
async function withCollection(db, item, credits) {
  if (item.media_type === 'movie' && !item.series && credits?.collection) {
    await assignCollection(db, item.library_id, credits.collection);
  }
  return credits;
}

/**
 * Groups a library's films into their TMDB collection ("Shrek Collection") once it holds
 * at least two of them — a lone film stays a lone film rather than a one-film collection.
 * Only films with no collection yet are touched, so one set by hand is kept.
 */
export async function assignCollection(db, libraryId, collection) {
  const films = await db.all(
    `SELECT id, series FROM items
     WHERE library_id = ? AND media_type = 'movie' AND extra_type IS NULL
       AND json_extract(credits_json, '$.collection') = ?`,
    [libraryId, collection]
  );
  if (films.length < 2) return;
  const loose = films.filter((f) => !f.series).map((f) => f.id);
  if (!loose.length) return;
  await db.run(
    `UPDATE items SET series = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${loose.map(() => '?').join(', ')})`,
    [collection, ...loose]
  );
  logger.info('metadata', `Grouped ${loose.length} film(s) into "${collection}"`);
}

// ─── Background backfill ─────────────────────────────────────────────────────
// Films get their credits (and so their collection) when their page is first opened; this
// fills in the rest after startup and after each scan, so collections appear on the shelf
// without opening every film. One lookup at a time, spaced out, and only with a TMDB key.
const BACKFILL_SPACING_MS = 400;
let backfillRunning = false;

export async function backfillMovieCredits() {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    if (!await getTmdbApiKey()) return;
    const db = await getDb();
    const films = await db.all(
      `SELECT * FROM items WHERE media_type = 'movie' AND extra_type IS NULL
         AND (credits_checked_at IS NULL OR NOT ${HAS_COLLECTION_FIELD})`
    );
    for (const film of films) {
      await ensureCredits(db, film);
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_SPACING_MS));
    }
    if (films.length) logger.info('metadata', `Looked up credits for ${films.length} film(s)`);
  } catch (err) {
    logger.warn('metadata', `Credits backfill stopped: ${err.message}`);
  } finally {
    backfillRunning = false;
  }
}

/**
 * After a metadata match: remember which TMDB title it is and let the next page view
 * refetch the credits for it. For an episode that's the whole show.
 */
export async function resetCredits(db, item, tmdbId) {
  if (!CREDIT_TYPES.has(item.media_type) || !tmdbId) return;
  const isEpisode = item.media_type !== 'movie' && item.series;
  if (isEpisode) {
    await db.run(
      `UPDATE items SET tmdb_id = ?, credits_checked_at = NULL WHERE media_type = ? AND library_id = ? AND series = ?`,
      [String(tmdbId), item.media_type, item.library_id, item.series]
    );
  } else {
    await db.run('UPDATE items SET tmdb_id = ?, credits_checked_at = NULL WHERE id = ?', [String(tmdbId), item.id]);
  }
}
