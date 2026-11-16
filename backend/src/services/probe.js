import { spawn } from 'child_process';

// ffmpeg detects by content, so a playlist disguised as movie.mkv could make it fetch other
// files or URLs. Library inputs are limited to file/pipe. Goes before `-i`; not for Live TV.
export const LOCAL_INPUT_PROTOCOLS = 'file,pipe';
export function localInputArgs() {
  return ['-protocol_whitelist', LOCAL_INPUT_PROTOCOLS];
}

// Playlist/script formats that make ffmpeg open other files; refused at scan and before playback.
const SCRIPT_FORMATS = new Set([
  'hls', 'applehttp', 'concat', 'dash', 'webm_dash_manifest', 'imf', 'sdp', 'rtsp', 'rtp',
  'tty', 'lavfi'
]);

/** `formatName` is ffprobe's comma-separated format_name. */
export function isScriptFormat(formatName) {
  return String(formatName || '')
    .toLowerCase()
    .split(',')
    .some((name) => SCRIPT_FORMATS.has(name.trim()));
}

// Resolves { code, stdout }, or null on spawn error or timeout (process killed); never rejects.
// Adds the local-protocol limit to every ffprobe run.
export function runProbe(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let proc;
    const timer = setTimeout(() => {
      try { proc?.kill('SIGKILL'); } catch (e) { /* already gone */ }
      done(null);
    }, timeoutMs);

    const fullArgs = cmd === 'ffprobe' && !args.includes('-protocol_whitelist')
      ? [...localInputArgs(), ...args]
      : args;

    try {
      proc = spawn(cmd, fullArgs);
    } catch (e) {
      return done(null);
    }

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', () => { /* ignore */ });
    proc.on('error', () => done(null));
    proc.on('close', (code) => done({ code, stdout }));
  });
}

const FORMAT_PROBE_TIMEOUT_MS = 15000;

/** ffprobe's format_name; '' if not media, null if ffprobe couldn't run. */
export async function probeFormatName(filePath) {
  const result = await runProbe('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=format_name',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ], FORMAT_PROBE_TIMEOUT_MS);
  if (!result) return null;
  if (result.code !== 0) return '';
  return result.stdout.trim();
}
