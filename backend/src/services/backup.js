import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const BACKUP_PREFIX = 'plinthio-backup-';
const FILENAME_RE = /^plinthio-backup-[A-Za-z0-9.\-]+\.sqlite$/;

// How often the scheduler wakes up to check whether a backup is due. Independent of the
// configured backup interval — this just needs to be finer-grained than the shortest
// interval an admin can pick.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function backupsDir() {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listBackupFiles() {
  const dir = backupsDir();
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.sqlite'))
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBackupSettings() {
  const db = await getDb();
  const rows = await db.all(
    "SELECT key, value FROM settings WHERE key IN ('backup_enabled', 'backup_interval_hours', 'backup_retention')"
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map.backup_enabled === 'true',
    intervalHours: map.backup_interval_hours ? parseInt(map.backup_interval_hours, 10) : 24,
    retentionCount: map.backup_retention ? parseInt(map.backup_retention, 10) : 7
  };
}

export async function saveBackupSettings({ enabled, intervalHours, retentionCount }) {
  const db = await getDb();
  const entries = [
    ['backup_enabled', enabled ? 'true' : 'false'],
    ['backup_interval_hours', String(intervalHours)],
    ['backup_retention', String(retentionCount)]
  ];
  for (const [key, value] of entries) {
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  }
  return getBackupSettings();
}

// Creates a complete, consistent snapshot via VACUUM INTO (safe under WAL mode, unlike a
// raw filesystem copy of the .sqlite file which can miss recently committed pages still
// sitting in the -wal file) and persists it under dataDir/backups.
export async function createBackup(reason = 'manual') {
  const dir = backupsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${BACKUP_PREFIX}${stamp}.sqlite`;
  const backupPath = path.join(dir, filename);

  const db = await getDb();
  await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

  const stat = fs.statSync(backupPath);
  await logger.info('backup', `Database backup created (${reason})`, { filename, bytes: stat.size });

  return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
}

async function pruneOldBackups(retentionCount) {
  const files = listBackupFiles(); // newest first
  const toDelete = files.slice(Math.max(retentionCount, 0));
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(backupsDir(), f.filename));
      await logger.info('backup', `Pruned old backup "${f.filename}" (retention limit is ${retentionCount})`);
    } catch (e) {
      // Already gone or unremovable — not worth failing the whole prune pass over.
    }
  }
}

function newestBackupTime() {
  const files = listBackupFiles();
  return files.length > 0 ? new Date(files[0].createdAt).getTime() : null;
}

async function runBackupIfDue() {
  try {
    const settings = await getBackupSettings();
    if (!settings.enabled) return;

    const last = newestBackupTime();
    const intervalMs = settings.intervalHours * 60 * 60 * 1000;
    if (last !== null && Date.now() - last < intervalMs) return;

    await createBackup('scheduled');
    await pruneOldBackups(settings.retentionCount);
  } catch (err) {
    await logger.error('backup', `Scheduled backup failed: ${err.message}`);
  }
}

let schedulerStarted = false;
export function initBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // Give the DB a moment to finish initializing before the first check, then recheck
  // periodically — runBackupIfDue itself no-ops until an interval has actually elapsed.
  setTimeout(runBackupIfDue, 60 * 1000);
  setInterval(runBackupIfDue, CHECK_INTERVAL_MS);
}

export async function runManualBackupAndPrune() {
  const result = await createBackup('manual');
  const settings = await getBackupSettings();
  await pruneOldBackups(settings.retentionCount);
  return result;
}

function safeBackupPath(filename) {
  if (!FILENAME_RE.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const full = path.join(backupsDir(), filename);
  if (!fs.existsSync(full)) {
    throw new Error('Backup file not found');
  }
  return full;
}

export function getBackupFilePath(filename) {
  return safeBackupPath(filename);
}

export async function deleteBackupFile(filename) {
  const full = safeBackupPath(filename);
  fs.unlinkSync(full);
  await logger.info('backup', `Backup "${filename}" deleted by admin`);
}
