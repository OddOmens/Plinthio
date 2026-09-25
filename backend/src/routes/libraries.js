import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { scanLibrary } from '../services/scanner.js';
import { logger } from '../services/logger.js';
import { serverError } from '../utils/http.js';

const router = express.Router();

// The library types the scanner actually knows how to walk (see walkDirectory in
// services/scanner.js). Shared with the setup wizard's library bootstrap in auth.js so the
// two entry points can't drift apart again.
export const LIBRARY_TYPES = ['audiobooks', 'manga', 'books', 'shows', 'movies', 'anime'];

router.use(authenticateToken);

export function resolveLibraryPath(inputPath) {
  let p = inputPath.trim();
  if (fs.existsSync(p)) return p;

  // If host path like /media/<user>/Database... was provided, map to /media
  const hostMatch = p.match(/^\/media\/[^/]+\/Database\d*(\/.*)?$/i);
  if (hostMatch) {
    const relative = hostMatch[1] || '';
    const containerPath = path.join('/media', relative);
    if (fs.existsSync(containerPath)) return containerPath;
  }

  // Also test prepending /media if user typed just "Books" or "/Books"
  const mediaSub = path.join('/media', p.replace(/^\//, ''));
  if (fs.existsSync(mediaSub)) return mediaSub;

  return p;
}

// List libraries with total items count
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const libraries = await db.all(`
      SELECT l.*, COUNT(i.id) as item_count
      FROM libraries l
      LEFT JOIN items i ON l.id = i.library_id
      GROUP BY l.id
      ORDER BY l.name ASC
    `);
    // Mount paths are server layout; only admins (who manage libraries) need them.
    if (req.user.role !== 'admin') {
      for (const lib of libraries) delete lib.path;
    }
    res.json({ libraries });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Shared by the admin browse route below and the pre-setup browse route in auth.js, so the
// first-run wizard can offer the same folder picker the Admin panel has.
export function listMediaDirectories(dir) {
  const targetDir = dir ? resolveLibraryPath(dir) : '/media';
  if (!fs.existsSync(targetDir)) {
    return { currentDir: targetDir, directories: [] };
  }

  const directories = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      path: path.join(targetDir, e.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { currentDir: targetDir, directories };
}

// Browse available media folders in /media
router.get('/browse', requireAdmin, async (req, res) => {
  try {
    res.json(listMediaDirectories(req.query.dir));
  } catch (err) {
    serverError(req, res, err);
  }
});

// Create new library (Admin only)
router.post('/', requireAdmin, async (req, res) => {
  let { name, path: libPath, type } = req.body;

  if (!name || !libPath || !type) {
    return res.status(400).json({ error: 'Name, path, and type are required' });
  }

  // Must stay in sync with the scanner's walkDirectory() type handling, the Admin "Add
  // Library" dropdown, and the setup wizard — video types were supported by the scanner and
  // offered in both UIs while this validator still rejected them, so picking Movies/TV/Anime
  // failed with a 400 and video was impossible to set up at all.
  if (!LIBRARY_TYPES.includes(type)) {
    return res.status(400).json({ error: `Type must be one of: ${LIBRARY_TYPES.join(', ')}` });
  }

  const resolvedPath = resolveLibraryPath(libPath);

  if (!fs.existsSync(resolvedPath)) {
    return res.status(400).json({
      error: `Directory not found: "${libPath}". In Docker, your host database is mounted at "/media" (e.g., "/media/Books" or "/media/Manga").`
    });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();

    await db.run(
      'INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
      [id, name.trim(), resolvedPath, type]
    );
    logger.info('library', `Library "${name.trim()}" (${type}) created by admin ${req.user.username}`, { libraryId: id, path: resolvedPath });

    // Auto-trigger initial scan in background
    scanLibrary(id).catch(err => console.error(`Error in initial scan for ${name}:`, err));

    res.json({
      message: 'Library created and scanning started',
      library: { id, name: name.trim(), path: resolvedPath, type }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Trigger library scan
router.post('/:id/scan', requireAdmin, async (req, res) => {
  try {
    const result = await scanLibrary(req.params.id);
    res.json(result);
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete library (Admin only) — cascades to remove every item, progress row, and bookmark
// tied to it, so log exactly what's about to be lost before it's gone for good.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const lib = await db.get('SELECT name, type, path FROM libraries WHERE id = ?', [req.params.id]);
    if (!lib) {
      return res.status(404).json({ error: 'Library not found' });
    }
    const itemCount = await db.get('SELECT COUNT(*) as count FROM items WHERE library_id = ?', [req.params.id]);

    await db.run('DELETE FROM libraries WHERE id = ?', [req.params.id]);
    logger.warn(
      'library',
      `Library "${lib.name}" (${lib.type}) deleted by admin ${req.user.username} — ${itemCount.count} catalog item(s) removed (reading progress/bookmarks are preserved and will re-attach if the same folder is re-scanned)`,
      { libraryId: req.params.id, path: lib.path }
    );

    res.json({ message: 'Library deleted successfully' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
