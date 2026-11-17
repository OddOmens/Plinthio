import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { PlinthioError } from '../errors.js';
import { resolveLibraryFile } from '../utils/libraryPath.js';
import { localInputArgs } from './probe.js';
import { logger } from './logger.js';

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

// Shared with the scanner; lives here to avoid importing the scanner.
export const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov']);

// Sidecars are named after the video with optional qualifiers: "The Movie.en.forced.srt".
function parseSidecarName(videoBase, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUBTITLE_EXTENSIONS.includes(ext)) return null;

  const withoutExt = filename.slice(0, -ext.length);
  if (withoutExt !== videoBase && !withoutExt.startsWith(`${videoBase}.`)) return null;

  const qualifiers = withoutExt.slice(videoBase.length).split('.').filter(Boolean);
  const forced = qualifiers.some((q) => q.toLowerCase() === 'forced');
  const language = qualifiers.find((q) => !['forced', 'sdh', 'cc', 'hi'].includes(q.toLowerCase())) || null;

  return { language, forced, format: ext.slice(1) };
}

/**
 * Listed fresh (no rescan needed for new .srt files). Symlinks outside library roots are
 * skipped so they can't expose other server files.
 */
export async function findSidecarSubtitles(videoPath) {
  const dir = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));

  let files;
  try {
    files = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }

  // A sidecar belongs to the longest matching video name ("Film.Unrated.en.srt" is
  // Film.Unrated.mkv's, not Film.mkv's), so hidden titles don't leak subtitles via a sibling.
  const longerBases = files
    .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .map((f) => path.basename(f, path.extname(f)))
    .filter((base) => base !== videoBase && base.startsWith(`${videoBase}.`));

  const found = [];
  for (const filename of files) {
    const parsed = parseSidecarName(videoBase, filename);
    if (!parsed) continue;
    const withoutExt = filename.slice(0, -path.extname(filename).length);
    if (longerBases.some((base) => withoutExt === base || withoutExt.startsWith(`${base}.`))) continue;
    let resolved;
    try {
      resolved = await resolveLibraryFile(path.join(dir, filename));
    } catch {
      continue;
    }
    if (!resolved.ok) continue;
    found.push({
      index: found.length,
      source: 'external',
      path: resolved.realPath,
      language: parsed.language,
      title: null,
      forced: parsed.forced,
      format: parsed.format
    });
  }
  return found;
}

/** Embedded text tracks plus sidecars. Bitmap subtitles (VOBSUB/PGS) can't become WebVTT. */
export async function listSubtitleTracks(playbackInfo, videoPath) {
  const embedded = (playbackInfo.subtitleTracks || [])
    .filter((track) => track.isTextBased)
    .map((track) => ({
      id: `embedded-${track.index}`,
      source: 'embedded',
      index: track.index,
      language: track.language,
      title: track.title,
      forced: track.forced
    }));

  const external = (await findSidecarSubtitles(videoPath)).map((track) => ({
    id: `external-${track.index}`,
    source: 'external',
    index: track.index,
    language: track.language,
    title: track.title,
    forced: track.forced
  }));

  return [...embedded, ...external];
}

function srtToVtt(text) {
  // WebVTT = SRT plus a header, with '.' instead of ',' in timestamps.
  const converted = text
    .replace(/^﻿/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}`;
}

// ─── ffmpeg conversions ──────────────────────────────────────────────────────
// Extraction reads the whole file, so results are cached on disk (path/size/mtime), concurrent
// requests share one run, runs are capped with a short queue, and a run is killed when all
// waiters leave, it times out, or the output is too large.
const SUBTITLE_CACHE_DIR = path.join(config.cacheDir, 'subtitles');
const SUBTITLE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;
// Generous: large remuxes on network shares take minutes to read.
const EXTRACT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VTT_BYTES = 8 * 1024 * 1024;
// Sidecars are read whole into memory.
export const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;

const conversions = new Map(); // cache file -> { promise, waiters, cancel }
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    running++;
    task.run().finally(() => {
      running--;
      pump();
    });
  }
}

function cacheFileFor(sourcePath, stat, track) {
  const key = crypto.createHash('sha256')
    .update(`${sourcePath}\n${stat.mtimeMs}\n${stat.size}\n${track}`)
    .digest('hex');
  return path.join(SUBTITLE_CACHE_DIR, `${key}.vtt`);
}

function runFfmpegToVtt(args, conversion) {
  return new Promise((resolve, reject) => {
    let proc;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conversion.kill = null;
      if (err) {
        try { proc?.kill('SIGKILL'); } catch (e) { /* already gone */ }
        reject(err);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(
      () => finish(new PlinthioError('P307', undefined, { cause: new Error('Subtitle extraction timed out') })),
      EXTRACT_TIMEOUT_MS
    );
    conversion.kill = () => finish(new PlinthioError('P305'));

    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish(new PlinthioError('P303', undefined, { cause: err }));
    }

    const chunks = [];
    let size = 0;
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_VTT_BYTES) {
        return finish(new PlinthioError('P307', undefined, { cause: new Error('Subtitle track is too large') }));
      }
      chunks.push(chunk);
    });
    proc.stderr.on('data', (d) => { if (stderr.length < 2000) stderr += d.toString().slice(0, 2000); });
    proc.on('error', (err) => finish(new PlinthioError('P303', undefined, { cause: err })));
    proc.on('close', (code) => {
      if (code !== 0) {
        return finish(new PlinthioError('P307', undefined, { cause: new Error(stderr.trim() || `ffmpeg exited ${code}`) }));
      }
      finish(null, Buffer.concat(chunks).toString('utf8'));
    });
  });
}

// `signal` aborts when the caller stops waiting (request closed).
async function convertCached(cacheFile, args, signal) {
  try {
    const cachedVtt = fs.readFileSync(cacheFile, 'utf8');
    // Touch for the age sweep.
    try { fs.utimesSync(cacheFile, new Date(), new Date()); } catch (e) { /* read-only cache */ }
    return cachedVtt;
  } catch (e) {
    // Not extracted yet.
  }

  let conversion = conversions.get(cacheFile);
  if (!conversion) {
    if (queue.length >= MAX_QUEUED) throw new PlinthioError('P305');

    conversion = { waiters: 0, kill: null, cancelled: false, promise: null };
    const task = {
      conversion,
      run: () => runFfmpegToVtt(args, conversion).then((vtt) => {
        try {
          fs.mkdirSync(SUBTITLE_CACHE_DIR, { recursive: true });
          const temp = `${cacheFile}.${process.pid}.tmp`;
          fs.writeFileSync(temp, vtt);
          fs.renameSync(temp, cacheFile);
        } catch (err) {
          logger.warn('media', `Could not cache extracted subtitles: ${err.message}`);
        }
        return vtt;
      })
    };
    conversion.promise = new Promise((resolve, reject) => {
      const run = task.run;
      task.run = () => (conversion.cancelled
        ? Promise.resolve().then(() => reject(new PlinthioError('P305')))
        : run().then(resolve, reject));
    }).finally(() => {
      if (conversions.get(cacheFile) === conversion) conversions.delete(cacheFile);
    });
    // Avoid unhandled rejection if every waiter has left.
    conversion.promise.catch(() => {});
    conversions.set(cacheFile, conversion);
    queue.push(task);
    pump();
  }

  conversion.waiters++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    conversion.waiters--;
    if (conversion.waiters > 0) return;
    // Last waiter gone: cancel, whether running or queued.
    conversion.cancelled = true;
    if (conversions.get(cacheFile) === conversion) conversions.delete(cacheFile);
    const queuedAt = queue.findIndex((task) => task.conversion === conversion);
    if (queuedAt !== -1) queue.splice(queuedAt, 1)[0].run();
    conversion.kill?.();
  };

  if (signal?.aborted) {
    release();
    throw new PlinthioError('P305');
  }
  signal?.addEventListener('abort', release, { once: true });
  try {
    return await conversion.promise;
  } finally {
    signal?.removeEventListener('abort', release);
    // Just keeps the waiter count accurate.
    if (!released) { released = true; conversion.waiters--; }
  }
}

function readSidecar(track) {
  const stat = fs.statSync(track.path);
  if (stat.size > MAX_SIDECAR_BYTES) {
    throw new PlinthioError('P307', undefined, { cause: new Error(`Subtitle file is larger than ${MAX_SIDECAR_BYTES / 1024 / 1024} MB`) });
  }
  return { stat, text: track.format === 'ass' || track.format === 'ssa' ? null : fs.readFileSync(track.path, 'utf8') };
}

/**
 * One track as WebVTT (the only format <track> accepts). Embedded and ASS/SSA go through ffmpeg.
 * @param {{ signal?: AbortSignal }} [opts] - aborted when the caller stops waiting
 */
export async function getSubtitleVtt(playbackInfo, videoPath, trackId, opts = {}) {
  const [source, rawIndex] = String(trackId).split('-');
  const index = parseInt(rawIndex, 10);
  if (!Number.isInteger(index) || index < 0) return null;

  if (source === 'embedded') {
    const track = (playbackInfo.subtitleTracks || []).find((t) => t.index === index);
    if (!track || !track.isTextBased) return null;
    const stat = fs.statSync(videoPath);
    return convertCached(cacheFileFor(videoPath, stat, `embedded-${index}`), [
      '-hide_banner', '-loglevel', 'error',
      ...localInputArgs(),
      '-i', videoPath,
      '-map', `0:s:${index}`,
      '-f', 'webvtt',
      'pipe:1'
    ], opts.signal);
  }

  if (source === 'external') {
    const track = (await findSidecarSubtitles(opts.sidecarsOf || videoPath))[index];
    if (!track) return null;

    const { stat, text } = readSidecar(track);
    if (track.format === 'vtt') return text;
    if (track.format === 'srt') return srtToVtt(text);
    // ASS/SSA styling needs a real conversion.
    return convertCached(cacheFileFor(track.path, stat, 'sidecar'), [
      '-hide_banner', '-loglevel', 'error',
      ...localInputArgs(),
      // Forced format, so the file can't be opened as something else.
      '-f', 'ass',
      '-i', track.path,
      '-f', 'webvtt',
      'pipe:1'
    ], opts.signal);
  }

  return null;
}

// Drops extracted tracks unused for a month.
export function sweepSubtitleCache(maxAgeMs = SUBTITLE_CACHE_MAX_AGE_MS) {
  let files;
  try {
    files = fs.readdirSync(SUBTITLE_CACHE_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of files) {
    const file = path.join(SUBTITLE_CACHE_DIR, name);
    try {
      if (now - fs.statSync(file).mtimeMs > maxAgeMs) fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}
setInterval(sweepSubtitleCache, 24 * 60 * 60 * 1000).unref();
