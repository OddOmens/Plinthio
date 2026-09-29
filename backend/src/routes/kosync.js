import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { userForApiKeyMd5 } from '../middleware/auth.js';
import { outsideAccessError } from '../services/network.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { logger } from '../services/logger.js';

// KOReader's progress sync ("Progress sync" plugin), mounted at /api/kosync — the address
// KOReader is given as its custom sync server. It speaks the kosync protocol:
//
//   GET  /users/auth              check the credentials (x-auth-user, x-auth-key headers)
//   POST /users/create            refused: accounts are made in Plinthio
//   PUT  /syncs/progress          { document, progress, percentage, device, device_id }
//   GET  /syncs/progress/:doc     the latest position for that document
//
// x-auth-user is the Plinthio username and x-auth-key is the MD5 of the "password", which
// is a Plinthio API key (KOReader hashes it before sending; keys store their MD5 for this).
//
// KOReader names a book by a hash of the file — a sample of 1 KB blocks, its "binary"
// method and the default — or by a hash of the file name. When the document matches a book
// in the library, the position also moves Plinthio's progress for it, and Plinthio's
// progress is sent back when it's newer. Positions for books Plinthio doesn't have are still
// kept, so KOReader devices sync with each other through Plinthio like any kosync server.
const router = express.Router();

// kosync's own error codes, which KOReader shows.
const unauthorized = (res) => res.status(401).json({ code: 2001, message: 'Unauthorized' });

router.get('/healthcheck', (req, res) => res.json({ state: 'OK' }));

router.post('/users/create', (req, res) => {
  res.status(402).json({
    code: 2005,
    message: 'Accounts are made in Plinthio. Choose Login, with your Plinthio username and a Plinthio API key as the password.'
  });
});

router.use(async (req, res, next) => {
  const username = req.headers['x-auth-user'];
  const key = req.headers['x-auth-key'];
  if (!username || !key) return unauthorized(res);
  try {
    const found = await userForApiKeyMd5(username, key);
    if (!found || found.expired) return unauthorized(res);
    // Home-only server or account, reached from outside (services/network.js).
    if (await outsideAccessError(req, found.user)) {
      return res.status(403).json({ code: 2001, message: 'This Plinthio account can only be used from the home network' });
    }
    req.user = found.user;
    next();
  } catch (err) {
    res.status(500).json({ code: 2000, message: 'Unknown server error' });
  }
});

router.get('/users/auth', (req, res) => res.json({ authorized: 'OK' }));

// ─── Matching KOReader's document ids to library items ──────────────────────────────────
// KOReader's partial MD5 (util.partialMD5): 1 KB read at offset 0, then at 1 KB, 4 KB,
// 16 KB … 1 GB (1024 << 2i), stopping at the end of the file.
export function koreaderPartialMd5(filePath) {
  const hash = crypto.createHash('md5');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024);
    for (let i = -1; i <= 10; i++) {
      const offset = i < 0 ? 0 : 1024 * (4 ** i);
      const read = fs.readSync(fd, buf, 0, 1024, offset);
      if (read <= 0) break;
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

const READABLE_TYPES = ['book', 'manga'];
let hashing = null;

// Hashes every readable item that doesn't have one yet (new ones, or ones the scanner reset
// because their file changed). A dozen 1 KB reads per file, done once.
function ensureHashes(db) {
  if (!hashing) {
    hashing = (async () => {
      const rows = await db.all(
        `SELECT id, path FROM items
         WHERE (koreader_hash IS NULL OR koreader_name_hash IS NULL)
           AND media_type IN (${READABLE_TYPES.map(() => '?').join(',')}) AND missing_since IS NULL`,
        READABLE_TYPES
      );
      for (const row of rows) {
        let binary = null;
        try {
          binary = koreaderPartialMd5(row.path);
        } catch (e) {
          continue; // unreadable right now; tried again next time
        }
        const name = crypto.createHash('md5').update(path.basename(row.path)).digest('hex');
        await db.run('UPDATE items SET koreader_hash = ?, koreader_name_hash = ? WHERE id = ?', [binary, name, row.id]);
      }
    })().finally(() => { hashing = null; });
  }
  return hashing;
}

async function itemForDocument(db, user, document) {
  await ensureHashes(db);
  const item = await db.get(
    `SELECT id, format, total_pages FROM items
     WHERE (koreader_hash = ? OR koreader_name_hash = ?) AND missing_since IS NULL
     ORDER BY koreader_hash = ? DESC LIMIT 1`,
    [document, document, document]
  );
  if (!item || await isItemHiddenForUser(db, item.id, user)) return null;
  return item;
}

const isPaged = (item) => String(item.format).toLowerCase() !== 'epub';
const DOC_RE = /^[a-f0-9]{32}$/i;

// ─── Progress ────────────────────────────────────────────────────────────────────────────
router.put('/syncs/progress', async (req, res) => {
  const { document, progress, device, device_id: deviceId } = req.body || {};
  const percentage = Number(req.body?.percentage);
  if (typeof document !== 'string' || !DOC_RE.test(document) || progress == null || !Number.isFinite(percentage)) {
    return res.status(403).json({ code: 2003, message: 'Invalid request' });
  }
  const pct = Math.min(1, Math.max(0, percentage));

  try {
    const db = await getDb();
    const item = await itemForDocument(db, req.user, document);
    await db.run(`
      INSERT INTO kosync_progress (user_id, document, item_id, progress, percentage, device, device_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, document) DO UPDATE SET
        item_id = excluded.item_id, progress = excluded.progress, percentage = excluded.percentage,
        device = excluded.device, device_id = excluded.device_id, updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, document, item?.id || null, String(progress).slice(0, 2000), pct, String(device || '').slice(0, 100), String(deviceId || '').slice(0, 100)]);

    if (item) {
      // For a PDF or comic, KOReader's position is the page number; for an EPUB it's an
      // XPointer Plinthio can't use, so only the percentage carries over (and the web
      // reader's own position is cleared so it opens at that percentage instead).
      const pages = item.total_pages || 0;
      const page = isPaged(item) ? Math.max(0, parseInt(progress, 10) || 0) : 0;
      const finished = pct >= 0.995 || (pages > 0 && page >= pages) ? 1 : 0;
      await db.run(`
        INSERT INTO user_progress (user_id, item_id, current_page, total_pages, progress_percent, is_finished, is_skipped, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, item_id) DO UPDATE SET
          current_page = excluded.current_page, total_pages = excluded.total_pages,
          progress_percent = excluded.progress_percent, is_finished = excluded.is_finished,
          is_skipped = 0, cfi = NULL, updated_at = CURRENT_TIMESTAMP
      `, [req.user.id, item.id, page, pages, Math.round(pct * 100), finished]);
    }

    res.json({ document, timestamp: Math.floor(Date.now() / 1000) });
  } catch (err) {
    logger.error('sync', `KOReader progress save failed: ${err.message}`);
    res.status(500).json({ code: 2000, message: 'Unknown server error' });
  }
});

const toUnix = (sqliteTime) => Math.floor(new Date(`${String(sqliteTime).replace(' ', 'T')}Z`).getTime() / 1000);

router.get('/syncs/progress/:document', async (req, res) => {
  const { document } = req.params;
  if (!DOC_RE.test(document)) return res.status(403).json({ code: 2003, message: 'Invalid request' });
  try {
    const db = await getDb();
    const saved = await db.get('SELECT * FROM kosync_progress WHERE user_id = ? AND document = ?', [req.user.id, document]);
    const item = await itemForDocument(db, req.user, document);
    const plinthio = item
      ? await db.get('SELECT current_page, progress_percent, is_finished, updated_at FROM user_progress WHERE user_id = ? AND item_id = ?', [req.user.id, item.id])
      : null;

    // Plinthio's own progress wins when it's newer — as a page number, which is all KOReader
    // can take from it (an EPUB's position can only come from another KOReader).
    const plinthioNewer = plinthio && item && isPaged(item) && plinthio.current_page > 0 &&
      (!saved || toUnix(plinthio.updated_at) > toUnix(saved.updated_at));
    if (plinthioNewer) {
      return res.json({
        document,
        progress: String(plinthio.current_page),
        percentage: Math.min(1, (plinthio.progress_percent || 0) / 100),
        device: 'Plinthio',
        device_id: 'plinthio',
        timestamp: toUnix(plinthio.updated_at)
      });
    }
    if (!saved) return res.json({});
    res.json({
      document,
      progress: saved.progress,
      percentage: saved.percentage,
      device: saved.device,
      device_id: saved.device_id,
      timestamp: toUnix(saved.updated_at)
    });
  } catch (err) {
    res.status(500).json({ code: 2000, message: 'Unknown server error' });
  }
});

export default router;
