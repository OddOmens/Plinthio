import { spawn } from 'child_process';
import { getDb } from '../config/database.js';
import { logger } from './logger.js';

// Frames are decoded in software then uploaded to the GPU for encoding (sw-decode + hw-encode).
// A full hw-decode + hw-encode pipeline (via -hwaccel vaapi + vpp_vaapi) would be marginally
// faster but requires vpp_vaapi, which is not compiled into the standard Ubuntu/Debian ffmpeg
// package. The sw-decode + hwupload path still offloads encoding to the Intel UHD GPU via
// VAAPI, cutting CPU usage dramatically compared to software libx264.
const HWACCELS = {
  nvenc: {
    encoder: 'h264_nvenc',
    deviceArgs: [],
    filter: (height) => `scale=-2:${height}`
  },
  qsv: {
    encoder: 'h264_qsv',
    deviceArgs: ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw'],
    filter: (height) => `scale=-2:${height},format=nv12,hwupload=extra_hw_frames=64`
  },
  vaapi: {
    encoder: 'h264_vaapi',
    // Software decode, then upload frames to GPU for encoding — works with any ffmpeg build.
    deviceArgs: ['-vaapi_device', '/dev/dri/renderD128'],
    filter: (height) => `scale=-2:${height},format=nv12,hwupload`
  }
};

// Order matters: the first method that passes a real test encode wins.
const DETECTION_ORDER = ['nvenc', 'qsv', 'vaapi'];

let detectionPromise = null;

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args);
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', (err) => resolve({ code: -1, output: err.message }));
    proc.on('close', (code) => resolve({ code, output }));
  });
}

/**
 * Encodes two seconds of a generated test pattern with the given method. This is the only
 * trustworthy check: distro ffmpeg builds advertise h264_nvenc/h264_qsv/h264_vaapi whether
 * or not any matching hardware is present or passed into the container, so going by the
 * encoder list alone picks an encoder that fails on every real playback.
 */
export async function testHwaccel(name) {
  const cfg = HWACCELS[name];
  if (!cfg) return { ok: false, error: `Unknown acceleration method: ${name}` };

  const { code, output } = await runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    ...cfg.deviceArgs,
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x360:rate=25',
    '-vf', cfg.filter(360),
    '-c:v', cfg.encoder,
    '-f', 'null', '-'
  ]);

  if (code === 0) return { ok: true };
  return { ok: false, error: (output.trim() || `ffmpeg exited ${code}`).slice(0, 500) };
}

async function detectHwaccel() {
  const { code } = await runFfmpeg(['-hide_banner', '-version']);
  if (code !== 0) {
    logger.warn('media', 'ffmpeg is not available — video transcoding will not work');
    return null;
  }

  for (const name of DETECTION_ORDER) {
    const result = await testHwaccel(name);
    if (result.ok) return name;
  }
  return null;
}

export function getDetectedHwaccel() {
  if (!detectionPromise) {
    detectionPromise = detectHwaccel().then((result) => {
      logger.info('media', result
        ? `Hardware video encoding available: ${result}`
        : 'No working hardware video encoder — transcoding will use software (libx264)');
      return result;
    });
  }
  return detectionPromise;
}

/**
 * The acceleration actually in force, honouring the admin's transcode_hwaccel setting:
 * 'auto' (default) uses whatever passed detection, 'none' forces software, and naming a
 * specific method forces that one — useful when detection guesses wrong on an unusual setup.
 */
export async function getActiveHwaccel() {
  let preference = 'auto';
  try {
    const db = await getDb();
    const row = await db.get("SELECT value FROM settings WHERE key = 'transcode_hwaccel'");
    if (row?.value) preference = row.value;
  } catch {
    // Settings unavailable (very early boot) — fall back to auto-detection.
  }

  if (preference === 'none') return null;
  if (preference !== 'auto') return HWACCELS[preference] ? preference : null;
  return getDetectedHwaccel();
}

export function hwaccelConfig(name) {
  return HWACCELS[name] || null;
}

export function listHwaccels() {
  return Object.keys(HWACCELS);
}
