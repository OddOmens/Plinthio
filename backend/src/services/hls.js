import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { PlinthioError } from '../errors.js';
import { logger } from './logger.js';
import { getActiveHwaccel, hwaccelConfig } from './hwaccel.js';

const HLS_DIR = path.join(config.cacheDir, 'hls');
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });

const SEGMENT_SECONDS = 3;
// Any HLS job with no segment/playlist request in this long gets reaped — otherwise every
// abandoned playback (tab closed mid-buffer, seek away) leaves an encoder running forever.
const IDLE_REAP_MS = 25 * 1000;
const REAP_SWEEP_MS = 10 * 1000;
// How long a segment request will wait for ffmpeg to catch up before giving up.
const SEGMENT_WAIT_TIMEOUT_MS = 15 * 1000;
const SEGMENT_POLL_INTERVAL_MS = 50;

// Bitrates are deliberately generous: this is a self-hosted server usually reached over a
// LAN or a tunnel, where running out of quality is more annoying than running out of
// bandwidth. Renditions taller than the source are dropped rather than upscaled.
const QUALITY_LADDER = [
  { name: '1080p', height: 1080, bitrate: 8000 },
  { name: '720p', height: 720, bitrate: 4000 },
  { name: '480p', height: 480, bitrate: 1500 }
];

// Remux jobs copy the source streams untouched, so there's exactly one rendition and no
// meaningful "quality" to choose between.
const SOURCE_QUALITY = 'source';

const PROFILE_RE = /^(source|1080p|720p|480p)-a(\d{1,2})$/;

const jobs = new Map();

export function parseProfile(profile) {
  const match = PROFILE_RE.exec(profile || '');
  if (!match) return null;
  return { quality: match[1], audioTrack: parseInt(match[2], 10) };
}

export function formatProfile(quality, audioTrack) {
  return `${quality}-a${audioTrack}`;
}

/**
 * The renditions offered for a given source. A remux needs no ladder; a transcode gets every
 * ladder rung that isn't taller than the source, and always at least one.
 */
export function buildLadder(playbackInfo) {
  if (playbackInfo.mode === 'remux') {
    return [{ name: SOURCE_QUALITY, height: playbackInfo.height || 0, bitrate: 8000 }];
  }

  const sourceHeight = playbackInfo.height || 1080;
  const rungs = QUALITY_LADDER.filter((rung) => rung.height <= sourceHeight);
  return rungs.length > 0 ? rungs : [QUALITY_LADDER[QUALITY_LADDER.length - 1]];
}

// Maximum number of ffmpeg encode processes that can run simultaneously.
// Software (libx264) is very CPU-heavy — cap at 1 to prevent thermal overload on
// low-power hosts like the Intel NUC i5-8500T. Hardware (VAAPI/NVENC) is cheap enough
// to allow 2 concurrent streams (e.g. two users watching different things).
let activeEncodes = 0;
const MAX_SW_ENCODES = 1;
const MAX_HW_ENCODES = 2;

function jobDir(itemId, profile) {
  return path.join(HLS_DIR, itemId, profile);
}

async function buildEncodeArgs(mode, quality, audioTrack, opts = {}) {
  const mapArgs = ['-map', '0:v:0', '-map', `0:a:${audioTrack}?`];

  if (mode === 'remux') {
    // Matching Jellyfin's exact direct-stream parameters:
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

  // Software fallback: cap threads so the encode doesn't consume every core and
  // cause thermal throttling. 'ultrafast' trades quality for speed — still fine
  // for streaming, and much less likely to lock up a low-power host.
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
 * Starts (or reuses) a progressive HLS encode for one playback profile of an item. The
 * playlist and segments land on disk as ffmpeg produces them — callers don't wait for the
 * whole file to finish, just for the pieces they need (see waitForStableFile below).
 */
export async function getOrStartJob(itemId, filePath, opts = {}) {
  const mode = opts.mode === 'remux' ? 'remux' : 'transcode';
  const quality = mode === 'remux' ? SOURCE_QUALITY : (opts.quality || '720p');
  const audioTrack = Number.isInteger(opts.audioTrack) ? opts.audioTrack : 0;
  const profile = formatProfile(quality, audioTrack);
  const mapKey = `${itemId}:${profile}`;

  const existing = jobs.get(mapKey);
  if (existing && !existing.exited) {
    existing.lastRequestedAt = Date.now();
    return existing;
  }

  const dir = jobDir(itemId, profile);
  fs.mkdirSync(dir, { recursive: true });

  const playlistPath = path.join(dir, 'media.m3u8');

  // If a previous run already finished this profile, serve it straight from disk rather than
  // re-encoding the same thing.
  if (fs.existsSync(playlistPath) && fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST')) {
    const finished = { profile, quality, audioTrack, mode, dir, playlistPath, proc: null, exited: true, error: null, lastRequestedAt: Date.now() };
    jobs.set(mapKey, finished);
    return finished;
  }

  const { inputArgs, outputArgs } = await buildEncodeArgs(mode, quality, audioTrack, opts);

  // Relative filenames throughout, with cwd set to the job dir: keeps the playlist's segment
  // URIs relative ("seg_00000.m4s") so they match exactly what the segment route serves,
  // regardless of where config.cacheDir happens to live on this machine.
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputArgs,
    '-i', filePath,
    ...outputArgs,
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    // 'event' rather than 'vod': the playlist grows as segments land, and clients can start
    // playing/buffering before the whole file is encoded. #EXT-X-ENDLIST is appended once
    // ffmpeg finishes, at which point it behaves like a normal VOD playlist.
    '-hls_playlist_type', 'event',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'seg_%05d.m4s',
    '-hls_list_size', '0',
    'media.m3u8'
  ];

  const proc = spawn('ffmpeg', args, { cwd: dir });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString().slice(0, 4000); });

  const job = {
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
      // A hardware encoder that fails at runtime (driver mismatch, unsupported pixel format)
      // would otherwise break playback outright, so the cached output is cleared and the
      // next request re-runs — falling back to software if the admin switches it off.
      job.error = new PlinthioError(
        /Input\/output error/i.test(stderr) ? 'P302' : 'P304',
        undefined,
        { cause: new Error(stderr.trim().slice(0, 300)) }
      );
      fs.rmSync(job.dir, { recursive: true, force: true });
    }
  });

  jobs.set(mapKey, job);
  return job;
}

// Polls for a file to appear (and, once found, to stop growing for one poll interval) since
// ffmpeg writes segment files non-atomically — a client that starts reading mid-write would
// get a truncated segment.
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
      // ffmpeg finished (or died) without ever producing this file — it doesn't exist.
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
  // Path containment: filename comes from a route param, keep it inside the job directory.
  if (path.resolve(target) !== path.join(path.resolve(job.dir), filename)) return null;
  const ok = await waitForStableFile(target, job);
  return ok ? target : null;
}

// Jobs are shared per item + profile, so two people watching the same title ride the same
// encode. Each request records who asked, which lets an explicit stop from one viewer leave
// the job running for anyone else still pulling segments from it.
export function touchJob(job, viewerId) {
  const now = Date.now();
  job.lastRequestedAt = now;
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

/**
 * Immediately terminates any active ffmpeg encode/remux processes for an item.
 * Called when the client closes the player, navigates away, or switches media.
 */
export function stopItemJobs(itemId, viewerId = null) {
  const now = Date.now();
  for (const [mapKey, job] of jobs.entries()) {
    if (mapKey.startsWith(`${itemId}:`)) {
      if (viewerId) {
        job.viewers?.delete(viewerId);
        // Someone else is still watching this encode — leave it to the idle reaper.
        if (hasOtherActiveViewers(job, viewerId, now)) continue;
      }
      killJob(job);
      job.exited = true;
      job.proc = null;
      jobs.delete(mapKey);
    }
  }
}

// Reaps ffmpeg processes nobody has asked for output from recently. Segment directories are
// left on disk for the cache sweep (sweepHlsCache) to age out separately, so a client that
// comes back to a recently-abandoned item can still be served already-encoded segments
// without a fresh encode — only actively-running processes are reclaimed here.
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

/**
 * Deletes on-disk HLS job directories untouched for longer than maxAgeMs. Call periodically
 * from the server bootstrap (mirrors the backup scheduler's own setInterval pattern).
 */
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
        // Directory may have just been removed by another sweep — ignore.
      }
    }
    try {
      if (fs.readdirSync(itemDir).length === 0) fs.rmdirSync(itemDir);
    } catch {
      // ignore
    }
  }
}

export function invalidateItemHls(itemId) {
  for (const [mapKey, job] of jobs.entries()) {
    if (mapKey.startsWith(`${itemId}:`)) {
      killJob(job);
      jobs.delete(mapKey);
    }
  }
  const dir = path.join(HLS_DIR, itemId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
