import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';

// The opening sequence: a short clip played before a movie or episode starts
// (components/IntroSequence.vue). Plinthio ships its own (assets/default-intro.mp4), off until
// an admin switches it on; they can also upload a replacement, kept in the data folder so it survives image
// updates and goes along with backups of /config.
export const INTRO_DIR = path.join(config.dataDir, 'intro');
export const INTRO_FILE = path.join(INTRO_DIR, 'intro.mp4');
export const DEFAULT_INTRO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/default-intro.mp4');
// Bump when assets/default-intro.mp4 changes, so players don't keep a cached copy.
const DEFAULT_INTRO_VERSION = 'default-2';
const DEFAULT_INTRO_DURATION = 4;
export const INTRO_MAX_BYTES = 20 * 1024 * 1024;
export const INTRO_MIN_SECONDS = 1;
export const INTRO_MAX_SECONDS = 10;
// Leeway for encoders that round a "10 second" clip up to 10.02.
const DURATION_SLACK = 0.25;

const KEYS = ['intro_enabled', 'intro_movies', 'intro_shows', 'intro_version', 'intro_duration'];

// The clip to play: the admin's upload if there is one, otherwise the built-in one.
export function activeIntroFile() {
  if (fs.existsSync(INTRO_FILE)) return INTRO_FILE;
  if (fs.existsSync(DEFAULT_INTRO_FILE)) return DEFAULT_INTRO_FILE;
  return null;
}

export async function getIntroSettings(db) {
  const rows = await db.all(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => '?').join(', ')})`, KEYS);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const file = activeIntroFile();
  const custom = file === INTRO_FILE;
  return {
    // Off until an admin switches it on, and only when there's a file to play.
    introEnabled: !!file && s.intro_enabled === '1',
    introMovies: s.intro_movies !== '0',
    introShows: s.intro_shows !== '0',
    // Whether the clip is an admin's upload (Remove goes back to the built-in one).
    introCustom: custom,
    // Changes with every upload, so players fetch the new clip instead of a cached one.
    introVersion: !file ? null : custom ? (s.intro_version || '1') : DEFAULT_INTRO_VERSION,
    introDuration: !file ? null : custom ? (s.intro_duration ? Number(s.intro_duration) : null) : DEFAULT_INTRO_DURATION
  };
}

async function setSetting(db, key, value) {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

export async function saveIntroSettings(db, { introEnabled, introMovies, introShows }) {
  if (typeof introEnabled === 'boolean') await setSetting(db, 'intro_enabled', introEnabled ? '1' : '0');
  if (typeof introMovies === 'boolean') await setSetting(db, 'intro_movies', introMovies ? '1' : '0');
  if (typeof introShows === 'boolean') await setSetting(db, 'intro_shows', introShows ? '1' : '0');
}

// What ffprobe says about a file: container, duration, and the first video stream's codec.
function probe(filePath) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    const timer = setTimeout(() => { try { proc?.kill('SIGKILL'); } catch (e) { /* gone */ } resolve(null); }, 15000);
    try {
      proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name', '-of', 'json', filePath]);
    } catch (e) {
      clearTimeout(timer);
      return resolve(null);
    }
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        const video = (data.streams || []).find((st) => st.codec_type === 'video');
        resolve({
          format: data.format?.format_name || '',
          duration: parseFloat(data.format?.duration) || 0,
          videoCodec: video?.codec_name || null
        });
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Checks an uploaded clip and, if it's usable, makes it the opening sequence. Throws an
 * Error with a message fit to show the admin when it isn't. The old clip stays in place
 * until the new one has passed.
 */
export async function installIntro(db, buffer) {
  fs.mkdirSync(INTRO_DIR, { recursive: true });
  const tmp = path.join(INTRO_DIR, `upload-${crypto.randomBytes(6).toString('hex')}.mp4`);
  fs.writeFileSync(tmp, buffer);
  try {
    const info = await probe(tmp);
    if (!info) throw new Error('Could not read that file. Upload an MP4 video.');
    if (!/mp4|mov/.test(info.format)) throw new Error('The opening sequence must be an MP4 file.');
    // H.264 is the one codec every browser, phone and TV here can play.
    if (info.videoCodec !== 'h264') {
      throw new Error(`The video must be H.264 (this one is ${info.videoCodec || 'not a video'}). Export it as "MP4 (H.264)".`);
    }
    if (info.duration < INTRO_MIN_SECONDS || info.duration > INTRO_MAX_SECONDS + DURATION_SLACK) {
      throw new Error(`The opening sequence must be ${INTRO_MIN_SECONDS}–${INTRO_MAX_SECONDS} seconds long (this one is ${info.duration.toFixed(1)}).`);
    }
    fs.renameSync(tmp, INTRO_FILE);
    await setSetting(db, 'intro_version', String(Date.now()));
    await setSetting(db, 'intro_duration', info.duration.toFixed(2));
    return info;
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

// Removes an uploaded clip; the built-in one plays instead (if it's switched on).
export async function removeIntro() {
  fs.rmSync(INTRO_FILE, { force: true });
}
