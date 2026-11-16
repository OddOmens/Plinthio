import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { PlinthioError } from '../errors.js';
import { logger } from './logger.js';
import { getActiveHwaccel, hwaccelConfig } from './hwaccel.js';
import { localInputArgs } from './probe.js';

const HLS_DIR = path.join(config.cacheDir, 'hls');
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });

const SEGMENT_SECONDS = 3;
// Jobs with no requests for this long are reaped, so abandoned playback doesn't leave encoders running.
const IDLE_REAP_MS = 25 * 1000;
const REAP_SWEEP_MS = 10 * 1000;
const SEGMENT_WAIT_TIMEOUT_MS = 15 * 1000;
const SEGMENT_POLL_INTERVAL_MS = 50;

// Generous bitrates: a self-hosted server is usually reached over a LAN or tunnel.
const QUALITY_LADDER = [
  { name: '1080p', height: 1080, bitrate: 8000 },
  { name: '720p', height: 720, bitrate: 4000 },
  { name: '480p', height: 480, bitrate: 1500 }
];

// Remuxes copy the source streams, so they have a single rendition.
const SOURCE_QUALITY = 'source';

const PROFILE_RE = /^(source|1080p|720p|480p)-a(\d{1,2})$/;

const jobs = new Map();
// Last request time per job directory, for the size sweep's eviction order.
const dirLastUsed = new Map();

export function parseProfile(profile) {
  const match = PROFILE_RE.exec(profile || '');
  if (!match) return null;
  return { quality: match[1], audioTrack: parseInt(match[2], 10) };
}

export function formatProfile(quality, audioTrack) {
  return `${quality}-a${audioTrack}`;
}

// Renditions for a source: one for a remux, else every rung not taller than the source (at least one).
export function buildLadder(playbackInfo) {
  if (playbackInfo.mode === 'remux') {
    return [{ name: SOURCE_QUALITY, height: playbackInfo.height || 0, bitrate: 8000 }];
  }

  const sourceHeight = playbackInfo.height || 1080;
  const rungs = QUALITY_LADDER.filter((rung) => rung.height <= sourceHeight);
  return rungs.length > 0 ? rungs : [QUALITY_LADDER[QUALITY_LADDER.length - 1]];
}

// Encodes cost real CPU, so they're capped. Past PER_USER_ENCODES a user's oldest encode is
// stopped (usually a quality switch); past the server cap a new one gets P305.
// Remuxes are cheap on CPU but each writes a full copy to the cache, so they get the same
// limits with more headroom.
const PER_USER_ENCODES = 2;
const MAX_ENCODES = Math.max(1, parseInt(process.env.TRANSCODE_LIMIT, 10) || 4);
const PER_USER_REMUXES = 3;
const MAX_REMUXES = Math.max(1, parseInt(process.env.REMUX_LIMIT, 10) || Math.max(8, MAX_ENCODES * 2));

const LIMITS = {
  transcode: { perUser: PER_USER_ENCODES, max: MAX_ENCODES },
  remux: { perUser: PER_USER_REMUXES, max: MAX_REMUXES }
};

// Starts admitted past the caps but not yet spawned (building args awaits). Keyed like `jobs`.
// Duplicate requests share the promise, and the caps count these so a parallel burst can't
// all pass the check.
const pendingStarts = new Map();

// Everything holding (or about to hold) an ffmpeg process of this kind, oldest first.
function activeSlots(mode) {
  const running = [...jobs.values()].filter((job) => job.mode === mode && !job.exited && job.proc);
  const pending = [...pendingStarts.values()].filter((start) => start.mode === mode && !start.cancelled);
  return [...running, ...pending].sort((a, b) => a.lastRequestedAt - b.lastRequestedAt);
}

function stopSlot(slot) {
  if (slot.pending) {
    // No process yet: startJob sees the flag once its await returns and never spawns.
    slot.cancelled = true;
    return;
  }
  killJob(slot);
  slot.exited = true;
  if (jobs.get(slot.mapKey) === slot) jobs.delete(slot.mapKey);
}

// Synchronous so the caller registers its pending start in the same tick.
function makeRoom(mode, userId) {
  const limit = LIMITS[mode];
  if (userId) {
    const now = Date.now();
    // Never stop a job someone else is also watching.
    const mine = activeSlots(mode)
      .filter((slot) => slot.ownerId === userId && !hasOtherActiveViewers(slot, userId, now));
    while (mine.length >= limit.perUser) stopSlot(mine.shift());
  }
  if (activeSlots(mode).length >= limit.max) throw new PlinthioError('P305');
}

function jobDir(itemId, profile) {
  return path.join(HLS_DIR, itemId, profile);
}

async function buildEncodeArgs(mode, quality, audioTrack, opts = {}) {
  const mapArgs = ['-map', '0:v:0', '-map', `0:a:${audioTrack}?`];

  if (mode === 'remux') {
    // -fflags +igndts+genpts: smooth timestamps from input
    // -tag:v hvc1: required for Chromium/Safari hardware HEVC decode in fMP4
    // -copyts -avoid_negative_ts disabled: preserves timestamps with zero keyframe wait
    const isHevc = opts.videoCodec === 'hevc' || opts.isHevc;
    const videoTagArgs = isHevc ? ['-tag:v', 'hvc1'] : [];
    const remuxTsFlags = ['-copyts', '-avoid_negative_ts', 'disabled', '-max_muxing_queue_size', '2048'];

    if (opts.audioTranscode) {
      return {
        inputArgs: ['-fflags', '+igndts+genpts'],
        outputArgs: [
          ...mapArgs,
          '-c:v', 'copy',
          ...videoTagArgs,
          '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
          ...remuxTsFlags
        ],
        isHw: false
      };
    }
    return {
      inputArgs: ['-fflags', '+igndts+genpts'],
      outputArgs: [
        ...mapArgs,
        '-c', 'copy',
        ...videoTagArgs,
        ...remuxTsFlags
      ],
      isHw: false
    };
  }

  const rung = QUALITY_LADDER.find((r) => r.name === quality) || QUALITY_LADDER[1];
  const accelName = await getActiveHwaccel();
  const accel = accelName ? hwaccelConfig(accelName) : null;

  if (accel) {
    return {
      inputArgs: accel.deviceArgs,
      outputArgs: [
        ...mapArgs,
        '-vf', accel.filter(rung.height),
        '-c:v', accel.encoder,
        '-b:v', `${rung.bitrate}k`,
        '-maxrate', `${rung.bitrate}k`,
        '-bufsize', `${rung.bitrate * 2}k`,
        '-c:a', 'aac', '-ac', '2', '-b:a', '160k'
      ],
      isHw: true
    };
  }

  // Software fallback: capped threads and 'ultrafast' so low-power hosts keep up.
  return {
    inputArgs: [],
    outputArgs: [
      ...mapArgs,
      '-vf', `scale=-2:${rung.height}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '26',
      '-threads', '2',
      '-maxrate', `${rung.bitrate}k`,
      '-bufsize', `${rung.bitrate * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-b:a', '128k'
    ],
    isHw: false
  };
}

/**
 * Starts (or reuses) a progressive HLS encode for one profile of an item.
 * No await may sit between the existing-job checks and registering the pending start,
 * or parallel requests could each spawn ffmpeg.
 */
export function getOrStartJob(itemId, filePath, opts = {}) {
  const mode = opts.mode === 'remux' ? 'remux' : 'transcode';
  const quality = mode === 'remux' ? SOURCE_QUALITY : (opts.quality || '720p');
  const audioTrack = Number.isInteger(opts.audioTrack) ? opts.audioTrack : 0;
  // A converted copy (services/compat.js) gets its own job and folder.
  const profile = formatProfile(quality, audioTrack) + (opts.variant ? `-${opts.variant}` : '');
  const mapKey = `${itemId}:${profile}`;
  const dir = jobDir(itemId, profile);
  const now = Date.now();
  dirLastUsed.set(dir, now);

  try {
    const existing = jobs.get(mapKey);
    if (existing && !existing.exited) {
      existing.lastRequestedAt = now;
      return Promise.resolve(existing);
    }

    const starting = pendingStarts.get(mapKey);
    if (starting && !starting.cancelled) {
      starting.lastRequestedAt = now;
      return starting.promise;
    }

    fs.mkdirSync(dir, { recursive: true });
    const playlistPath = path.join(dir, 'media.m3u8');

    // A previous run finished this profile; serve it from disk.
    if (fs.existsSync(playlistPath) && fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST')) {
      const finished = { mapKey, profile, quality, audioTrack, mode, dir, playlistPath, proc: null, exited: true, error: null, lastRequestedAt: now };
      jobs.set(mapKey, finished);
      return Promise.resolve(finished);
    }

    makeRoom(mode, opts.userId);

    const start = {
      pending: true,
      mapKey,
      mode,
      ownerId: opts.userId || null,
      cancelled: false,
      lastRequestedAt: now,
      promise: null
    };
    start.promise = startJob(start, { itemId, filePath, profile, quality, audioTrack, dir, playlistPath, opts })
      .finally(() => {
        if (pendingStarts.get(mapKey) === start) pendingStarts.delete(mapKey);
      });
    pendingStarts.set(mapKey, start);
    return start.promise;
  } catch (err) {
    return Promise.reject(err);
  }
}

async function startJob(start, { itemId, filePath, profile, quality, audioTrack, dir, playlistPath, opts }) {
  const { mapKey, mode } = start;
  const { inputArgs, outputArgs } = await buildEncodeArgs(mode, quality, audioTrack, opts);

  // Cancelled while building args; don't spawn.
  if (start.cancelled) throw new PlinthioError('P305');

  // cwd is the job dir so segment URIs in the playlist stay relative, matching the segment route.
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputArgs,
    ...localInputArgs(),
    '-i', filePath,
    ...outputArgs,
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    // 'event' so clients can play while the playlist grows; ffmpeg appends #EXT-X-ENDLIST at the end.
    '-hls_playlist_type', 'event',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'seg_%05d.m4s',
    '-hls_list_size', '0',
    'media.m3u8'
  ];

  // The directory may have been swept while the arguments were being worked out.
  fs.mkdirSync(dir, { recursive: true });

  // No await from here to jobs.set, so the process is tracked from the moment it exists.
  const stale = jobs.get(mapKey);
  if (stale && !stale.exited) killJob(stale);

  const proc = spawn('ffmpeg', args, { cwd: dir });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString().slice(0, 4000); });

  const job = {
    mapKey,
    ownerId: start.ownerId,
    profile,
    quality,
    audioTrack,
    mode,
    dir,
    playlistPath,
    proc,
    exited: false,
    error: null,
    lastRequestedAt: Date.now()
  };

  proc.on('error', (err) => {
    job.exited = true;
    job.error = new PlinthioError('P303', undefined, { cause: err });
    logger.warn('media', `HLS ffmpeg spawn failed for item ${itemId}: ${err.message}`);
  });

  proc.on('close', (code) => {
    job.exited = true;
    // 255/SIGKILL is the normal result of the client disconnecting or seeking away.
    if (code && code !== 255 && stderr) {
      logger.warn('media', `HLS ffmpeg exited ${code} for item ${itemId} (${profile}): ${stderr.trim()}`);
      // Clear the failed output so the next request re-runs (e.g. a runtime hardware encoder failure).
      job.error = new PlinthioError(
        /Input\/output error/i.test(stderr) ? 'P302' : 'P304',
        undefined,
        { cause: new Error(stderr.trim().slice(0, 300)) }
      );
      // Only if nothing newer has taken over this directory since.
      const current = jobs.get(mapKey);
      if (!current || current === job) fs.rmSync(job.dir, { recursive: true, force: true });
    }
  });

  jobs.set(mapKey, job);
  return job;
}

// Waits for a file to appear and stop growing, since ffmpeg writes segments non-atomically.
async function waitForStableFile(filePath, job, timeoutMs = SEGMENT_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;

  while (Date.now() < deadline) {
    if (job.exited && job.error) throw job.error;
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      // init.mp4 is written once atomically at the start of the job
      if (filePath.endsWith('init.mp4') && size > 0) return true;
      if (size > 0 && size === lastSize) return true;
      lastSize = size;
    } else if (job.exited) {
      // ffmpeg exited without producing this file.
      return false;
    }
    await new Promise((r) => setTimeout(r, SEGMENT_POLL_INTERVAL_MS));
  }
  return fs.existsSync(filePath);
}

export async function waitForPlaylist(job) {
  const deadline = Date.now() + SEGMENT_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (job.exited && job.error) throw job.error;
    if (fs.existsSync(job.playlistPath)) {
      const content = fs.readFileSync(job.playlistPath, 'utf8');
      if (content.includes('.m4s') || content.includes('#EXT-X-ENDLIST')) return true;
    }
    await new Promise((r) => setTimeout(r, SEGMENT_POLL_INTERVAL_MS));
  }
  return false;
}

export async function waitForSegment(job, filename) {
  const target = path.join(job.dir, filename);
  // Filename comes from a route param; keep it inside the job directory.
  if (path.resolve(target) !== path.join(path.resolve(job.dir), filename)) return null;
  const ok = await waitForStableFile(target, job);
  return ok ? target : null;
}

// Jobs are shared per item + profile; viewers are tracked so one viewer's stop leaves the
// job running for others.
export function touchJob(job, viewerId) {
  const now = Date.now();
  job.lastRequestedAt = now;
  if (job.dir) dirLastUsed.set(job.dir, now);
  if (viewerId) {
    if (!job.viewers) job.viewers = new Map();
    job.viewers.set(viewerId, now);
  }
}

function hasOtherActiveViewers(job, viewerId, now) {
  if (!job.viewers) return false;
  for (const [id, seenAt] of job.viewers) {
    if (id !== viewerId && now - seenAt <= IDLE_REAP_MS) return true;
  }
  return false;
}

function killJob(job) {
  if (job.proc && !job.proc.killed) job.proc.kill('SIGKILL');
}

// Kills an item's ffmpeg jobs, unless another viewer is still using them.
export function stopItemJobs(itemId, viewerId = null) {
  const now = Date.now();
  for (const [mapKey, job] of jobs.entries()) {
    if (mapKey.startsWith(`${itemId}:`)) {
      if (viewerId) {
        job.viewers?.delete(viewerId);
        // Still watched by someone else; leave it to the idle reaper.
        if (hasOtherActiveViewers(job, viewerId, now)) continue;
      }
      killJob(job);
      job.exited = true;
      job.proc = null;
      jobs.delete(mapKey);
    }
  }
  // Cancel pending starts too, unless another account's.
  for (const [mapKey, start] of pendingStarts.entries()) {
    if (!mapKey.startsWith(`${itemId}:`)) continue;
    if (viewerId && start.ownerId && start.ownerId !== viewerId) continue;
    start.cancelled = true;
  }
}

// Running or pending transcodes; background conversions (services/compat.js) wait while any exist.
export function activeEncodeCount() {
  return activeSlots('transcode').length;
}

// Stops an item's jobs and deletes its cache, e.g. after the file was replaced.
export function dropItemHlsCache(itemId) {
  stopItemJobs(itemId);
  const itemDir = path.join(HLS_DIR, itemId);
  for (const dir of dirLastUsed.keys()) {
    if (dir.startsWith(itemDir + path.sep)) dirLastUsed.delete(dir);
  }
  fs.rmSync(itemDir, { recursive: true, force: true });
}

// No ffmpeg outlives the server process.
export function stopAllJobs() {
  for (const start of pendingStarts.values()) start.cancelled = true;
  for (const job of jobs.values()) killJob(job);
}
process.on('exit', stopAllJobs);

// Kills idle ffmpeg processes; their segments stay on disk for sweepHlsCache, so a returning
// viewer can reuse them.
function reapIdleJobs() {
  const now = Date.now();
  for (const [mapKey, job] of jobs.entries()) {
    if (job.exited) {
      jobs.delete(mapKey);
      continue;
    }
    if (now - job.lastRequestedAt > IDLE_REAP_MS) {
      killJob(job);
      jobs.delete(mapKey);
    }
  }
}

setInterval(reapIdleJobs, REAP_SWEEP_MS).unref();

// Size budget on top of the age sweep (each remux is a full copy). Least recently used
// directories go first; running or recently requested ones (EVICT_IDLE_MS) are kept.
const HLS_CACHE_MAX_BYTES = Math.max(1, parseFloat(process.env.HLS_CACHE_MAX_GB) || 40) * 1024 ** 3;
const EVICT_IDLE_MS = 10 * 60 * 1000;
const SIZE_SWEEP_MS = 5 * 60 * 1000;

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try { total += fs.statSync(path.join(dir, entry.name)).size; } catch { /* just removed */ }
    }
  } catch {
    // Directory went away mid-sweep.
  }
  return total;
}

function listJobDirs() {
  const dirs = [];
  let itemIds;
  try {
    itemIds = fs.readdirSync(HLS_DIR);
  } catch {
    return dirs;
  }
  for (const itemId of itemIds) {
    const itemDir = path.join(HLS_DIR, itemId);
    let profiles;
    try {
      profiles = fs.readdirSync(itemDir);
    } catch {
      continue;
    }
    for (const profile of profiles) dirs.push(path.join(itemDir, profile));
  }
  return dirs;
}

export function enforceHlsCacheBudget(maxBytes = HLS_CACHE_MAX_BYTES, idleMs = EVICT_IDLE_MS) {
  const now = Date.now();
  for (const [dir, usedAt] of dirLastUsed) {
    if (now - usedAt > 24 * 60 * 60 * 1000) dirLastUsed.delete(dir);
  }

  const running = new Set([...jobs.values()].filter((job) => !job.exited && job.proc).map((job) => job.dir));
  let total = 0;
  const entries = [];
  for (const dir of listJobDirs()) {
    const size = dirSize(dir);
    total += size;
    let lastUsed = dirLastUsed.get(dir);
    if (lastUsed === undefined) {
      try { lastUsed = fs.statSync(dir).mtimeMs; } catch { continue; }
    }
    entries.push({ dir, size, lastUsed });
  }
  if (total <= maxBytes) return 0;

  let freed = 0;
  entries.sort((a, b) => a.lastUsed - b.lastUsed);
  for (const entry of entries) {
    if (total <= maxBytes) break;
    if (running.has(entry.dir) || now - entry.lastUsed < idleMs) continue;
    const mapKey = [...jobs.entries()].find(([, job]) => job.dir === entry.dir)?.[0];
    if (mapKey) jobs.delete(mapKey);
    fs.rmSync(entry.dir, { recursive: true, force: true });
    try { fs.rmdirSync(path.dirname(entry.dir)); } catch { /* other profiles still there */ }
    dirLastUsed.delete(entry.dir);
    total -= entry.size;
    freed += entry.size;
  }
  if (freed > 0) {
    logger.info('media', `HLS cache over its ${Math.round(maxBytes / 1024 ** 3)} GB budget: removed ${Math.round(freed / 1024 ** 2)} MB of idle segments`);
  }
  return freed;
}

setInterval(() => {
  try { enforceHlsCacheBudget(); } catch (err) { logger.warn('media', `HLS cache size sweep failed: ${err.message}`); }
}, SIZE_SWEEP_MS).unref();

// Deletes HLS job directories untouched for longer than maxAgeMs.
export function sweepHlsCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(HLS_DIR)) return;
  const now = Date.now();
  for (const itemId of fs.readdirSync(HLS_DIR)) {
    const itemDir = path.join(HLS_DIR, itemId);
    let profiles;
    try {
      profiles = fs.readdirSync(itemDir);
    } catch {
      continue;
    }
    for (const profile of profiles) {
      const dir = path.join(itemDir, profile);
      try {
        const stat = fs.statSync(dir);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Already removed by another sweep.
      }
    }
    try {
      if (fs.readdirSync(itemDir).length === 0) fs.rmdirSync(itemDir);
    } catch {
      // ignore
    }
  }
  enforceHlsCacheBudget();
}
