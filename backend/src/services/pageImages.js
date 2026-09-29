import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { extractMangaPage } from './archive.js';

// Comic and manga pages sized for the screen reading them. Scans are commonly 2000–3500px
// tall and several MB each; a phone showing them 390px wide downloaded (and decoded) all of
// that for nothing. The reader asks for ?w=<device pixels>, rounded up to one of these
// widths so a handful of cached sizes cover every screen.
export const PAGE_WIDTHS = [720, 1080, 1440, 2160];

const PAGE_CACHE_DIR = path.join(config.cacheDir, 'pages');

// The smallest standard width at least as wide as asked for, or null for "send the
// original" (no width, nonsense, or wider than anything we'd scale to).
export function pickPageWidth(raw) {
  const wanted = parseInt(raw, 10);
  if (!Number.isInteger(wanted) || wanted <= 0) return null;
  return PAGE_WIDTHS.find((w) => w >= wanted) || null;
}

function cacheFile(itemId, pageIndex, width) {
  return path.join(PAGE_CACHE_DIR, itemId, `${pageIndex}-${width}`);
}

// Returns { data, mimeType } for a page at (at most) `width` pixels wide, or null when the
// page doesn't exist. Cached on disk as the bytes plus a one-line mime type sidecar.
export async function resizedMangaPage(itemId, archivePath, pageIndex, width) {
  const file = cacheFile(itemId, pageIndex, width);
  try {
    const [data, mimeType] = await Promise.all([
      fs.promises.readFile(file),
      fs.promises.readFile(`${file}.type`, 'utf8')
    ]);
    const archiveMtime = (await fs.promises.stat(archivePath)).mtimeMs;
    if ((await fs.promises.stat(file)).mtimeMs >= archiveMtime) {
      // Keeps the volume's folder "recently used" for the cache sweep.
      const now = new Date();
      fs.promises.utimes(path.dirname(file), now, now).catch(() => {});
      return { data, mimeType };
    }
  } catch {
    // Not cached yet (or the archive changed since) — build it below.
  }

  const page = await extractMangaPage(archivePath, pageIndex);
  if (!page) return null;

  let result = { data: page.data, mimeType: page.mimeType };
  // Animated GIFs would lose their animation; leave them (rare in comics) as they are.
  if (page.mimeType !== 'image/gif') {
    try {
      const resized = await sharp(page.data)
        .rotate()
        .resize(width, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      // A page that was already small and well compressed can come out bigger; keep
      // whichever is lighter.
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

// Drops the resized pages of volumes nobody has read for a while (same age limit as the
// other media caches, see HLS_CACHE_MAX_AGE_HOURS).
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
