import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';

// Every file Plinthio catalogues or serves has to really live inside a library folder. A
// library can hold symlinks, and a link is only a name: `book.epub -> /config/jwt.secret`
// looks like a book and reads as the server's signing secret. So both the scanner and the
// routes that hand out file contents resolve the link first and check where it lands.
//
// "Inside a library" means inside ANY library's root, so a link from one library into
// another keeps working. Setups that link out to a separate media pool on purpose can name
// those folders in SYMLINK_ALLOWED_ROOTS (separated like PATH, with ':').
const EXTRA_ROOTS = (process.env.SYMLINK_ALLOWED_ROOTS || '')
  .split(path.delimiter)
  .map((p) => p.trim())
  .filter((p) => p && path.isAbsolute(p));

// The roots change only when an admin adds, moves or removes a library, so they're kept for
// a few seconds rather than read from the database on every segment and page request. A
// file that falls outside the cached roots triggers one re-read (at most once a second)
// before it's refused, so a library added a moment ago works straight away.
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

/**
 * Synchronous check against roots the caller already holds (the scanner's directory walk).
 * Returns the real path, or null when the file is missing or lands outside the roots.
 */
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

/**
 * For routes: the real path to read, or null after answering the request (P301 when the
 * file is gone, 403 when it isn't inside a library).
 */
export async function requireLibraryFile(req, res, filePath) {
  const result = await resolveLibraryFile(filePath);
  if (result.ok) return result.realPath;
  if (result.reason === 'missing') sendError(req, res, 'P301');
  else sendError(req, res, 'P003', { message: 'Access denied: this file is not inside a library folder' });
  return null;
}
