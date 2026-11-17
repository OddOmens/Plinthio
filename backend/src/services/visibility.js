// Routes serving files by item id must apply the same visibility checks as listings, or hidden
// items stay reachable by id. (item_visibility.user_id IS NULL = hidden for everyone.)

// Effective rating: the item's age_rating, else its series'. Unrated passes only if allowed.
export const AGE_RATINGS = ['Everyone', 'Teen', 'Mature', 'Explicit'];

export function ratingRank(rating) {
  const rank = AGE_RATINGS.indexOf(rating);
  return rank === -1 ? null : rank;
}

// SQL fragment (starting with AND) for rows `user` may see: not missing or offloaded (unless
// includeOffloaded), Kids Mode, personal hides, age rating, and extras only as visible as their film.
// No bind parameters (interpolated values are never user input), so it drops into any query.
// restrictionsOnly: only Kids Mode and age rating. hiddenFilms: also drop extras of globally hidden films.
export function accessSql(user, alias = 'i', { includeOffloaded = false, restrictionsOnly = false, hiddenFilms = !restrictionsOnly } = {}) {
  let sql = '';
  if (!restrictionsOnly) {
    sql = includeOffloaded
      ? ` AND (${alias}.offloaded_at IS NOT NULL OR ${alias}.missing_since IS NULL)`
      : ` AND ${alias}.missing_since IS NULL AND ${alias}.offloaded_at IS NULL`;
  }

  sql += kidsModeSql(user, alias);
  if (!restrictionsOnly) sql += personalSql(user, alias);
  sql += ageRatingSql(user, alias);
  sql += extraFilmSql(user, alias, hiddenFilms);
  return sql;
}

function kidsModeSql(user, alias) {
  if (user && (user.kids_mode === 1 || user.kids_mode === true)) {
    return ` AND (
      EXISTS (SELECT 1 FROM libraries kl WHERE kl.id = ${alias}.library_id AND kl.kids_allowed = 1)
      OR EXISTS (
        SELECT 1 FROM kids_titles kt
        WHERE kt.item_id = ${alias}.id
           OR (kt.series IS NOT NULL AND kt.library_id = ${alias}.library_id AND kt.series = ${alias}.series)
      )
    )`;
  }
  return '';
}

function ageRatingSql(user, alias) {
  const maxRank = ratingRank(user?.max_age_rating);
  if (maxRank === null) return '';
  const unratedRank = user.allow_unrated === 0 || user.allow_unrated === false ? 99 : 0;
  const cases = AGE_RATINGS.map((r, idx) => `WHEN '${r}' THEN ${idx}`).join(' ');
  return ` AND (CASE COALESCE(NULLIF(${alias}.age_rating, ''), (
      SELECT ss.age_rating FROM series_settings ss
      WHERE ss.library_id = ${alias}.library_id AND ss.series_name = ${alias}.series
    )) ${cases} ELSE ${unratedRank} END) <= ${maxRank}`;
}

// Extras don't carry their film's rating or hide, so they're held to the film's rules here.
// An extra whose film row is gone is judged on its own.
function extraFilmSql(user, alias, hiddenFilms) {
  const film = `${alias}_film`;
  let rules = kidsModeSql(user, film) + ageRatingSql(user, film);
  if (hiddenFilms) {
    rules += ` AND NOT EXISTS (SELECT 1 FROM item_visibility ${film}_v WHERE ${film}_v.item_id = ${film}.id AND ${film}_v.user_id IS NULL)`;
  }
  if (!rules) return '';
  return ` AND (${alias}.extra_of IS NULL OR NOT EXISTS (
      SELECT 1 FROM items ${film} WHERE ${film}.id = ${alias}.extra_of AND NOT (1${rules})
    ))`;
}

// The user's own hides (hiddenLibraries, hideKids). hideKids is ignored for Kids Mode accounts.
export const LIBRARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_HIDDEN_LIBRARIES = 200;

function personalSql(user, alias) {
  const prefs = user?.preferences;
  if (!prefs || typeof prefs !== 'object') return '';
  let sql = '';

  // User-controlled JSON: validate ids again before interpolating them into SQL.
  const hidden = Array.isArray(prefs.hiddenLibraries)
    ? prefs.hiddenLibraries.filter((id) => typeof id === 'string' && LIBRARY_ID_PATTERN.test(id)).slice(0, MAX_HIDDEN_LIBRARIES)
    : [];
  if (hidden.length) {
    sql += ` AND ${alias}.library_id NOT IN (${hidden.map((id) => `'${id}'`).join(', ')})`;
  }

  if (prefs.hideKids === true && !(user.kids_mode === 1 || user.kids_mode === true)) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM libraries hl WHERE hl.id = ${alias}.library_id AND hl.kids_allowed = 1)
      AND NOT EXISTS (
        SELECT 1 FROM kids_titles hk
        WHERE hk.item_id = ${alias}.id
           OR (hk.series IS NOT NULL AND hk.library_id = ${alias}.library_id AND hk.series = ${alias}.series)
      )`;
  }
  return sql;
}

// SQL fragment for "may this account know the title exists": restrictions plus (non-admins)
// global hides, but unlike accessSql keeps personal hides, missing and offloaded titles.
// For routes that act on an item id. No bind parameters.
export function knownSql(user, alias = 'i') {
  let sql = accessSql(user, alias, { restrictionsOnly: true, hiddenFilms: user?.role !== 'admin' });
  if (user?.role !== 'admin') {
    sql += ` AND NOT EXISTS (SELECT 1 FROM item_visibility gv WHERE gv.item_id = ${alias}.id AND gv.user_id IS NULL)`;
  }
  return sql;
}

export async function canKnowItem(db, itemId, user) {
  if (typeof itemId !== 'string' || !itemId || itemId.length > 64) return false;
  return !!(await db.get(`SELECT 1 FROM items i WHERE i.id = ?${knownSql(user, 'i')}`, [itemId]));
}

// Kids Mode or an age rating limit.
export function isLimitedAccount(user) {
  return !!user && (user.kids_mode === 1 || user.kids_mode === true || ratingRank(user.max_age_rating) !== null);
}

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
