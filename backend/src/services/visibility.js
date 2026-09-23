// Every listing endpoint (GET /items, series view, etc.) excludes items hidden for a
// user or hidden globally (user_id IS NULL = admin restrict). Any route that serves a
// raw file straight by item id must apply the same check, or hiding/restricting an item
// wouldn't actually stop someone who already has (or guesses) its id from accessing it
// directly.
export async function isItemHiddenForUser(db, itemId, userId) {
  const row = await db.get(
    'SELECT 1 FROM item_visibility WHERE item_id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1',
    [itemId, userId]
  );
  return !!row;
}
