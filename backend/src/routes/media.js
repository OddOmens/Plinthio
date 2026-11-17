import express from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken } from '../middleware/auth.js';
import { getMangaPagesList, extractMangaPage } from '../services/archive.js';
import { pickPageWidth, resizedMangaPage } from '../services/pageImages.js';
import { getThumbnailPath, getOrCreateThumbnail, THUMB_WIDTHS } from '../services/thumbnails.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { escapeXml } from '../utils/xml.js';
import { sendRangedFile, streamFile, SEND_OPTS } from '../utils/fileStream.js';
import { sendError, codeForFsError } from '../errors.js';
import { getOrCreateStill } from '../services/videoFrame.js';
import { activeIntroFile } from '../services/intro.js';
import { ITEM_ID_RE } from '../utils/ids.js';
import { requireLibraryFile } from '../utils/libraryPath.js';

// Reading a book/comic/audiobook file: a disconnected drive or unreadable file is P302/P301,
// anything else the generic P000.
function mediaFileError(req, res, err) {
  const code = err?.plinthioCode || codeForFsError(err, { playback: true }) || 'P000';
  sendError(req, res, code, { err });
}

const router = express.Router();

// In-memory cover path cache.
const coverPathCache = new Map();

// Call when an item's cover_path changes so a stale path isn't served.
export function invalidateCoverCache(itemId) {
  coverPathCache.delete(itemId);
}

// Episode thumbnail, grabbed on first request and cached; 404 falls back to the cover.
const STILL_TYPES = new Set(['show', 'anime', 'movie']);
// Opening sequence clip (uploaded or built-in). URLs carry ?v=<version>, so cache hard.
router.get('/intro', authenticateToken, (req, res) => {
  const file = activeIntroFile();
  if (!file) return res.status(404).json({ error: 'No opening sequence' });
  const size = fs.statSync(file).size;
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  sendRangedFile(req, res, file, size, 'video/mp4');
});

router.get('/still/:id', authenticateToken, async (req, res) => {
  const itemId = req.params.id;
  if (!ITEM_ID_RE.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT id, path, media_type, duration, file_size FROM items WHERE id = ?', [itemId]);
    if (!item || !STILL_TYPES.has(item.media_type) || await isItemHiddenForUser(db, itemId, req.user)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const still = await getOrCreateStill(item);
    if (!still) return res.status(404).json({ error: 'No still for this video' });
    const etag = `"still-${itemId}-${item.file_size || 0}"`;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.sendFile(still, SEND_OPTS);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Accepts ?token= for <img> tags.
router.get('/cover/:id', authenticateToken, async (req, res) => {
  const itemId = req.params.id;
  if (!ITEM_ID_RE.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  const isRaw = req.query.raw === 'true' || req.query.full === 'true';
  const requestedWidth = parseInt(req.query.w, 10);
  // A fixed set of widths (matching cache invalidation), so a client can't force a resize and
  // cached file per arbitrary width.
  const width = THUMB_WIDTHS.includes(requestedWidth) ? requestedWidth : 360;

  try {
    const db = await getDb();
    if (await isItemHiddenForUser(db, itemId, req.user)) {
      return sendError(req, res, 'P300');
    }

    // Fast path: cached WebP thumbnail on disk
    if (!isRaw) {
      const thumbPath = getThumbnailPath(itemId, width);
      if (fs.existsSync(thumbPath)) {
        const stat = fs.statSync(thumbPath);
        const etag = `"${itemId}-w${width}-${stat.size}"`;
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        return res.sendFile(thumbPath, SEND_OPTS);
      }
    }

    // Slow path: find the original cover
    let item = coverPathCache.get(itemId);
    if (!item) {
      item = await db.get('SELECT cover_path, title FROM items WHERE id = ?', [itemId]);
      if (item) {
        coverPathCache.set(itemId, item);
      }
    }

    if (item && item.cover_path) {
      const coverFullPath = path.join(config.coversDir, item.cover_path);
      if (fs.existsSync(coverFullPath)) {
        if (isRaw) {
          const stat = fs.statSync(coverFullPath);
          const etag = `"${itemId}-raw-${stat.size}"`;
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) return res.status(304).end();
          return res.sendFile(coverFullPath, SEND_OPTS);
        }

        const thumbPath = await getOrCreateThumbnail(itemId, item.cover_path, width);
        if (thumbPath && fs.existsSync(thumbPath)) {
          const stat = fs.statSync(thumbPath);
          const etag = `"${itemId}-w${width}-${stat.size}"`;
          res.setHeader('Content-Type', 'image/webp');
          res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) return res.status(304).end();
          return res.sendFile(thumbPath, SEND_OPTS);
        }
      }
    }

    // SVG placeholder when there's no image
    const title = item ? item.title : 'Plinthio';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#312e81;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e1b4b;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        <rect x="20" y="20" width="260" height="410" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,6" opacity="0.4"/>
        <text x="50%" y="45%" text-anchor="middle" fill="#c7d2fe" font-size="20" font-family="system-ui, sans-serif" font-weight="bold">
          ${escapeXml(title.slice(0, 30))}
        </text>
        <text x="50%" y="55%" text-anchor="middle" fill="#818cf8" font-size="14" font-family="system-ui, sans-serif">
          Plinthio Media
        </text>
      </svg>
    `;
    res.setHeader('Content-Type', 'image/svg+xml');
    // Short cache: a scan may supply the real artwork minutes later.
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(svg);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Audio with range support; accepts ?token=.
router.get('/stream/:id', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);

    if (!item) return sendError(req, res, 'P300');
    if (await isItemHiddenForUser(db, req.params.id, req.user)) {
      return sendError(req, res, 'P300');
    }
    // Refused unless the real file is inside a library (see utils/libraryPath.js).
    const filePath = await requireLibraryFile(req, res, item.path);
    if (!filePath) return;
    const stat = fs.statSync(filePath);
    const contentType = mime.lookup(item.path) || 'audio/mpeg';
    sendRangedFile(req, res, filePath, stat.size, contentType);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

router.get('/manga/:id/pages', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT path FROM items WHERE id = ?', [req.params.id]);
    if (!item) return sendError(req, res, 'P300');
    if (await isItemHiddenForUser(db, req.params.id, req.user)) {
      return sendError(req, res, 'P300');
    }

    const filePath = await requireLibraryFile(req, res, item.path);
    if (!filePath) return;

    const pages = await getMangaPagesList(filePath);
    res.json({
      totalPages: pages.length,
      pages: pages.map((_, index) => ({ pageIndex: index, pageNumber: index + 1 }))
    });
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// One page image; accepts ?token=.
router.get('/manga/:id/page/:pageIndex', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT path FROM items WHERE id = ?', [req.params.id]);
    if (!item) return sendError(req, res, 'P300');
    if (await isItemHiddenForUser(db, req.params.id, req.user)) {
      return sendError(req, res, 'P300');
    }

    const pageIndex = parseInt(req.params.pageIndex, 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return sendError(req, res, 'P306', { message: 'Invalid page index' });
    }
    const filePath = await requireLibraryFile(req, res, item.path);
    if (!filePath) return;
    // ?w= gives a screen-sized copy (services/pageImages.js); without it, the original page.
    const width = pickPageWidth(req.query.w);
    const page = width
      ? await resizedMangaPage(req.params.id, filePath, pageIndex, width)
      : await extractMangaPage(filePath, pageIndex);

    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.setHeader('Content-Type', page.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.send(page.data);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Raw EPUB/PDF file.
router.get('/book/:id/file', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get('SELECT path, title, format FROM items WHERE id = ?', [req.params.id]);
    if (!item) return sendError(req, res, 'P300');
    if (await isItemHiddenForUser(db, req.params.id, req.user)) {
      return sendError(req, res, 'P300');
    }

    // P301 for a file gone since the last scan; refused if it resolves outside the libraries.
    const filePath = await requireLibraryFile(req, res, item.path);
    if (!filePath) return;

    const contentType = mime.lookup(item.path) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.title)}.${item.format}"`);
    streamFile(res, filePath);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

export default router;
