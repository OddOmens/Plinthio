import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { PlinthioError } from '../errors.js';
import { logger } from './logger.js';
import { getSetting, setSetting } from './settings.js';
import { getPlaybackInfo, forgetPlaybackInfo } from './transcode.js';
import { getActiveHwaccel, hwaccelConfig } from './hwaccel.js';
import { activeEncodeCount, dropItemHlsCache } from './hls.js';
import { localInputArgs } from './probe.js';
import { isLibraryScanning } from './scanner.js';
import { resolveLibraryFile } from '../utils/libraryPath.js';

// Background H.264 copies of video some devices can't decode (AV1/VP9 on Apple, MPEG-2,
// VC-1, 10-bit H.264...), so playback doesn't need a live encode every time.
// Copies live under DATA_DIR/compat, outside libraries, unless "replace the original" is on;
// then the copy takes the original's place and the row keeps its id.

const COMPAT_DIR = path.join(config.dataDir, 'compat');
fs.mkdirSync(COMPAT_DIR, { recursive: true });

// Anything but 8-bit H.264 and HEVC (plays on Apple devices, already compact) needs a copy.
export function needsCopy(info) {
  if (!info || info.probeFailed || !info.videoCodec) return false;
  if (info.videoCodec === 'hevc') return false;
  if (info.videoCodec === 'h264') return info.tenBitH264 === true;
  return true;
}

const DEFAULT_MAX_GB = 50;

// crf: libx264 quality (lower = better, bigger). bitrate: multiplier for hardware encoders.
// preset: CPU time spent on compression.
export const QUALITIES = {
  smaller: { crf: 24, bitrate: 0.65, preset: 'veryfast' },
  balanced: { crf: 21, bitrate: 1, preset: 'veryfast' },
  high: { crf: 18, bitrate: 1.6, preset: 'fast' }
};
// The tallest a copy may be: 0 keeps the source's own size (up to 2160p).
export const MAX_HEIGHTS = [0, 1080, 720];
const TICK_MS = Math.max(50, parseInt(process.env.COMPAT_TICK_MS, 10) || 3000);

// { itemId, proc, progress, paused, cancelled, capped, tmpPath, budget }
let current = null;
let working = false;
let kickAgain = false;
// Library search in progress: { total, done, queued }.
let discovery = null;

// P310 nothing to convert, P311 size limit, P302 unreadable file.
export class CompatError extends PlinthioError {}

const copyPath = (itemId) => path.join(COMPAT_DIR, `${itemId}.mp4`);
const tmpPath = (itemId) => path.join(COMPAT_DIR, `${itemId}.part.mp4`);
// The probe cache key for a title's copy (see getPlaybackInfo).
export const compatProbeId = (itemId) => `${itemId}.compat`;

export async function getCompatSettings(db) {
  const maxGb = parseFloat(await getSetting(db, 'compat_max_gb'));
  const quality = await getSetting(db, 'compat_quality');
  const maxHeight = parseInt(await getSetting(db, 'compat_max_height'), 10);
  return {
    maxGb: Number.isFinite(maxGb) && maxGb >= 0 ? maxGb : DEFAULT_MAX_GB,
    quality: QUALITIES[quality] ? quality : 'balanced',
    maxHeight: MAX_HEIGHTS.includes(maxHeight) ? maxHeight : 0,
    allowUsers: (await getSetting(db, 'compat_allow_users')) === '1',
    autoConvert: (await getSetting(db, 'compat_auto')) === '1',
    replaceOriginal: (await getSetting(db, 'compat_replace_original')) === '1'
  };
}

export async function saveCompatSettings(db, patch) {
  if (patch.maxGb !== undefined) await setSetting(db, 'compat_max_gb', String(patch.maxGb));
  // Quality and height apply only to new copies.
  if (patch.quality !== undefined) await setSetting(db, 'compat_quality', patch.quality);
  if (patch.maxHeight !== undefined) await setSetting(db, 'compat_max_height', String(patch.maxHeight));
  if (patch.allowUsers !== undefined) await setSetting(db, 'compat_allow_users', patch.allowUsers ? '1' : '0');
  if (patch.autoConvert !== undefined) await setSetting(db, 'compat_auto', patch.autoConvert ? '1' : '0');
  if (patch.replaceOriginal !== undefined) {
    await setSetting(db, 'compat_replace_original', patch.replaceOriginal ? '1' : '0');
    // Saving also retries originals that couldn't be replaced.
    await db.run('UPDATE compat_copies SET replace_error = NULL');
  }
  kick();
  return getCompatSettings(db);
}

async function usedBytes(db) {
  return (await db.get("SELECT COALESCE(SUM(size), 0) AS total FROM compat_copies WHERE status = 'done'")).total;
}

function removeFiles(itemId) {
  for (const file of [copyPath(itemId), tmpPath(itemId)]) {
    try { fs.unlinkSync(file); } catch { /* wasn't there */ }
  }
  forgetPlaybackInfo(compatProbeId(itemId));
}

function progressOf(row) {
  if (row.status === 'done') return 1;
  if (row.status === 'running' && current?.itemId === row.item_id) return current.progress;
  return 0;
}

// { status: 'none' | 'queued' | 'running' | 'done' | 'failed', progress: 0–1, error, errorCode }
export async function copyState(db, itemId) {
  const row = await db.get('SELECT * FROM compat_copies WHERE item_id = ?', [itemId]);
  if (!row) return { status: 'none', progress: 0, error: null, errorCode: null };
  return {
    status: row.status,
    progress: progressOf(row),
    error: row.error || null,
    errorCode: row.error_code || null
  };
}

// The finished copy, or null. A copy of a since-changed source is deleted.
export async function readyCopy(db, itemId, sourcePath) {
  const row = await db.get("SELECT * FROM compat_copies WHERE item_id = ? AND status = 'done'", [itemId]);
  if (!row) return null;
  const file = copyPath(itemId);
  let source;
  try {
    source = fs.statSync(sourcePath);
    fs.accessSync(file, fs.constants.R_OK);
  } catch {
    return null;
  }
  if (source.size !== row.source_size || Math.floor(source.mtimeMs) !== row.source_mtime) {
    logger.info('media', `The file for item ${itemId} changed; its converted copy was removed`);
    await db.run('DELETE FROM compat_copies WHERE item_id = ?', [itemId]);
    removeFiles(itemId);
    return null;
  }
  return { path: file, size: row.size };
}

// Queues a copy; existing ones are left alone except failed ones, which are retried.
export async function requestCopy(db, itemId, filePath, userId) {
  const existing = await db.get('SELECT status FROM compat_copies WHERE item_id = ?', [itemId]);
  if (existing && existing.status !== 'failed') return copyState(db, itemId);

  const info = await getPlaybackInfo(itemId, filePath);
  if (info.probeFailed) throw new CompatError('P302', 'This file could not be read as a video');
  if (!needsCopy(info)) throw new CompatError('P310');
  const settings = await getCompatSettings(db);
  if (await usedBytes(db) >= settings.maxGb * 1024 ** 3) throw new CompatError('P311');

  removeFiles(itemId);
  await db.run(
    `INSERT INTO compat_copies (item_id, status, source_codec, requested_by) VALUES (?, 'queued', ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET status = 'queued', size = 0, error = NULL, error_code = NULL,
       replace_error = NULL, source_codec = excluded.source_codec,
       requested_by = excluded.requested_by, created_at = CURRENT_TIMESTAMP, finished_at = NULL`,
    [itemId, info.tenBitH264 ? 'h264 10-bit' : info.videoCodec, userId || null]
  );
  kick();
  return copyState(db, itemId);
}

// Cancels a queued or running copy, or deletes a finished one.
export async function removeCopy(db, itemId) {
  if (current?.itemId === itemId) {
    current.cancelled = true;
    current.proc.kill('SIGKILL');
  }
  await db.run('DELETE FROM compat_copies WHERE item_id = ?', [itemId]);
  removeFiles(itemId);
}

export async function removeAllCopies(db) {
  const rows = await db.all('SELECT item_id FROM compat_copies');
  for (const row of rows) await removeCopy(db, row.item_id);
  logger.info('media', `Converted copies: all ${rows.length} deleted and the queue emptied`);
}

export async function retryFailed(db) {
  const { changes } = await db.run(
    `UPDATE compat_copies SET status = 'queued', error = NULL, error_code = NULL, size = 0,
       created_at = CURRENT_TIMESTAMP, finished_at = NULL WHERE status = 'failed'`
  );
  if (changes) logger.info('media', `Converted copies: ${changes} failed conversion(s) queued again`);
  kick();
  return changes;
}

export async function compatOverview(db) {
  const rows = await db.all(
    `SELECT c.item_id, c.status, c.size, c.source_codec, c.error, c.error_code, c.replace_error, c.created_at,
            i.title, i.series, i.volume, i.media_type
     FROM compat_copies c LEFT JOIN items i ON i.id = c.item_id
     ORDER BY CASE c.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, c.created_at`
  );
  return {
    ...await getCompatSettings(db),
    usedBytes: await usedBytes(db),
    discovery: discovery ? { ...discovery } : null,
    copies: rows.map((row) => ({
      itemId: row.item_id,
      title: row.title || null,
      series: row.series || null,
      volume: row.volume ?? null,
      mediaType: row.media_type || null,
      status: row.status,
      progress: progressOf(row),
      // Paused while a live transcode runs.
      paused: row.status === 'running' && current?.itemId === row.item_id && current.paused,
      size: row.size || 0,
      sourceCodec: row.source_codec || null,
      error: row.error || null,
      errorCode: row.error_code || null,
      replaceError: row.replace_error || null
    }))
  };
}

// Queues copies for a library, all libraries, or `itemIds`. Runs in the background;
// progress is in compatOverview().discovery.
export async function queueLibrary(db, libraryId, userId, itemIds = null) {
  if (discovery) throw new PlinthioError('P004', 'A search for videos to convert is already running');
  const filter = itemIds
    ? `AND i.id IN (${itemIds.map(() => '?').join(',')})`
    : (libraryId ? 'AND i.library_id = ?' : '');
  const items = await db.all(
    `SELECT i.id, i.path FROM items i
     WHERE i.media_type IN ('movie', 'show', 'anime') AND i.missing_since IS NULL
       AND i.id NOT IN (SELECT item_id FROM compat_copies WHERE status != 'failed')
       ${filter}`,
    itemIds || (libraryId ? [libraryId] : [])
  );
  discovery = { total: items.length, done: 0, queued: 0 };
  (async () => {
    try {
      for (const item of items) {
        try {
          const file = await resolveLibraryFile(item.path);
          if (file.ok) {
            const info = await getPlaybackInfo(item.id, file.realPath);
            if (needsCopy(info)) {
              await requestCopy(db, item.id, file.realPath, userId);
              discovery.queued++;
            }
          }
        } catch (err) {
          // The size limit stops the run; other errors are one bad file.
          if (err?.plinthioCode === 'P311') {
            logger.warn('media', '[P311] Converted copies: the size limit was reached, so the rest of the library was not queued');
            break;
          }
        }
        discovery.done++;
      }
      logger.info('media', `Converted copies: ${discovery.queued} of ${items.length} video(s) need converting and were queued`);
    } finally {
      discovery = null;
      drainNewVideos(db);
    }
  })();
  return { total: items.length };
}

// Videos a scan added or changed, waiting to be checked.
const newVideoIds = new Set();
let drainingNewVideos = false;
const NEW_VIDEO_BATCH = 500;

// From the scanner: queues new/changed titles when auto-convert is on. Never throws, so a scan can't fail here.
export async function queueNewVideos(db, itemIds) {
  try {
    if (!itemIds?.length || !(await getCompatSettings(db)).autoConvert) return;
    for (const id of itemIds) newVideoIds.add(id);
    drainNewVideos(db);
  } catch (err) {
    logger.warn('media', `Converted copies: new videos could not be checked: ${err.message}`);
  }
}

// One search at a time; batches wait here.
function drainNewVideos(db) {
  if (discovery || drainingNewVideos || !newVideoIds.size) return;
  const ids = [...newVideoIds].slice(0, NEW_VIDEO_BATCH);
  for (const id of ids) newVideoIds.delete(id);
  drainingNewVideos = true;
  queueLibrary(db, null, null, ids)
    .catch((err) => logger.warn('media', `Converted copies: new videos could not be checked: ${err.message}`))
    .finally(() => { drainingNewVideos = false; });
}

// Hardware encoder bitrates; generous because this is the copy people keep.
function bitrateFor(height) {
  if (height > 1440) return 24000;
  if (height > 1080) return 14000;
  if (height > 720) return 8000;
  if (height > 480) return 4000;
  return 2000;
}

// Video encoder args; software when accel is null.
function videoArgs(info, accel, height, quality) {
  const bitrate = Math.round(bitrateFor(height) * quality.bitrate);
  const rate = ['-maxrate', `${Math.round(bitrate * 1.5)}k`, '-bufsize', `${bitrate * 3}k`];
  // Deinterlace, or comb lines are baked into the copy.
  const deinterlace = info.interlaced ? 'yadif,' : '';
  if (accel) {
    return ['-vf', deinterlace + accel.filter(height), '-c:v', accel.encoder, '-b:v', `${bitrate}k`, ...rate];
  }
  // Half the cores, as this runs long beside a server in use.
  return [
    '-vf', `${deinterlace}scale=-2:${height}`, '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), ...rate,
    '-pix_fmt', 'yuv420p', '-threads', String(Math.max(1, Math.floor(os.cpus().length / 2)))
  ];
}

function buildArgs(info, sourcePath, outPath, { accel, subtitles, quality, maxHeight }) {
  // Source height capped by the admin's limit or 2160p (H.264 above plays almost nowhere), made even.
  const height = Math.min(info.height || 1080, maxHeight || 2160) & ~1;

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...(accel ? accel.deviceArgs : []),
    ...localInputArgs(),
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '0:a?'
  ];
  const textSubs = subtitles ? (info.subtitleTracks || []).filter((track) => track.isTextBased) : [];
  for (const track of textSubs) args.push('-map', `0:s:${track.index}`);

  args.push(...videoArgs(info, accel, height, QUALITIES[quality] || QUALITIES.balanced));

  // AAC and MP3 are copied; anything else becomes AAC with up to 5.1 channels.
  (info.audioTracks || []).forEach((track, index) => {
    if (track.codec === 'aac' || track.codec === 'mp3') {
      args.push(`-c:a:${index}`, 'copy');
    } else {
      const channels = Math.min(track.channels || 2, 6);
      args.push(`-c:a:${index}`, 'aac', `-ac:a:${index}`, String(channels), `-b:a:${index}`, channels > 2 ? '384k' : '192k');
    }
  });
  if (textSubs.length) args.push('-c:s', 'mov_text');

  args.push(
    '-map_metadata', '0', '-map_chapters', '0',
    '-max_muxing_queue_size', '2048',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', outPath
  );
  return args;
}

function runEncode(itemId, args, duration, budget) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(proc.pid, 10); } catch { /* not allowed here: runs at normal priority */ }
    const job = { itemId, proc, progress: 0, paused: false, cancelled: false, capped: false, tmpPath: tmpPath(itemId), budget };
    current = job;

    let stderr = '';
    let pending = '';
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    proc.stdout.on('data', (d) => {
      pending += d.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        // Both are microseconds despite the name.
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (match && duration > 0) job.progress = Math.min(0.99, parseInt(match[1], 10) / 1e6 / duration);
      }
    });
    const done = (result) => {
      if (current === job) current = null;
      resolve(result);
    };
    proc.on('error', (err) => done({ ok: false, code: 'P303', error: `ffmpeg could not start: ${err.message}` }));
    proc.on('close', (code) => {
      if (job.cancelled) return done({ ok: false, cancelled: true });
      if (job.capped) return done({ ok: false, error: 'cap' });
      if (code === 0) return done({ ok: true });
      done({ ok: false, code: 'P304', error: (stderr.trim() || `ffmpeg exited ${code}`).slice(0, 300) });
    });
  });
}

// Pauses the conversion during live transcodes and kills it if it would exceed the size limit.
function tick() {
  if (!current) return;
  const job = current;
  try {
    if (fs.statSync(job.tmpPath).size > job.budget) {
      job.capped = true;
      job.proc.kill('SIGKILL');
      return;
    }
  } catch { /* nothing written yet */ }
  const busy = activeEncodeCount() > 0;
  try {
    if (busy && !job.paused) {
      job.proc.kill('SIGSTOP');
      job.paused = true;
      logger.info('media', 'Converted copies: paused while a video is being converted for someone watching');
    } else if (!busy && job.paused) {
      job.proc.kill('SIGCONT');
      job.paused = false;
      logger.info('media', 'Converted copies: carrying on');
    }
  } catch { /* no job control on this platform: it keeps running */ }
}

// `error` is shown in the admin list ('cap' and 'missing' are translated there); `code` is
// from docs/error-codes.md.
async function fail(db, itemId, error, code, title) {
  removeFiles(itemId);
  await db.run(
    `UPDATE compat_copies SET status = 'failed', error = ?, error_code = ?, size = 0,
       finished_at = CURRENT_TIMESTAMP WHERE item_id = ?`,
    [error, code, itemId]
  );
  const why = error === 'cap' ? 'the size limit for copies was reached'
    : error === 'missing' ? 'its file is missing from disk'
      : error;
  const message = `[${code}] Converting ${title ? `"${title}"` : `item ${itemId}`} failed: ${why}`;
  // Size limit and missing file are admin issues, logged as warnings.
  if (code === 'P311' || code === 'P301') logger.warn('media', message);
  else logger.error('media', message);
}

async function convert(db, row) {
  const itemId = row.item_id;
  const item = await db.get('SELECT id, path, title FROM items WHERE id = ?', [itemId]);
  if (!item) return removeCopy(db, itemId);
  const failed = (error, code) => fail(db, itemId, error, code, item.title);

  const file = await resolveLibraryFile(item.path).catch(() => ({ ok: false }));
  if (!file.ok) return failed('missing', 'P301');

  const settings = await getCompatSettings(db);
  const room = settings.maxGb * 1024 ** 3 - await usedBytes(db);
  if (room <= 0) return failed('cap', 'P311');

  // Live transcodes take priority.
  while (activeEncodeCount() > 0) await new Promise((r) => setTimeout(r, TICK_MS));
  const claimed = await db.run("UPDATE compat_copies SET status = 'running' WHERE item_id = ? AND status = 'queued'", [itemId]);
  if (!claimed.changes) return; // cancelled while it waited
  const stillWanted = () => db.get("SELECT 1 FROM compat_copies WHERE item_id = ? AND status = 'running'", [itemId]);

  const info = await getPlaybackInfo(itemId, file.realPath);
  if (info.probeFailed) return failed('This file could not be read as a video', 'P302');
  const source = fs.statSync(file.realPath);
  const out = tmpPath(itemId);
  const accelName = await getActiveHwaccel();
  const accel = accelName ? hwaccelConfig(accelName) : null;
  logger.info('media', `Converting "${item.title}" (${row.source_codec || info.videoCodec}) to H.264 with ${accelName || 'the CPU'} (${settings.quality} quality${settings.maxHeight && info.height > settings.maxHeight ? `, scaled down to ${settings.maxHeight}p` : ''})`);

  // Hardware then CPU, each retried without subtitles, since an unconvertible subtitle
  // track shouldn't cost the whole copy.
  const hasSubs = (info.subtitleTracks || []).some((track) => track.isTextBased);
  const plans = [];
  for (const encoder of accel ? [accel, null] : [null]) {
    for (const subtitles of hasSubs ? [true, false] : [false]) plans.push({ accel: encoder, subtitles, quality: settings.quality, maxHeight: settings.maxHeight });
  }
  let result;
  for (const [index, plan] of plans.entries()) {
    result = await runEncode(itemId, buildArgs(info, file.realPath, out, plan), info.duration, room);
    if (result.ok || result.cancelled || result.error === 'cap' || result.code === 'P303') break;
    if (!await stillWanted()) return removeFiles(itemId); // removed between attempts
    const next = plans[index + 1];
    if (next) {
      logger.warn('media', `Converting "${item.title}" with ${plan.accel ? accelName : 'the CPU'}${plan.subtitles ? '' : ', no subtitles,'} failed (${result.error}); trying ${next.accel ? accelName : 'the CPU'}${next.subtitles ? '' : ' without its subtitles'}`);
    }
  }
  if (result.cancelled) {
    logger.info('media', `Converting "${item.title}" was cancelled`);
    return;
  }
  if (!result.ok) return result.error === 'cap' ? failed('cap', 'P311') : failed(result.error, result.code || 'P304');

  // Keep only a complete H.264 result.
  forgetPlaybackInfo(compatProbeId(itemId));
  const made = await getPlaybackInfo(compatProbeId(itemId), out);
  forgetPlaybackInfo(compatProbeId(itemId));
  if (made.probeFailed || made.videoCodec !== 'h264' || (info.duration > 0 && made.duration < info.duration * 0.95 - 2)) {
    return failed('The converted file came out incomplete', 'P304');
  }
  const size = fs.statSync(out).size;
  if (size > room) return failed('cap', 'P311');

  fs.renameSync(out, copyPath(itemId));
  const saved = await db.run(
    `UPDATE compat_copies SET status = 'done', size = ?, source_size = ?, source_mtime = ?, error = NULL,
       error_code = NULL, finished_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'running'`,
    [size, source.size, Math.floor(source.mtimeMs), itemId]
  );
  if (!saved.changes) return removeFiles(itemId); // removed while it was being checked
  logger.info('media', `The H.264 copy of "${item.title}" is ready (${Math.round(size / 1024 ** 2)} MB, the original is ${Math.round(source.size / 1024 ** 2)} MB)`);
}

// Replaces the original with the copy. The copy is staged beside it first, so the original
// is only touched once the replacement is fully on the same disk.
async function replaceOriginal(db, row) {
  const itemId = row.item_id;
  const item = await db.get('SELECT id, path, title, library_id FROM items WHERE id = ?', [itemId]);
  if (!item) return removeCopy(db, itemId);
  if (isLibraryScanning(item.library_id)) return; // next round

  const original = path.resolve(item.path);
  const file = await resolveLibraryFile(original).catch(() => ({ ok: false }));
  if (!file.ok) return;
  if (!await readyCopy(db, itemId, file.realPath)) return;

  const giveUp = async (reason) => {
    await db.run('UPDATE compat_copies SET replace_error = ? WHERE item_id = ?', [reason, itemId]);
    const why = { readonly: 'the media folder is read-only', link: 'it is a link to a file elsewhere', exists: 'another file already has that name' }[reason] || reason;
    logger.warn('media', `Could not replace "${item.title}" with its converted copy: ${why}`);
  };
  // Links aren't replaced; the copy keeps being served from compat.
  if (file.realPath !== original) return giveUp('link');

  const dir = path.dirname(original);
  const base = path.basename(original, path.extname(original));
  let target = path.join(dir, `${base}.mp4`);
  if (target !== original && fs.existsSync(target)) target = path.join(dir, `${base}.h264.mp4`);
  if (target !== original && fs.existsSync(target)) return giveUp('exists');
  const staging = path.join(dir, `.${base}.plinthio-part`);

  try {
    await fs.promises.copyFile(copyPath(itemId), staging);
    if (fs.statSync(staging).size !== row.size) throw new Error('the copy came out a different size');
    // A scan started during the copy has already listed this folder; retry next round.
    if (isLibraryScanning(item.library_id)) {
      fs.unlinkSync(staging);
      return;
    }
    // No await between these, so nothing sees the folder half-changed.
    fs.renameSync(staging, target);
    if (target !== original) fs.unlinkSync(original);
  } catch (err) {
    try { fs.unlinkSync(staging); } catch { /* never written */ }
    return giveUp(['EROFS', 'EACCES', 'EPERM'].includes(err.code) ? 'readonly' : err.message);
  }

  await db.run(
    `UPDATE items SET path = ?, format = 'mp4', file_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [target, row.size, itemId]
  );
  await db.run('DELETE FROM compat_copies WHERE item_id = ?', [itemId]);
  removeFiles(itemId);
  forgetPlaybackInfo(itemId);
  dropItemHlsCache(itemId);
  logger.info('media', `Replaced "${item.title}" with its converted copy: ${path.basename(original)} was deleted, ${path.basename(target)} took its place`);
}

async function replaceOriginals(db) {
  if (!(await getCompatSettings(db)).replaceOriginal) return;
  const rows = await db.all("SELECT * FROM compat_copies WHERE status = 'done' AND replace_error IS NULL");
  for (const row of rows) {
    try {
      await replaceOriginal(db, row);
    } catch (err) {
      logger.error('media', `Replacing item ${row.item_id} with its converted copy failed: ${err.message}`);
    }
  }
}

async function work() {
  if (working) {
    kickAgain = true;
    return;
  }
  working = true;
  try {
    const db = await getDb();
    for (;;) {
      const row = await db.get("SELECT * FROM compat_copies WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1");
      if (!row) break;
      await convert(db, row);
    }
    await replaceOriginals(db);
  } catch (err) {
    logger.error('media', `The conversion queue stopped: ${err.message}. It starts again within a minute`);
  } finally {
    working = false;
    if (kickAgain) {
      kickAgain = false;
      kick();
    }
  }
}

function kick() {
  setImmediate(() => { work(); });
}

// Startup: requeues interrupted conversions, deletes orphan files, starts the queue.
export async function initCompat() {
  const db = await getDb();
  await db.run("UPDATE compat_copies SET status = 'queued' WHERE status = 'running'");
  await db.run('DELETE FROM compat_copies WHERE item_id NOT IN (SELECT id FROM items)');
  const done = new Set((await db.all("SELECT item_id FROM compat_copies WHERE status = 'done'")).map((row) => row.item_id));
  for (const name of fs.readdirSync(COMPAT_DIR)) {
    const itemId = name.split('.')[0];
    if (name.endsWith('.part.mp4') || !done.has(itemId)) {
      try { fs.unlinkSync(path.join(COMPAT_DIR, name)); } catch { /* already gone */ }
    }
  }
  let ticks = 0;
  setInterval(() => {
    tick();
    // Once a minute, e.g. for originals skipped during a scan.
    if (++ticks % Math.ceil(60000 / TICK_MS) === 0) kick();
  }, TICK_MS).unref();
  kick();
}

process.on('exit', () => {
  if (current) current.proc.kill('SIGKILL');
});
