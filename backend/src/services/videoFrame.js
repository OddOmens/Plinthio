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
    '-vf', 'scale=600:-2',
    '-q:v', '4',
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
