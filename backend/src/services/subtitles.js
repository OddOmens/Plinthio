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

// Plex/Jellyfin convention: subtitles sit next to the video, named after it, with an
// optional language (and sometimes "forced"/"sdh") between the name and the extension —
// e.g. "The Movie.en.srt", "The Movie.en.forced.srt".
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
 * Subtitle files sitting alongside the video file. These are listed fresh rather than cached
 * in the database so dropping a new .srt next to a movie works without a rescan.
 *
 * A sidecar that is a symlink to somewhere outside the library folders is left out, the
 * same as the scanner does for media files (utils/libraryPath.js): `Movie.en.srt ->
 * /config/…` would otherwise be read out to anyone who can play the film.
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

  const found = [];
  for (const filename of files) {
    const parsed = parseSidecarName(videoBase, filename);
    if (!parsed) continue;
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

/**
 * Every subtitle track the player can offer: text-based tracks muxed into the file, plus
 * sidecar files. Embedded bitmap subtitles (DVD/Blu-ray VOBSUB/PGS) are left out — they're
 * images, and there's no way to turn them into WebVTT without burning them into the video.
 */
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
  // WebVTT is SRT with a header and '.' replaced by ',' in timestamps. Cue numbers are
  // valid in both, so they're left alone.
  const converted = text
    .replace(/^﻿/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}`;
}

// ─── ffmpeg conversions ──────────────────────────────────────────────────────
// Pulling a subtitle track out of a film makes ffmpeg read the whole file, so it's treated
// as the expensive thing it is:
//   • the result is kept on disk, keyed on the file's path, size and modified time, so each
//     track is extracted once (and again only if the file changes);
//   • requests for a track that's already being extracted wait on that one run;
//   • at most MAX_CONCURRENT run at a time, with a short queue behind them — past that the
//     player is told to try again shortly rather than piling up ffmpeg processes;
//   • a run is stopped when everyone waiting for it has gone, when it takes too long, or
//     when it produces more text than any real subtitle track holds.
const SUBTITLE_CACHE_DIR = path.join(config.cacheDir, 'subtitles');
const SUBTITLE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;
// Generous: a 60 GB remux on a slow network share takes minutes to read end to end.
const EXTRACT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VTT_BYTES = 8 * 1024 * 1024;
// Sidecar files are read into memory whole. Real ones are well under a megabyte; a heavily
// typeset .ass can reach a few.
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

// One shared, queued, cached ffmpeg run per cache file. `signal` is the caller's way of
// saying it has stopped waiting (its HTTP request closed).
async function convertCached(cacheFile, args, signal) {
  try {
    const cachedVtt = fs.readFileSync(cacheFile, 'utf8');
    // Touched so the age sweep keeps tracks that are still being watched.
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
    // Nobody may be left listening by the time it fails (everyone disconnected).
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
    // The last one waiting has gone: stop the work, whether it's running or still queued.
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
    // A finished run has nothing left to stop; this only keeps the count honest.
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
 * Returns one subtitle track as WebVTT, which is the only format a <track> element accepts.
 * Embedded tracks and ASS/SSA sidecars are converted by ffmpeg (once — see above); .srt and
 * .vtt sidecars are converted in place or passed through.
 *
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
    // ASS/SSA carry styling and positioning that a naive text swap would mangle, so ffmpeg
    // does the conversion.
    return convertCached(cacheFileFor(track.path, stat, 'sidecar'), [
      '-hide_banner', '-loglevel', 'error',
      ...localInputArgs(),
      // Stated rather than detected, so a file that only claims to be subtitles can't be
      // opened as some other format.
      '-f', 'ass',
      '-i', track.path,
      '-f', 'webvtt',
      'pipe:1'
    ], opts.signal);
  }

  return null;
}

// Extracted tracks nobody has asked for in a month are dropped; they're cheap to remake.
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
