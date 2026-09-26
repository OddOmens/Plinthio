import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getDetectedHwaccel, listHwaccels, testHwaccel } from '../services/hwaccel.js';
import {
  listBackupFiles,
  getBackupSettings,
  saveBackupSettings,
  runManualBackupAndPrune,
  getBackupFilePath,
  deleteBackupFile
} from '../services/backup.js';
import { getAutoScanSettings, saveAutoScanSettings } from '../services/autoScan.js';
import { verifyTmdbApiKey } from '../services/externalMetadata.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';

const router = express.Router();

// Shelf views ("grouping modes"). Series and Creator are the core ways to browse and are
// always available; Disk Folders and Custom Folders are the ones an admin may switch off.
// Older installs stored the previous mode names (grid / author / series), which map onto
// the new ones so a saved choice survives the upgrade.
const SHELF_MODES = ['series', 'creator', 'disk_folder', 'custom_folder'];
const OPTIONAL_SHELF_MODES = ['disk_folder', 'custom_folder'];
const LEGACY_MODE_NAMES = { grid: 'series', series: 'series', author: 'creator', creator: 'creator', disk_folder: 'disk_folder', custom_folder: 'custom_folder' };

export function normalizeShelfModes(stored) {
  const wanted = new Set((Array.isArray(stored) ? stored : SHELF_MODES).map((m) => LEGACY_MODE_NAMES[m]).filter(Boolean));
  return SHELF_MODES.filter((m) => !OPTIONAL_SHELF_MODES.includes(m) || wanted.has(m));
}

async function readShelfModes(db) {
  const row = await db.get("SELECT value FROM settings WHERE key = 'allowed_grouping_modes'");
  let stored = null;
  try { stored = row?.value ? JSON.parse(row.value) : null; } catch (e) { /* fall back to all */ }
  return normalizeShelfModes(stored);
}

// Which shelf views this server offers (every signed-in user needs this to draw the shelf).
router.get('/filters', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    res.json({ allowedGroupingModes: await readShelfModes(db), optionalGroupingModes: OPTIONAL_SHELF_MODES });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin: turn the optional views on or off. Anything else in the list is ignored — Series
// and Creator can't be disabled.
router.patch('/filters', authenticateToken, requireAdmin, async (req, res) => {
  const { allowedGroupingModes } = req.body;

  if (!Array.isArray(allowedGroupingModes)) {
    return res.status(400).json({ error: 'allowedGroupingModes must be an array' });
  }

  try {
    const db = await getDb();
    const modes = normalizeShelfModes(allowedGroupingModes);
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('allowed_grouping_modes', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(modes)]
    );

    res.json({ message: 'Shelf views updated', allowedGroupingModes: modes });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint to check whether a TMDB API key is configured (never returns the key itself)
router.get('/metadata-providers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'");
    res.json({ tmdbConfigured: !!(row && row.value) || !!process.env.TMDB_API_KEY });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Hardware transcoding: what this machine can do, and what the admin has chosen.
router.get('/transcoding', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT value FROM settings WHERE key = 'transcode_hwaccel'");
    res.json({
      preference: row?.value || 'auto',
      detected: await getDetectedHwaccel(),
      available: listHwaccels()
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.put('/transcoding', authenticateToken, requireAdmin, async (req, res) => {
  const { preference } = req.body;
  if (!['auto', 'none', ...listHwaccels()].includes(preference)) {
    return res.status(400).json({ error: 'Unknown hardware acceleration preference' });
  }

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('transcode_hwaccel', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [preference]
    );
    res.json({ message: 'Transcoding settings saved', preference });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Runs a short real encode, because ffmpeg listing an encoder is no guarantee the driver
// underneath it actually works — that usually only shows up as failed playback otherwise.
router.post('/transcoding/test', authenticateToken, requireAdmin, async (req, res) => {
  const { method } = req.body;
  if (!listHwaccels().includes(method)) {
    return res.status(400).json({ error: 'Unknown hardware acceleration method' });
  }

  try {
    res.json(await testHwaccel(method));
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint to set/clear the TMDB API key used for movie/show/anime metadata search
router.put('/metadata-providers/tmdb-key', authenticateToken, requireAdmin, async (req, res) => {
  const { apiKey } = req.body;

  try {
    const db = await getDb();
    if (!apiKey || !apiKey.trim()) {
      await db.run("DELETE FROM settings WHERE key = 'tmdb_api_key'");
      return res.json({ message: 'TMDB API key cleared', tmdbConfigured: !!process.env.TMDB_API_KEY });
    }

    // Verify before storing. A key that doesn't work should say so here, not silently do
    // nothing until someone notices their posters never arrived.
    const check = await verifyTmdbApiKey(apiKey);
    if (!check.ok) {
      return sendError(req, res, 'P401', { message: check.reason, status: 400 });
    }

    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('tmdb_api_key', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [apiKey.trim()]
    );

    res.json({
      message: check.authStyle === 'read-access-token'
        ? 'TMDB Read Access Token saved and verified'
        : 'TMDB API key saved and verified',
      tmdbConfigured: true
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint: download a consistent point-in-time snapshot of the database.
// Uses SQLite's own VACUUM INTO rather than copying the file directly — the live database
// runs in WAL mode, so a raw filesystem copy of just the .sqlite file can miss recently
// committed data still sitting in the -wal file. VACUUM INTO produces one complete,
// self-contained, crash-safe file. Note: this only covers the database — covers/, the
// jwt.secret, and the media libraries themselves live under the same /config and library
// volumes and should be included in whatever external backup schedule you run for those.
router.get('/backup', authenticateToken, requireAdmin, async (req, res) => {
  const backupsDir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `plinthio-backup-${stamp}.sqlite`;
  const backupPath = path.join(backupsDir, filename);

  try {
    const db = await getDb();
    await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    res.download(backupPath, filename, (err) => {
      fs.unlink(backupPath, () => {});
      if (err) console.error('Backup download failed:', err.message);
    });
  } catch (err) {
    fs.unlink(backupPath, () => {});
    res.status(500).json({ error: `Backup failed: ${err.message}` });
  }
});

// Admin endpoint: read the automatic backup schedule (enabled, interval, retention)
router.get('/backup/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const settings = await getBackupSettings();
    res.json(settings);
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint: update the automatic backup schedule
router.put('/backup/config', authenticateToken, requireAdmin, async (req, res) => {
  const { enabled, intervalHours, retentionCount } = req.body;

  const parsedInterval = parseInt(intervalHours, 10);
  const parsedRetention = parseInt(retentionCount, 10);

  if (!Number.isFinite(parsedInterval) || parsedInterval < 1 || parsedInterval > 168) {
    return res.status(400).json({ error: 'Interval must be between 1 and 168 hours' });
  }
  if (!Number.isFinite(parsedRetention) || parsedRetention < 1 || parsedRetention > 30) {
    return res.status(400).json({ error: 'Retention must be between 1 and 30 backups' });
  }

  try {
    const settings = await saveBackupSettings({
      enabled: !!enabled,
      intervalHours: parsedInterval,
      retentionCount: parsedRetention
    });
    res.json({ message: 'Backup schedule updated', ...settings });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoints: automatic library scanning (periodic sweep + filesystem watcher)
router.get('/auto-scan', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json(await getAutoScanSettings());
  } catch (err) {
    serverError(req, res, err);
  }
});

router.put('/auto-scan', authenticateToken, requireAdmin, async (req, res) => {
  const { enabled, intervalMinutes, watchEnabled } = req.body;

  if (intervalMinutes !== undefined) {
    const parsed = parseInt(intervalMinutes, 10);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 7 * 24 * 60) {
      return res.status(400).json({ error: 'Scan interval must be between 5 minutes and 7 days' });
    }
  }

  try {
    const settings = await saveAutoScanSettings({ enabled, intervalMinutes, watchEnabled });
    res.json({ message: 'Automatic scanning updated', ...settings });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint: list backups currently stored on disk
router.get('/backup/list', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ backups: listBackupFiles() });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin endpoint: create a backup right now and keep it on disk (unlike GET /backup, which
// streams a one-off snapshot to the browser and deletes the server-side copy afterward)
router.post('/backup/create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await runManualBackupAndPrune();
    res.json({ message: 'Backup created', backup: result, backups: listBackupFiles() });
  } catch (err) {
    res.status(500).json({ error: `Backup failed: ${err.message}` });
  }
});

// Admin endpoint: download one previously stored backup
router.get('/backup/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filePath = getBackupFilePath(req.params.filename);
    res.download(filePath, req.params.filename);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Admin endpoint: delete one stored backup
router.delete('/backup/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await deleteBackupFile(req.params.filename);
    res.json({ message: 'Backup deleted', backups: listBackupFiles() });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
