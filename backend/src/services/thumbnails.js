import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { oneLine } from './logger.js';

// Fixed widths (others snap to 360) so clients can't create unbounded cache variants.
export const THUMB_WIDTHS = [180, 360, 720, 1280];

const THUMB_DIR = path.join(config.cacheDir, 'thumbnails');
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

export function getThumbnailPath(itemId, width = 360) {
  return path.join(THUMB_DIR, `${itemId}_w${width}.webp`);
}

export function hasThumbnail(itemId, width = 360) {
  const thumbPath = getThumbnailPath(itemId, width);
  return fs.existsSync(thumbPath);
}

/** Written via temp file + rename so readers never see a partial thumbnail. */
export async function getOrCreateThumbnail(itemId, coverFilename, width = 360, quality = 80) {
  const thumbPath = getThumbnailPath(itemId, width);

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
    console.warn(`[Thumbnails] Failed to generate thumbnail for ${itemId}: ${oneLine(err.message)}`);
    return coverFullPath;
  }
}

/** Pre-generates 360px thumbnails with a small worker pool to avoid saturating the CPU. */
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
          // getOrCreateThumbnail already logged it; carry on with the rest.
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, missing.length) }, () => worker());
    await Promise.all(workers);

    console.log(`[Thumbnails] Cache warmed successfully! Generated ${completed} thumbnails.`);
  } catch (err) {
    console.warn(`[Thumbnails] Cache warming failed: ${oneLine(err.message)}`);
  }
}
