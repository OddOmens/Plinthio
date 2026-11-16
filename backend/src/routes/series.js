import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor, canEditLibrary } from '../middleware/auth.js';
import { handle, serverError } from '../utils/http.js';
import { knownSql } from '../services/visibility.js';

const router = express.Router();

const READING_DIRECTIONS = new Set(['ltr', 'rtl', 'webtoon']);
const AGE_RATINGS = new Set(['Everyone', 'Teen', 'Mature', 'Explicit']);

router.use(authenticateToken);

// Reader settings for a series; defaults instead of 404 when unconfigured. A series the account
// can't see also gets defaults, so asking by name reveals nothing about it.
router.get('/:libraryId/:seriesName/settings', handle(async (req, res) => {
  const { libraryId } = req.params;
  let seriesName = req.params.seriesName;
  try { seriesName = decodeURIComponent(seriesName); } catch { /* already decoded */ }
  const db = await getDb();
  const isEditor = canEditLibrary(req.user);
  const visible = isEditor || await db.get(
    `SELECT 1 FROM items i WHERE i.library_id = ? AND i.series = ?${knownSql(req.user, 'i')} LIMIT 1`,
    [libraryId, seriesName]
  );
  const row = visible ? await db.get(
    'SELECT * FROM series_settings WHERE library_id = ? AND series_name = ?',
    [libraryId, seriesName]
  ) : null;

  res.json({
    settings: {
      readingDirection: row?.reading_direction || null,
      ageRating: row?.age_rating || null,
      titleOverride: row?.title_override || null
    }
  });
}));

// Library management, so editor rights (same as the per-item metadata editor).
router.put('/:libraryId/:seriesName/settings', requireEditor, async (req, res) => {
  const { libraryId } = req.params;
  const seriesName = decodeURIComponent(req.params.seriesName);
  const { readingDirection, ageRating, titleOverride } = req.body;

  if (readingDirection && !READING_DIRECTIONS.has(readingDirection)) {
    return res.status(400).json({ error: 'Reading direction must be ltr, rtl, or webtoon' });
  }
  if (ageRating && !AGE_RATINGS.has(ageRating)) {
    return res.status(400).json({ error: `Age rating must be one of: ${[...AGE_RATINGS].join(', ')}` });
  }

  try {
    const db = await getDb();

    const library = await db.get('SELECT id FROM libraries WHERE id = ?', [libraryId]);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    await db.run(
      `INSERT INTO series_settings (id, library_id, series_name, reading_direction, age_rating, title_override)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (library_id, series_name) DO UPDATE SET
         reading_direction = excluded.reading_direction,
         age_rating = excluded.age_rating,
         title_override = excluded.title_override,
         updated_at = CURRENT_TIMESTAMP`,
      [crypto.randomUUID(), libraryId, seriesName, readingDirection || null, ageRating || null, titleOverride || null]
    );

    // A rename moves its items too, or the settings row would point at a name no item carries.
    const renamed = titleOverride && titleOverride !== seriesName;
    if (renamed) {
      await db.run(
        'UPDATE items SET series = ? WHERE library_id = ? AND series = ?',
        [titleOverride, libraryId, seriesName]
      );
      await db.run(
        'UPDATE series_settings SET series_name = ?, title_override = NULL WHERE library_id = ? AND series_name = ?',
        [titleOverride, libraryId, seriesName]
      );
    }

    res.json({ message: 'Series settings saved', seriesName: renamed ? titleOverride : seriesName });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
