import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { logger } from './logger.js';
import { setSetting } from './settings.js';

const BACKUP_PREFIX = 'plinthio-backup-';
const FILENAME_RE = /^plinthio-backup-[A-Za-z0-9.\-]+\.sqlite$/;

// Scheduler check period; only needs to be finer than the shortest backup interval.
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

const SETTING_KEYS = [
  'backup_enabled', 'backup_interval_hours', 'backup_retention',
  'backup_destination', 'backup_copy_retention', 'backup_copy_files', 'backup_copy_server_key',
  'backup_last_copy_at', 'backup_last_copy_error'
];

export async function getBackupSettings() {
  const db = await getDb();
  const rows = await db.all(
    `SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(', ')})`,
    SETTING_KEYS
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    // Second copy location as the server sees it (in Docker, a mounted folder); '' means off.
    destination: map.backup_destination || '',
    copyRetentionCount: map.backup_copy_retention ? parseInt(map.backup_copy_retention, 10) : 30,
    // Also copy what a database restore can't bring back (avatars, covers, certificates).
    copyFiles: map.backup_copy_files === undefined ? true : map.backup_copy_files === 'true',
    // Off by default: the server key signs sessions and unlocks two-factor secrets, so anyone
    // who can read the backup folder could sign in as anyone. Leaving it out only costs
    // re-signing-in and re-enrolling two-factor after a full restore.
    copyServerKey: map.backup_copy_server_key === 'true',
    lastCopyAt: map.backup_last_copy_at || null,
    lastCopyError: map.backup_last_copy_error || null,
    // On by default, so an unconfigured server still keeps a week of daily snapshots.
    enabled: map.backup_enabled === undefined ? true : map.backup_enabled === 'true',
    intervalHours: map.backup_interval_hours ? parseInt(map.backup_interval_hours, 10) : 24,
    retentionCount: map.backup_retention ? parseInt(map.backup_retention, 10) : 7
  };
}

async function writeSettings(entries) {
  const db = await getDb();
  for (const [key, value] of entries) {
    await setSetting(db, key, value);
  }
}

export async function saveBackupSettings({ enabled, intervalHours, retentionCount, destination, copyRetentionCount, copyFiles, copyServerKey }) {
  const entries = [
    ['backup_enabled', enabled ? 'true' : 'false'],
    ['backup_interval_hours', String(intervalHours)],
    ['backup_retention', String(retentionCount)]
  ];
  if (destination !== undefined) entries.push(['backup_destination', destination]);
  if (copyRetentionCount !== undefined) entries.push(['backup_copy_retention', String(copyRetentionCount)]);
  if (copyFiles !== undefined) entries.push(['backup_copy_files', copyFiles ? 'true' : 'false']);
  if (copyServerKey !== undefined) entries.push(['backup_copy_server_key', copyServerKey ? 'true' : 'false']);
  await writeSettings(entries);
  return getBackupSettings();
}

// VACUUM INTO gives a consistent snapshot under WAL; a raw file copy can miss pages still in the -wal file.
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

// Pre-upgrade snapshots (services/upgrade.js) are for rollback, so they don't count toward
// the retention limit; the newest few are always kept.
const UPGRADE_PREFIX = `${BACKUP_PREFIX}before-`;
const UPGRADE_BACKUPS_KEPT = 5;

// Which snapshots fall outside the retention rules, from a newest-first list.
function outsideRetention(files, retentionCount) {
  const upgrades = files.filter((f) => f.filename.startsWith(UPGRADE_PREFIX));
  const regular = files.filter((f) => !f.filename.startsWith(UPGRADE_PREFIX));
  return [...regular.slice(Math.max(retentionCount, 0)), ...upgrades.slice(UPGRADE_BACKUPS_KEPT)];
}

async function pruneOldBackups(retentionCount) {
  const toDelete = outsideRetention(listBackupFiles(), retentionCount);
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(backupsDir(), f.filename));
      await logger.info('backup', `Pruned old backup "${f.filename}" (retention limit is ${retentionCount})`);
    } catch (e) {
      // Already gone or unremovable; don't fail the prune.
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
    if (last !== null && Date.now() - last < intervalMs) {
      // Retry a failed copy (drive unplugged, share offline) on every check.
      if (settings.destination && settings.lastCopyError) await copyToDestination();
      return;
    }

    await createBackup('scheduled');
    await pruneOldBackups(settings.retentionCount);
    await copyToDestination();
  } catch (err) {
    await logger.error('backup', `Scheduled backup failed: ${err.message}`);
  }
}

let schedulerStarted = false;
export function initBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // The first check, after startup settles, also copies whatever the destination is missing
  // (e.g. a pre-upgrade snapshot).
  setTimeout(async () => {
    await runBackupIfDue();
    await copyToDestination().catch(() => {});
  }, 60 * 1000);
  setInterval(runBackupIfDue, CHECK_INTERVAL_MS);
}

export async function runManualBackupAndPrune() {
  const result = await createBackup('manual');
  const settings = await getBackupSettings();
  await pruneOldBackups(settings.retentionCount);
  await copyToDestination();
  return result;
}

// Second copy, so a failed /config disk doesn't take the backups with it. Layout:
//   <destination>/database/plinthio-backup-*.sqlite
//   <destination>/files/{avatars,covers,ssl,.version}
//   <destination>/files/jwt.secret   only when the admin chose to include the server key

const COPIED_FILES = ['avatars', 'covers', 'ssl', '.version'];
const SERVER_KEY_FILE = 'jwt.secret';

// Whether a server key copy is in the backup folder. It's never deleted automatically (it may
// be someone's only copy); Admin shows it so the admin can deal with it.
export function serverKeyAtDestination(destination) {
  if (!destination) return false;
  try {
    return fs.existsSync(path.join(destination, 'files', SERVER_KEY_FILE));
  } catch {
    return false;
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Validates a destination, creating it if its parent exists.
export async function checkDestination(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Choose a folder.' };
  if (!path.isAbsolute(raw)) return { ok: false, error: 'Use a full path, starting with /.' };
  const dest = path.resolve(raw);
  const dataDir = path.resolve(config.dataDir);
  if (isInside(dest, dataDir)) {
    return { ok: false, path: dest, error: "That's inside the server's own data folder; pick a folder somewhere else." };
  }
  if (isInside(dataDir, dest)) {
    return { ok: false, path: dest, error: "That folder contains the server's data folder; pick one beside it or elsewhere." };
  }
  try {
    if (!fs.existsSync(dest)) {
      if (!fs.existsSync(path.dirname(dest))) {
        return { ok: false, path: dest, error: `Neither that folder nor ${path.dirname(dest)} exists. In Docker, the folder has to be mounted into the container first.` };
      }
      fs.mkdirSync(dest);
    }
    if (!fs.statSync(dest).isDirectory()) return { ok: false, path: dest, error: "That's a file, not a folder." };
    const probe = path.join(dest, `.plinthio-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    const why = err.code === 'EACCES' || err.code === 'EPERM' ? 'the server isn\'t allowed to write there'
      : err.code === 'EROFS' ? 'it is mounted read-only'
      : err.message;
    return { ok: false, path: dest, error: `Can't write to that folder: ${why}.` };
  }

  let freeBytes = null;
  try {
    const stats = await fs.promises.statfs(dest);
    freeBytes = stats.bavail * stats.bsize;
  } catch { /* not every filesystem reports it */ }
  // Same device as the data folder protects against mistakes, not disk failure.
  const sameDisk = fs.statSync(dest).dev === fs.statSync(dataDir).dev;
  return { ok: true, path: dest, sameDisk, freeBytes, serverKeyPresent: serverKeyAtDestination(dest) };
}

function copyIfChanged(from, to) {
  const src = fs.statSync(from);
  if (fs.existsSync(to)) {
    const dst = fs.statSync(to);
    if (dst.size === src.size && dst.mtimeMs >= src.mtimeMs) return false;
  }
  // Written under a temporary name and renamed, so a copy cut short never looks complete.
  const tmp = `${to}.partial`;
  fs.copyFileSync(from, tmp);
  fs.renameSync(tmp, to);
  fs.utimesSync(to, src.atime, src.mtime);
  return true;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name));
  } else {
    copyIfChanged(from, to);
  }
}

let copyInFlight = null;

// Syncs snapshots and extra files to the destination and applies its retention. Never
// throws: failures are recorded for Admin and logged.
export async function copyToDestination() {
  if (copyInFlight) return copyInFlight;
  copyInFlight = (async () => {
    const settings = await getBackupSettings();
    if (!settings.destination) return null;
    try {
      const check = await checkDestination(settings.destination);
      if (!check.ok) throw new Error(check.error);
      const dbDir = path.join(check.path, 'database');
      fs.mkdirSync(dbDir, { recursive: true });

      let copied = 0;
      for (const f of listBackupFiles()) {
        if (copyIfChanged(path.join(backupsDir(), f.filename), path.join(dbDir, f.filename))) copied += 1;
      }

      if (settings.copyFiles) {
        const filesDir = path.join(check.path, 'files');
        fs.mkdirSync(filesDir, { recursive: true });
        for (const name of COPIED_FILES) copyTree(path.join(config.dataDir, name), path.join(filesDir, name));
        if (settings.copyServerKey) {
          copyTree(path.join(config.dataDir, SERVER_KEY_FILE), path.join(filesDir, SERVER_KEY_FILE));
          try { fs.chmodSync(path.join(filesDir, SERVER_KEY_FILE), 0o600); } catch { /* no key file (JWT_SECRET is set in the environment) */ }
        }
      }

      const atDestination = fs.readdirSync(dbDir)
        .filter((f) => FILENAME_RE.test(f))
        .map((f) => ({ filename: f, mtime: fs.statSync(path.join(dbDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const f of outsideRetention(atDestination, settings.copyRetentionCount)) {
        fs.unlinkSync(path.join(dbDir, f.filename));
      }

      const at = new Date().toISOString();
      await writeSettings([['backup_last_copy_at', at], ['backup_last_copy_error', '']]);
      if (copied) await logger.info('backup', `Copied ${copied} backup${copied === 1 ? '' : 's'} to ${check.path}`);
      return { ok: true, copied, at, path: check.path };
    } catch (err) {
      await writeSettings([['backup_last_copy_error', `${new Date().toISOString()} ${err.message}`]]);
      await logger.error('backup', `Copying backups to ${settings.destination} failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  })();
  try {
    return await copyInFlight;
  } finally {
    copyInFlight = null;
  }
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
