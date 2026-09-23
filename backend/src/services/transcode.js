import { spawn } from 'child_process';
import { logger } from './logger.js';

// Codecs a mainstream browser can play from a plain <video> tag. HEVC/H.265 is the big
// omission: Chrome and Firefox on desktop won't decode it at all, and it's extremely common
// in downloaded video, which is why so much of a real library needs transcoding.
const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
// MKV is a container browsers don't play even when the streams inside are compatible, so
// it gets remuxed (stream-copied into MP4) — far cheaper than a real transcode.
const BROWSER_CONTAINERS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'webm']);

const probeCache = new Map();
const PROBE_CACHE_MAX = 500;

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `ffprobe exited ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Could not parse ffprobe output'));
      }
    });
  });
}

/**
 * Decides whether a file can be streamed to the browser untouched, remuxed, or needs a full
 * transcode. Cached per item because ffprobe costs ~50-150ms and playback-info is hit on
 * every open.
 */
export async function getPlaybackInfo(itemId, filePath) {
  if (probeCache.has(itemId)) return probeCache.get(itemId);

  let info;
  try {
    const probe = await runFfprobe(filePath);
    const videoStream = (probe.streams || []).find((s) => s.codec_type === 'video');
    const audioStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
    const container = probe.format?.format_name || '';

    const videoOk = videoStream ? BROWSER_VIDEO_CODECS.has(videoStream.codec_name) : true;
    const audioOk = audioStream ? BROWSER_AUDIO_CODECS.has(audioStream.codec_name) : true;
    const containerOk = BROWSER_CONTAINERS.has(container);

    // 10-bit H.264 is technically "h264" but browsers can't decode High10 profile.
    const tenBitH264 = videoStream?.codec_name === 'h264' && (videoStream.pix_fmt || '').includes('10');

    let mode = 'direct';
    if (!videoOk || !audioOk || tenBitH264) mode = 'transcode';
    else if (!containerOk) mode = 'remux';

    info = {
      mode,
      container,
      videoCodec: videoStream?.codec_name || null,
      audioCodec: audioStream?.codec_name || null,
      duration: parseFloat(probe.format?.duration) || 0,
      reason: mode === 'transcode'
        ? `${tenBitH264 ? 'h264 (10-bit)' : videoStream?.codec_name || 'unknown video'}${audioOk ? '' : ` / ${audioStream?.codec_name}`} can't be decoded by browsers`
        : mode === 'remux'
          ? `${container} isn't a browser-playable container`
          : null
    };
  } catch (err) {
    // If ffprobe isn't available or fails, fall back to a direct stream — that's the old
    // behaviour, and a direct attempt is better than refusing to play anything.
    logger.warn('media', `ffprobe failed for item ${itemId}: ${err.message}`);
    info = { mode: 'direct', container: null, videoCodec: null, audioCodec: null, duration: 0, reason: null };
  }

  if (probeCache.size >= PROBE_CACHE_MAX) {
    probeCache.delete(probeCache.keys().next().value);
  }
  probeCache.set(itemId, info);
  return info;
}

export function invalidatePlaybackInfo(itemId) {
  probeCache.delete(itemId);
}

/**
 * Spawns ffmpeg to convert the file into a fragmented MP4 the browser can play, starting at
 * `startSeconds`. Because the output is a live pipe with no known length, the browser can't
 * seek within it — the client instead re-requests this endpoint with a new start offset,
 * which is why `-ss` comes before `-i` (input seeking, near-instant even in long files).
 */
export function spawnTranscode(filePath, startSeconds = 0, mode = 'transcode') {
  const args = ['-hide_banner', '-loglevel', 'error'];

  if (startSeconds > 0) args.push('-ss', String(startSeconds));
  args.push('-i', filePath);

  if (mode === 'remux') {
    // Streams are already browser-friendly — just rewrap into MP4. Cheap, no quality loss.
    args.push('-c', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      // Chrome/Safari refuse High10; force 8-bit 4:2:0 so output is universally decodable.
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-ac', '2',
      '-b:a', '160k'
    );
  }

  args.push(
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  );

  return spawn('ffmpeg', args);
}

export function isFfmpegAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
    proc.stdout?.resume();
    proc.stderr?.resume();
  });
}
