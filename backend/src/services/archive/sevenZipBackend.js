import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config/env.js';

// Unlike the zip and rar backends, 7-Zip only gives us whole-archive extraction to a
// directory — there's no "read one entry into memory" API. So a .cb7 is unpacked once into
// the cache directory on first access and pages are then read straight off disk. The cache
// is aged out by sweepArchiveCache() below.
const ARCHIVE_CACHE_DIR = path.join(config.cacheDir, 'archives');

let sevenZip = null;

async function getSevenZip() {
  if (!sevenZip) {
    try {
      sevenZip = (await import('7zip-min')).default;
    } catch (err) {
      throw new Error('CB7/7z support requires the 7zip-min package — run `npm install` in backend/');
    }
  }
  return sevenZip;
}

function unpack(sevenZipModule, archivePath, destDir) {
  return new Promise((resolve, reject) => {
    sevenZipModule.unpack(archivePath, destDir, (err) => (err ? reject(err) : resolve()));
  });
}

function cacheDirFor(archivePath) {
  const hash = crypto.createHash('md5').update(path.resolve(archivePath)).digest('hex');
  return path.join(ARCHIVE_CACHE_DIR, hash);
}

// Extraction is written to a temp directory and renamed into place, so a half-extracted
// archive is never visible as a complete cache entry (same trick thumbnails.js uses).
async function ensureExtracted(archivePath) {
  const dir = cacheDirFor(archivePath);
  if (fs.existsSync(dir)) {
    fs.utimesSync(dir, new Date(), new Date());
    return dir;
  }

  const sevenZipModule = await getSevenZip();
  const tempDir = `${dir}.${Date.now()}.tmp`;
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await unpack(sevenZipModule, archivePath, tempDir);
    fs.renameSync(tempDir, dir);
    return dir;
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Could not extract 7z archive: ${err.message}`);
  }
}

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ name: rel, isDirectory: true });
      out.push(...walk(path.join(dir, entry.name), rel));
    } else {
      out.push({ name: rel, isDirectory: false });
    }
  }
  return out;
}

export default {
  async listEntries(archivePath) {
    const dir = await ensureExtracted(archivePath);
    return walk(dir);
  },

  async readEntry(archivePath, name) {
    const dir = await ensureExtracted(archivePath);
    const target = path.join(dir, name);
    // Entry names come from the archive itself, so keep the resolved read inside the cache.
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) return null;
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }
};

export function sweepArchiveCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(ARCHIVE_CACHE_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(ARCHIVE_CACHE_DIR)) {
    const dir = path.join(ARCHIVE_CACHE_DIR, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Already gone — nothing to do.
    }
  }
}
