import express from 'express';
import fs from 'fs';
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
    updated_at: item.updated_at
  };
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
             i.cover_path, i.description, i.author, i.age_rating, i.library_id,
             l.name AS library_name
      FROM items i
      JOIN libraries l ON l.id = i.library_id
    `);

    // Files on a library that is itself unreachable are reported under the library, not as
    // thousands of individually "missing" files.
    const reachableLibIds = new Set(libraries.filter((l) => l.path_exists).map((l) => l.id));
    const missingFiles = await findMissingFiles(items.filter((i) => reachableLibIds.has(i.library_id)));

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

export default router;
