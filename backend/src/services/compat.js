import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config/env.js';
import { getDb } from '../config/database.js';
import { logger } from './logger.js';
import { getSetting, setSetting } from './settings.js';
import { getPlaybackInfo, forgetPlaybackInfo } from './transcode.js';
import { getActiveHwaccel, hwaccelConfig } from './hwaccel.js';
import { activeEncodeCount, dropItemHlsCache } from './hls.js';
import { localInputArgs } from './probe.js';
import { isLibraryScanning } from './scanner.js';
import { resolveLibraryFile } from '../utils/libraryPath.js';

// H.264 copies of video that some devices can't decode. AV1 (and VP9/VP8) plays in most
// browsers but not on Apple devices without a hardware decoder; for those the server
// converts as it streams (routes/video.js), which costs a full encode every time someone
// presses play. A copy is that conversion done once, in the background, at full size:
// afterwards the device is simply sent the copy.
//
// Copies live under DATA_DIR/compat, never in a library folder, so a title is still one
// file as far as the scanner and the shelves are concerned. The original is left alone
// unless the admin switches on "replace the original", in which case the finished copy
// takes the original's place in the library and its row keeps its id, progress and art.

const COMPAT_DIR = path.join(config.dataDir, 'compat');
fs.mkdirSync(COMPAT_DIR, { recursive: true });

// What a copy can be made of. H.264 needs none; HEVC plays on every Apple device.
export const CONVERTIBLE_CODECS = new Set(['av1', 'vp9', 'vp8']);

const DEFAULT_MAX_GB = 50;
const TICK_MS = Math.max(50, parseInt(process.env.COMPAT_TICK_MS, 10) || 3000);

// The conversion running now: { itemId, proc, progress, paused, cancelled, capped, tmpPath, budget }.
let current = null;
let working = false;
let kickAgain = false;
// A library being searched for titles to convert: { total, done, queued }.
let discovery = null;

export class CompatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const copyPath = (itemId) => path.join(COMPAT_DIR, `${itemId}.mp4`);
const tmpPath = (itemId) => path.join(COMPAT_DIR, `${itemId}.part.mp4`);
// The probe cache key for a title's copy (see getPlaybackInfo).
export const compatProbeId = (itemId) => `${itemId}.compat`;

export async function getCompatSettings(db) {
  const maxGb = parseFloat(await getSetting(db, 'compat_max_gb'));
  return {
    maxGb: Number.isFinite(maxGb) && maxGb >= 0 ? maxGb : DEFAULT_MAX_GB,
    allowUsers: (await getSetting(db, 'compat_allow_users')) === '1',
    replaceOriginal: (await getSetting(db, 'compat_replace_original')) === '1'
  };
}

export async function saveCompatSettings(db, patch) {
  if (patch.maxGb !== undefined) await setSetting(db, 'compat_max_gb', String(patch.maxGb));
  if (patch.allowUsers !== undefined) await setSetting(db, 'compat_allow_users', patch.allowUsers ? '1' : '0');
  if (patch.replaceOriginal !== undefined) {
    await setSetting(db, 'compat_replace_original', patch.replaceOriginal ? '1' : '0');
    // Saving the switch is also "try again" for originals that couldn't be replaced.
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

/**
 * Where a title's copy stands, for the apps: { status: 'none' | 'queued' | 'running' |
 * 'done' | 'failed', progress: 0–1, error }.
 */
export async function copyState(db, itemId) {
  const row = await db.get('SELECT * FROM compat_copies WHERE item_id = ?', [itemId]);
  if (!row) return { status: 'none', progress: 0, error: null };
  return { status: row.status, progress: progressOf(row), error: row.error || null };
}

/**
 * The finished copy of this file, or null. A copy made from a file that has since been
 * replaced (a different size or date) is thrown away rather than played.
 */
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
    logger.info('media', `The file for item ${itemId} changed; its H.264 copy was removed`);
    await db.run('DELETE FROM compat_copies WHERE item_id = ?', [itemId]);
    removeFiles(itemId);
    return null;
  }
  return { path: file, size: row.size };
}

/**
 * Queues a copy of one title. Resolves to its state; a title already queued, running or
 * done is left as it is, and a failed one is tried again.
 */
export async function requestCopy(db, itemId, filePath, userId) {
  const existing = await db.get('SELECT status FROM compat_copies WHERE item_id = ?', [itemId]);
  if (existing && existing.status !== 'failed') return copyState(db, itemId);

  const info = await getPlaybackInfo(itemId, filePath);
  if (info.probeFailed) throw new CompatError(422, 'This file could not be read as a video');
  if (!CONVERTIBLE_CODECS.has(info.videoCodec)) {
    throw new CompatError(409, 'This video already plays everywhere, so it needs no H.264 copy');
  }
  const settings = await getCompatSettings(db);
  if (await usedBytes(db) >= settings.maxGb * 1024 ** 3) {
    throw new CompatError(409, 'The size limit for H.264 copies has been reached');
  }

  removeFiles(itemId);
  await db.run(
    `INSERT INTO compat_copies (item_id, status, source_codec, requested_by) VALUES (?, 'queued', ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET status = 'queued', size = 0, error = NULL, replace_error = NULL,
       source_codec = excluded.source_codec, requested_by = excluded.requested_by,
       created_at = CURRENT_TIMESTAMP, finished_at = NULL`,
    [itemId, info.videoCodec, userId || null]
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
  for (const row of await db.all('SELECT item_id FROM compat_copies')) await removeCopy(db, row.item_id);
}

/** Everything the admin page shows: the settings, the space used and each copy. */
export async function compatOverview(db) {
  const rows = await db.all(
    `SELECT c.item_id, c.status, c.size, c.source_codec, c.error, c.replace_error, c.created_at,
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
      size: row.size || 0,
      sourceCodec: row.source_codec || null,
      error: row.error || null,
      replaceError: row.replace_error || null
    }))
  };
}

/**
 * Looks through one library (or all of them) for video that needs a copy and queues it.
 * Returns straight away; compatOverview().discovery reports how far it has got.
 */
export async function queueLibrary(db, libraryId, userId) {
  if (discovery) throw new CompatError(409, 'A search for videos to convert is already running');
  const items = await db.all(
    `SELECT i.id, i.path FROM items i
     WHERE i.media_type IN ('movie', 'show', 'anime') AND i.missing_since IS NULL
       AND i.id NOT IN (SELECT item_id FROM compat_copies WHERE status != 'failed')
       ${libraryId ? 'AND i.library_id = ?' : ''}`,
    libraryId ? [libraryId] : []
  );
  discovery = { total: items.length, done: 0, queued: 0 };
  (async () => {
    try {
      for (const item of items) {
        try {
          const file = await resolveLibraryFile(item.path);
          if (file.ok) {
            const info = await getPlaybackInfo(item.id, file.realPath);
            if (!info.probeFailed && CONVERTIBLE_CODECS.has(info.videoCodec)) {
              await requestCopy(db, item.id, file.realPath, userId);
              discovery.queued++;
            }
          }
        } catch (err) {
          // Past the size limit nothing more can be queued; anything else is one bad file.
          if (err instanceof CompatError && /limit/.test(err.message)) break;
        }
        discovery.done++;
      }
      logger.info('media', `H.264 copies: ${discovery.queued} of ${items.length} video(s) queued for conversion`);
    } finally {
      discovery = null;
    }
  })();
  return { total: items.length };
}

// ─── The conversion itself ──────────────────────────────────────────────────

// For the hardware encoders, which take a bitrate rather than a quality. Generous for the
// same reason as the streaming ladder (services/hls.js): this is the copy people keep.
function bitrateFor(height) {
  if (height > 1440) return 24000;
  if (height > 1080) return 14000;
  if (height > 720) return 8000;
  if (height > 480) return 4000;
  return 2000;
}

async function buildArgs(info, sourcePath, outPath, { subtitles }) {
  const accelName = await getActiveHwaccel();
  const accel = accelName ? hwaccelConfig(accelName) : null;
  // The source's own size (H.264 past 2160p plays almost nowhere), with even dimensions.
  const height = Math.min(info.height || 1080, 2160) & ~1;
  const bitrate = bitrateFor(height);

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...(accel ? accel.deviceArgs : []),
    ...localInputArgs(),
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '0:a?'
  ];
  const textSubs = subtitles ? (info.subtitleTracks || []).filter((track) => track.isTextBased) : [];
  for (const track of textSubs) args.push('-map', `0:s:${track.index}`);

  if (accel) {
    args.push(
      '-vf', accel.filter(height), '-c:v', accel.encoder,
      '-b:v', `${bitrate}k`, '-maxrate', `${Math.round(bitrate * 1.5)}k`, '-bufsize', `${bitrate * 3}k`
    );
  } else {
    // Half the cores: this runs for a long time beside a server people are using.
    args.push(
      '-vf', `scale=-2:${height}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
      '-maxrate', `${Math.round(bitrate * 1.5)}k`, '-bufsize', `${bitrate * 3}k`,
      '-pix_fmt', 'yuv420p', '-threads', String(Math.max(1, Math.floor(os.cpus().length / 2)))
    );
  }

  // Audio every browser and Apple device plays in an MP4: AAC and MP3 are kept as they
  // are, anything else (Opus, AC-3, DTS…) becomes AAC with up to 5.1 channels.
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
        // Both are microseconds, whatever the older name says.
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (match && duration > 0) job.progress = Math.min(0.99, parseInt(match[1], 10) / 1e6 / duration);
      }
    });
    const done = (result) => {
      if (current === job) current = null;
      resolve(result);
    };
    proc.on('error', (err) => done({ ok: false, error: `ffmpeg could not start: ${err.message}` }));
    proc.on('close', (code) => {
      if (job.cancelled) return done({ ok: false, cancelled: true });
      if (job.capped) return done({ ok: false, error: 'cap' });
      if (code === 0) return done({ ok: true });
      done({ ok: false, error: (stderr.trim() || `ffmpeg exited ${code}`).slice(0, 300) });
    });
  });
}

// Keeps the running conversion out of the way: stopped while someone is watching something
// the server has to convert live, and ended if it would take the copies past their limit.
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
    if (busy && !job.paused) { job.proc.kill('SIGSTOP'); job.paused = true; }
    else if (!busy && job.paused) { job.proc.kill('SIGCONT'); job.paused = false; }
  } catch { /* no job control on this platform: it keeps running */ }
}

async function fail(db, itemId, error) {
  removeFiles(itemId);
  await db.run(
    "UPDATE compat_copies SET status = 'failed', error = ?, size = 0, finished_at = CURRENT_TIMESTAMP WHERE item_id = ?",
    [error, itemId]
  );
  logger.warn('media', `H.264 copy of item ${itemId} failed: ${error}`);
}

async function convert(db, row) {
  const itemId = row.item_id;
  const item = await db.get('SELECT id, path, title FROM items WHERE id = ?', [itemId]);
  if (!item) return removeCopy(db, itemId);

  const file = await resolveLibraryFile(item.path).catch(() => ({ ok: false }));
  if (!file.ok) return fail(db, itemId, 'missing');

  const settings = await getCompatSettings(db);
  const room = settings.maxGb * 1024 ** 3 - await usedBytes(db);
  if (room <= 0) return fail(db, itemId, 'cap');

  // Live conversions come first.
  while (activeEncodeCount() > 0) await new Promise((r) => setTimeout(r, TICK_MS));
  const claimed = await db.run("UPDATE compat_copies SET status = 'running' WHERE item_id = ? AND status = 'queued'", [itemId]);
  if (!claimed.changes) return; // cancelled while it waited

  const info = await getPlaybackInfo(itemId, file.realPath);
  if (info.probeFailed) return fail(db, itemId, 'This file could not be read as a video');
  const source = fs.statSync(file.realPath);
  const out = tmpPath(itemId);
  logger.info('media', `Making an H.264 copy of "${item.title}" (${info.videoCodec})`);

  const hasSubs = (info.subtitleTracks || []).some((track) => track.isTextBased);
  let result = await runEncode(itemId, await buildArgs(info, file.realPath, out, { subtitles: true }), info.duration, room);
  // A subtitle track ffmpeg can't turn into MP4 text shouldn't cost the whole copy.
  if (!result.ok && !result.cancelled && result.error !== 'cap' && hasSubs) {
    result = await runEncode(itemId, await buildArgs(info, file.realPath, out, { subtitles: false }), info.duration, room);
  }
  if (result.cancelled) return;
  if (!result.ok) return fail(db, itemId, result.error);

  // Only a copy that really is the whole film in H.264 is kept.
  forgetPlaybackInfo(compatProbeId(itemId));
  const made = await getPlaybackInfo(compatProbeId(itemId), out);
  forgetPlaybackInfo(compatProbeId(itemId));
  if (made.probeFailed || made.videoCodec !== 'h264' || (info.duration > 0 && made.duration < info.duration * 0.95 - 2)) {
    return fail(db, itemId, 'The converted file came out incomplete');
  }
  const size = fs.statSync(out).size;
  if (size > room) return fail(db, itemId, 'cap');

  fs.renameSync(out, copyPath(itemId));
  const saved = await db.run(
    `UPDATE compat_copies SET status = 'done', size = ?, source_size = ?, source_mtime = ?, error = NULL,
       finished_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'running'`,
    [size, source.size, Math.floor(source.mtimeMs), itemId]
  );
  if (!saved.changes) return removeFiles(itemId); // removed while it was being checked
  logger.info('media', `H.264 copy of "${item.title}" is ready (${Math.round(size / 1024 ** 2)} MB)`);
}

// ─── Replacing the original ─────────────────────────────────────────────────

// Puts a finished copy where the original was and deletes the original. The copy is
// written into the library folder under a temporary name first, so the original is only
// touched once the whole replacement is sitting beside it on the same disk.
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
    logger.warn('media', `Could not replace "${item.title}" with its H.264 copy: ${reason}`);
  };
  // A link is someone else's file layout; the copy keeps being used from where it is.
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
    // A scan that started during the copy has already listed this folder: wait for the next round.
    if (isLibraryScanning(item.library_id)) {
      fs.unlinkSync(staging);
      return;
    }
    // No await between these: nothing else in the server sees the folder half-changed.
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
  logger.info('media', `Replaced "${item.title}" with its H.264 copy (${path.basename(target)})`);
}

async function replaceOriginals(db) {
  if (!(await getCompatSettings(db)).replaceOriginal) return;
  const rows = await db.all("SELECT * FROM compat_copies WHERE status = 'done' AND replace_error IS NULL");
  for (const row of rows) {
    try {
      await replaceOriginal(db, row);
    } catch (err) {
      logger.warn('media', `Replacing item ${row.item_id} with its H.264 copy failed: ${err.message}`);
    }
  }
}

// ─── The queue ──────────────────────────────────────────────────────────────

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
    logger.warn('media', `H.264 copy queue stopped: ${err.message}`);
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

/**
 * Called once at startup: a conversion cut short by the last shutdown goes back in the
 * queue, files nothing refers to are deleted, and the queue starts.
 */
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
    // Once a minute: originals that couldn't be replaced during a scan, and the like.
    if (++ticks % Math.ceil(60000 / TICK_MS) === 0) kick();
  }, TICK_MS).unref();
  kick();
}

process.on('exit', () => {
  if (current) current.proc.kill('SIGKILL');
});
