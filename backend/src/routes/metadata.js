import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { config } from '../config/env.js';
import { searchExternalMetadata } from '../services/externalMetadata.js';
import { getThumbnailPath } from '../services/thumbnails.js';
import { invalidateCoverCache } from './media.js';
import { downloadCover, cleanSearchTitle } from '../services/artwork.js';
import { parseMediaTitle } from '../services/titleCleaner.js';
import multer from 'multer';
import sharp from 'sharp';
import { logger } from '../services/logger.js';
import { serverError } from '../utils/http.js';
import { AGE_RATINGS } from '../services/visibility.js';

const router = express.Router();

// Cover uploads are held in memory and re-encoded by sharp before they ever touch disk.
// That normalizes anything the user drops in (PNG/WebP/HEIC/huge originals) to a consistent
// JPEG, and re-encoding strips any non-image payload smuggled inside the file.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image files can be used as cover art'));
    }
    cb(null, true);
  }
});

const ITEM_ID_RE = /^[a-f0-9]{32}$/;

async function writeCoverJpeg(buffer, coverFilename) {
  const fullPath = path.join(config.coversDir, coverFilename);
  await sharp(buffer)
    .rotate() // honour EXIF orientation so phone photos aren't sideways
    .resize(1200, 1800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(fullPath);
  return coverFilename;
}

function clearCachedThumbnails(itemId) {
  for (const width of [180, 360, 720]) {
    const thumbPath = getThumbnailPath(itemId, width);
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
    }
  }
  invalidateCoverCache(itemId);
}

router.use(authenticateToken);

// Replace a single item's cover art with an uploaded image (admins and editors).
router.post('/cover/:itemId', requireEditor, coverUpload.single('cover'), async (req, res) => {
  const { itemId } = req.params;
  if (!ITEM_ID_RE.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  try {
    const db = await getDb();
    const item = await db.get('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const coverFilename = await writeCoverJpeg(req.file.buffer, `${itemId}.jpg`);
    await db.run(
      'UPDATE items SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [coverFilename, itemId]
    );
    clearCachedThumbnails(itemId);

    logger.info('media', `Cover art replaced for item ${itemId} by ${req.user.username}`);
    res.json({ message: 'Cover art updated' });
  } catch (err) {
    console.error('[metadata] cover upload failed:', err);
    res.status(500).json({ error: 'Could not process that image' });
  }
});

// Replace the cover for a whole series / folder. Applied to every volume in the series so
// the shelf, the series card and each volume all agree — matching how Jellyfin treats a
// folder image as the identity for everything under it.
router.post('/series-cover', requireEditor, coverUpload.single('cover'), async (req, res) => {
  const seriesName = (req.body.series || '').trim();
  if (!seriesName) return res.status(400).json({ error: 'Series name is required' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // Scope to the library/media type the editor is looking at, so re-arting one "Naruto"
  // doesn't overwrite a same-named series elsewhere on the server.
  let where = 'series = ?';
  const params = [seriesName];
  if (req.body.libraryId) { where += ' AND library_id = ?'; params.push(String(req.body.libraryId)); }
  if (req.body.mediaType) { where += ' AND media_type = ?'; params.push(String(req.body.mediaType)); }

  try {
    const db = await getDb();
    const items = await db.all(`SELECT id FROM items WHERE ${where}`, params);
    if (items.length === 0) return res.status(404).json({ error: 'Series not found' });

    for (const item of items) {
      await writeCoverJpeg(req.file.buffer, `${item.id}.jpg`);
      await db.run(
        'UPDATE items SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [`${item.id}.jpg`, item.id]
      );
      clearCachedThumbnails(item.id);
    }

    logger.info('media', `Cover art replaced for series "${seriesName}" (${items.length} items) by ${req.user.username}`);
    res.json({ message: `Cover art updated for ${items.length} item(s)`, count: items.length });
  } catch (err) {
    console.error('[metadata] series cover upload failed:', err);
    res.status(500).json({ error: 'Could not process that image' });
  }
});

// Multer rejects (oversized file, non-image) throw rather than calling next() with a normal
// response, so translate them here instead of letting them fall through to the generic
// 500 handler with an opaque message.
router.use((err, req, res, next) => {
  if (!err) return next();
  const tooLarge = err.code === 'LIMIT_FILE_SIZE';
  res.status(400).json({
    error: tooLarge ? 'That image is too large (15MB max)' : (err.message || 'Upload failed')
  });
});

// Search external metadata providers (MangaDex, Google Books, Open Library, TMDB)
router.get('/search', async (req, res) => {
  const { mediaType, query, year } = req.query;

  if (!mediaType || !query) {
    return res.status(400).json({ error: 'mediaType and query are required' });
  }

  try {
    // For video types the user's title often still has the year or scene tags from the
    // filename (e.g. "Resident Evil 2020", "The Batman 2022 1080p"). Strip that noise the
    // same way the scanner does so the manual search finds the right result automatically.
    const VIDEO_TYPES = new Set(['movie', 'show', 'anime']);
    const parsed = VIDEO_TYPES.has(mediaType) ? parseMediaTitle(query) : null;
    const searchQuery = parsed ? (parsed.cleanTitle || query.trim()) : query.trim();
    const searchYear = year || (parsed?.year ?? null);

    const results = await searchExternalMetadata(mediaType, searchQuery, searchYear);
    res.json({ results, searchedAs: searchQuery !== query.trim() ? searchQuery : undefined, year: searchYear });
  } catch (err) {
    if (err.code === 'MISSING_API_KEY') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error(`[metadata] Search failed for mediaType="${mediaType}" query="${query}":`, err);

    if (err.status === 401 || err.status === 403) {
      return res.status(502).json({
        error: 'The metadata provider rejected the configured API key. For TMDB, copy either the "API Key" or the "API Read Access Token" from your TMDB account settings into Server Settings — the server reached the provider fine, so this is the credential, not the network.',
        code: 'PROVIDER_AUTH_FAILED'
      });
    }
    if (err.status === 429) {
      return res.status(502).json({
        error: 'The metadata provider is rate limiting this server. Wait a moment and try again.',
        code: 'PROVIDER_RATE_LIMITED'
      });
    }

    const hint = err.name === 'AbortError'
      ? 'Request timed out — the server could not reach the metadata provider in time.'
      : 'Could not reach the external metadata provider from the server. Check the container has outbound internet access.';
    res.status(502).json({ error: `${hint} (${err.message || 'unknown error'})` });
  }
});

// Admin / Editor: Fetch items for title cleanup & metadata inspection
router.get('/admin/items', requireEditor, async (req, res) => {
  const { libraryId, mediaType, filter = 'all', search = '', limit = 100, offset = 0 } = req.query;

  try {
    const db = await getDb();
    const conditions = [];
    const params = [];

    if (libraryId) {
      conditions.push('i.library_id = ?');
      params.push(libraryId);
    }
    if (mediaType) {
      conditions.push('i.media_type = ?');
      params.push(mediaType);
    }
    if (search && search.trim()) {
      conditions.push('(i.title LIKE ? OR i.path LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT i.id, i.library_id, i.title, i.author, i.series, i.volume, i.path,
             i.cover_path, i.cover_source, i.media_type, i.duration, i.file_size,
             i.format, i.description, i.release_date, i.genres, i.artists, i.updated_at,
             i.themes, i.publisher, i.status, i.age_rating,
             l.name as library_name, l.type as library_type
      FROM items i
      LEFT JOIN libraries l ON i.library_id = l.id
      ${whereClause}
      ORDER BY i.title ASC
    `;

    const allRows = await db.all(sql, params);

    let totalDirty = 0;
    let totalMissingCover = 0;
    let totalMissingMeta = 0;

    const enriched = allRows.map((item) => {
      const filename = path.basename(item.path);
      const parsedPath = parseMediaTitle(filename);
      const parsedTitle = parseMediaTitle(item.title);

      const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle || item.title;
      const detectedYear = parsedPath.year || parsedTitle.year || (item.release_date ? item.release_date.slice(0, 4) : null);

      const hasCover = !!item.cover_path;
      const hasDescription = !!(item.description && item.description.trim());
      const hasReleaseDate = !!item.release_date;

      // "Dirty" if current title differs from cleanTitle, contains release tags or trailing year
      const isDirty = (item.title !== cleanTitle) || /\b(19\d\d|20\d\d)\b/.test(item.title) || /[._]/.test(item.title);

      if (isDirty) totalDirty++;
      if (!hasCover) totalMissingCover++;
      if (!hasDescription || !hasReleaseDate) totalMissingMeta++;

      return {
        ...item,
        filename,
        cleanTitle,
        detectedYear,
        isTv: parsedPath.isTv,
        hasCover,
        hasDescription,
        hasReleaseDate,
        isDirty
      };
    });

    let filtered = enriched;
    if (filter === 'dirty') {
      filtered = enriched.filter((i) => i.isDirty);
    } else if (filter === 'missing_cover') {
      filtered = enriched.filter((i) => !i.hasCover);
    } else if (filter === 'missing_meta') {
      filtered = enriched.filter((i) => !i.hasDescription || !i.hasReleaseDate);
    }

    const total = filtered.length;
    const paginated = filtered.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      items: paginated,
      total,
      totalAll: allRows.length,
      totalDirty,
      totalMissingCover,
      totalMissingMeta
    });
  } catch (err) {
    console.error('[metadata] admin/items error:', err);
    serverError(req, res, err);
  }
});

// Admin / Editor: Batch Clean Titles for selected items
router.post('/admin/batch-clean-titles', requireEditor, async (req, res) => {
  const { itemIds } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds array is required' });
  }

  try {
    const db = await getDb();
    let updatedCount = 0;
    const results = [];

    for (const id of itemIds) {
      const item = await db.get('SELECT id, title, path, release_date FROM items WHERE id = ?', [id]);
      if (!item) continue;

      const filename = path.basename(item.path);
      const parsedPath = parseMediaTitle(filename);
      const parsedTitle = parseMediaTitle(item.title);
      const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle;
      const detectedYear = parsedPath.year || parsedTitle.year;

      if (cleanTitle && cleanTitle !== item.title) {
        let releaseDate = item.release_date;
        if (!releaseDate && detectedYear) {
          releaseDate = String(detectedYear);
        }

        await db.run(
          'UPDATE items SET title = ?, release_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [cleanTitle, releaseDate, id]
        );
        updatedCount++;
        results.push({ id, oldTitle: item.title, newTitle: cleanTitle, year: detectedYear });
      }
    }

    logger.info('metadata', `Batch cleaned titles for ${updatedCount} item(s) by ${req.user.username}`);
    res.json({ message: `Cleaned ${updatedCount} title(s)`, updatedCount, results });
  } catch (err) {
    console.error('[metadata] batch-clean-titles error:', err);
    serverError(req, res, err);
  }
});

// Admin / Editor: Batch Find & Match Metadata with TMDB / external provider
router.post('/admin/batch-match', requireEditor, async (req, res) => {
  const { itemIds, overwriteCovers = false, useCanonicalTitle = true } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds array is required' });
  }

  try {
    const db = await getDb();
    let matchedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const id of itemIds) {
      const item = await db.get('SELECT * FROM items WHERE id = ?', [id]);
      if (!item) {
        skippedCount++;
        continue;
      }

      const filename = path.basename(item.path);
      const parsedPath = parseMediaTitle(filename);
      const parsedTitle = parseMediaTitle(item.title);
      const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle || item.title;
      const year = parsedPath.year || parsedTitle.year || (item.release_date ? item.release_date.slice(0, 4) : null);

      try {
        const queryTitle = parsedPath.isTv ? (parsedPath.series || cleanTitle) : cleanTitle;
        const searchResults = await searchExternalMetadata(item.media_type, queryTitle, year);

        if (!searchResults || searchResults.length === 0) {
          skippedCount++;
          results.push({ id, originalTitle: item.title, cleanTitle, success: false, reason: 'No metadata found' });
          continue;
        }

        // Find the best match: prefer exact year if year exists
        const best = (year && searchResults.find((r) => (r.releaseDate || '').startsWith(String(year)))) || searchResults[0];

        // Download cover if needed
        let newCoverPath = null;
        if (best.coverUrl && (!item.cover_path || overwriteCovers)) {
          try {
            newCoverPath = await downloadCover(best.coverUrl, id);
          } catch (e) {
            console.warn(`Cover download failed for ${id}: ${e.message}`);
          }
        }

        const newTitle = (useCanonicalTitle && best.title) ? best.title : cleanTitle;
        const newOverview = best.overview || item.description;
        const newReleaseDate = best.releaseDate || (year ? String(year) : item.release_date);
        const newAuthor = best.author || item.author;
        const newArtists = best.artists || item.artists;
        const newGenres = Array.isArray(best.genres) ? best.genres.join(', ') : (best.genres || item.genres);
        const coverToSave = newCoverPath || item.cover_path;
        const coverSource = newCoverPath ? 'tmdb' : item.cover_source;

        await db.run(
          `UPDATE items SET
            title = ?, description = ?, release_date = ?, author = ?, artists = ?,
            genres = ?, cover_path = ?, cover_source = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newTitle, newOverview, newReleaseDate, newAuthor, newArtists, newGenres, coverToSave, coverSource, id]
        );

        matchedCount++;
        results.push({
          id,
          originalTitle: item.title,
          cleanTitle,
          matchedTitle: newTitle,
          year: best.releaseDate ? best.releaseDate.slice(0, 4) : year,
          posterUpdated: !!newCoverPath,
          success: true
        });

        // Small delay between requests to be courteous to external APIs
        await new Promise((resolve) => setTimeout(resolve, 120));
      } catch (err) {
        skippedCount++;
        results.push({ id, originalTitle: item.title, cleanTitle, success: false, reason: err.message });
      }
    }

    logger.info('metadata', `Batch metadata match finished: ${matchedCount} matched, ${skippedCount} skipped by ${req.user.username}`);
    res.json({
      message: `Matched ${matchedCount} of ${itemIds.length} item(s)`,
      total: itemIds.length,
      matched: matchedCount,
      skipped: skippedCount,
      results
    });
  } catch (err) {
    console.error('[metadata] batch-match error:', err);
    serverError(req, res, err);
  }
});

// Admin / Editor: Auto-match single item
router.post('/admin/match-single/:itemId', requireEditor, async (req, res) => {
  const { itemId } = req.params;
  const { overwriteCover = false, useCanonicalTitle = true } = req.body;

  try {
    const db = await getDb();
    const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const filename = path.basename(item.path);
    const parsedPath = parseMediaTitle(filename);
    const parsedTitle = parseMediaTitle(item.title);
    const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle || item.title;
    const year = parsedPath.year || parsedTitle.year || (item.release_date ? item.release_date.slice(0, 4) : null);

    const queryTitle = parsedPath.isTv ? (parsedPath.series || cleanTitle) : cleanTitle;
    const searchResults = await searchExternalMetadata(item.media_type, queryTitle, year);

    if (!searchResults || searchResults.length === 0) {
      return res.status(404).json({ error: 'No metadata found on external provider', cleanTitle, year });
    }

    const best = (year && searchResults.find((r) => (r.releaseDate || '').startsWith(String(year)))) || searchResults[0];

    let newCoverPath = null;
    if (best.coverUrl && (!item.cover_path || overwriteCover)) {
      try {
        newCoverPath = await downloadCover(best.coverUrl, itemId);
      } catch (e) {
        console.warn(`Cover download failed for ${itemId}: ${e.message}`);
      }
    }

    const newTitle = (useCanonicalTitle && best.title) ? best.title : cleanTitle;
    const newOverview = best.overview || item.description;
    const newReleaseDate = best.releaseDate || (year ? String(year) : item.release_date);
    const newAuthor = best.author || item.author;
    const newArtists = best.artists || item.artists;
    const newGenres = Array.isArray(best.genres) ? best.genres.join(', ') : (best.genres || item.genres);
    const coverToSave = newCoverPath || item.cover_path;
    const coverSource = newCoverPath ? 'tmdb' : item.cover_source;

    await db.run(
      `UPDATE items SET
        title = ?, description = ?, release_date = ?, author = ?, artists = ?,
        genres = ?, cover_path = ?, cover_source = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newTitle, newOverview, newReleaseDate, newAuthor, newArtists, newGenres, coverToSave, coverSource, itemId]
    );

    const updated = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    res.json({ message: 'Item matched and updated', item: updated, matched: best });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Apply a chosen external metadata result to an item: updates fields and downloads the cover
router.post('/apply/:itemId', requireEditor, async (req, res) => {
  const { itemId } = req.params;
  const { title, author, artists, series, coverUrl, description, releaseDate, genres, themes, publisher, status, ageRating } = req.body;

  try {
    const db = await getDb();
    const item = await db.get('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    let coverPath = null;
    if (coverUrl) {
      try {
        coverPath = await downloadCover(coverUrl, itemId);
      } catch (err) {
        console.warn(`Failed to download cover for item ${itemId}: ${err.message}`);
      }
    }

    const fields = [];
    const params = [];

    if (title) { fields.push('title = ?'); params.push(title); }
    if (author !== undefined) { fields.push('author = ?'); params.push(author || null); }
    if (artists !== undefined) { fields.push('artists = ?'); params.push(artists || null); }
    if (series !== undefined) { fields.push('series = ?'); params.push(series || null); }
    if (coverPath) {
      fields.push('cover_path = ?'); params.push(coverPath);
      fields.push('cover_source = ?'); params.push('tmdb');
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(description || null); }
    if (releaseDate !== undefined) { fields.push('release_date = ?'); params.push(releaseDate || null); }
    if (genres !== undefined) {
      const gVal = Array.isArray(genres) ? genres.join(', ') : (genres || null);
      fields.push('genres = ?'); params.push(gVal);
    }
    if (themes !== undefined) {
      const tVal = Array.isArray(themes) ? themes.join(', ') : (themes || null);
      fields.push('themes = ?'); params.push(tVal);
    }
    if (publisher !== undefined) { fields.push('publisher = ?'); params.push(publisher || null); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status || null); }
    if (ageRating !== undefined) {
      if (ageRating && !AGE_RATINGS.includes(ageRating)) {
        return res.status(400).json({ error: `Age rating must be one of: ${AGE_RATINGS.join(', ')}` });
      }
      fields.push('age_rating = ?'); params.push(ageRating || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No metadata fields provided to apply' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(itemId);

    await db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);

    const updated = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    res.json({ message: 'Metadata updated', item: updated });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
