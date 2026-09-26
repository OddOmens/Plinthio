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

// SQL fragment (starting with AND, or empty) restricting `alias` rows to what `user` may
// see. It carries no bind parameters — every interpolated value is an integer computed
// here, never user input — so it can be dropped into any existing query without
// disturbing that query's parameter order.
export function ratingSql(user, alias = 'i') {
  const maxRank = ratingRank(user?.max_age_rating);
  if (maxRank === null) return '';
  const unratedRank = user.allow_unrated === 0 || user.allow_unrated === false ? 99 : 0;
  const cases = AGE_RATINGS.map((r, idx) => `WHEN '${r}' THEN ${idx}`).join(' ');
  return ` AND (CASE COALESCE(NULLIF(${alias}.age_rating, ''), (
      SELECT ss.age_rating FROM series_settings ss
      WHERE ss.library_id = ${alias}.library_id AND ss.series_name = ${alias}.series
    )) ${cases} ELSE ${unratedRank} END) <= ${maxRank}`;
}

// `user` is the req.user object; a bare id is still accepted (no rating limit applied).
export async function isItemHiddenForUser(db, itemId, user) {
  const userId = typeof user === 'object' ? user?.id : user;
  const row = await db.get(
    'SELECT 1 FROM item_visibility WHERE item_id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1',
    [itemId, userId]
  );
  if (row) return true;

  const rating = typeof user === 'object' ? ratingSql(user, 'i') : '';
  if (!rating) return false;
  const allowed = await db.get(`SELECT 1 FROM items i WHERE i.id = ?${rating}`, [itemId]);
  return !allowed;
}
