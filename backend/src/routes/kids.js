import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { logger } from '../services/logger.js';

// Kids Mode: what a kids account may see. Admins and editors mark whole libraries (see
// PATCH /api/libraries/:id), or single series or titles here. Enforcement lives in
// services/visibility.js (accessSql) so it applies to every listing, page, file and sync API.
const router = express.Router();
router.use(authenticateToken, requireEditor);

// Everything currently kids-safe.
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const libraries = await db.all('SELECT id, name, type, COALESCE(kids_allowed, 0) AS kids_allowed FROM libraries ORDER BY name ASC');
    const titles = await db.all(`
      SELECT kt.id, kt.library_id, kt.series, kt.item_id, kt.created_at,
             COALESCE(kt.series, i.title) AS name, l.name AS library_name,
             COALESCE(i.media_type, (SELECT media_type FROM items WHERE library_id = kt.library_id AND series = kt.series LIMIT 1)) AS media_type
      FROM kids_titles kt
      LEFT JOIN items i ON i.id = kt.item_id
      LEFT JOIN libraries l ON l.id = kt.library_id
      ORDER BY name ASC
    `);
    res.json({ libraries, titles });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Is this series / title kids-safe, and why? (?itemId=… or ?library=…&series=…)
router.get('/status', async (req, res) => {
  const { itemId, library, series } = req.query;
  try {
    const db = await getDb();
    let libraryId = library;
    let seriesName = series;
    if (itemId) {
      const item = await db.get('SELECT id, library_id, series FROM items WHERE id = ?', [itemId]);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      libraryId = item.library_id;
      seriesName = item.series;
      const own = await db.get('SELECT id FROM kids_titles WHERE item_id = ?', [itemId]);
      if (own) return res.json({ allowed: true, via: 'title', entryId: own.id });
    }
    if (!libraryId) return res.status(400).json({ error: 'itemId or library is required' });

    const lib = await db.get('SELECT kids_allowed FROM libraries WHERE id = ?', [libraryId]);
    if (lib?.kids_allowed) return res.json({ allowed: true, via: 'library' });
    if (seriesName) {
      const s = await db.get('SELECT id FROM kids_titles WHERE library_id = ? AND series = ?', [libraryId, seriesName]);
      if (s) return res.json({ allowed: true, via: 'series', entryId: s.id });
    }
    res.json({ allowed: false, via: null });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Add a series ({ libraryId, series }) or a single title ({ itemId }).
router.post('/titles', async (req, res) => {
  const { itemId, libraryId, series } = req.body || {};
  try {
    const db = await getDb();
    let row;
    if (itemId) {
      const item = await db.get('SELECT id, library_id, title FROM items WHERE id = ?', [itemId]);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      row = { library_id: item.library_id, series: null, item_id: item.id, label: item.title };
    } else if (libraryId && typeof series === 'string' && series.trim()) {
      const exists = await db.get('SELECT 1 FROM items WHERE library_id = ? AND series = ? LIMIT 1', [libraryId, series]);
      if (!exists) return res.status(404).json({ error: 'Series not found' });
      row = { library_id: libraryId, series, item_id: null, label: series };
    } else {
      return res.status(400).json({ error: 'Send itemId, or libraryId and series' });
    }
    const id = crypto.randomUUID();
    await db.run(
      `INSERT OR IGNORE INTO kids_titles (id, library_id, series, item_id, added_by) VALUES (?, ?, ?, ?, ?)`,
      [id, row.library_id, row.series, row.item_id, req.user.id]
    );
    logger.info('library', `"${row.label}" added to Kids Mode by ${req.user.username}`);
    res.status(201).json({ message: 'Added to Kids Mode' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Remove by entry id, or by the same body as POST.
router.delete('/titles/:id?', async (req, res) => {
  const { itemId, libraryId, series } = req.body || {};
  try {
    const db = await getDb();
    let result;
    if (req.params.id) result = await db.run('DELETE FROM kids_titles WHERE id = ?', [req.params.id]);
    else if (itemId) result = await db.run('DELETE FROM kids_titles WHERE item_id = ?', [itemId]);
    else if (libraryId && series) result = await db.run('DELETE FROM kids_titles WHERE library_id = ? AND series = ?', [libraryId, series]);
    else return res.status(400).json({ error: 'Nothing to remove' });
    if (!result.changes) return res.status(404).json({ error: 'Not in Kids Mode' });
    res.json({ message: 'Removed from Kids Mode' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
