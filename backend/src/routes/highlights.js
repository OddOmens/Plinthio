import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';

// Highlighted passages in the EPUB reader. Each one is the reader's own: every query is
// scoped to the signed-in user.
const router = express.Router();
router.use(authenticateToken);

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
const MAX_TEXT = 10000;
const MAX_NOTE = 5000;
const MAX_CFI = 2000;

function cleanText(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function cleanProgress(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

router.get('/:itemId', async (req, res) => {
  try {
    const db = await getDb();
    const highlights = await db.all(
      `SELECT * FROM highlights WHERE user_id = ? AND item_id = ?
       ORDER BY COALESCE(progress, 0) ASC, created_at ASC`,
      [req.user.id, req.params.itemId]
    );
    res.json({ highlights });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/', async (req, res) => {
  const { itemId, cfiRange, text, color = 'yellow', note, chapter, progress } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'Item ID is required' });
  if (!cfiRange || typeof cfiRange !== 'string' || cfiRange.length > MAX_CFI) {
    return res.status(400).json({ error: 'A valid cfiRange is required' });
  }
  if (!HIGHLIGHT_COLORS.includes(color)) {
    return res.status(400).json({ error: `Color must be one of: ${HIGHLIGHT_COLORS.join(', ')}` });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO highlights (id, user_id, item_id, cfi_range, text, color, note, chapter, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, String(itemId), cfiRange, cleanText(text, MAX_TEXT), color,
        cleanText(note, MAX_NOTE), cleanText(chapter, 500), cleanProgress(progress)]
    );
    const highlight = await db.get('SELECT * FROM highlights WHERE id = ?', [id]);
    res.status(201).json({ highlight });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Change the colour or the note. Sending note: null (or "") clears it.
router.patch('/:id', async (req, res) => {
  const { color, note } = req.body || {};
  const fields = [];
  const params = [];
  if (color !== undefined) {
    if (!HIGHLIGHT_COLORS.includes(color)) {
      return res.status(400).json({ error: `Color must be one of: ${HIGHLIGHT_COLORS.join(', ')}` });
    }
    fields.push('color = ?');
    params.push(color);
  }
  if (note !== undefined) {
    fields.push('note = ?');
    params.push(cleanText(note, MAX_NOTE));
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields provided to update' });

  try {
    const db = await getDb();
    params.push(req.params.id, req.user.id);
    const result = await db.run(
      `UPDATE highlights SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      params
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Highlight not found' });
    const highlight = await db.get('SELECT * FROM highlights WHERE id = ?', [req.params.id]);
    res.json({ highlight });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM highlights WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Highlight not found' });
    res.json({ message: 'Highlight deleted' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
