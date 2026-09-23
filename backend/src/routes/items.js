import express from 'express';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// List items with pagination, filtering, search, and visibility check
router.get('/', async (req, res) => {
  const { libraryId, mediaType, author, series, search, limit = 5000, offset = 0 } = req.query;
  const userId = req.user.id;

  try {
    const db = await getDb();
    let query = `
      SELECT
        i.*,
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        p.cfi as current_page_cfi,
        p.updated_at as progress_updated_at
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `;
    const params = [userId, userId];

    if (libraryId) {
      query += ' AND i.library_id = ?';
      params.push(libraryId);
    }

    if (mediaType && mediaType !== 'all') {
      query += ' AND i.media_type = ?';
      params.push(mediaType);
    }

    if (author) {
      query += ' AND i.author = ?';
      params.push(author);
    }

    if (series) {
      query += ' AND i.series = ?';
      params.push(series);
    }

    if (search) {
      query += ' AND (i.title LIKE ? OR i.author LIKE ? OR i.series LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 5000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    query += ' ORDER BY i.title ASC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);

    const items = await db.all(query, params);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Group by Authors
router.get('/authors', async (req, res) => {
  const { mediaType } = req.query;
  const userId = req.user.id;

  try {
    const db = await getDb();
    let query = `
      SELECT
        i.author,
        COUNT(i.id) as item_count,
        MIN(i.id) as sample_item_id
      FROM items i
      WHERE i.author IS NOT NULL AND i.author != ''
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `;
    const params = [userId];

    if (mediaType && mediaType !== 'all') {
      query += ' AND i.media_type = ?';
      params.push(mediaType);
    }

    query += ' GROUP BY i.author ORDER BY i.author ASC';

    const authors = await db.all(query, params);
    res.json({ authors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Group by Series
router.get('/series', async (req, res) => {
  const { mediaType } = req.query;
  const userId = req.user.id;

  try {
    const db = await getDb();
    let query = `
      SELECT
        i.series,
        i.author,
        COUNT(i.id) as item_count,
        MIN(i.id) as sample_item_id
      FROM items i
      WHERE i.series IS NOT NULL AND i.series != ''
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `;
    const params = [userId];

    if (mediaType && mediaType !== 'all') {
      query += ' AND i.media_type = ?';
      params.push(mediaType);
    }

    query += ' GROUP BY i.series ORDER BY i.series ASC';

    const seriesList = await db.all(query, params);
    res.json({ series: seriesList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single Series Details (all volumes, progress, metadata)
router.get('/series/:name', async (req, res) => {
  const userId = req.user.id;
  let seriesName = req.params.name;
  try {
    seriesName = decodeURIComponent(seriesName);
  } catch (e) {
    // keep as is if malformed URI
  }

  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT
        i.*,
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        p.cfi as current_page_cfi,
        p.updated_at as progress_updated_at,
        l.name as library_name
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      LEFT JOIN libraries l ON i.library_id = l.id
      WHERE i.series = ?
      AND i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
      ORDER BY
        CASE WHEN i.volume IS NULL THEN 1 ELSE 0 END,
        i.volume ASC,
        i.title ASC
    `, [userId, seriesName, userId]);

    if (!items || items.length === 0) {
      return res.status(404).json({ error: 'Series not found' });
    }

    const volumeCount = items.length;
    const author = items.find(i => i.author)?.author || 'Unknown Author';
    const artists = items.find(i => i.artists)?.artists || null;
    const description = items.find(i => i.description)?.description || null;
    const genres = items.find(i => i.genres)?.genres || null;
    const themes = items.find(i => i.themes)?.themes || null;
    const publisher = items.find(i => i.publisher)?.publisher || null;
    const status = items.find(i => i.status)?.status || null;
    const releaseDate = items.find(i => i.release_date)?.release_date || null;
    const totalPages = items.reduce((sum, i) => sum + (i.total_pages || 0), 0);
    const readCount = items.filter(i => i.is_finished).length;
    const inProgressCount = items.filter(i => !i.is_finished && i.progress_percent > 0).length;
    const unreadCount = volumeCount - readCount - inProgressCount;

    const totalProgressSum = items.reduce((sum, i) => sum + (i.is_finished ? 100 : (i.progress_percent || 0)), 0);
    const overallProgress = volumeCount > 0 ? Math.round(totalProgressSum / volumeCount) : 0;

    // Determine smart next volume to read:
    // 1. First in-progress volume
    // 2. First unread volume
    // 3. First volume in series
    const inProgressVol = items.find(i => !i.is_finished && i.progress_percent > 0);
    const firstUnreadVol = items.find(i => !i.is_finished);
    const nextVolume = inProgressVol || firstUnreadVol || items[0];

    res.json({
      series: {
        name: seriesName,
        author,
        artists,
        description,
        genres,
        themes,
        publisher,
        status,
        release_date: releaseDate,
        volumeCount,
        totalPages,
        readCount,
        inProgressCount,
        unreadCount,
        overallProgress,
        libraryName: items[0].library_name || null,
        format: items[0].format || null,
        nextVolume,
        volumes: items
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark all volumes in a series as read
router.post('/series/:name/mark-read', async (req, res) => {
  const userId = req.user.id;
  let seriesName = req.params.name;
  try {
    seriesName = decodeURIComponent(seriesName);
  } catch (e) {}

  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT id, total_pages FROM items
      WHERE series = ?
      AND id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `, [seriesName, userId]);

    for (const item of items) {
      await db.run(`
        INSERT INTO user_progress
          (user_id, item_id, current_page, total_pages, progress_percent, is_finished, updated_at)
        VALUES (?, ?, ?, ?, 100, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, item_id) DO UPDATE SET
          current_page = excluded.total_pages,
          total_pages = excluded.total_pages,
          progress_percent = 100,
          is_finished = 1,
          updated_at = CURRENT_TIMESTAMP
      `, [userId, item.id, item.total_pages || 1, item.total_pages || 1]);
    }

    res.json({ message: 'Marked all volumes as read', count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark all volumes in a series as unread
router.post('/series/:name/mark-unread', async (req, res) => {
  const userId = req.user.id;
  let seriesName = req.params.name;
  try {
    seriesName = decodeURIComponent(seriesName);
  } catch (e) {}

  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT id, total_pages FROM items
      WHERE series = ?
      AND id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `, [seriesName, userId]);

    for (const item of items) {
      await db.run(`
        INSERT INTO user_progress
          (user_id, item_id, current_page, total_pages, progress_percent, is_finished, updated_at)
        VALUES (?, ?, 0, ?, 0, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, item_id) DO UPDATE SET
          current_page = 0,
          progress_percent = 0,
          is_finished = 0,
          updated_at = CURRENT_TIMESTAMP
      `, [userId, item.id, item.total_pages || 0]);
    }

    res.json({ message: 'Marked all volumes as unread', count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Group by Folders (Folder Hierarchy View)
router.get('/folders', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT i.id, i.title, i.author, i.path, i.media_type, l.name as library_name, l.path as library_path
      FROM items i
      JOIN libraries l ON i.library_id = l.id
      WHERE i.id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
      ORDER BY i.path ASC
    `, [userId]);

    // Build folder tree
    const foldersMap = {};
    for (const item of items) {
      const dir = path.dirname(item.path);
      const relative = path.relative(item.library_path, dir) || 'Root';
      const key = `${item.library_name} / ${relative}`;

      if (!foldersMap[key]) {
        foldersMap[key] = {
          folderName: key,
          libraryName: item.library_name,
          relativePath: relative,
          itemCount: 0,
          sampleItemId: item.id
        };
      }
      foldersMap[key].itemCount++;
    }

    res.json({ folders: Object.values(foldersMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List hidden items for user or admin
router.get('/hidden', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const hidden = await db.all(`
      SELECT i.*, v.user_id, v.hidden_by, v.created_at as hidden_at
      FROM item_visibility v
      JOIN items i ON v.item_id = i.id
      WHERE v.user_id = ? OR (? = 'admin' AND v.user_id IS NULL)
      ORDER BY v.created_at DESC
    `, [userId, req.user.role]);

    res.json({ hiddenItems: hidden });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hide item (for current user, or globally if admin specifies global=true)
router.post('/:id/hide', async (req, res) => {
  const userId = req.user.id;
  const itemId = req.params.id;
  const isGlobal = req.body.global === true && req.user.role === 'admin';

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO item_visibility (item_id, user_id, hidden_by, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(item_id, user_id) DO NOTHING`,
      [itemId, isGlobal ? null : userId, userId]
    );

    res.json({ message: 'Item hidden from shelf' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unhide item
router.post('/:id/unhide', async (req, res) => {
  const userId = req.user.id;
  const itemId = req.params.id;

  try {
    const db = await getDb();
    if (req.user.role === 'admin' && req.body.global) {
      await db.run('DELETE FROM item_visibility WHERE item_id = ? AND user_id IS NULL', [itemId]);
    } else {
      await db.run('DELETE FROM item_visibility WHERE item_id = ? AND user_id = ?', [itemId, userId]);
    }

    res.json({ message: 'Item restored to shelf' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single item details
router.get('/:id', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const item = await db.get(`
      SELECT
        i.*,
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        p.cfi as current_page_cfi
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE i.id = ?
    `, [userId, req.params.id]);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
