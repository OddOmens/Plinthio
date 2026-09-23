import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// List user's custom collections / folders
router.get('/', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const collections = await db.all(`
      SELECT
        c.*,
        COUNT(ci.item_id) as item_count,
        MIN(ci.item_id) as sample_item_id
      FROM collections c
      LEFT JOIN collection_items ci ON c.id = ci.collection_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.name ASC
    `, [userId]);

    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all collections and their items, plus an "Unorganized" section for remaining items
router.get('/all-grouped', async (req, res) => {
  const userId = req.user.id;
  const { mediaType } = req.query;

  try {
    const db = await getDb();

    // 1. Fetch user's custom collections
    const collections = await db.all(
      'SELECT * FROM collections WHERE user_id = ? ORDER BY name ASC',
      [userId]
    );

    // 2. For each collection, fetch its items
    const groupedCollections = [];
    for (const col of collections) {
      let itemsQuery = `
        SELECT i.*, p.current_time, p.current_page, p.progress_percent, p.is_finished
        FROM collection_items ci
        JOIN items i ON ci.item_id = i.id
        LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
        WHERE ci.collection_id = ?
        AND i.id NOT IN (
          SELECT item_id FROM item_visibility
          WHERE user_id = ? OR user_id IS NULL
        )
      `;
      const params = [userId, col.id, userId];
      if (mediaType && mediaType !== 'all') {
        itemsQuery += ' AND i.media_type = ?';
        params.push(mediaType);
      }
      itemsQuery += ' ORDER BY ci.added_at DESC';

      const items = await db.all(itemsQuery, params);
      groupedCollections.push({
        id: col.id,
        name: col.name,
        description: col.description,
        isDefault: false,
        items
      });
    }

    // 3. Fetch unorganized items (items visible to user not assigned to ANY collection of this user)
    let unorgQuery = `
      SELECT i.*, p.current_time, p.current_page, p.progress_percent, p.is_finished
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE i.id NOT IN (
        SELECT ci.item_id FROM collection_items ci
        JOIN collections c ON ci.collection_id = c.id
        WHERE c.user_id = ?
      )
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `;
    const unorgParams = [userId, userId, userId];
    if (mediaType && mediaType !== 'all') {
      unorgQuery += ' AND i.media_type = ?';
      unorgParams.push(mediaType);
    }
    unorgQuery += ' ORDER BY i.title ASC';

    const unorganizedItems = await db.all(unorgQuery, unorgParams);

    // Append non-deletable "Unorganized" collection
    groupedCollections.push({
      id: 'unorganized',
      name: 'Unorganized',
      description: 'Media titles not assigned to any custom folder',
      isDefault: true,
      items: unorganizedItems
    });

    res.json({ collections: groupedCollections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new custom collection / folder
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO collections (id, user_id, name, description) VALUES (?, ?, ?, ?)`,
      [id, userId, name.trim(), (description || '').trim()]
    );

    const collection = await db.get('SELECT * FROM collections WHERE id = ?', [id]);
    res.status(201).json({ message: 'Folder created', collection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get items in a specific custom collection / folder
router.get('/:id', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const db = await getDb();
    const collection = await db.get('SELECT * FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const items = await db.all(`
      SELECT
        i.*,
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        ci.added_at as collection_added_at
      FROM collection_items ci
      JOIN items i ON ci.item_id = i.id
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE ci.collection_id = ?
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
      ORDER BY ci.added_at DESC
    `, [userId, id, userId]);

    res.json({ collection, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a custom collection / folder
router.delete('/:id', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add item to custom collection / folder
router.post('/:id/items', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { itemId } = req.body;

  if (!itemId) {
    return res.status(400).json({ error: 'Item ID is required' });
  }

  try {
    const db = await getDb();
    const collection = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Reject unknown or hidden-from-this-user item ids up front — otherwise a bogus id
    // silently sits in collection_items forever (every read query INNER JOINs items, so it
    // never surfaces, but it also never errors and never gets cleaned up).
    const item = await db.get(`
      SELECT i.id FROM items i
      WHERE i.id = ?
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `, [itemId, userId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await db.run(`
      INSERT OR IGNORE INTO collection_items (collection_id, item_id)
      VALUES (?, ?)
    `, [id, itemId]);

    res.json({ message: 'Item added to folder' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove item from custom collection / folder
router.delete('/:id/items/:itemId', async (req, res) => {
  const userId = req.user.id;
  const { id, itemId } = req.params;

  try {
    const db = await getDb();
    const collection = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    await db.run('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?', [id, itemId]);
    res.json({ message: 'Item removed from folder' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check which folders an item is already inside
router.get('/for-item/:itemId', async (req, res) => {
  const userId = req.user.id;
  const { itemId } = req.params;

  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT c.id, c.name,
        CASE WHEN ci.item_id IS NOT NULL THEN 1 ELSE 0 END as in_collection
      FROM collections c
      LEFT JOIN collection_items ci ON c.id = ci.collection_id AND ci.item_id = ?
      WHERE c.user_id = ?
      ORDER BY c.name ASC
    `, [itemId, userId]);

    res.json({ folders: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
