import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { extractMangaPage } from './archive.js';

// Comic pages resized to the reader's ?w=<device pixels>, rounded up to one of these widths
// so a few cached sizes cover every screen.
export const PAGE_WIDTHS = [720, 1080, 1440, 2160];

const PAGE_CACHE_DIR = path.join(config.cacheDir, 'pages');

// Smallest standard width >= requested, or null to send the original.
export function pickPageWidth(raw) {
  const wanted = parseInt(raw, 10);
  if (!Number.isInteger(wanted) || wanted <= 0) return null;
  return PAGE_WIDTHS.find((w) => w >= wanted) || null;
}

function cacheFile(itemId, pageIndex, width) {
  return path.join(PAGE_CACHE_DIR, itemId, `${pageIndex}-${width}`);
}

// { data, mimeType } or null if no such page. Cached on disk with a `.type` mime sidecar.
export async function resizedMangaPage(itemId, archivePath, pageIndex, width) {
  const file = cacheFile(itemId, pageIndex, width);
  try {
    const [data, mimeType] = await Promise.all([
      fs.promises.readFile(file),
      fs.promises.readFile(`${file}.type`, 'utf8')
    ]);
    const archiveMtime = (await fs.promises.stat(archivePath)).mtimeMs;
    if ((await fs.promises.stat(file)).mtimeMs >= archiveMtime) {
      // Marks the volume folder recently used for the sweep.
      const now = new Date();
      fs.promises.utimes(path.dirname(file), now, now).catch(() => {});
      return { data, mimeType };
    }
  } catch {
    // Not cached or stale.
  }

  const page = await extractMangaPage(archivePath, pageIndex);
  if (!page) return null;

  let result = { data: page.data, mimeType: page.mimeType };
  // GIFs are left alone to keep animation.
  if (page.mimeType !== 'image/gif') {
    try {
      const resized = await sharp(page.data)
        .rotate()
        .resize(width, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      // Keep whichever is smaller.
      if (resized.length < page.data.length) result = { data: resized, mimeType: 'image/webp' };
    } catch (err) {
      console.warn(`[pages] Could not resize page ${pageIndex} of ${itemId}, sending the original:`, err.message);
      return result;
    }
  }

  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, result.data);
    await fs.promises.writeFile(`${file}.type`, result.mimeType);
  } catch (err) {
    console.warn('[pages] Could not cache a resized page:', err.message);
  }
  return result;
}

// Drops resized pages of volumes not read within maxAgeMs.
export function sweepPageCache(maxAgeMs) {
  if (!fs.existsSync(PAGE_CACHE_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(PAGE_CACHE_DIR)) {
    const dir = path.join(PAGE_CACHE_DIR, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Already gone.
    }
  }
}
