import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { compatOverview, saveCompatSettings, queueLibrary, removeAllCopies, retryFailed, QUALITIES, MAX_HEIGHTS } from '../services/compat.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getDetectedHwaccel, listHwaccels, testHwaccel } from '../services/hwaccel.js';
import {
  listBackupFiles,
  getBackupSettings,
  saveBackupSettings,
  runManualBackupAndPrune,
  checkDestination,
  copyToDestination,
  getBackupFilePath,
  serverKeyAtDestination,
  deleteBackupFile
} from '../services/backup.js';
import { getAutoScanSettings, saveAutoScanSettings } from '../services/autoScan.js';
import { verifyTmdbApiKey, getTmdbKeyInfo, hasBuiltinTmdbKey, verifyGoogleBooksKey, getGoogleBooksKeyInfo, METADATA_PROVIDERS, providersOff } from '../services/externalMetadata.js';
import { getComicVineKeyInfo, verifyComicVineKey } from '../services/comicvine.js';
import { SEND_OPTS } from '../utils/fileStream.js';
import { handle, serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';
import { getSetting, setSetting } from '../services/settings.js';
import { SeerrError, normalizeSeerrUrl, getSeerrConfig, seerrStatus, saveSeerrConfig, clearSeerrConfig, checkSeerr } from '../services/seerr.js';
import { hostOf } from '../services/safeFetch.js';
import { AUTO_ACCEPT_MODES, getAutoAccept, setAutoAccept } from '../services/requestAutomation.js';

const router = express.Router();

// Shelf views. Series and Creator are always on; admins may switch off Disk/Custom Folders.
// Old stored names (grid / author / series) map onto the current ones.
const SHELF_MODES = ['series', 'creator', 'disk_folder', 'custom_folder'];
const OPTIONAL_SHELF_MODES = ['disk_folder', 'custom_folder'];
const LEGACY_MODE_NAMES = { grid: 'series', series: 'series', author: 'creator', creator: 'creator', disk_folder: 'disk_folder', custom_folder: 'custom_folder' };

export function normalizeShelfModes(stored) {
  const wanted = new Set((Array.isArray(stored) ? stored : SHELF_MODES).map((m) => LEGACY_MODE_NAMES[m]).filter(Boolean));
  return SHELF_MODES.filter((m) => !OPTIONAL_SHELF_MODES.includes(m) || wanted.has(m));
}

async function readShelfModes(db) {
  const value = await getSetting(db, 'allowed_grouping_modes');
  let stored = null;
  try { stored = value ? JSON.parse(value) : null; } catch (e) { /* fall back to all */ }
  return normalizeShelfModes(stored);
}

// Enabled shelf views (every signed-in user needs this).
router.get('/filters', authenticateToken, handle(async (req, res) => {
  const db = await getDb();
  res.json({ allowedGroupingModes: await readShelfModes(db), optionalGroupingModes: OPTIONAL_SHELF_MODES });
}));

// Toggle the optional views; Series and Creator can't be disabled.
router.patch('/filters', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { allowedGroupingModes } = req.body;

  if (!Array.isArray(allowedGroupingModes)) {
    return res.status(400).json({ error: 'allowedGroupingModes must be an array' });
  }

  const db = await getDb();
  const modes = normalizeShelfModes(allowedGroupingModes);
  await setSetting(db, 'allowed_grouping_modes', JSON.stringify(modes));

  res.json({ message: 'Shelf views updated', allowedGroupingModes: modes });
}));

// Which TMDB key is in use, never the key itself. tmdbSource is "custom", "environment",
// "builtin" or null; tmdbBuiltIn says whether this build has a key to fall back to.
async function tmdbStatus() {
  const { key, source } = await getTmdbKeyInfo();
  return { tmdbConfigured: !!key, tmdbSource: source, tmdbBuiltIn: hasBuiltinTmdbKey() };
}

async function googleBooksStatus() {
  const { key, source } = await getGoogleBooksKeyInfo();
  return { googleBooksConfigured: !!key, googleBooksSource: source };
}

async function comicVineStatus() {
  const { key, source } = await getComicVineKeyInfo();
  return { comicVineConfigured: !!key, comicVineSource: source };
}

// Which providers are switched on: { tmdb: true, mangadex: true, … }.
async function providerSwitches() {
  const off = await providersOff();
  return { providers: Object.fromEntries(METADATA_PROVIDERS.map((p) => [p, !off.has(p)])) };
}

router.get('/metadata-providers', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json({ ...await tmdbStatus(), ...await googleBooksStatus(), ...await comicVineStatus(), ...await providerSwitches() });
}));

// Hardware transcoding: what this machine can do, and what the admin has chosen.
router.get('/transcoding', authenticateToken, requireAdmin, handle(async (req, res) => {
  const db = await getDb();
  const preference = await getSetting(db, 'transcode_hwaccel');
  res.json({
    preference: preference || 'auto',
    detected: await getDetectedHwaccel(),
    available: listHwaccels()
  });
}));

router.put('/transcoding', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { preference } = req.body;
  if (!['auto', 'none', ...listHwaccels()].includes(preference)) {
    return res.status(400).json({ error: 'Unknown hardware acceleration preference' });
  }

  const db = await getDb();
  await setSetting(db, 'transcode_hwaccel', preference);
  res.json({ message: 'Transcoding settings saved', preference });
}));

// A short real encode: ffmpeg listing an encoder doesn't prove the driver works.
router.post('/transcoding/test', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { method } = req.body;
  if (!listHwaccels().includes(method)) {
    return res.status(400).json({ error: 'Unknown hardware acceleration method' });
  }

  res.json(await testHwaccel(method));
}));

// Converted copies settings and list (services/compat.js).
router.get('/compat', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json(await compatOverview(await getDb()));
}));

router.put('/compat', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { maxGb, quality, maxHeight, allowUsers, autoConvert, replaceOriginal } = req.body || {};
  const patch = {};
  if (quality !== undefined) {
    if (typeof quality !== 'string' || !Object.hasOwn(QUALITIES, quality)) return res.status(400).json({ error: 'The quality must be smaller, balanced or high' });
    patch.quality = quality;
  }
  if (maxHeight !== undefined) {
    if (!MAX_HEIGHTS.includes(maxHeight)) return res.status(400).json({ error: 'The largest size must be 0 (the original), 1080 or 720' });
    patch.maxHeight = maxHeight;
  }
  if (maxGb !== undefined) {
    const value = Number(maxGb);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      return res.status(400).json({ error: 'The size limit must be a number of gigabytes' });
    }
    patch.maxGb = value;
  }
  if (allowUsers !== undefined) patch.allowUsers = allowUsers === true;
  if (autoConvert !== undefined) patch.autoConvert = autoConvert === true;
  if (replaceOriginal !== undefined) patch.replaceOriginal = replaceOriginal === true;
  const db = await getDb();
  const before = await compatOverview(db);
  await saveCompatSettings(db, patch);
  const after = await compatOverview(db);
  // Deleting originals is irreversible, so log who turned it on.
  if (before.replaceOriginal !== after.replaceOriginal) {
    logger.warn('media', `Converted copies: replacing originals was switched ${after.replaceOriginal ? 'ON' : 'off'} by ${req.user.username}`);
  }
  if (before.autoConvert !== after.autoConvert) {
    logger.info('media', `Converted copies: converting new videos automatically was switched ${after.autoConvert ? 'on' : 'off'} by ${req.user.username}`);
  }
  if (before.quality !== after.quality || before.maxHeight !== after.maxHeight) {
    logger.info('media', `Converted copies: new copies will be ${after.quality} quality, ${after.maxHeight ? `at most ${after.maxHeight}p` : 'at their original size'} (set by ${req.user.username})`);
  }
  res.json(after);
}));

// Queues every video needing a copy, in one library, all, or among itemIds.
router.post('/compat/queue', authenticateToken, requireAdmin, handle(async (req, res) => {
  const libraryId = req.body?.libraryId || null;
  let itemIds = null;
  if (req.body?.itemIds !== undefined) {
    itemIds = req.body.itemIds;
    if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > 2000 || !itemIds.every((id) => typeof id === 'string' && /^[a-f0-9]{8,64}$/i.test(id))) {
      return res.status(400).json({ error: 'itemIds must be a list of up to 2000 item ids' });
    }
  }
  const db = await getDb();
  if (libraryId && !await db.get('SELECT id FROM libraries WHERE id = ?', [libraryId])) {
    return res.status(404).json({ error: 'Library not found' });
  }
  try {
    res.status(202).json(await queueLibrary(db, libraryId, req.user.id, itemIds));
  } catch (err) {
    if (err?.plinthioCode) return sendError(req, res, err.plinthioCode, { message: err.message });
    throw err;
  }
}));

// Puts every failed conversion back in the queue.
router.post('/compat/retry', authenticateToken, requireAdmin, handle(async (req, res) => {
  const db = await getDb();
  await retryFailed(db);
  res.json(await compatOverview(db));
}));

// Deletes every copy and empties the queue; originals untouched.
router.delete('/compat/copies', authenticateToken, requireAdmin, handle(async (req, res) => {
  const db = await getDb();
  await removeAllCopies(db);
  res.json(await compatOverview(db));
}));

// Switch one metadata provider on or off: { provider: 'google-books', enabled: false }.
router.put('/metadata-providers/enabled', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { provider, enabled } = req.body;
  if (!METADATA_PROVIDERS.includes(provider) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: `provider must be one of ${METADATA_PROVIDERS.join(', ')}, and enabled true or false` });
  }
  const off = await providersOff();
  if (enabled) off.delete(provider);
  else off.add(provider);
  const db = await getDb();
  await setSetting(db, 'metadata_providers_off', JSON.stringify([...off]));
  res.json(await providerSwitches());
}));

// Sending accepted requests on to a Seerr server. The key is write-only: it is never returned.
function seerrFailure(req, res, err) {
  if (!(err instanceof SeerrError)) throw err;
  const messages = {
    invalid_url: 'Enter the address as http:// or https:// followed by the server and port',
    key_required: 'Enter the API key again: the address changed',
    unreachable: 'Nothing answered at that address',
    not_seerr: 'That address answered, but not as Seerr',
    unauthorized: 'Seerr refused the API key'
  };
  const input = err.reason === 'invalid_url' || err.reason === 'key_required';
  return sendError(req, res, 'P507', {
    message: messages[err.reason] || undefined,
    status: input ? 400 : undefined,
    extra: { reason: err.reason, ...(req.user?.role === 'admin' && err.detail ? { detail: err.detail } : {}) }
  });
}

router.get('/seerr', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json(await seerrStatus(await getDb()));
}));

router.put('/seerr', authenticateToken, requireAdmin, handle(async (req, res) => {
  const db = await getDb();
  const rawUrl = typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!rawUrl) {
    await clearSeerrConfig(db);
    logger.info('settings', `${req.user.username} removed the Seerr connection`);
    return res.json(await seerrStatus(db));
  }

  try {
    const saved = await getSeerrConfig(db);
    const url = normalizeSeerrUrl(rawUrl);
    const typedKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
    // The saved key only ever goes to the server it was saved for.
    if (!typedKey && (!saved.apiKey || hostOf(saved.url) !== hostOf(url))) throw new SeerrError('key_required');
    const next = { url, apiKey: typedKey || saved.apiKey, enabled: req.body.enabled !== false };

    // Checked before saving, so a wrong address or key fails here and not on the next request.
    const { version } = await checkSeerr(next);
    await saveSeerrConfig(db, next);
    logger.info('settings', `${req.user.username} ${next.enabled ? 'connected' : 'saved (switched off)'} Seerr at ${hostOf(url)}`);
    res.json({ ...await seerrStatus(db), version });
  } catch (err) {
    return seerrFailure(req, res, err);
  }
}));

router.post('/seerr/test', authenticateToken, requireAdmin, handle(async (req, res) => {
  const config = await getSeerrConfig(await getDb());
  try {
    if (!config.url || !config.apiKey) throw new SeerrError('invalid_url');
    res.json({ ok: true, ...await checkSeerr(config) });
  } catch (err) {
    return seerrFailure(req, res, err);
  }
}));

// Who has their requests accepted as they make them: 'off' | 'staff' | 'all'.
router.get('/requests', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json({ autoAccept: await getAutoAccept(await getDb()) });
}));

router.put('/requests', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { autoAccept } = req.body;
  if (!AUTO_ACCEPT_MODES.includes(autoAccept)) {
    return res.status(400).json({ error: `autoAccept must be one of: ${AUTO_ACCEPT_MODES.join(', ')}` });
  }
  const db = await getDb();
  await setAutoAccept(db, autoAccept);
  logger.info('settings', `${req.user.username} set automatic acceptance of requests to "${autoAccept}"`);
  res.json({ autoAccept });
}));

// Set or clear the TMDB API key.
router.put('/metadata-providers/tmdb-key', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { apiKey } = req.body;

  const db = await getDb();
  if (!apiKey || !apiKey.trim()) {
    await db.run("DELETE FROM settings WHERE key = 'tmdb_api_key'");
    const status = await tmdbStatus();
    return res.json({
      message: status.tmdbSource === 'builtin' ? 'Your TMDB key was removed. Using the built-in key.' : 'TMDB API key cleared',
      ...status
    });
  }

  // Verify before storing so a bad key fails here, not silently later.
  const check = await verifyTmdbApiKey(apiKey);
  if (!check.ok) {
    return sendError(req, res, 'P401', { message: check.reason, status: 400 });
  }

  await setSetting(db, 'tmdb_api_key', apiKey.trim());

  res.json({
    message: check.authStyle === 'read-access-token'
      ? 'TMDB Read Access Token saved and verified'
      : 'TMDB API key saved and verified',
    ...await tmdbStatus()
  });
}));

// Optional Google Books key; without one it uses the shared keyless quota.
router.put('/metadata-providers/comicvine-key', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { apiKey } = req.body;

  const db = await getDb();
  if (!apiKey || !String(apiKey).trim()) {
    await db.run("DELETE FROM settings WHERE key = 'comicvine_api_key'");
    return res.json({ message: 'Comic Vine API key cleared', ...await comicVineStatus() });
  }

  const check = await verifyComicVineKey(apiKey);
  if (!check.ok) {
    return sendError(req, res, 'P401', { message: check.reason, status: 400 });
  }

  await setSetting(db, 'comicvine_api_key', String(apiKey).trim());
  res.json({ message: 'Comic Vine API key saved and verified', ...await comicVineStatus() });
}));
router.put('/metadata-providers/google-books-key', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { apiKey } = req.body;

  const db = await getDb();
  if (!apiKey || !String(apiKey).trim()) {
    await db.run("DELETE FROM settings WHERE key = 'google_books_api_key'");
    return res.json({ message: 'Google Books API key cleared', ...await googleBooksStatus() });
  }

  const check = await verifyGoogleBooksKey(apiKey);
  if (!check.ok) {
    return sendError(req, res, 'P401', { message: check.reason, status: 400 });
  }

  await setSetting(db, 'google_books_api_key', String(apiKey).trim());
  res.json({ message: 'Google Books API key saved and verified', ...await googleBooksStatus() });
}));

// Database snapshot download via VACUUM INTO: a raw copy in WAL mode can miss data still in
// the -wal file. Covers database only, not covers/, jwt.secret or media.
router.get('/backup', authenticateToken, requireAdmin, async (req, res) => {
  const backupsDir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `plinthio-backup-${stamp}.sqlite`;
  const backupPath = path.join(backupsDir, filename);

  try {
    const db = await getDb();
    await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    res.download(backupPath, filename, SEND_OPTS, (err) => {
      fs.unlink(backupPath, () => {});
      // Fails before any bytes are sent (file unreadable) need an answer, or the browser waits forever.
      if (err) serverError(req, res, err);
    });
  } catch (err) {
    fs.unlink(backupPath, () => {});
    res.status(500).json({ error: `Backup failed: ${err.message}` });
  }
});

// Automatic backup schedule.
router.get('/backup/config', authenticateToken, requireAdmin, handle(async (req, res) => {
  const settings = await getBackupSettings();
  res.json(withServerKeyStatus(settings));
}));

// Also reports whether a jwt.secret copy sits in the backup folder, so the page can warn.
function withServerKeyStatus(settings) {
  return { ...settings, serverKeyAtDestination: serverKeyAtDestination(settings.destination) };
}

router.put('/backup/config', authenticateToken, requireAdmin, async (req, res) => {
  const { enabled, intervalHours, retentionCount, destination, copyRetentionCount, copyFiles, copyServerKey } = req.body;

  const parsedInterval = parseInt(intervalHours, 10);
  const parsedRetention = parseInt(retentionCount, 10);

  if (!Number.isFinite(parsedInterval) || parsedInterval < 1 || parsedInterval > 168) {
    return res.status(400).json({ error: 'Interval must be between 1 and 168 hours' });
  }
  if (!Number.isFinite(parsedRetention) || parsedRetention < 1 || parsedRetention > 30) {
    return res.status(400).json({ error: 'Retention must be between 1 and 30 backups' });
  }
  let parsedCopyRetention;
  if (copyRetentionCount !== undefined) {
    parsedCopyRetention = parseInt(copyRetentionCount, 10);
    if (!Number.isFinite(parsedCopyRetention) || parsedCopyRetention < 1 || parsedCopyRetention > 365) {
      return res.status(400).json({ error: 'Copies kept must be between 1 and 365' });
    }
  }
  let cleanDestination;
  if (destination !== undefined) {
    cleanDestination = destination === null ? '' : String(destination).trim();
    if (cleanDestination) {
      const check = await checkDestination(cleanDestination);
      if (!check.ok) return res.status(400).json({ error: check.error });
      cleanDestination = check.path;
    }
  }

  try {
    const before = await getBackupSettings();
    const settings = await saveBackupSettings({
      enabled: !!enabled,
      intervalHours: parsedInterval,
      retentionCount: parsedRetention,
      destination: cleanDestination,
      copyRetentionCount: parsedCopyRetention,
      copyFiles: copyFiles === undefined ? undefined : !!copyFiles,
      // Strictly `true`: this copies the signing key into the backup folder.
      copyServerKey: copyServerKey === undefined ? undefined : copyServerKey === true
    });
    // A new destination gets the existing backups straight away, not at the next backup.
    if (settings.destination && settings.destination !== before.destination) {
      copyToDestination().catch(() => {});
    }
    res.json({ message: 'Backup schedule updated', ...withServerKeyStatus(settings) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Automatic library scanning (periodic sweep + filesystem watcher).
router.get('/auto-scan', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json(await getAutoScanSettings());
}));

router.put('/auto-scan', authenticateToken, requireAdmin, handle(async (req, res) => {
  const { enabled, intervalMinutes, watchEnabled, mode, times } = req.body;

  if (mode !== undefined && mode !== 'interval' && mode !== 'times') {
    return res.status(400).json({ error: 'Scan mode must be "interval" or "times"' });
  }
  if (times !== undefined && (!Array.isArray(times) || !times.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))) {
    return res.status(400).json({ error: 'Scan times must be a list of HH:MM times' });
  }

  if (intervalMinutes !== undefined) {
    const parsed = parseInt(intervalMinutes, 10);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 7 * 24 * 60) {
      return res.status(400).json({ error: 'Scan interval must be between 5 minutes and 7 days' });
    }
  }

  const settings = await saveAutoScanSettings({ enabled, intervalMinutes, watchEnabled, mode, times });
  res.json({ message: 'Automatic scanning updated', ...settings });
}));

// Can this folder take backups (writable, and on the same disk as the data?).
router.post('/backup/destination/check', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json(await checkDestination(req.body?.path));
}));

router.post('/backup/copy', authenticateToken, requireAdmin, handle(async (req, res) => {
  const result = await copyToDestination();
  if (!result) return res.status(400).json({ error: 'No backup destination is set' });
  if (!result.ok) return res.status(500).json({ error: result.error });
  res.json(result);
}));

router.get('/backup/list', authenticateToken, requireAdmin, handle(async (req, res) => {
  res.json({ backups: listBackupFiles() });
}));

// Creates a backup kept on disk (GET /backup streams a one-off instead).
router.post('/backup/create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await runManualBackupAndPrune();
    res.json({ message: 'Backup created', backup: result, backups: listBackupFiles() });
  } catch (err) {
    res.status(500).json({ error: `Backup failed: ${err.message}` });
  }
});

router.get('/backup/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filePath = getBackupFilePath(req.params.filename);
    res.download(filePath, req.params.filename, SEND_OPTS);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.delete('/backup/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await deleteBackupFile(req.params.filename);
    res.json({ message: 'Backup deleted', backups: listBackupFiles() });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
