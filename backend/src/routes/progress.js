import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { shapeItems, shapeItem } from '../services/itemView.js';
import { ratingSql } from '../services/visibility.js';

const router = express.Router();

router.use(authenticateToken);

// Get "Continue Listening / Reading" items for the user
router.get('/continue', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT
        i.*,
        p.current_time,
        p.duration as progress_duration,
        p.current_page,
        p.total_pages as progress_total_pages,
        p.progress_percent,
        p.is_finished,
        p.updated_at as last_accessed
      FROM user_progress p
      JOIN items i ON p.item_id = i.id
      WHERE p.user_id = ? AND p.is_finished = 0 AND p.progress_percent > 0
      AND i.extra_type IS NULL
      AND COALESCE(p.is_skipped, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
      ORDER BY p.updated_at DESC
      LIMIT 10
    `, [userId, userId]);

    await shapeItems(db, items, req.user);
    res.json({ items });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Mark volumes skipped (or not). Used for "I watched the anime for these volumes".
// Only the skip flag changes — a volume already read stays read, and partial progress is
// kept so un-skipping restores it. Declared before /:itemId so "skip" isn't taken for an id.
router.post('/skip', async (req, res) => {
  const { itemIds, skipped = true } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 2000) {
    return res.status(400).json({ error: 'itemIds must be a non-empty array' });
  }
  const ids = [...new Set(itemIds.filter((id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)))];
  if (ids.length === 0) return res.status(400).json({ error: 'No valid item ids' });

  try {
    const db = await getDb();
    // Only items this user can actually see.
    const visible = await db.all(`
      SELECT i.id, i.total_pages FROM items i
      WHERE i.id IN (${ids.map(() => '?').join(',')})
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `, [...ids, req.user.id]);

    const flag = skipped ? 1 : 0;
    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of visible) {
        await db.run(`
          INSERT INTO user_progress (user_id, item_id, total_pages, is_skipped, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, item_id) DO UPDATE SET
            is_skipped = excluded.is_skipped,
            updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, item.id, item.total_pages || 0, flag]);
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ message: skipped ? 'Marked as skipped' : 'No longer skipped', count: visible.length });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Get progress for single item
router.get('/:itemId', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const progress = await db.get(
      'SELECT * FROM user_progress WHERE user_id = ? AND item_id = ?',
      [userId, req.params.itemId]
    );
    res.json({ progress: progress || null });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Save progress (called periodically or on pause/page change)
router.post('/:itemId', async (req, res) => {
  const userId = req.user.id;
  const itemId = req.params.itemId;
  const { currentTime, duration, currentPage, totalPages, cfi } = req.body;
  // Optional; only the audio player sends it. Clamped to what the player offers.
  const rate = Number(req.body.playbackRate);
  const playbackRate = Number.isFinite(rate) && rate >= 0.5 && rate <= 3 ? rate : null;

  try {
    const db = await getDb();

    let percent = 0;
    let isFinished = 0;

    if (req.body.isFinished !== undefined) {
      isFinished = req.body.isFinished ? 1 : 0;
      if (req.body.progressPercent !== undefined) {
        percent = Math.min(100, Math.max(0, Number(req.body.progressPercent) || 0));
      } else {
        percent = isFinished ? 100 : 0;
      }
    } else if (duration && duration > 0) {
      percent = Math.min(100, Math.round((currentTime / duration) * 100));
      if (percent >= 98) isFinished = 1;
    } else if (totalPages && totalPages > 0) {
      percent = Math.min(100, Math.round((currentPage / totalPages) * 100));
      if (currentPage >= totalPages) isFinished = 1;
    }

    await db.run(`
      INSERT INTO user_progress
        (user_id, item_id, current_time, duration, current_page, total_pages, progress_percent, is_finished, cfi, playback_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, item_id) DO UPDATE SET
        current_time = excluded.current_time,
        duration = excluded.duration,
        current_page = excluded.current_page,
        total_pages = excluded.total_pages,
        progress_percent = excluded.progress_percent,
        is_finished = excluded.is_finished,
        cfi = COALESCE(excluded.cfi, user_progress.cfi),
        playback_rate = COALESCE(excluded.playback_rate, user_progress.playback_rate),
        -- Actually reading (or marking read/unread) a volume means it isn't skipped.
        is_skipped = 0,
        updated_at = CURRENT_TIMESTAMP
    `, [
      userId,
      itemId,
      currentTime || 0,
      duration || 0,
      currentPage || 0,
      totalPages || 0,
      percent,
      isFinished,
      cfi || null,
      playbackRate
    ]);

    res.json({ message: 'Progress saved', progressPercent: percent, isFinished });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
