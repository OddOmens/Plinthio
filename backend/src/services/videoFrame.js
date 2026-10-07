import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../config/env.js';

// Last-resort artwork for video: a frame from the film itself. TMDB posters are better, but
// they need an API key the user may never set, and a still from the movie beats the blank
// placeholder a keyless install would otherwise show for its entire library.
//
// The frame is taken at a fraction of the runtime rather than the start, because the opening
// seconds of a film are usually a black screen or a distributor logo.
const GRAB_AT_FRACTION = 0.2;
const FALLBACK_SECONDS = 300;
const TIMEOUT_MS = 30000;
// Wide enough for a big card or banner on a retina screen; `min(…, iw)` never enlarges a
// smaller video. Frames were 600px (stills 480px) before 1.5, which looked soft once cards
// grew past ~300px — FRAME_LEGACY_WIDTH lets the scanner find and redo those.
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

/**
 * Writes a poster-shaped still for `itemId` into the covers directory.
 * Returns the cover filename, or null if a frame couldn't be grabbed.
 */
export async function extractVideoFrameCover(filePath, itemId, durationSeconds = 0) {
  if (!fs.existsSync(filePath)) return null;

  let seekTo = Math.max(
    1,
    Math.floor(durationSeconds > 0 ? durationSeconds * GRAB_AT_FRACTION : FALLBACK_SECONDS)
  );
  // A clip only a second or two long (a teaser, a short extra) would be sought past its
  // end — take its middle instead.
  if (durationSeconds > 0 && seekTo >= durationSeconds) seekTo = durationSeconds / 2;
  const coverFilename = `${itemId}.jpg`;
  const finalPath = path.join(config.coversDir, coverFilename);
  // Written aside and renamed into place so a killed ffmpeg can't leave a truncated JPEG
  // sitting there looking like a valid cover.
  const tempPath = `${finalPath}.${process.pid}.tmp`;

  const ok = await runFfmpeg([
    '-v', 'error',
    // Seeking before -i is the fast path: ffmpeg jumps to the keyframe instead of decoding
    // everything up to that point.
    '-ss', String(seekTo),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', scaleTo(FRAME_WIDTH),
    '-q:v', '3',
    // ffmpeg picks the output format from the file extension, and the temp file's is
    // `.tmp` — so the format has to be stated outright or it exits with "Unable to find a
    // suitable output format".
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
// A show's episodes usually share the show's poster (folder artwork), which makes an
// episode list a column of identical pictures. A still per episode is grabbed the first
// time the list asks for it — 1280px, cached on disk, and never more than
// two ffmpeg processes at once, so opening a 24-episode season doesn't flood the server.
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

// Keyed on the file size so replacing the file makes a new still rather than serving the
// old episode's.
export function stillPath(item) {
  return path.join(stillsDir, `${item.id}-${item.file_size || 0}-w${STILL_WIDTH}.jpg`);
}

/**
 * Returns the path of a still for this video item, grabbing it first if needed, or null
 * if the file can't be read.
 */
export async function getOrCreateStill(item) {
  const finalPath = stillPath(item);
  if (fs.existsSync(finalPath)) return finalPath;
  if (!item.path || !fs.existsSync(item.path)) return null;

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
        '-i', item.path,
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
