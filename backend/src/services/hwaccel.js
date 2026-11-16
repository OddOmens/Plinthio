import { spawn } from 'child_process';
import { getDb } from '../config/database.js';
import { logger } from './logger.js';
import { getSetting } from './settings.js';

// Software decode + hardware encode: full hardware decode needs vpp_vaapi, which distro
// ffmpeg builds lack, and encoding is where the CPU savings are.
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

// Test-encodes two seconds of a pattern. Distro ffmpeg builds list hardware encoders whether
// or not the hardware is present, so a real encode is the only trustworthy check.
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

// The method in force per transcode_hwaccel: 'auto' (detected), 'none' (software), or a named method.
export async function getActiveHwaccel() {
  let preference = 'auto';
  try {
    const db = await getDb();
    const stored = await getSetting(db, 'transcode_hwaccel');
    if (stored) preference = stored;
  } catch {
    // Settings unavailable during early boot; use auto-detection.
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
