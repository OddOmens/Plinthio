import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { getThumbnailPath, THUMB_WIDTHS } from '../services/thumbnails.js';
import { logger } from '../services/logger.js';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Caps on how many example rows each section returns. Counts are always exact; the lists
// are there so an admin can see *which* titles, not to page through a whole library.
const LIST_LIMIT = 100;
const STAT_CONCURRENCY = 64;

// Checks every item's file in parallel batches. Sync stat() on 50k files over a network
// share would block the event loop (and every other request) for seconds.
async function findMissingFiles(items) {
  const missing = [];
  for (let i = 0; i < items.length; i += STAT_CONCURRENCY) {
    const batch = items.slice(i, i + STAT_CONCURRENCY);
    const results = await Promise.all(batch.map((item) =>
      fs.promises.access(item.path).then(() => true, () => false)
    ));
    results.forEach((exists, idx) => { if (!exists) missing.push(batch[idx]); });
  }
  return missing;
}

function publicRow(item) {
  return {
    id: item.id,
    title: item.title,
    series: item.series || null,
    volume: item.volume ?? null,
    media_type: item.media_type,
    library_name: item.library_name,
    path: item.path,
    missing_since: item.missing_since || null,
    offloaded_at: item.offloaded_at || null,
    updated_at: item.updated_at
  };
}

// Missing and offloaded titles grouped the way people think about them: a film, a book, or
// one season of a show (a whole series of books or comics). Each group carries its item ids
// so the admin can keep it as history, undo that, or remove it, in one go.
function groupTitles(items, goneNow) {
  const groups = new Map();
  for (const item of items) {
    const episodic = ['show', 'anime'].includes(item.media_type);
    const season = episodic && item.volume != null ? Math.floor(Number(item.volume)) : null;
    const name = item.series || item.title;
    const key = `${item.library_id}::${item.media_type}::${name}::${season ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        library_name: item.library_name,
        media_type: item.media_type,
        name,
        season,
        count: 0,
        size: 0,
        awaitingDeletion: 0,
        since: null,
        ids: []
      });
    }
    const g = groups.get(key);
    g.count++;
    g.size += item.file_size || 0;
    g.ids.push(item.id);
    // Offloaded but its file is still there: the space isn't free until it's deleted.
    if (item.offloaded_at && !item.missing_since && !goneNow.has(item.id)) g.awaitingDeletion++;
    const since = item.offloaded_at || item.missing_since;
    if (since && (!g.since || since < g.since)) g.since = since;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.season ?? -1) - (b.season ?? -1));
}

// A one-page "what needs attention" report: libraries that can't be reached, catalog rows
// whose file is gone, likely duplicates, titles missing art/metadata/ratings, and recent
// playback encode failures. Read-only — each section's fix is an existing action
// (rescan, metadata editor, series sheet) that the Admin UI links to.
router.get('/', async (req, res) => {
  try {
    const db = await getDb();

    const libraries = await db.all(`
      SELECT l.id, l.name, l.type, l.path, l.last_scanned_at, COUNT(i.id) AS item_count
      FROM libraries l
      LEFT JOIN items i ON i.library_id = l.id
      GROUP BY l.id
      ORDER BY l.name ASC
    `);
    for (const lib of libraries) {
      lib.path_exists = await fs.promises.access(lib.path).then(() => true, () => false);
    }

    const items = await db.all(`
      SELECT i.id, i.title, i.series, i.volume, i.media_type, i.path, i.updated_at,
             i.cover_path, i.description, i.author, i.age_rating, i.library_id, i.missing_since,
             i.offloaded_at, i.file_size, l.name AS library_name
      FROM items i
      JOIN libraries l ON l.id = i.library_id
    `);

    // Files on a library that is itself unreachable are reported under the library, not as
    // thousands of individually "missing" files.
    const reachableLibIds = new Set(libraries.filter((l) => l.path_exists).map((l) => l.id));
    // Missing = the last scan flagged it (kept, hidden, waiting for an admin), or its file is
    // gone right now even though no scan has run since.
    const goneNow = new Set((await findMissingFiles(items.filter((i) => reachableLibIds.has(i.library_id)))).map((i) => i.id));
    // Offloaded titles were removed on purpose and kept as history, so they're not missing.
    const missingFiles = items.filter((i) => !i.offloaded_at && (i.missing_since || goneNow.has(i.id)));
    const offloaded = items.filter((i) => i.offloaded_at);

    // Same title + same byte size in the same media type is almost always the same file
    // twice (a copy in two folders, or in two libraries).
    const duplicateGroups = await db.all(`
      SELECT i.media_type, LOWER(TRIM(i.title)) AS norm_title, i.file_size,
             COUNT(*) AS copies, GROUP_CONCAT(i.id) AS ids
      FROM items i
      WHERE i.file_size > 0
      GROUP BY i.media_type, norm_title, i.file_size
      HAVING copies > 1
      ORDER BY copies DESC
      LIMIT ${LIST_LIMIT}
    `);
    // Two different files both claiming to be volume/episode N of the same series.
    const volumeClashes = await db.all(`
      SELECT i.library_id, l.name AS library_name, i.series, i.volume,
             COUNT(*) AS copies, GROUP_CONCAT(i.id) AS ids
      FROM items i
      JOIN libraries l ON l.id = i.library_id
      WHERE i.series IS NOT NULL AND i.series != '' AND i.volume IS NOT NULL
      GROUP BY i.library_id, i.series, i.volume
      HAVING copies > 1
      ORDER BY i.series ASC, i.volume ASC
      LIMIT ${LIST_LIMIT}
    `);

    const byId = new Map(items.map((i) => [i.id, i]));
    const expand = (ids) => ids.split(',').map((id) => byId.get(id)).filter(Boolean).map(publicRow);

    const noCover = items.filter((i) => !i.cover_path);
    const noDescription = items.filter((i) => !i.description);
    const noAuthor = items.filter((i) => !i.author && ['book', 'manga', 'audiobook'].includes(i.media_type));

    const seriesRatings = await db.all('SELECT library_id, series_name, age_rating FROM series_settings WHERE age_rating IS NOT NULL');
    const ratedSeries = new Set(seriesRatings.map((r) => `${r.library_id}::${r.series_name}`));
    const unrated = items.filter((i) => !i.age_rating && !(i.series && ratedSeries.has(`${i.library_id}::${i.series}`)));

    const transcodeFailures = await db.all(`
      SELECT message, timestamp FROM system_logs
      WHERE category = 'media' AND (message LIKE 'HLS ffmpeg exited%' OR message LIKE 'HLS ffmpeg spawn failed%')
      ORDER BY timestamp DESC
      LIMIT 50
    `);

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalItems: items.length,
        unreachableLibraries: libraries.filter((l) => !l.path_exists).length,
        missingFiles: missingFiles.length,
        offloaded: offloaded.length,
        duplicateGroups: duplicateGroups.length,
        volumeClashes: volumeClashes.length,
        noCover: noCover.length,
        noDescription: noDescription.length,
        noAuthor: noAuthor.length,
        unrated: unrated.length,
        transcodeFailures: transcodeFailures.length
      },
      libraries,
      missingFiles: missingFiles.slice(0, LIST_LIMIT).map(publicRow),
      missingGroups: groupTitles(missingFiles, goneNow),
      offloadedGroups: groupTitles(offloaded, goneNow),
      duplicates: duplicateGroups.map((g) => ({ copies: g.copies, items: expand(g.ids) })),
      volumeClashes: volumeClashes.map((g) => ({
        library_id: g.library_id,
        library_name: g.library_name,
        series: g.series,
        volume: g.volume,
        items: expand(g.ids)
      })),
      noCover: noCover.slice(0, LIST_LIMIT).map(publicRow),
      noAuthor: noAuthor.slice(0, LIST_LIMIT).map(publicRow),
      transcodeFailures
    });
  } catch (err) {
    serverError(req, res, err, 'Could not build the library health report');
  }
});

// Remove missing titles from the catalog for good ("empty the trash"). Only titles a scan
// has flagged missing and whose file is still gone are removed — so a drive that came back
// since is never emptied out. Reading progress, ratings and bookmarks are kept (they're
// keyed by item id and re-attach if the same file is ever scanned again).
//
// Offloaded titles are only removed when asked for by id: "remove everything missing" must
// never take history someone chose to keep.
router.post('/remove-missing', async (req, res) => {
  const { itemIds } = req.body || {};
  try {
    const db = await getDb();
    let rows = await db.all('SELECT id, path, cover_path, title, offloaded_at FROM items WHERE missing_since IS NOT NULL');
    if (Array.isArray(itemIds)) {
      const wanted = new Set(itemIds);
      rows = rows.filter((r) => wanted.has(r.id));
    } else {
      rows = rows.filter((r) => !r.offloaded_at);
    }
    let removed = 0;
    for (const row of rows) {
      const stillGone = await fs.promises.access(row.path).then(() => false, () => true);
      if (!stillGone) continue;
      await db.run('DELETE FROM items WHERE id = ?', [row.id]);
      removed++;
      if (row.cover_path) {
        try { fs.unlinkSync(path.join(config.coversDir, row.cover_path)); } catch (e) { /* already gone */ }
      }
      for (const width of THUMB_WIDTHS) {
        try { fs.unlinkSync(getThumbnailPath(row.id, width)); } catch (e) { /* not cached */ }
      }
    }
    logger.info('library', `${removed} missing title(s) removed from the catalog by ${req.user.username}`);
    res.json({ removed, skipped: rows.length - removed });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Keep titles as history: hidden from shelves, search and playback, shown greyed on their
// title page with everyone's progress. Usually for titles already gone from disk (Library
// Health's missing list), but it also works ahead of deleting the files.
router.post('/offload', async (req, res) => {
  const itemIds = validIds(req.body?.itemIds);
  if (!itemIds) return res.status(400).json({ error: 'itemIds must be a list of item ids' });
  try {
    const db = await getDb();
    const result = await db.run(
      `UPDATE items SET offloaded_at = CURRENT_TIMESTAMP
       WHERE offloaded_at IS NULL AND id IN (${itemIds.map(() => '?').join(', ')})`,
      itemIds
    );
    logger.info('library', `${result.changes} title(s) offloaded (kept as history) by ${req.user.username}`);
    res.json({ offloaded: result.changes });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Undo that. A title whose file is still there is back on the shelves; one whose file is
// gone goes back to being missing.
router.post('/unoffload', async (req, res) => {
  const itemIds = validIds(req.body?.itemIds);
  if (!itemIds) return res.status(400).json({ error: 'itemIds must be a list of item ids' });
  try {
    const db = await getDb();
    const result = await db.run(
      `UPDATE items SET offloaded_at = NULL
       WHERE offloaded_at IS NOT NULL AND id IN (${itemIds.map(() => '?').join(', ')})`,
      itemIds
    );
    logger.info('library', `${result.changes} title(s) no longer offloaded, by ${req.user.username}`);
    res.json({ restored: result.changes });
  } catch (err) {
    serverError(req, res, err);
  }
});

const ITEM_ID_RE = /^[a-f0-9]{32}$/;
function validIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000) return null;
  return ids.every((id) => typeof id === 'string' && ITEM_ID_RE.test(id)) ? [...new Set(ids)] : null;
}

export default router;
