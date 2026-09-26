import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { getRatingSettings, getRatingSummary } from '../services/ratings.js';

const router = express.Router();

router.use(authenticateToken);

// Hidden items 404 like a missing one, same as every other by-id route — a rating shouldn't
// be the way to confirm an item exists.
async function loadVisibleItem(db, itemId, userId) {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item || await isItemHiddenForUser(db, itemId, userId)) return null;
  return item;
}

// Rating summary for one item: your stars, the server-wide average, and (movies/shows/anime)
// TMDB's score — each only when the admin has that display switched on.
router.get('/:itemId', async (req, res) => {
  try {
    const db = await getDb();
    const item = await loadVisibleItem(db, req.params.itemId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const settings = await getRatingSettings(db);
    res.json(await getRatingSummary(db, item, req.user.id, settings));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set (or with rating: null, clear) your own 1–5 star rating.
router.put('/:itemId', async (req, res) => {
  const { rating } = req.body;
  const clearing = rating === null || rating === 0;
  if (!clearing && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }

  try {
    const db = await getDb();
    const settings = await getRatingSettings(db);
    if (!settings.showPersonal) {
      return res.status(403).json({ error: 'Personal ratings are turned off on this server' });
    }

    const item = await loadVisibleItem(db, req.params.itemId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (clearing) {
      await db.run('DELETE FROM user_ratings WHERE user_id = ? AND item_id = ?', [req.user.id, item.id]);
    } else {
      await db.run(
        `INSERT INTO user_ratings (user_id, item_id, rating) VALUES (?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET rating = excluded.rating, updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, item.id, rating]
      );
    }

    res.json(await getRatingSummary(db, item, req.user.id, settings));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:itemId', async (req, res) => {
  try {
    const db = await getDb();
    const settings = await getRatingSettings(db);
    if (!settings.showPersonal) {
      return res.status(403).json({ error: 'Personal ratings are turned off on this server' });
    }
    await db.run('DELETE FROM user_ratings WHERE user_id = ? AND item_id = ?', [req.user.id, req.params.itemId]);
    res.json({ message: 'Rating removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
