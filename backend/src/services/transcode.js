import { spawn } from 'child_process';
import { logger } from './logger.js';

// Codecs a mainstream browser can play from a plain <video> tag. HEVC/H.265 is absent from
// the base set: Chrome ≥107/Edge/Safari support it, but Firefox does not, and capability
// varies by platform — so we only include it when the client explicitly signals support via
// the clientHevc flag sent by the player after a MediaSource.isTypeSupported() probe.
const BASE_BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
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
 *
 * @param {string} itemId
 * @param {string} filePath
 * @param {{ clientHevc?: boolean }} [caps] - client capability flags sent by the player
 */
export async function getPlaybackInfo(itemId, filePath, caps = {}) {
  const cacheKey = `${itemId}:${caps.clientHevc ? 'hevc' : 'base'}`;
  if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);

  const BROWSER_VIDEO_CODECS = caps.clientHevc
    ? new Set([...BASE_BROWSER_VIDEO_CODECS, 'hevc'])
    : BASE_BROWSER_VIDEO_CODECS;

  let info;
  try {
    const probe = await runFfprobe(filePath);
    const streams = probe.streams || [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    const audioStream = audioStreams[0];
    const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');
    const container = probe.format?.format_name || '';

    const videoOk = videoStream ? BROWSER_VIDEO_CODECS.has(videoStream.codec_name) : true;
    const audioOk = audioStream ? BROWSER_AUDIO_CODECS.has(audioStream.codec_name) : true;
    const containerOk = BROWSER_CONTAINERS.has(container);

    // 10-bit H.264 is technically "h264" but browsers can't decode High10 profile.
    const tenBitH264 = videoStream?.codec_name === 'h264' && (videoStream.pix_fmt || '').includes('10');

    // Direct Stream logic (mirroring Jellyfin):
    // 1. 'direct': Container and all streams natively playable. 0% CPU.
    // 2. 'remux': Video is browser-compatible (e.g. H.264 or HEVC on Vivaldi/Chrome), but container is MKV
    //    and/or audio is EAC3/DTS/TrueHD. Video is stream-copied (-c:v copy) untouched; only audio
    //    is converted to AAC (-c:a aac). Takes ~0.5% CPU and starts instantly.
    // 3. 'transcode': Only needed if the VIDEO codec itself cannot be decoded by the browser.
    let mode = 'direct';
    if (!videoOk || tenBitH264) {
      mode = 'transcode';
    } else if (!containerOk || !audioOk) {
      mode = 'remux';
    }

    info = {
      mode,
      videoOk,
      audioOk,
      container,
      videoCodec: videoStream?.codec_name || null,
      audioCodec: audioStream?.codec_name || null,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      // Track indexes here are per-type (the Nth audio stream), which is what ffmpeg's
      // `-map 0:a:N` wants — not the absolute stream index.
      audioTracks: audioStreams.map((stream, index) => ({
        index,
        codec: stream.codec_name,
        language: stream.tags?.language || null,
        title: stream.tags?.title || null,
        channels: stream.channels || 2,
        isDefault: stream.disposition?.default === 1
      })),
      subtitleTracks: subtitleStreams.map((stream, index) => ({
        index,
        codec: stream.codec_name,
        language: stream.tags?.language || null,
        title: stream.tags?.title || null,
        forced: stream.disposition?.forced === 1,
        isDefault: stream.disposition?.default === 1,
        // Bitmap subtitles (DVD/Blu-ray) can't be converted to WebVTT text, so they're
        // advertised but flagged as unsupported rather than silently failing to load.
        isTextBased: ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(stream.codec_name)
      })),
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
    info = {
      mode: 'direct',
      container: null,
      videoCodec: null,
      audioCodec: null,
      width: 0,
      height: 0,
      audioTracks: [],
      subtitleTracks: [],
      duration: 0,
      reason: null
    };
  }


  if (probeCache.size >= PROBE_CACHE_MAX) {
    probeCache.delete(probeCache.keys().next().value);
  }
  probeCache.set(cacheKey, info);
  return info;
}

export function invalidatePlaybackInfo(itemId) {
  probeCache.delete(itemId);
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
