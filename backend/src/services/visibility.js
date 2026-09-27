// Every listing endpoint (GET /items, series view, etc.) excludes items hidden for a
// user or hidden globally (user_id IS NULL = admin restrict). Any route that serves a
// raw file straight by item id must apply the same check, or hiding/restricting an item
// wouldn't actually stop someone who already has (or guesses) its id from accessing it
// directly.

// Parental controls. An item's effective rating is its own age_rating if set, else its
// series' rating (series_settings, keyed by library + series name). A restricted account
// sees only items at or below its max_age_rating; unrated items pass only if the account
// allows them.
export const AGE_RATINGS = ['Everyone', 'Teen', 'Mature', 'Explicit'];

export function ratingRank(rating) {
  const rank = AGE_RATINGS.indexOf(rating);
  return rank === -1 ? null : rank;
}

// SQL fragment (starting with AND) restricting `alias` rows to what `user` may see:
//   • never a title whose file has gone missing (kept for recovery, see missing_since)
//   • Kids Mode: only kids-safe libraries, series and titles
//   • parental controls: nothing above the account's age rating
// It carries no bind parameters — every interpolated value is an integer or a fixed string
// computed here, never user input — so it can be dropped into any existing query without
// disturbing that query's parameter order.
export function accessSql(user, alias = 'i') {
  let sql = ` AND ${alias}.missing_since IS NULL`;

  if (user && (user.kids_mode === 1 || user.kids_mode === true)) {
    sql += ` AND (
      EXISTS (SELECT 1 FROM libraries kl WHERE kl.id = ${alias}.library_id AND kl.kids_allowed = 1)
      OR EXISTS (
        SELECT 1 FROM kids_titles kt
        WHERE kt.item_id = ${alias}.id
           OR (kt.series IS NOT NULL AND kt.library_id = ${alias}.library_id AND kt.series = ${alias}.series)
      )
    )`;
  }

  const maxRank = ratingRank(user?.max_age_rating);
  if (maxRank !== null) {
    const unratedRank = user.allow_unrated === 0 || user.allow_unrated === false ? 99 : 0;
    const cases = AGE_RATINGS.map((r, idx) => `WHEN '${r}' THEN ${idx}`).join(' ');
    sql += ` AND (CASE COALESCE(NULLIF(${alias}.age_rating, ''), (
      SELECT ss.age_rating FROM series_settings ss
      WHERE ss.library_id = ${alias}.library_id AND ss.series_name = ${alias}.series
    )) ${cases} ELSE ${unratedRank} END) <= ${maxRank}`;
  }
  return sql;
}

// Earlier name, kept so existing callers (and work on other branches) keep compiling.
export const ratingSql = accessSql;

// `user` is the req.user object; a bare id is still accepted (no rating limit applied).
export async function isItemHiddenForUser(db, itemId, user) {
  const userId = typeof user === 'object' ? user?.id : user;
  const row = await db.get(
    'SELECT 1 FROM item_visibility WHERE item_id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1',
    [itemId, userId]
  );
  if (row) return true;

  const allowed = await db.get(
    `SELECT 1 FROM items i WHERE i.id = ?${accessSql(typeof user === 'object' ? user : null, 'i')}`,
    [itemId]
  );
  return !allowed;
}
