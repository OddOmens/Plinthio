import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { config } from '../config/env.js';
import { PlinthioError } from '../errors.js';

// PDFs read page by page, like a comic: each page is rendered to a JPEG on the server the
// first time it's asked for (poppler's pdftoppm, installed in the Docker image) and cached on
// disk. Serving images rather than the PDF means the web reader, offline downloads, OPDS and
// the Komga API for Mihon all get PDFs through the same page URLs as a CBZ.
//
// Pages are rendered 1600px on their long side: sharp on a tablet, ~200-400 KB a page.
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

/**
 * Page count, title and author from the PDF's own metadata.
 */
export async function pdfInfo(filePath) {
  const key = fileKey(filePath);
  if (infoCache.has(key)) return infoCache.get(key);
  const out = await run('pdfinfo', [filePath]);
  const field = (name) => {
    const m = out.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
    return m && m[1].trim() ? m[1].trim() : null;
  };
  const info = {
    pages: parseInt(field('Pages'), 10) || 0,
    title: field('Title'),
    author: field('Author')
  };
  if (infoCache.size > 500) infoCache.clear();
  infoCache.set(key, info);
  return info;
}

// Two renders at once at most; the rest wait their turn.
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

/**
 * Path of a rendered JPEG of page `pageIndex` (0-based), rendering it first if needed.
 * Returns null for a page past the end.
 */
export async function renderPdfPage(filePath, pageIndex, { longSide = PAGE_LONG_SIDE } = {}) {
  const { pages } = await pdfInfo(filePath);
  if (pageIndex < 0 || pageIndex >= pages) return null;

  const dir = path.join(pagesDir, fileKey(filePath));
  const finalPath = path.join(dir, `${pageIndex}-${longSide}.jpg`);
  if (fs.existsSync(finalPath)) return finalPath;

  if (!inFlight.has(finalPath)) {
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
    }).finally(() => inFlight.delete(finalPath)));
  }
  return inFlight.get(finalPath);
}

/**
 * Writes page one as the item's cover. Returns the cover filename, or null.
 */
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
