import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get all bookmarks for a specific item
router.get('/:itemId', async (req, res) => {
  const userId = req.user.id;
  const { itemId } = req.params;

  try {
    const db = await getDb();
    const bookmarks = await db.all(`
      SELECT * FROM bookmarks
      WHERE user_id = ? AND item_id = ?
      ORDER BY position ASC
    `, [userId, itemId]);

    res.json({ bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new bookmark
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { itemId, type = 'audiobook', position = 0, title, notes, cfi } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'Item ID is required' });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const cleanTitle = (title || '').trim() || null;
    const cleanNotes = (notes || '').trim() || null;

    await db.run(`
      INSERT INTO bookmarks (id, user_id, item_id, type, position, title, notes, cfi, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, userId, itemId, type, parseFloat(position) || 0, cleanTitle, cleanNotes, cfi || null]);

    const bookmark = await db.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
    res.status(201).json({ message: 'Bookmark created', bookmark });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a bookmark title/notes
router.patch('/:id', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { title, notes } = req.body;

  // Built as an explicit field list rather than `COALESCE(?, title)` — COALESCE can never
  // actually clear a field, since binding NULL for "clear this" is indistinguishable from
  // "field omitted" to COALESCE. This also avoids calling .trim() on a null title/notes
  // (sent to intentionally clear the field), which previously threw a TypeError.
  const fields = [];
  const params = [];
  if (title !== undefined) {
    fields.push('title = ?');
    params.push(title === null ? null : (String(title).trim() || null));
  }
  if (notes !== undefined) {
    fields.push('notes = ?');
    params.push(notes === null ? null : (String(notes).trim() || null));
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update' });
  }

  try {
    const db = await getDb();
    params.push(id, userId);
    const result = await db.run(`UPDATE bookmarks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    const bookmark = await db.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
    res.json({ message: 'Bookmark updated', bookmark });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a bookmark
router.delete('/:id', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [id, userId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }
    res.json({ message: 'Bookmark deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
