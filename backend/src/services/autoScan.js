import fs from 'fs';
import { getDb } from '../config/database.js';
import { scanLibrary } from './scanner.js';
import { logger } from './logger.js';

// Until this existed, a file added to a library stayed invisible until an admin opened the
// Admin panel and clicked Scan — the thing every other media server does for you. Two
// mechanisms, either of which can be turned off:
//
//   * a periodic sweep, which re-scans any library whose last scan is older than the
//     configured interval (the reliable floor — works on network shares, bind mounts and
//     filesystems that emit no events at all), and
//   * a filesystem watcher, which reacts within seconds of a file appearing.
//
// Both funnel into scanLibrary, which holds a per-library lock, so overlapping triggers
// can't scan the same library twice at once.

const SETTINGS_KEY = 'auto_scan';
const TICK_MS = 60 * 1000;
// A copy landing in a watched folder fires events continuously while it's being written.
// Waiting for the directory to fall quiet avoids scanning a half-copied file — and avoids
// one scan per file when a whole season is dropped in at once.
const WATCH_QUIET_MS = 30 * 1000;

export const DEFAULT_AUTO_SCAN = {
  enabled: true,
  intervalMinutes: 60,
  watchEnabled: true
};

export async function getAutoScanSettings() {
  try {
    const db = await getDb();
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY]);
    if (!row) return { ...DEFAULT_AUTO_SCAN };
    return { ...DEFAULT_AUTO_SCAN, ...JSON.parse(row.value) };
  } catch (err) {
    // Unreadable or malformed settings shouldn't disable scanning outright.
    return { ...DEFAULT_AUTO_SCAN };
  }
}

export async function saveAutoScanSettings(patch) {
  const db = await getDb();
  const current = await getAutoScanSettings();

  const next = {
    enabled: patch.enabled === undefined ? current.enabled : !!patch.enabled,
    watchEnabled: patch.watchEnabled === undefined ? current.watchEnabled : !!patch.watchEnabled,
    intervalMinutes: clampInterval(
      patch.intervalMinutes === undefined ? current.intervalMinutes : patch.intervalMinutes
    )
  };

  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [SETTINGS_KEY, JSON.stringify(next)]
  );

  // Apply immediately rather than at the next restart.
  await syncWatchers();
  return next;
}

function clampInterval(value) {
  const minutes = parseInt(value, 10);
  if (!Number.isFinite(minutes)) return DEFAULT_AUTO_SCAN.intervalMinutes;
  // Floor of 5 minutes: anything tighter is just re-walking the disk for no reason.
  return Math.min(Math.max(minutes, 5), 7 * 24 * 60);
}

async function triggerScan(libraryId, reason) {
  try {
    const result = await scanLibrary(libraryId);
    if (result.status === 'completed' && (result.added || result.updated || result.removed)) {
      logger.info('scan', `Automatic scan (${reason}) updated library ${libraryId}`, result);
    }
  } catch (err) {
    logger.warn('scan', `Automatic scan (${reason}) failed for library ${libraryId}: ${err.message}`);
  }
}

// ---------------------------------------------------------------- periodic sweep

async function runDueScans() {
  const settings = await getAutoScanSettings();
  if (!settings.enabled) return;

  const db = await getDb();
  const libraries = await db.all('SELECT id, name, last_scanned_at FROM libraries');
  const intervalMs = settings.intervalMinutes * 60 * 1000;

  for (const library of libraries) {
    const last = library.last_scanned_at ? Date.parse(`${library.last_scanned_at}Z`) : null;
    if (last !== null && Number.isFinite(last) && Date.now() - last < intervalMs) continue;
    await triggerScan(library.id, 'scheduled');
  }
}

// ---------------------------------------------------------------- filesystem watching

const watchers = new Map(); // libraryId -> { watcher, path, timer }

function stopWatching(libraryId) {
  const entry = watchers.get(libraryId);
  if (!entry) return;
  clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch (e) { /* already closed */ }
  watchers.delete(libraryId);
}

function startWatching(library) {
  if (watchers.has(library.id)) return;
  if (!fs.existsSync(library.path)) return;

  let watcher;
  try {
    watcher = fs.watch(library.path, { recursive: true, persistent: false });
  } catch (err) {
    // Recursive watching isn't available everywhere (and some network mounts emit nothing).
    // The periodic sweep is the fallback, so this is a warning, not a failure.
    logger.warn('scan', `Could not watch "${library.name}" for changes: ${err.message}`);
    return;
  }

  const entry = { watcher, path: library.path, timer: null };
  watchers.set(library.id, entry);

  watcher.on('change', () => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => triggerScan(library.id, 'file change'), WATCH_QUIET_MS);
  });
  watcher.on('error', (err) => {
    logger.warn('scan', `Watcher for "${library.name}" stopped: ${err.message}`);
    stopWatching(library.id);
  });
}

// Reconciles the live watchers with the libraries that currently exist and the current
// settings — called at boot, whenever settings change, and on every tick so a library added
// or deleted through the Admin panel is picked up without a restart.
export async function syncWatchers() {
  const settings = await getAutoScanSettings();

  if (!settings.enabled || !settings.watchEnabled) {
    for (const id of [...watchers.keys()]) stopWatching(id);
    return;
  }

  const db = await getDb();
  const libraries = await db.all('SELECT id, name, path FROM libraries');
  const liveIds = new Set(libraries.map((l) => l.id));

  for (const id of [...watchers.keys()]) {
    const entry = watchers.get(id);
    const library = libraries.find((l) => l.id === id);
    // Gone, or repointed at a different folder.
    if (!liveIds.has(id) || library.path !== entry.path) stopWatching(id);
  }

  for (const library of libraries) startWatching(library);
}

// ---------------------------------------------------------------- bootstrap

let started = false;

export function initAutoScan() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await syncWatchers();
      await runDueScans();
    } catch (err) {
      logger.warn('scan', `Automatic scan tick failed: ${err.message}`);
    }
  };

  // Let the server finish booting (and the thumbnail warm-up settle) before the first pass.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, TICK_MS).unref();
}

export function stopAutoScan() {
  for (const id of [...watchers.keys()]) stopWatching(id);
}
