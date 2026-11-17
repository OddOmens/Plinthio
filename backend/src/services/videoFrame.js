import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../config/env.js';
import { localInputArgs } from './probe.js';
import { resolveLibraryFile } from '../utils/libraryPath.js';

// Last-resort video artwork (works without a TMDB key). Grabbed partway in, since openings
// are usually black or a logo.
const GRAB_AT_FRACTION = 0.2;
const FALLBACK_SECONDS = 300;
const TIMEOUT_MS = 30000;
// `min(…, iw)` never enlarges. FRAME_LEGACY_WIDTH lets the scanner find and redo old low-res grabs.
export const FRAME_WIDTH = 1280;
export const FRAME_LEGACY_WIDTH = 600;
const scaleTo = (w) => `scale=min(${w}\\,iw):-2`;

function runFfmpeg(args) {
  return new Promise((resolve) => {
    let proc;
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      try { proc?.kill('SIGKILL'); } catch (e) { /* already gone */ }
      done(false);
    }, TIMEOUT_MS);

    try {
      proc = spawn('ffmpeg', args);
    } catch (err) {
      return done(false);
    }

    proc.stderr.on('data', () => { /* ffmpeg chatters on stderr; ignore */ });
    proc.on('error', () => done(false));
    proc.on('close', (code) => done(code === 0));
  });
}

/** Writes a still into the covers directory; returns its filename or null. */
export async function extractVideoFrameCover(filePath, itemId, durationSeconds = 0) {
  if (!fs.existsSync(filePath)) return null;

  let seekTo = Math.max(
    1,
    Math.floor(durationSeconds > 0 ? durationSeconds * GRAB_AT_FRACTION : FALLBACK_SECONDS)
  );
  // Very short clips: take the middle instead of seeking past the end.
  if (durationSeconds > 0 && seekTo >= durationSeconds) seekTo = durationSeconds / 2;
  const coverFilename = `${itemId}.jpg`;
  const finalPath = path.join(config.coversDir, coverFilename);
  // Temp + rename so a killed ffmpeg can't leave a truncated cover.
  const tempPath = `${finalPath}.${process.pid}.tmp`;

  const ok = await runFfmpeg([
    '-v', 'error',
    // -ss before -i seeks by keyframe instead of decoding up to it.
    '-ss', String(seekTo),
    ...localInputArgs(),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', scaleTo(FRAME_WIDTH),
    '-q:v', '3',
    // Needed because the `.tmp` extension gives ffmpeg no output format.
    '-f', 'image2',
    '-y', tempPath
  ]);

  if (!ok || !fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* nothing to clean up */ }
    return null;
  }

  try {
    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* nothing to clean up */ }
    return null;
  }

  return coverFilename;
}

// ─── Episode stills ──────────────────────────────────────────────────────────
// Per-episode stills grabbed on first request, cached, max two ffmpeg runs at once.
const STILL_WIDTH = 1280;
const STILL_AT_FRACTION = 0.3; // past the cold open and title sequence
const MAX_CONCURRENT_STILLS = 2;
const stillsDir = path.join(config.cacheDir, 'stills');
const stillsInFlight = new Map();
const stillQueue = [];
let stillsRunning = 0;

function pumpStills() {
  while (stillsRunning < MAX_CONCURRENT_STILLS && stillQueue.length) {
    stillsRunning++;
    stillQueue.shift()().finally(() => {
      stillsRunning--;
      pumpStills();
    });
  }
}

function runQueued(task) {
  return new Promise((resolve) => {
    stillQueue.push(() => task().then(resolve, () => resolve(null)));
    pumpStills();
  });
}

// Includes file size so a replaced file gets a new still.
export function stillPath(item) {
  return path.join(stillsDir, `${item.id}-${item.file_size || 0}-w${STILL_WIDTH}.jpg`);
}

/** Path to the item's still, grabbing it if needed; null if the file can't be read. */
export async function getOrCreateStill(item) {
  const finalPath = stillPath(item);
  if (fs.existsSync(finalPath)) return finalPath;
  if (!item.path) return null;
  // Must resolve inside a library root.
  let source;
  try {
    source = await resolveLibraryFile(item.path);
  } catch (e) {
    return null;
  }
  if (!source.ok) return null;

  if (!stillsInFlight.has(finalPath)) {
    stillsInFlight.set(finalPath, runQueued(async () => {
      fs.mkdirSync(stillsDir, { recursive: true });
      const duration = item.duration || 0;
      let seekTo = Math.max(1, Math.floor(duration > 0 ? duration * STILL_AT_FRACTION : 120));
      if (duration > 0 && seekTo >= duration) seekTo = duration / 2;
      const tempPath = `${finalPath}.${process.pid}.tmp`;
      const ok = await runFfmpeg([
        '-v', 'error',
        '-ss', String(seekTo),
        ...localInputArgs(),
        '-i', source.realPath,
        '-frames:v', '1',
        '-vf', scaleTo(STILL_WIDTH),
        '-q:v', '3',
        '-f', 'image2',
        '-y', tempPath
      ]);
      if (!ok || !fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
        try { fs.unlinkSync(tempPath); } catch (e) { /* nothing to clean up */ }
        return null;
      }
      fs.renameSync(tempPath, finalPath);
      return finalPath;
    }).finally(() => stillsInFlight.delete(finalPath)));
  }
  return stillsInFlight.get(finalPath);
}
