import { spawn } from 'child_process';

// Library files are opened by content, not by extension: a file named movie.mkv that is
// really an HLS playlist, a concat script or an SDP description is "played" by ffmpeg
// fetching whatever it lists — other files on the server, or URLs. Local media only ever
// needs the file (and pipe) protocol, so every ffmpeg/ffprobe run on a library file is told
// to allow nothing else. Goes before `-i` (it's an input option).
//
// Not for Live TV, which reads network streams on purpose.
export const LOCAL_INPUT_PROTOCOLS = 'file,pipe';
export function localInputArgs() {
  return ['-protocol_whitelist', LOCAL_INPUT_PROTOCOLS];
}

// Containers that are instructions rather than media. Even limited to local files these
// make ffmpeg open *other* files, so anything ffprobe identifies as one is refused outright
// — at scan time and again before playback.
const SCRIPT_FORMATS = new Set([
  'hls', 'applehttp', 'concat', 'dash', 'webm_dash_manifest', 'imf', 'sdp', 'rtsp', 'rtp',
  'tty', 'lavfi'
]);

/** True when an ffprobe `format_name` ("hls", "matroska,webm"…) names a playlist/script type. */
export function isScriptFormat(formatName) {
  return String(formatName || '')
    .toLowerCase()
    .split(',')
    .some((name) => SCRIPT_FORMATS.has(name.trim()));
}

// Runs a short-lived probe (ffprobe) and collects what it prints. Resolves { code, stdout }
// once it exits, or null if it couldn't start, errored, or ran past timeoutMs (it's killed
// then). Never rejects, so callers can fall back to their own "unknown" value.
//
// Every ffprobe run through here is on a local file, so the protocol limit is added for
// all of them in this one place.
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

/**
 * The container ffprobe detects for a file: its format_name, '' when ffprobe ran and could
 * not open the file as media at all, or null when ffprobe itself couldn't be run (not
 * installed, timed out). Used by the scanner to turn away playlist/script files.
 */
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
