import { lookupTmdbRating } from './externalMetadata.js';
import { cleanSearchTitle, parseMediaTitle } from './titleCleaner.js';
import { logger } from './logger.js';

// Admin display switches for the rating UI. Each defaults on; stored as 'true'/'false' in
// the settings table and served alongside the rest of the server customization.
export const RATING_SETTING_KEYS = {
  showPersonal: 'ratings_show_personal',
  showCommunity: 'ratings_show_community',
  showExternal: 'ratings_show_external'
};

export async function getRatingSettings(db) {
  const rows = await db.all(
    `SELECT key, value FROM settings WHERE key IN (${Object.values(RATING_SETTING_KEYS).map(() => '?').join(', ')})`,
    Object.values(RATING_SETTING_KEYS)
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const settings = {};
  for (const [name, key] of Object.entries(RATING_SETTING_KEYS)) {
    settings[name] = byKey.has(key) ? byKey.get(key) !== 'false' : true;
  }
  return settings;
}

export async function saveRatingSettings(db, updates) {
  for (const [name, key] of Object.entries(RATING_SETTING_KEYS)) {
    if (updates[name] === undefined) continue;
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, updates[name] ? 'true' : 'false']
    );
  }
}

// Only video has a world rating source today (TMDB). Books and manga fall back to Plinthio's
// own ratings alone.
export const EXTERNAL_RATING_TYPES = new Set(['movie', 'show', 'anime']);

// A title's TMDB score drifts slowly; a week between lookups keeps it current without
// querying TMDB every time someone opens a rating. Misses are remembered for the same span.
const EXTERNAL_RATING_MAX_AGE_DAYS = 7;

// Episodes of one show all share the show's score, so concurrent opens of several episodes
// (or the same movie from two tabs) collapse into a single TMDB request.
const inFlight = new Map();

/**
 * Fills in the item's TMDB score if it's missing or stale, and returns the item with the
 * current external_rating* columns. Never throws — a provider outage just means no world
 * rating is shown this time.
 */
export async function ensureExternalRating(db, item) {
  if (!EXTERNAL_RATING_TYPES.has(item.media_type)) return item;

  const fresh = await db.get(
    `SELECT 1 FROM items WHERE id = ? AND external_rating_checked_at > datetime('now', ?)`,
    [item.id, `-${EXTERNAL_RATING_MAX_AGE_DAYS} days`]
  );
  if (fresh) return item;

  const isEpisode = item.media_type !== 'movie' && item.series;
  const rawTitle = isEpisode ? item.series : item.title;
  const query = cleanSearchTitle(rawTitle);
  if (!query) return item;
  const year = item.release_date ? item.release_date.slice(0, 4) : parseMediaTitle(rawTitle).year;

  const key = `${item.media_type}:${isEpisode ? `series:${item.series}` : item.id}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, (async () => {
      let result;
      try {
        result = await lookupTmdbRating(item.media_type, query, isEpisode ? null : year);
      } catch (err) {
        // No key configured, or TMDB unreachable: leave checked_at alone so the next open
        // retries once the admin adds a key or the network comes back.
        if (err.code !== 'MISSING_API_KEY') {
          logger.warn('media', `TMDB rating lookup failed for "${query}": ${err.message}`);
        }
        return;
      }

      const params = [result?.rating ?? null, result?.votes ?? null, result ? 'tmdb' : null];
      if (isEpisode) {
        await db.run(
          `UPDATE items SET external_rating = ?, external_rating_votes = ?, external_rating_source = ?,
             external_rating_checked_at = CURRENT_TIMESTAMP
           WHERE media_type = ? AND series = ?`,
          [...params, item.media_type, item.series]
        );
      } else {
        await db.run(
          `UPDATE items SET external_rating = ?, external_rating_votes = ?, external_rating_source = ?,
             external_rating_checked_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [...params, item.id]
        );
      }
    })().finally(() => inFlight.delete(key)));
  }
  await inFlight.get(key);

  return db.get('SELECT * FROM items WHERE id = ?', [item.id]);
}

/**
 * The rating summary for one item as a given user sees it, honouring the admin's display
 * switches — a hidden section is omitted from the response, not just from the UI.
 */
export async function getRatingSummary(db, item, userId, settings) {
  const summary = { itemId: item.id, settings };

  if (settings.showPersonal) {
    const mine = await db.get('SELECT rating FROM user_ratings WHERE user_id = ? AND item_id = ?', [userId, item.id]);
    summary.userRating = mine?.rating ?? null;
  }

  if (settings.showCommunity) {
    const agg = await db.get(
      'SELECT AVG(rating) AS average, COUNT(*) AS count FROM user_ratings WHERE item_id = ?',
      [item.id]
    );
    summary.community = {
      average: agg.count > 0 ? Math.round(agg.average * 10) / 10 : null,
      count: agg.count
    };
  }

  if (settings.showExternal && EXTERNAL_RATING_TYPES.has(item.media_type)) {
    const withRating = await ensureExternalRating(db, item);
    summary.external = withRating?.external_rating != null
      ? {
          source: withRating.external_rating_source || 'tmdb',
          rating: Math.round(withRating.external_rating * 10) / 10,
          scale: 10,
          votes: withRating.external_rating_votes || 0
        }
      : null;
  }

  return summary;
}
