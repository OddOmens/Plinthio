import express from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken } from '../middleware/auth.js';
import { getMangaPagesList, extractMangaPage } from '../services/archive.js';
import { getThumbnailPath, getOrCreateThumbnail } from '../services/thumbnails.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { escapeXml } from '../utils/xml.js';
import { sendRangedFile, streamFile } from '../utils/fileStream.js';
import { sendError, codeForFsError } from '../errors.js';

// Reading a book/comic/audiobook file: a disconnected drive or unreadable file is P302/P301,
// anything else the generic P000.
function mediaFileError(req, res, err) {
  const code = err?.plinthioCode || codeForFsError(err, { playback: true }) || 'P000';
  sendError(req, res, code, { err });
}

const router = express.Router();

// In-memory cache for cover lookups to prevent SQLite query spam
const coverPathCache = new Map();

// Called whenever an item's cover_path changes on disk (metadata apply, rescan) so this
// route doesn't keep serving a stale cached path indefinitely.
export function invalidateCoverCache(itemId) {
  coverPathCache.delete(itemId);
}

// Item ids are always a 32-char hex md5 of the file path (see scanner.js) — reject anything
// else before it's used to build a filesystem path or hits the DB, closing off any path
// traversal / injection surface via a malformed :id.
const ITEM_ID_RE = /^[a-f0-9]{32}$/;
// Only a fixed, small set of widths are ever actually requested by the frontend — capping
// to this list (matching the widths the invalidation code elsewhere already assumes) means
// no amount of requests can make the server cache more than a handful of thumbnail variants
// per item, instead of trusting an open 100-1200 range that trivially lets a single client
// force ~1100 distinct sharp() resizes per cover.
const ALLOWED_THUMB_WIDTHS = [180, 360, 720];

// Cover image endpoint (Supports token via query string: ?token=...)
router.get('/cover/:id', authenticateToken, async (req, res) => {
  const itemId = req.params.id;
  if (!ITEM_ID_RE.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  const isRaw = req.query.raw === 'true' || req.query.full === 'true';
  const requestedWidth = parseInt(req.query.w, 10);
  const width = ALLOWED_THUMB_WIDTHS.includes(requestedWidth) ? requestedWidth : 360;

  try {
    const db = await getDb();
    if (await isItemHiddenForUser(db, itemId, req.user)) {
      return sendError(req, res, 'P300');
    }

    // FAST PATH: If thumbnail WebP file is already generated and cached on disk
    if (!isRaw) {
      const thumbPath = getThumbnailPath(itemId, width);
      if (fs.existsSync(thumbPath)) {
        const stat = fs.statSync(thumbPath);
        const etag = `"${itemId}-w${width}-${stat.size}"`;
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        return res.sendFile(thumbPath);
      }
    }

    // SLOW PATH: Lookup original cover in memory cache or database
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
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) return res.status(304).end();
          return res.sendFile(coverFullPath);
        }

        // Generate WebP thumbnail on-the-fly and save to cache
        const thumbPath = await getOrCreateThumbnail(itemId, item.cover_path, width);
        if (thumbPath && fs.existsSync(thumbPath)) {
          const stat = fs.statSync(thumbPath);
          const etag = `"${itemId}-w${width}-${stat.size}"`;
          res.setHeader('Content-Type', 'image/webp');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('ETag', etag);
          if (req.headers['if-none-match'] === etag) return res.status(304).end();
          return res.sendFile(thumbPath);
        }
      }
    }

    // Default SVG cover placeholder if no image exists
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
    // The placeholder means "no artwork yet", which is a temporary state — a scan may fill
    // it in minutes later. Caching it for a day (as this used to) meant a library that
    // rendered blank once kept rendering blank long after the real posters arrived.
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(svg);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Audio Stream Endpoint with HTTP 206 Partial Content (Supports token via query string: ?token=...)
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
    if (!fs.existsSync(item.path)) return sendError(req, res, 'P301');

    const filePath = item.path;
    const stat = fs.statSync(filePath);
    const contentType = mime.lookup(filePath) || 'audio/mpeg';
    sendRangedFile(req, res, filePath, stat.size, contentType);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Manga Page List
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

    const pages = await getMangaPagesList(item.path);
    res.json({
      totalPages: pages.length,
      pages: pages.map((_, index) => ({ pageIndex: index, pageNumber: index + 1 }))
    });
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Manga Single Page Image Stream (Supports token via query string: ?token=...)
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
    const page = await extractMangaPage(item.path, pageIndex);

    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.setHeader('Content-Type', page.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // Cache for 7 days
    res.send(page.data);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

// Raw Book File download / stream for EPUB/PDF
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

    // Without this, a file removed from disk since the last scan made createReadStream emit
    // an unhandled 'error' and crashed the server for everyone.
    if (!fs.existsSync(item.path)) return sendError(req, res, 'P301');

    const contentType = mime.lookup(item.path) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.title)}.${item.format}"`);
    streamFile(res, item.path);
  } catch (err) {
    mediaFileError(req, res, err);
  }
});

export default router;
