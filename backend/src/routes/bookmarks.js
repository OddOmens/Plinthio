import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { handle } from '../utils/http.js';
import { canKnowItem } from '../services/visibility.js';

const router = express.Router();

router.use(authenticateToken);

// Bookmarks are the person's own notes, but they still have limits: without them one account
// could store them without end, against titles that don't exist.
const MAX_BOOKMARKS_PER_ITEM = 500;
const MAX_TITLE = 300;
const MAX_NOTES = 5000;
const MAX_CFI = 2000;
const BOOKMARK_TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

// Trimmed, or null when empty; `false` when it's too long to keep.
function cleanText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text.length > max) return false;
  return text || null;
}

router.get('/:itemId', handle(async (req, res) => {
  const userId = req.user.id;
  const { itemId } = req.params;

  const db = await getDb();
  const bookmarks = await db.all(`
      SELECT * FROM bookmarks
      WHERE user_id = ? AND item_id = ?
      ORDER BY position ASC
    `, [userId, itemId]);

  res.json({ bookmarks });
}));

router.post('/', handle(async (req, res) => {
  const userId = req.user.id;
  const { itemId, type = 'audiobook', position = 0, title, notes, cfi } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'Item ID is required' });
  }
  const cleanTitle = cleanText(title, MAX_TITLE);
  const cleanNotes = cleanText(notes, MAX_NOTES);
  if (cleanTitle === false || cleanNotes === false) {
    return res.status(400).json({ error: `A bookmark's title can be ${MAX_TITLE} characters and its note ${MAX_NOTES}` });
  }
  if (typeof type !== 'string' || !BOOKMARK_TYPE_RE.test(type)) {
    return res.status(400).json({ error: 'Invalid bookmark type' });
  }
  if (cfi !== undefined && cfi !== null && (typeof cfi !== 'string' || cfi.length > MAX_CFI)) {
    return res.status(400).json({ error: 'Invalid bookmark position' });
  }

  const db = await getDb();
  // Only on a title that exists and that the account may know about.
  if (!(await canKnowItem(db, itemId, req.user))) {
    return res.status(404).json({ error: 'Item not found' });
  }
  const existing = await db.get('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND item_id = ?', [userId, itemId]);
  if (existing.count >= MAX_BOOKMARKS_PER_ITEM) {
    return res.status(400).json({ error: `A title can have ${MAX_BOOKMARKS_PER_ITEM} bookmarks. Delete some first` });
  }
  const id = crypto.randomUUID();

  await db.run(`
      INSERT INTO bookmarks (id, user_id, item_id, type, position, title, notes, cfi, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [id, userId, itemId, type, parseFloat(position) || 0, cleanTitle, cleanNotes, cfi || null]);

  const bookmark = await db.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
  res.status(201).json({ message: 'Bookmark created', bookmark });
}));

router.patch('/:id', handle(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { title, notes } = req.body;

  // Built as an explicit field list rather than `COALESCE(?, title)` — COALESCE can never
  // actually clear a field, since binding NULL for "clear this" is indistinguishable from
  // "field omitted" to COALESCE. This also avoids calling .trim() on a null title/notes
  // (sent to intentionally clear the field), which previously threw a TypeError.
  const fields = [];
  const params = [];
  const cleanTitle = cleanText(title, MAX_TITLE);
  const cleanNotes = cleanText(notes, MAX_NOTES);
  if (cleanTitle === false || cleanNotes === false) {
    return res.status(400).json({ error: `A bookmark's title can be ${MAX_TITLE} characters and its note ${MAX_NOTES}` });
  }
  if (title !== undefined) {
    fields.push('title = ?');
    params.push(cleanTitle);
  }
  if (notes !== undefined) {
    fields.push('notes = ?');
    params.push(cleanNotes);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update' });
  }

  const db = await getDb();
  params.push(id, userId);
  const result = await db.run(`UPDATE bookmarks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Bookmark not found' });
  }

  const bookmark = await db.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
  res.json({ message: 'Bookmark updated', bookmark });
}));

router.delete('/:id', handle(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const db = await getDb();
  const result = await db.run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [id, userId]);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Bookmark not found' });
  }
  res.json({ message: 'Bookmark deleted' });
}));

export default router;
