import express from 'express';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { shapeItems, shapeItem } from '../services/itemView.js';
import { ratingSql, isItemHiddenForUser } from '../services/visibility.js';
import { probeChapters } from '../services/chapters.js';

// Item ids are always a 32-char hex md5 of the file path (see scanner.js).
const ITEM_ID_RE = /^[a-f0-9]{32}$/;

const router = express.Router();

router.use(authenticateToken);

// The shelf renders a card per item, and at library scale this response is the single
// biggest thing the app moves. `i.*` dragged the long-form metadata (description, genres,
// themes, artists, publisher, status, release_date) into every row — roughly half the
// payload, none of it rendered on a card. Detail sheets and the metadata editor fetch the
// full row from GET /items/:id, so nothing on screen loses a field.
const LIST_COLUMNS = `
  i.id, i.library_id, i.title, i.author, i.series, i.volume, i.path, i.cover_path,
  i.media_type, i.duration, i.total_pages, i.file_size, i.format, i.created_at, i.updated_at
`;

// List items with pagination, filtering, search, and visibility check
router.get('/', async (req, res) => {
  const { libraryId, mediaType, author, series, search, progress, genre, sort, addedWithinDays, limit = 5000, offset = 0 } = req.query;
  const userId = req.user.id;

  try {
    const db = await getDb();
    let query = `
      SELECT
        ${LIST_COLUMNS},
        p.current_time,
        p.current_page,
        p.progress_percent,
        p.is_finished,
        p.cfi as current_page_cfi,
        p.updated_at as progress_updated_at
      FROM items i
      LEFT JOIN user_progress p ON i.id = p.item_id AND p.user_id = ?
      WHERE NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
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

    // Search reaches past the card fields into the long-form metadata too, so "time travel",
    // a cast member, a genre or a publisher finds the title even when it isn't in its name.
    if (search) {
      const fields = ['i.title', 'i.author', 'i.series', 'i.description', 'i.genres', 'i.themes', 'i.artists', 'i.publisher'];
      query += ` AND (${fields.map((f) => `${f} LIKE ?`).join(' OR ')})`;
      const s = `%${String(search).trim()}%`;
      params.push(...fields.map(() => s));
    }

    if (progress === 'unread') {
      query += ' AND (p.item_id IS NULL OR (COALESCE(p.progress_percent, 0) = 0 AND COALESCE(p.is_finished, 0) = 0))';
    } else if (progress === 'in_progress') {
      query += ' AND p.is_finished = 0 AND p.progress_percent > 0';
    } else if (progress === 'finished') {
      query += ' AND p.is_finished = 1';
    }

    if (genre) {
      // genres is a comma-separated list; pad both sides so "Drama" doesn't match "Melodrama".
      query += " AND (', ' || LOWER(COALESCE(i.genres, '')) || ',') LIKE ?";
      params.push(`%, ${String(genre).trim().toLowerCase()},%`);
    }

    const days = parseInt(addedWithinDays, 10);
    if (Number.isInteger(days) && days > 0 && days <= 3650) {
      query += ` AND i.created_at >= datetime('now', '-${days} days')`;
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 5000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    // i.id breaks ties so paging stays stable when many rows share a sort value.
    const ORDER_BY = {
      title: 'i.title ASC, i.id ASC',
      added: 'i.created_at DESC, i.id ASC',
      release: "CASE WHEN i.release_date IS NULL OR i.release_date = '' THEN 1 ELSE 0 END, i.release_date DESC, i.id ASC",
      recent: 'CASE WHEN p.updated_at IS NULL THEN 1 ELSE 0 END, p.updated_at DESC, i.title ASC, i.id ASC'
    };
    query += ` ORDER BY ${ORDER_BY[sort] || ORDER_BY.title} LIMIT ? OFFSET ?`;
    params.push(safeLimit, safeOffset);

    const items = await db.all(query, params);
    await shapeItems(db, items, req.user);
    res.json({ items });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Series are identified by name, but a name alone isn't unique: a manga and an anime both
// called "Naruto", or the same title in two libraries, used to merge into one detail page
// (and one mark-as-read). Callers pass ?library= and/or ?type= to pin down which one they
// mean; without them the old name-only behaviour is kept for compatibility.
function seriesScope(query, alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  let sql = '';
  const params = [];
  if (query.library) {
    sql += ` AND ${col('library_id')} = ?`;
    params.push(String(query.library));
  }
  if (query.type) {
    sql += ` AND ${col('media_type')} = ?`;
    params.push(String(query.type));
  }
  return { sql, params };
}

// Distinct genres across what this user can see, with counts, for the shelf's genre filter.
router.get('/genres', async (req, res) => {
  const { mediaType } = req.query;
  try {
    const db = await getDb();
    let query = `
      SELECT i.genres FROM items i
      WHERE i.genres IS NOT NULL AND i.genres != ''
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `;
    const params = [req.user.id];
    if (mediaType && mediaType !== 'all') {
      query += ' AND i.media_type = ?';
      params.push(mediaType);
    }
    const rows = await db.all(query, params);
    const counts = new Map();
    for (const row of rows) {
      for (const raw of row.genres.split(',')) {
        const name = raw.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = counts.get(key) || { name, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    const genres = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    res.json({ genres });
  } catch (err) {
    serverError(req, res, err);
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
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
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
    serverError(req, res, err);
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
        i.library_id,
        i.media_type,
        COUNT(i.id) as item_count,
        MIN(i.id) as sample_item_id
      FROM items i
      WHERE i.series IS NOT NULL AND i.series != ''
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `;
    const params = [userId];

    if (mediaType && mediaType !== 'all') {
      query += ' AND i.media_type = ?';
      params.push(mediaType);
    }

    query += ' GROUP BY i.series, i.library_id, i.media_type ORDER BY i.series ASC';

    const seriesList = await db.all(query, params);
    res.json({ series: seriesList });
  } catch (err) {
    serverError(req, res, err);
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

  const scope = seriesScope(req.query, 'i');
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
      WHERE i.series = ?${scope.sql}
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
      ORDER BY
        CASE WHEN i.volume IS NULL THEN 1 ELSE 0 END,
        i.volume ASC,
        i.title ASC
    `, [userId, seriesName, ...scope.params, userId]);

    if (!items || items.length === 0) {
      return res.status(404).json({ error: 'Series not found' });
    }
    await shapeItems(db, items, req.user);

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
        libraryId: items[0].library_id || null,
        mediaType: items[0].media_type || null,
        libraryName: items[0].library_name || null,
        format: items[0].format || null,
        nextVolume,
        volumes: items
      }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Mark all volumes in a series as read
router.post('/series/:name/mark-read', async (req, res) => {
  const userId = req.user.id;
  let seriesName = req.params.name;
  try {
    seriesName = decodeURIComponent(seriesName);
  } catch (e) {}

  const scope = seriesScope(req.query);
  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT id, total_pages FROM items
      WHERE series = ?${scope.sql}
      AND id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )${ratingSql(req.user, 'items')}
    `, [seriesName, ...scope.params, userId]);

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
    serverError(req, res, err);
  }
});

// Mark all volumes in a series as unread
router.post('/series/:name/mark-unread', async (req, res) => {
  const userId = req.user.id;
  let seriesName = req.params.name;
  try {
    seriesName = decodeURIComponent(seriesName);
  } catch (e) {}

  const scope = seriesScope(req.query);
  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT id, total_pages FROM items
      WHERE series = ?${scope.sql}
      AND id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )${ratingSql(req.user, 'items')}
    `, [seriesName, ...scope.params, userId]);

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
    serverError(req, res, err);
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
      WHERE NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
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
    serverError(req, res, err);
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
    await shapeItems(db, hidden, req.user);

    res.json({ hiddenItems: hidden });
  } catch (err) {
    serverError(req, res, err);
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
    serverError(req, res, err);
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
    serverError(req, res, err);
  }
});

// Embedded chapter markers (audiobooks, and any video with chapters). Probed on first
// request and cached on the row alongside the file size it was read from, so replacing
// the file re-probes rather than serving the old book's chapters.
router.get('/:id/chapters', async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT id, path, file_size, chapters_json FROM items WHERE id = ?', [req.params.id]);
    if (!item || await isItemHiddenForUser(db, item.id, req.user)) {
      return res.status(404).json({ error: 'Item not found' });
    }

    try {
      const cached = item.chapters_json ? JSON.parse(item.chapters_json) : null;
      if (cached && cached.fileSize === item.file_size && Array.isArray(cached.chapters)) {
        return res.json({ chapters: cached.chapters });
      }
    } catch (e) {
      // Corrupt cache — fall through and re-probe.
    }

    const chapters = await probeChapters(item.path);
    await db.run('UPDATE items SET chapters_json = ? WHERE id = ?', [
      JSON.stringify({ fileSize: item.file_size, chapters }),
      item.id
    ]);
    res.json({ chapters });
  } catch (err) {
    serverError(req, res, err);
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
      AND NOT EXISTS (
        SELECT 1 FROM item_visibility v
        WHERE v.item_id = i.id AND (v.user_id = ? OR v.user_id IS NULL)
      )${ratingSql(req.user, 'i')}
    `, [userId, req.params.id, userId]);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await shapeItem(db, item, req.user);
    res.json({ item });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
