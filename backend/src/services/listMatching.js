import { accessSql } from './visibility.js';

// Matches external search results to library items by title or series name (case-insensitive,
// same media type), since the library has no provider ids to join on. Only items the user can see count.
// `rows`: { id, media_type, title }. Returns Map(row.id → { id, title }).
export async function matchLibraryTitles(db, user, rows) {
  const matches = new Map();
  if (!rows.length) return matches;

  const byType = new Map();
  for (const row of rows) {
    if (!row.title) continue;
    if (!byType.has(row.media_type)) byType.set(row.media_type, []);
    byType.get(row.media_type).push(row);
  }

  for (const [mediaType, typeRows] of byType) {
    const titles = [...new Set(typeRows.map((r) => r.title.toLowerCase()))];
    const placeholders = titles.map(() => '?').join(', ');
    const found = await db.all(`
      SELECT i.id, i.title, i.series FROM items i
      WHERE i.media_type = ?
      AND (LOWER(i.title) IN (${placeholders}) OR LOWER(i.series) IN (${placeholders}))
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${accessSql(user, 'i')}
      ORDER BY i.volume ASC, i.title ASC
    `, [mediaType, ...titles, ...titles, user.id]);

    const byTitle = new Map();
    for (const item of found) {
      for (const key of [item.title, item.series]) {
        const k = key?.toLowerCase();
        if (k && !byTitle.has(k)) byTitle.set(k, { id: item.id, title: item.series || item.title });
      }
    }
    for (const row of typeRows) {
      const match = byTitle.get(row.title.toLowerCase());
      if (match) matches.set(row.id, match);
    }
  }

  return matches;
}

// Latest request status per external title. `rows`: { source, external_id }.
// Returns Map(`${source}:${external_id}` → status).
export async function latestRequestStatuses(db, rows) {
  const statuses = new Map();
  if (!rows.length) return statuses;

  const keys = [...new Set(rows.map((r) => `${r.source}:${r.external_id}`))];
  const placeholders = keys.map(() => '?').join(', ');
  const found = await db.all(`
    SELECT source, external_id, status FROM media_requests
    WHERE source || ':' || external_id IN (${placeholders})
    ORDER BY created_at ASC
  `, keys);

  // Ascending order, so the newest request for a title is the one left in the map.
  for (const row of found) statuses.set(`${row.source}:${row.external_id}`, row.status);
  return statuses;
}
