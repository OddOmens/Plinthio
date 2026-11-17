import { spawn } from 'child_process';
import { PlinthioError } from '../errors.js';
import { logger } from './logger.js';
import { localInputArgs, isScriptFormat } from './probe.js';

// Browser-playable codecs. HEVC support varies, so it's added only when the client sends clientHevc.
const BASE_BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
// Other containers (e.g. MKV) get remuxed to MP4, far cheaper than transcoding.
const BROWSER_CONTAINERS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'webm']);
const WEBM_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1']);
const WEBM_AUDIO_CODECS = new Set(['opus', 'vorbis']);

const probeCache = new Map();
const PROBE_CACHE_MAX = 500;

// Codecs native apps may declare (?videoCodecs=h264,hevc), since browser defaults don't fit them.
const CLIENT_VIDEO_CODECS = ['h264', 'hevc', 'av1', 'vp9', 'vp8'];

/** Known codecs from ?videoCodecs=, or null to use browser defaults. */
export function parseClientVideoCodecs(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const asked = new Set(raw.toLowerCase().split(',').map((c) => c.trim()));
  const known = CLIENT_VIDEO_CODECS.filter((codec) => asked.has(codec));
  return known.length ? known : null;
}

// For when an item's file has been replaced.
export function forgetPlaybackInfo(itemId) {
  for (const key of probeCache.keys()) {
    if (key.startsWith(`${itemId}:`)) probeCache.delete(key);
  }
}

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      // Local files only: see localInputArgs in probe.js.
      ...localInputArgs(),
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
    // P303: can't launch. P302: disk I/O failure. P304: corrupt/unsupported file.
    proc.on('error', (err) => reject(new PlinthioError('P303', undefined, { cause: err })));
    proc.on('close', (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `ffprobe exited ${code}`;
        const code_ = /Input\/output error|Permission denied/i.test(message) ? 'P302' : 'P304';
        return reject(new PlinthioError(code_, undefined, { cause: new Error(message) }));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Could not parse ffprobe output'));
      }
    });
  });
}

/**
 * Direct, remux or transcode. Cached per item and capabilities since it runs on every open.
 * @param {{ clientHevc?: boolean, videoCodecs?: string[] | null }} [caps] - videoCodecs replaces the browser defaults
 */
export async function getPlaybackInfo(itemId, filePath, caps = {}) {
  const cacheKey = `${itemId}:${caps.videoCodecs ? caps.videoCodecs.join('+') : (caps.clientHevc ? 'hevc' : 'base')}`;
  if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);

  const BROWSER_VIDEO_CODECS = caps.videoCodecs
    ? new Set(caps.videoCodecs)
    : caps.clientHevc
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
    // A "video" that is really a playlist or script must never reach ffmpeg (see probe.js).
    if (isScriptFormat(container)) {
      const err = new PlinthioError('P304', undefined, { cause: new Error(`"${container}" is a playlist or script, not a media file`) });
      err.unsafeFormat = true;
      throw err;
    }

    const videoOk = videoStream ? BROWSER_VIDEO_CODECS.has(videoStream.codec_name) : true;
    const audioOk = audioStream ? BROWSER_AUDIO_CODECS.has(audioStream.codec_name) : true;
    // ffprobe reports WebM and MKV alike; a .webm with only WebM codecs plays as-is.
    const isWebm = container === 'matroska,webm' && /\.webm$/i.test(filePath) &&
      (!videoStream || WEBM_VIDEO_CODECS.has(videoStream.codec_name)) &&
      audioStreams.every((a) => WEBM_AUDIO_CODECS.has(a.codec_name));
    const containerOk = BROWSER_CONTAINERS.has(container) || isWebm;

    // Browsers can't decode 10-bit (High10) H.264.
    const tenBitH264 = videoStream?.codec_name === 'h264' && (videoStream.pix_fmt || '').includes('10');

    // direct: everything playable. remux: video copied, container and/or audio converted.
    // transcode: only when the video codec itself can't be decoded.
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
      // Used by services/compat.js for converted copies.
      tenBitH264,
      interlaced: ['tt', 'bb', 'tb', 'bt'].includes(videoStream?.field_order),
      audioCodec: audioStream?.codec_name || null,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      // Per-type indexes, as `-map 0:a:N` expects, not absolute stream indexes.
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
        // Bitmap subtitles can't become WebVTT.
        isTextBased: ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(stream.codec_name)
      })),
      duration: parseFloat(probe.format?.duration) || 0,
      reason: mode === 'transcode'
        ? `${tenBitH264 ? 'h264 (10-bit)' : videoStream?.codec_name || 'unknown video'}${audioOk ? '' : ` / ${audioStream?.codec_name}`} can't be decoded by ${caps.videoCodecs ? 'this device' : 'browsers'}`
        : mode === 'remux'
          ? `${container} isn't a browser-playable container`
          : null
    };
  } catch (err) {
    // Fall back to a direct stream attempt rather than refusing to play.
    logger.warn('media', `ffprobe failed for item ${itemId}: ${err.message}`);
    info = {
      mode: 'direct',
      // Routes won't pass an unprobed file to ffmpeg; unsafeFormat marks a refused playlist/script.
      probeFailed: true,
      unsafeFormat: err.unsafeFormat === true,
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
