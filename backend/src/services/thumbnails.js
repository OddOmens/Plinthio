import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';

const THUMB_DIR = path.join(config.cacheDir, 'thumbnails');
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

/**
 * Returns the expected thumbnail path for an item ID and width
 */
export function getThumbnailPath(itemId, width = 360) {
  return path.join(THUMB_DIR, `${itemId}_w${width}.webp`);
}

/**
 * Checks if a cached thumbnail exists on disk
 */
export function hasThumbnail(itemId, width = 360) {
  const thumbPath = getThumbnailPath(itemId, width);
  return fs.existsSync(thumbPath);
}

/**
 * Resizes and compresses an image to an optimized WebP thumbnail
 * Saves to disk cache atomically to prevent corrupted reads.
 */
export async function getOrCreateThumbnail(itemId, coverFilename, width = 360, quality = 80) {
  const thumbPath = getThumbnailPath(itemId, width);

  // Return immediately if cached
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  const coverFullPath = path.join(config.coversDir, coverFilename);
  if (!fs.existsSync(coverFullPath)) {
    return null;
  }

  const tempPath = `${thumbPath}.${Date.now()}.tmp`;

  try {
    await sharp(coverFullPath)
      .resize(width, null, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality,
        effort: 4
      })
      .toFile(tempPath);

    fs.renameSync(tempPath, thumbPath);
    return thumbPath;
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
    console.warn(`[Thumbnails] Failed to generate thumbnail for ${itemId}: ${err.message}`);
    // Fall back to original cover path
    return coverFullPath;
  }
}

/**
 * Background warmer: Pre-generates thumbnails for all existing items
 * Uses a concurrency pool to avoid saturating CPU.
 */
export async function warmThumbnailCache(concurrency = 3) {
  try {
    const db = await getDb();
    const items = await db.all(`
      SELECT id, cover_path
      FROM items
      WHERE cover_path IS NOT NULL AND cover_path != ''
    `);

    const missing = items.filter(item => !hasThumbnail(item.id, 360));
    if (missing.length === 0) {
      console.log(`[Thumbnails] Cache is fully warmed (${items.length} items).`);
      return;
    }

    console.log(`[Thumbnails] Warming cache: generating thumbnails for ${missing.length} items...`);

    let index = 0;
    let completed = 0;

    async function worker() {
      while (index < missing.length) {
        const item = missing[index++];
        try {
          await getOrCreateThumbnail(item.id, item.cover_path, 360);
          completed++;
        } catch (err) {
          // Silent continue
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, missing.length) }, () => worker());
    await Promise.all(workers);

    console.log(`[Thumbnails] Cache warmed successfully! Generated ${completed} thumbnails.`);
  } catch (err) {
    console.warn(`[Thumbnails] Cache warming failed: ${err.message}`);
  }
}
