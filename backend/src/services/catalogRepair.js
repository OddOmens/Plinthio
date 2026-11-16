import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { getThumbnailPath, THUMB_WIDTHS } from './thumbnails.js';

// Fields a merged-away row can fill in on the row that's kept, when the kept row has none.
const FILLABLE = ['cover_path', 'cover_source', 'description', 'release_date', 'genres', 'themes',
  'artists', 'publisher', 'status', 'age_rating', 'author', 'external_rating', 'duration'];

const pathHash = (p) => crypto.createHash('md5').update(p).digest('hex');

/**
 * Folds rows that share a path into one, keeping the row with history (or else the fuller
 * one) and repointing everything at it. Cheap to run on every start.
 */
export async function mergeSamePathRows(db) {
  const shared = await db.all('SELECT path FROM items GROUP BY path HAVING COUNT(*) > 1');
  if (!shared.length) return 0;

  // Tables with an item_id are discovered, so ones added later are covered too.
  const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'items'")).map((t) => t.name);
  const refs = [];
  for (const table of tables) {
    const columns = await db.all(`PRAGMA table_info("${table}")`);
    if (columns.some((c) => c.name === 'item_id')) refs.push(table);
  }
  const itemColumns = new Set((await db.all('PRAGMA table_info(items)')).map((c) => c.name));
  const fillable = FILLABLE.filter((c) => itemColumns.has(c));

  let merged = 0;
  for (const { path: filePath } of shared) {
    const rows = await db.all('SELECT * FROM items WHERE path = ?', [filePath]);
    for (const row of rows) {
      row.history = 0;
      for (const table of refs) {
        row.history += (await db.get(`SELECT COUNT(*) n FROM "${table}" WHERE item_id = ?`, [row.id])).n;
      }
    }
    const worth = (r) => r.history * 1000 + (r.cover_path ? 10 : 0) + (r.description ? 5 : 0) + (r.id === pathHash(filePath) ? 1 : 0);
    rows.sort((a, b) => worth(b) - worth(a));
    const [keep, ...drop] = rows;

    for (const other of drop) {
      await db.exec('BEGIN');
      try {
        for (const table of refs) {
          // Where both rows have an entry (a unique pair like user + title), the kept row's wins.
          await db.run(`UPDATE OR IGNORE "${table}" SET item_id = ? WHERE item_id = ?`, [keep.id, other.id]);
          await db.run(`DELETE FROM "${table}" WHERE item_id = ?`, [other.id]);
        }
        await db.run('UPDATE items SET extra_of = ? WHERE extra_of = ?', [keep.id, other.id]);
        const fills = fillable.filter((c) => (keep[c] == null || keep[c] === '') && other[c] != null && other[c] !== '');
        if (fills.length) {
          await db.run(`UPDATE items SET ${fills.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...fills.map((c) => other[c]), keep.id]);
          for (const c of fills) keep[c] = other[c];
        }
        await db.run('DELETE FROM items WHERE id = ?', [other.id]);
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }
      // Its artwork, unless the kept row now uses the same file.
      if (other.cover_path && other.cover_path !== keep.cover_path) {
        try { fs.unlinkSync(path.join(config.coversDir, other.cover_path)); } catch (e) { /* already gone */ }
      }
      for (const width of THUMB_WIDTHS) {
        try { fs.unlinkSync(getThumbnailPath(other.id, width)); } catch (e) { /* not cached */ }
      }
      merged++;
    }
  }
  return merged;
}
