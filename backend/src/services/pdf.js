import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { config } from '../config/env.js';
import { PlinthioError } from '../errors.js';

// PDF pages are rendered to cached JPEGs (pdftoppm) on first request, so every reader and API
// serves PDFs through the same page URLs as a CBZ. 1600px long side ≈ 200-400 KB a page.
const PAGE_LONG_SIDE = 1600;
const TIMEOUT_MS = 60000;
const MAX_CONCURRENT = 2;
const pagesDir = path.join(config.cacheDir, 'pdf-pages');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        if (err.code === 'ENOENT') {
          reject(new PlinthioError('P308', `${cmd} is not installed`, { cause: err }));
        } else {
          reject(new PlinthioError('P309', `${cmd} failed: ${err.message}`, { cause: err }));
        }
        return;
      }
      resolve(stdout);
    });
  });
}

// Keyed on path, size and mtime so a replaced file is re-read rather than served stale.
function fileKey(filePath) {
  const st = fs.statSync(filePath);
  return crypto.createHash('sha1').update(`${filePath}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 20);
}

const infoCache = new Map();

// The page count is file-controlled and sizes the reader's page list; cap crafted values.
export const MAX_PDF_PAGES = 20000;

export function clampPageCount(value) {
  const pages = parseInt(value, 10);
  if (!Number.isFinite(pages) || pages <= 0) return 0;
  return Math.min(pages, MAX_PDF_PAGES);
}

export async function pdfInfo(filePath) {
  const key = fileKey(filePath);
  if (infoCache.has(key)) return infoCache.get(key);
  const out = await run('pdfinfo', [filePath]);
  const field = (name) => {
    const m = out.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
    return m && m[1].trim() ? m[1].trim() : null;
  };
  const info = {
    pages: clampPageCount(field('Pages')),
    title: field('Title'),
    author: field('Author')
  };
  if (infoCache.size > 500) infoCache.clear();
  infoCache.set(key, info);
  return info;
}

let running = 0;
const queue = [];
function limited(task) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      task().then(resolve, reject).finally(() => {
        running--;
        if (queue.length) queue.shift()();
      });
    };
    if (running < MAX_CONCURRENT) go();
    else queue.push(go);
  });
}

const inFlight = new Map();
// Volume folders with a render running, so the cache sweep leaves them alone.
const busyDirs = new Map();
function markBusy(dir, delta) {
  const n = (busyDirs.get(dir) || 0) + delta;
  if (n > 0) busyDirs.set(dir, n);
  else busyDirs.delete(dir);
}

/** Path to the rendered JPEG of a 0-based page, or null past the end. */
export async function renderPdfPage(filePath, pageIndex, { longSide = PAGE_LONG_SIDE } = {}) {
  const { pages } = await pdfInfo(filePath);
  if (pageIndex < 0 || pageIndex >= pages) return null;

  const dir = path.join(pagesDir, fileKey(filePath));
  const finalPath = path.join(dir, `${pageIndex}-${longSide}.jpg`);
  if (fs.existsSync(finalPath)) {
    // Keeps the folder fresh for the age sweep.
    const now = new Date();
    fs.promises.utimes(dir, now, now).catch(() => {});
    return finalPath;
  }

  if (!inFlight.has(finalPath)) {
    markBusy(dir, 1);
    inFlight.set(finalPath, limited(async () => {
      fs.mkdirSync(dir, { recursive: true });
      const prefix = path.join(dir, `tmp-${process.pid}-${pageIndex}-${longSide}`);
      const n = String(pageIndex + 1);
      await run('pdftoppm', [
        '-f', n, '-l', n,
        '-scale-to', String(longSide),
        '-jpeg', '-jpegopt', 'quality=85',
        '-singlefile',
        filePath, prefix
      ]);
      fs.renameSync(`${prefix}.jpg`, finalPath);
      return finalPath;
    }).finally(() => {
      inFlight.delete(finalPath);
      markBusy(dir, -1);
    }));
  }
  return inFlight.get(finalPath);
}

/** Drops rendered pages not read within `maxAgeMs`, skipping folders with a render in progress. */
export function sweepPdfPageCache(maxAgeMs) {
  let entries;
  try {
    entries = fs.readdirSync(pagesDir);
  } catch {
    return; // Nothing rendered yet.
  }
  const now = Date.now();
  for (const entry of entries) {
    const dir = path.join(pagesDir, entry);
    if (busyDirs.has(dir)) continue;
    try {
      if (now - fs.statSync(dir).mtimeMs >= maxAgeMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Already gone.
    }
  }
}

/** Writes page one as the item's cover; returns its filename or null. */
export async function extractPdfCover(filePath, itemId) {
  try {
    const page = await renderPdfPage(filePath, 0, { longSide: 900 });
    if (!page) return null;
    const coverFilename = `${itemId}.jpg`;
    fs.copyFileSync(page, path.join(config.coversDir, coverFilename));
    return coverFilename;
  } catch (err) {
    return null;
  }
}
