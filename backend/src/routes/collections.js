import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { shapeItems, shapeItem } from '../services/itemView.js';
import { ratingSql } from '../services/visibility.js';
import { LIST_CATEGORIES, categoryForMediaType } from '../config/mediaTypes.js';
import { matchLibraryTitles, latestRequestStatuses } from '../services/listMatching.js';

const router = express.Router();

router.use(authenticateToken);

// List user's custom collections / folders
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const { type, category } = req.query;
  try {
    const db = await getDb();
    const params = [userId];
    if (type) params.push(type);
    if (category) params.push(category);
    // External entries (titles picked from a metadata search) count toward a list's size too.
    const collections = await db.all(`
      SELECT
        c.*,
        COUNT(ci.item_id)
          + (SELECT COUNT(*) FROM list_external_entries le WHERE le.collection_id = c.id) as item_count,
        MIN(ci.item_id) as sample_item_id
      FROM collections c
      LEFT JOIN collection_items ci ON c.id = ci.collection_id
      WHERE c.user_id = ?
      ${type ? "AND COALESCE(c.type, 'collection') = ?" : ''}
      ${category ? 'AND c.category = ?' : ''}
      GROUP BY c.id
      ORDER BY c.name ASC
    `, params);

    res.json({ collections });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Get all collections and their items, plus an "Unorganized" section for remaining items
router.get('/all-grouped', async (req, res) => {
  const userId = req.user.id;
  const { mediaType } = req.query;

  try {
    const db = await getDb();

    // 1. Fetch user's custom collections. Read lists are excluded — they're an explicit
    // reading order browsed on their own, not part of the folder/Unorganized split.
    const collections = await db.all(
      "SELECT * FROM collections WHERE user_id = ? AND COALESCE(type, 'collection') = 'collection' ORDER BY name ASC",
      [userId]
    );

    // 2. Fetch the items of every collection in one query and group them here. This used
    // to run a query per collection, so a user with 40 folders paid 40 round trips (each
    // re-running the visibility check) every time the shelf switched to folder grouping.
    const groupedCollections = [];
    if (collections.length > 0) {
      const placeholders = collections.map(() => '?').join(', ');
      let itemsQuery = `
        SELECT ci.collection_id, i.*, p.current_time, p.current_page, p.progress_percent, p.is_finished
        FROM collection_items ci
        JOIN items i ON ci.item_id = i.id
        LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
        WHERE ci.collection_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM item_visibility v
          WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
        )${ratingSql(req.user, 'i')}
      `;
      const params = [userId, ...collections.map((c) => c.id), userId];
      if (mediaType && mediaType !== 'all') {
        itemsQuery += ' AND i.media_type = ?';
        params.push(mediaType);
      }
      itemsQuery += ' ORDER BY ci.added_at DESC';

      const rows = await db.all(itemsQuery, params);
      await shapeItems(db, rows, req.user);
      const itemsByCollection = new Map(collections.map((c) => [c.id, []]));
      for (const row of rows) {
        const { collection_id: collectionId, ...item } = row;
        itemsByCollection.get(collectionId)?.push(item);
      }

      for (const col of collections) {
        groupedCollections.push({
          id: col.id,
          name: col.name,
          description: col.description,
          isDefault: false,
          items: itemsByCollection.get(col.id) || []
        });
      }
    }

    // 3. Fetch unorganized items (items visible to user not assigned to ANY collection of this user)
    let unorgQuery = `
      SELECT i.*, p.current_time, p.current_page, p.progress_percent, p.is_finished
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE i.extra_type IS NULL
      AND i.id NOT IN (
        SELECT ci.item_id FROM collection_items ci
        JOIN collections c ON ci.collection_id = c.id
        WHERE c.user_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `;
    const unorgParams = [userId, userId, userId];
    if (mediaType && mediaType !== 'all') {
      unorgQuery += ' AND i.media_type = ?';
      unorgParams.push(mediaType);
    }
    unorgQuery += ' ORDER BY i.title ASC';

    const unorganizedItems = await db.all(unorgQuery, unorgParams);
    await shapeItems(db, unorganizedItems, req.user);

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
    serverError(req, res, err);
  }
});

// Create a new custom collection / folder
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { name, description, type } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  if (type && !['collection', 'readlist'].includes(type)) {
    return res.status(400).json({ error: 'Type must be collection or readlist' });
  }
  // Lists always belong to a category; older clients that don't send one made reading orders.
  const category = type === 'readlist' ? (req.body.category || 'read') : null;
  if (category && !LIST_CATEGORIES[category]) {
    return res.status(400).json({ error: `Category must be one of: ${Object.keys(LIST_CATEGORIES).join(', ')}` });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO collections (id, user_id, name, description, type, category) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, name.trim(), (description || '').trim(), type || 'collection', category]
    );

    const collection = await db.get('SELECT * FROM collections WHERE id = ?', [id]);
    res.status(201).json({ message: 'Folder created', collection });
  } catch (err) {
    serverError(req, res, err);
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
      return sendError(req, res, 'P500', { message: 'Folder or list not found' });
    }

    const items = await db.all(`
      SELECT
        i.*,
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        ci.added_at as collection_added_at,
        ci.position as collection_position
      FROM collection_items ci
      JOIN items i ON ci.item_id = i.id
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE ci.collection_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
      ORDER BY ci.position ASC, ci.added_at ASC
    `, [userId, id, userId]);

    await shapeItems(db, items, req.user);

    // Lists interleave library items with external titles in one order. `items` stays as the
    // library-only array for existing callers; `entries` is the merged, ordered view.
    const externals = await db.all(
      'SELECT * FROM list_external_entries WHERE collection_id = ? ORDER BY position ASC, added_at ASC',
      [id]
    );
    const [matches, requestStatuses] = await Promise.all([
      matchLibraryTitles(db, req.user, externals),
      latestRequestStatuses(db, externals)
    ]);
    const entries = [
      ...items.map((item) => ({ kind: 'item', id: item.id, position: item.collection_position, item })),
      ...externals.map((ext) => ({
        kind: 'external',
        id: ext.id,
        position: ext.position,
        external: {
          ...ext,
          library_item: matches.get(ext.id) || null,
          request_status: requestStatuses.get(`${ext.source}:${ext.external_id}`) || null
        }
      }))
    ].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

    res.json({ collection, items, entries });
  } catch (err) {
    serverError(req, res, err);
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
      return sendError(req, res, 'P500', { message: 'Folder or list not found' });
    }
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    serverError(req, res, err);
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
    const collection = await db.get('SELECT id, type, category FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return sendError(req, res, 'P500', { message: 'Folder or list not found' });
    }

    // Reject unknown or hidden-from-this-user item ids up front — otherwise a bogus id
    // silently sits in collection_items forever (every read query INNER JOINs items, so it
    // never surfaces, but it also never errors and never gets cleaned up).
    const item = await db.get(`
      SELECT i.id, i.media_type FROM items i
      WHERE i.id = ?
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `, [itemId, userId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (collection.category && !LIST_CATEGORIES[collection.category]?.includes(item.media_type)) {
      return sendError(req, res, 'P501', { message: `This list only holds ${collection.category}` });
    }

    // New items go on the end of the reading order rather than the start.
    await db.run(`
      INSERT OR IGNORE INTO collection_items (collection_id, item_id, position)
      VALUES (?, ?, ?)
    `, [id, itemId, await nextPosition(db, id)]);

    res.json({ message: 'Item added to folder' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Set the reading order of a folder/read list. Takes the full ordered list of item ids and
// renumbers them, so the client can send the list it's showing rather than computing deltas.
router.put('/:id/reorder', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  // `entries` ([{ kind: 'item' | 'external', id }]) orders a list that mixes library items
  // and external titles; plain `itemIds` is still accepted from older clients.
  const entries = Array.isArray(req.body.entries)
    ? req.body.entries
    : Array.isArray(req.body.itemIds) ? req.body.itemIds.map((itemId) => ({ kind: 'item', id: itemId })) : null;

  if (!entries) {
    return res.status(400).json({ error: 'entries must be an array of { kind, id }' });
  }

  try {
    const db = await getDb();
    const collection = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return sendError(req, res, 'P500', { message: 'Folder or list not found' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      for (const [position, entry] of entries.entries()) {
        await db.run(
          entry?.kind === 'external'
            ? 'UPDATE list_external_entries SET position = ? WHERE collection_id = ? AND id = ?'
            : 'UPDATE collection_items SET position = ? WHERE collection_id = ? AND item_id = ?',
          [position, id, entry?.id]
        );
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ message: 'Reading order saved' });
  } catch (err) {
    serverError(req, res, err);
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
      return sendError(req, res, 'P500', { message: 'Folder or list not found' });
    }

    await db.run('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?', [id, itemId]);
    res.json({ message: 'Item removed from folder' });
  } catch (err) {
    serverError(req, res, err);
  }
});

const EXTERNAL_TEXT_LIMITS = { title: 300, subtitle: 300, author: 300, releaseDate: 40, overview: 4000, coverUrl: 1000 };

function clip(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

// Add a title from an external metadata search (TMDB, MangaDex, Google Books, Open Library)
// to a list — for things the library doesn't have yet.
router.post('/:id/external', async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { mediaType, source, externalId, title } = req.body;

  if (!mediaType || !source || !externalId || !title) {
    return res.status(400).json({ error: 'mediaType, source, externalId and title are required' });
  }
  // Cover art is rendered straight from the provider, so only accept https URLs.
  const coverUrl = typeof req.body.coverUrl === 'string' && /^https:\/\//.test(req.body.coverUrl)
    ? req.body.coverUrl
    : null;

  try {
    const db = await getDb();
    const collection = await db.get(
      "SELECT id, category FROM collections WHERE id = ? AND user_id = ? AND type = 'readlist'",
      [id, userId]
    );
    if (!collection) {
      return sendError(req, res, 'P500');
    }
    if (collection.category && !LIST_CATEGORIES[collection.category]?.includes(mediaType)) {
      return sendError(req, res, 'P501', { message: `This list only holds ${collection.category}` });
    }

    const entryId = crypto.randomUUID();
    const result = await db.run(`
      INSERT OR IGNORE INTO list_external_entries
        (id, collection_id, media_type, source, external_id, title, subtitle, author, release_date, overview, cover_url, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entryId, id, mediaType, clip(source, 40), clip(externalId, 200),
      clip(title, EXTERNAL_TEXT_LIMITS.title),
      clip(req.body.subtitle, EXTERNAL_TEXT_LIMITS.subtitle),
      clip(req.body.author, EXTERNAL_TEXT_LIMITS.author),
      clip(req.body.releaseDate, EXTERNAL_TEXT_LIMITS.releaseDate),
      clip(req.body.overview, EXTERNAL_TEXT_LIMITS.overview),
      clip(coverUrl, EXTERNAL_TEXT_LIMITS.coverUrl),
      await nextPosition(db, id)
    ]);

    if (result.changes === 0) {
      return sendError(req, res, 'P502');
    }
    res.status(201).json({ message: 'Added to list', id: entryId });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.delete('/:id/external/:entryId', async (req, res) => {
  const userId = req.user.id;
  const { id, entryId } = req.params;

  try {
    const db = await getDb();
    const collection = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [id, userId]);
    if (!collection) {
      return sendError(req, res, 'P500');
    }

    await db.run('DELETE FROM list_external_entries WHERE collection_id = ? AND id = ?', [id, entryId]);
    res.json({ message: 'Removed from list' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Library items and external titles share one position space per list.
async function nextPosition(db, collectionId) {
  const row = await db.get(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position FROM (
      SELECT position FROM collection_items WHERE collection_id = ?
      UNION ALL
      SELECT position FROM list_external_entries WHERE collection_id = ?
    )
  `, [collectionId, collectionId]);
  return row.position;
}

// Check which folders an item is already inside
router.get('/for-item/:itemId', async (req, res) => {
  const userId = req.user.id;
  const { itemId } = req.params;

  try {
    const db = await getDb();
    // Only offer the lists this kind of item can go in (a movie never shows the "Read" lists);
    // plain folders take anything.
    const item = await db.get('SELECT media_type FROM items WHERE id = ?', [itemId]);
    const category = categoryForMediaType(item?.media_type);
    const rows = await db.all(`
      SELECT c.id, c.name, COALESCE(c.type, 'collection') as type, c.category,
        CASE WHEN ci.item_id IS NOT NULL THEN 1 ELSE 0 END as in_collection
      FROM collections c
      LEFT JOIN collection_items ci ON c.id = ci.collection_id AND ci.item_id = ?
      WHERE c.user_id = ?
      AND (c.category IS NULL OR c.category = ?)
      ORDER BY COALESCE(c.type, 'collection') ASC, c.name ASC
    `, [itemId, userId, category]);

    res.json({ folders: rows });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
