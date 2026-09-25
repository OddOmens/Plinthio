import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const TRICKPLAY_DIR = path.join(config.cacheDir, 'trickplay');
if (!fs.existsSync(TRICKPLAY_DIR)) fs.mkdirSync(TRICKPLAY_DIR, { recursive: true });

const INTERVAL_SECONDS = 10;
const TILE_WIDTH = 320;
const GRID_COLUMNS = 10;
const GRID_ROWS = 10;
const TILES_PER_SHEET = GRID_COLUMNS * GRID_ROWS;

// One generation per item at a time: the scrubber fires a burst of requests as soon as
// someone hovers it, and without this each one would start its own ffmpeg pass.
const inFlight = new Map();

function itemDir(itemId) {
  return path.join(TRICKPLAY_DIR, itemId);
}

export function getTrickplayIndex(itemId) {
  const indexPath = path.join(itemDir(itemId), 'index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
}

export function getSheetPath(itemId, sheetNumber) {
  const sheetPath = path.join(itemDir(itemId), `sheet_${sheetNumber}.jpg`);
  return fs.existsSync(sheetPath) ? sheetPath : null;
}

function extractFrames(videoPath, framesDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', `fps=1/${INTERVAL_SECONDS},scale=${TILE_WIDTH}:-2`,
      '-q:v', '5',
      path.join(framesDir, 'frame_%05d.jpg')
    ]);

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `ffmpeg exited ${code}`));
      resolve();
    });
  });
}

async function buildSheets(itemId, framesDir, targetDir) {
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
  if (frames.length === 0) throw new Error('No frames were extracted');

  // Every frame is the same size, so the first one's dimensions define the whole grid.
  const { width, height } = await sharp(path.join(framesDir, frames[0])).metadata();
  const sheetCount = Math.ceil(frames.length / TILES_PER_SHEET);

  for (let sheet = 0; sheet < sheetCount; sheet++) {
    const sheetFrames = frames.slice(sheet * TILES_PER_SHEET, (sheet + 1) * TILES_PER_SHEET);
    const composites = sheetFrames.map((frame, i) => ({
      input: path.join(framesDir, frame),
      left: (i % GRID_COLUMNS) * width,
      top: Math.floor(i / GRID_COLUMNS) * height
    }));

    const rows = Math.ceil(sheetFrames.length / GRID_COLUMNS);
    await sharp({
      create: {
        width: width * GRID_COLUMNS,
        height: height * rows,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .composite(composites)
      .jpeg({ quality: 70 })
      .toFile(path.join(targetDir, `sheet_${sheet}.jpg`));
  }

  return {
    interval: INTERVAL_SECONDS,
    tileWidth: width,
    tileHeight: height,
    columns: GRID_COLUMNS,
    rows: GRID_ROWS,
    tileCount: frames.length,
    sheetCount
  };
}

/**
 * Builds the scrub-preview sprite sheets for an item: a frame every 10 seconds, packed into
 * 10x10 JPEG grids plus an index describing the layout. Written to a temp directory and
 * renamed into place so a half-built set is never served (same approach as thumbnails.js).
 */
export async function generateTrickplay(itemId, videoPath) {
  const existing = getTrickplayIndex(itemId);
  if (existing) return existing;
  if (inFlight.has(itemId)) return inFlight.get(itemId);

  const promise = (async () => {
    const finalDir = itemDir(itemId);
    const tempDir = `${finalDir}.${Date.now()}.tmp`;
    const framesDir = path.join(tempDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    try {
      await extractFrames(videoPath, framesDir);
      const index = await buildSheets(itemId, framesDir, tempDir);
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.writeFileSync(path.join(tempDir, 'index.json'), JSON.stringify(index));
      fs.renameSync(tempDir, finalDir);
      return index;
    } catch (err) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      logger.warn('media', `Trickplay generation failed for ${itemId}: ${err.message}`);
      return null;
    } finally {
      inFlight.delete(itemId);
    }
  })();

  inFlight.set(itemId, promise);
  return promise;
}

export function sweepTrickplayCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(TRICKPLAY_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(TRICKPLAY_DIR)) {
    const dir = path.join(TRICKPLAY_DIR, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Already gone.
    }
  }
}
