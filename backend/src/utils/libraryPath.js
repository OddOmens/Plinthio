import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';

// Every file catalogued or served must really live inside a library: a symlink like
// `book.epub -> /config/jwt.secret` would otherwise serve the signing secret. "Inside" means
// any library's root; extra targets can be listed in SYMLINK_ALLOWED_ROOTS (':'-separated).
const EXTRA_ROOTS = (process.env.SYMLINK_ALLOWED_ROOTS || '')
  .split(path.delimiter)
  .map((p) => p.trim())
  .filter((p) => p && path.isAbsolute(p));

// Roots are cached for a few seconds. A miss forces one re-read (at most once a second)
// before refusing, so a just-added library works straight away.
const ROOTS_TTL_MS = 5000;
const MISS_REFRESH_MS = 1000;
let cached = { roots: null, at: 0 };

async function loadRoots() {
  const db = await getDb();
  const libraries = await db.all('SELECT path FROM libraries');
  const roots = new Set();
  for (const dir of [...libraries.map((l) => l.path), ...EXTRA_ROOTS]) {
    if (!dir) continue;
    try {
      roots.add(fs.realpathSync(dir));
    } catch (e) {
      // A library whose folder is gone (unmounted drive) has nothing under it to serve.
    }
  }
  cached = { roots: [...roots], at: Date.now() };
  return cached.roots;
}

/** The real (symlink-free) path of every library root. `fresh` skips the short cache. */
export async function getLibraryRoots({ fresh = false } = {}) {
  if (!fresh && cached.roots && Date.now() - cached.at < ROOTS_TTL_MS) return cached.roots;
  return loadRoots();
}

export function isInsideRoots(realPath, roots) {
  return roots.some((root) => {
    if (realPath === root) return true;
    return realPath.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

// One line per offending path, not one per request or per scan.
const warned = new Set();
export function warnOutsideLibrary(filePath, realPath, category = 'media') {
  if (warned.has(filePath)) return;
  if (warned.size >= 2000) warned.clear();
  warned.add(filePath);
  logger.warn(category, `Skipped "${filePath}": it links to "${realPath}", which is outside every library folder`);
}

/** Sync check against roots the caller holds: the real path, or null if missing or outside. */
export function realPathInRoots(filePath, roots, category = 'media') {
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
  } catch (e) {
    return null;
  }
  if (isInsideRoots(realPath, roots)) return realPath;
  warnOutsideLibrary(filePath, realPath, category);
  return null;
}

/**
 * Resolves a catalogued path to the file it really is.
 *   { ok: true, realPath }          it exists and sits inside a library
 *   { ok: false, reason: 'missing' } it isn't on disk (or a parent folder isn't)
 *   { ok: false, reason: 'outside' } it resolves to somewhere outside every library
 * Other filesystem errors (EIO, EACCES) are thrown for the caller's own error handling.
 */
export async function resolveLibraryFile(filePath) {
  if (!filePath) return { ok: false, reason: 'missing' };
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { ok: false, reason: 'missing' };
    throw err;
  }

  let roots = await getLibraryRoots();
  if (!isInsideRoots(realPath, roots) && Date.now() - cached.at >= MISS_REFRESH_MS) {
    roots = await getLibraryRoots({ fresh: true });
  }
  if (isInsideRoots(realPath, roots)) return { ok: true, realPath };

  warnOutsideLibrary(filePath, realPath);
  return { ok: false, reason: 'outside' };
}

/** For routes: the real path, or null after answering (P301 if gone, 403 if outside). */
export async function requireLibraryFile(req, res, filePath) {
  const result = await resolveLibraryFile(filePath);
  if (result.ok) return result.realPath;
  if (result.reason === 'missing') sendError(req, res, 'P301');
  else sendError(req, res, 'P003', { message: 'Access denied: this file is not inside a library folder' });
  return null;
}
