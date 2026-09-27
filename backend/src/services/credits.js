import { fetchTmdbDetails, findTmdbId } from './externalMetadata.js';
import { cleanSearchTitle, parseMediaTitle } from './titleCleaner.js';
import { logger } from './logger.js';

// Cast, crew and studios for a movie or show, as shown on its title page. Fetched from TMDB
// the first time the page is opened and kept on the item, the same way the world rating is
// (see ratings.js). Credits barely change, so a month between refreshes is plenty; a miss
// is remembered for the same span so an unknown title isn't searched on every open.
export const CREDIT_TYPES = new Set(['movie', 'show', 'anime']);
const CREDITS_MAX_AGE_DAYS = 30;

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
    `SELECT 1 FROM items WHERE id = ? AND credits_checked_at > datetime('now', ?)`,
    [item.id, `-${CREDITS_MAX_AGE_DAYS} days`]
  );
  if (fresh) return parse(item.credits_json);

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
  return parse(row?.credits_json);
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
