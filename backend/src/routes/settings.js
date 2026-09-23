import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  listBackupFiles,
  getBackupSettings,
  saveBackupSettings,
  runManualBackupAndPrune,
  getBackupFilePath,
  deleteBackupFile
} from '../services/backup.js';

const router = express.Router();

const DEFAULT_FILTERS = ['grid', 'author', 'series', 'disk_folder', 'custom_folder'];

// Public / user endpoint to get allowed filters on this server
router.get('/filters', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT value FROM settings WHERE key = 'allowed_grouping_modes'");
    let allowed = DEFAULT_FILTERS;
    if (row && row.value) {
      try {
        allowed = JSON.parse(row.value);
      } catch (e) {}
    }
    res.json({ allowedGroupingModes: allowed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to update allowed grouping modes
router.patch('/filters', authenticateToken, requireAdmin, async (req, res) => {
  const { allowedGroupingModes } = req.body;

  if (!Array.isArray(allowedGroupingModes) || allowedGroupingModes.length === 0) {
    return res.status(400).json({ error: 'At least one filter mode must remain enabled' });
  }

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('allowed_grouping_modes', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(allowedGroupingModes)]
    );

    res.json({ message: 'Global filter settings updated', allowedGroupingModes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to check whether a TMDB API key is configured (never returns the key itself)
router.get('/metadata-providers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT value FROM settings WHERE key = 'tmdb_api_key'");
    res.json({ tmdbConfigured: !!(row && row.value) || !!process.env.TMDB_API_KEY });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('tmdb_api_key', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [apiKey.trim()]
    );

    res.json({ message: 'TMDB API key saved', tmdbConfigured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: list backups currently stored on disk
router.get('/backup/list', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ backups: listBackupFiles() });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
