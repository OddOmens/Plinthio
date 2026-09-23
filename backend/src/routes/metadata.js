import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { config } from '../config/env.js';
import { searchExternalMetadata } from '../services/externalMetadata.js';
import { getThumbnailPath } from '../services/thumbnails.js';
import { invalidateCoverCache } from './media.js';
import { downloadCover } from '../services/artwork.js';
import multer from 'multer';
import sharp from 'sharp';
import { logger } from '../services/logger.js';

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

  try {
    const db = await getDb();
    const items = await db.all('SELECT id FROM items WHERE series = ?', [seriesName]);
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
  const { mediaType, query } = req.query;

  if (!mediaType || !query) {
    return res.status(400).json({ error: 'mediaType and query are required' });
  }

  try {
    const results = await searchExternalMetadata(mediaType, query);
    res.json({ results });
  } catch (err) {
    if (err.code === 'MISSING_API_KEY') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    // Log the full error server-side (visible in `docker logs`) — the client only gets a
    // generic message, but this is almost always the container failing to reach the
    // provider's host (DNS, no outbound internet, corporate proxy/firewall).
    console.error(`[metadata] Search failed for mediaType="${mediaType}" query="${query}":`, err);
    const hint = err.name === 'AbortError'
      ? 'Request timed out — the server could not reach the metadata provider in time.'
      : 'Could not reach the external metadata provider from the server. Check the container has outbound internet access.';
    res.status(502).json({ error: `${hint} (${err.message || 'unknown error'})` });
  }
});

// Apply a chosen external metadata result to an item: updates fields and downloads the cover
router.post('/apply/:itemId', requireEditor, async (req, res) => {
  const { itemId } = req.params;
  const { title, author, artists, series, coverUrl, description, releaseDate, genres, themes, publisher, status } = req.body;

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
    if (coverPath) { fields.push('cover_path = ?'); params.push(coverPath); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description || null); }
    if (releaseDate !== undefined) { fields.push('release_date = ?'); params.push(releaseDate || null); }
    if (genres !== undefined) { fields.push('genres = ?'); params.push(genres || null); }
    if (themes !== undefined) { fields.push('themes = ?'); params.push(themes || null); }
    if (publisher !== undefined) { fields.push('publisher = ?'); params.push(publisher || null); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status || null); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No metadata fields provided to apply' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(itemId);

    await db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);

    const updated = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    res.json({ message: 'Metadata updated', item: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
