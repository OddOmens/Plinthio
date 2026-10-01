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

const SETTING_KEYS = [
  'backup_enabled', 'backup_interval_hours', 'backup_retention',
  'backup_destination', 'backup_copy_retention', 'backup_copy_files',
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
    // A second place every backup is copied to (another disk, a NAS share, a synced cloud
    // folder): '' means off. A path as the server sees it — in Docker, a mounted folder.
    destination: map.backup_destination || '',
    copyRetentionCount: map.backup_copy_retention ? parseInt(map.backup_copy_retention, 10) : 30,
    // Also copy what a database restore can't bring back (avatars, uploaded covers, the
    // sign-in secret, the HTTPS certificates).
    copyFiles: map.backup_copy_files === undefined ? true : map.backup_copy_files === 'true',
    lastCopyAt: map.backup_last_copy_at || null,
    lastCopyError: map.backup_last_copy_error || null,
    // On unless an admin turned it off: a server nobody configured still keeps a week of
    // daily snapshots of everyone's progress, bookmarks and highlights.
    enabled: map.backup_enabled === undefined ? true : map.backup_enabled === 'true',
    intervalHours: map.backup_interval_hours ? parseInt(map.backup_interval_hours, 10) : 24,
    retentionCount: map.backup_retention ? parseInt(map.backup_retention, 10) : 7
  };
}

async function writeSettings(entries) {
  const db = await getDb();
  for (const [key, value] of entries) {
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  }
}

export async function saveBackupSettings({ enabled, intervalHours, retentionCount, destination, copyRetentionCount, copyFiles }) {
  const entries = [
    ['backup_enabled', enabled ? 'true' : 'false'],
    ['backup_interval_hours', String(intervalHours)],
    ['backup_retention', String(retentionCount)]
  ];
  if (destination !== undefined) entries.push(['backup_destination', destination]);
  if (copyRetentionCount !== undefined) entries.push(['backup_copy_retention', String(copyRetentionCount)]);
  if (copyFiles !== undefined) entries.push(['backup_copy_files', copyFiles ? 'true' : 'false']);
  await writeSettings(entries);
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

// The snapshots taken before an upgrade (services/upgrade.js) are how a version is rolled
// back, so they're kept apart from the schedule: the retention count applies to scheduled
// and manual backups only, and the newest few pre-upgrade ones are always kept. (They used
// to count against the same limit, so a week of daily backups deleted them all.)
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
    if (last !== null && Date.now() - last < intervalMs) {
      // Not time for a new backup, but a copy that failed (a drive unplugged, a share
      // offline) is tried again on every check until it goes through.
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
  // Give the DB a moment to finish initializing before the first check, then recheck
  // periodically — runBackupIfDue itself no-ops until an interval has actually elapsed.
  // The first check also copies whatever the destination is missing — the snapshot taken
  // before an upgrade, or backups made while it was unreachable.
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

// ─── Copying to a second place ───────────────────────────────────────────────
// Snapshots in /config/backups protect against mistakes and bad upgrades, not against the
// disk under /config failing. So each backup can also be copied somewhere else, laid out as
//   <destination>/database/plinthio-backup-*.sqlite
//   <destination>/files/{avatars,covers,ssl,jwt.secret,.version}

const COPIED_FILES = ['avatars', 'covers', 'ssl', 'jwt.secret', '.version'];

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Whether a folder can take backups, and anything worth warning about. Creates the folder
// if it doesn't exist yet (its parent must).
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
  // Same device as the data folder: it still guards against deleting files by mistake, but
  // not against that disk failing.
  const sameDisk = fs.statSync(dest).dev === fs.statSync(dataDir).dev;
  return { ok: true, path: dest, sameDisk, freeBytes };
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

// Copies every snapshot not already at the destination, refreshes the extra files, and
// trims the destination to its own retention. Never throws: a failed copy mustn't fail the
// backup itself; it's recorded (Admin shows it) and logged.
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
        try { fs.chmodSync(path.join(filesDir, 'jwt.secret'), 0o600); } catch { /* not copied */ }
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
