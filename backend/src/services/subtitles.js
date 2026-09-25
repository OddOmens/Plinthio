import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

// Plex/Jellyfin convention: subtitles sit next to the video, named after it, with an
// optional language (and sometimes "forced"/"sdh") between the name and the extension —
// e.g. "The Movie.en.srt", "The Movie.en.forced.srt".
function parseSidecarName(videoBase, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUBTITLE_EXTENSIONS.includes(ext)) return null;

  const withoutExt = filename.slice(0, -ext.length);
  if (withoutExt !== videoBase && !withoutExt.startsWith(`${videoBase}.`)) return null;

  const qualifiers = withoutExt.slice(videoBase.length).split('.').filter(Boolean);
  const forced = qualifiers.some((q) => q.toLowerCase() === 'forced');
  const language = qualifiers.find((q) => !['forced', 'sdh', 'cc', 'hi'].includes(q.toLowerCase())) || null;

  return { language, forced, format: ext.slice(1) };
}

/**
 * Subtitle files sitting alongside the video file. These are listed fresh rather than cached
 * in the database so dropping a new .srt next to a movie works without a rescan.
 */
export function findSidecarSubtitles(videoPath) {
  const dir = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));

  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const found = [];
  for (const filename of files) {
    const parsed = parseSidecarName(videoBase, filename);
    if (!parsed) continue;
    found.push({
      index: found.length,
      source: 'external',
      path: path.join(dir, filename),
      language: parsed.language,
      title: null,
      forced: parsed.forced,
      format: parsed.format
    });
  }
  return found;
}

/**
 * Every subtitle track the player can offer: text-based tracks muxed into the file, plus
 * sidecar files. Embedded bitmap subtitles (DVD/Blu-ray VOBSUB/PGS) are left out — they're
 * images, and there's no way to turn them into WebVTT without burning them into the video.
 */
export function listSubtitleTracks(playbackInfo, videoPath) {
  const embedded = (playbackInfo.subtitleTracks || [])
    .filter((track) => track.isTextBased)
    .map((track) => ({
      id: `embedded-${track.index}`,
      source: 'embedded',
      index: track.index,
      language: track.language,
      title: track.title,
      forced: track.forced
    }));

  const external = findSidecarSubtitles(videoPath).map((track) => ({
    id: `external-${track.index}`,
    source: 'external',
    index: track.index,
    language: track.language,
    title: track.title,
    forced: track.forced
  }));

  return [...embedded, ...external];
}

function srtToVtt(text) {
  // WebVTT is SRT with a header and '.' replaced by ',' in timestamps. Cue numbers are
  // valid in both, so they're left alone.
  const converted = text
    .replace(/^﻿/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}`;
}

function extractEmbedded(videoPath, streamIndex) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-map', `0:s:${streamIndex}`,
      '-f', 'webvtt',
      'pipe:1'
    ]);

    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `ffmpeg exited ${code}`));
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/**
 * Returns one subtitle track as WebVTT, which is the only format a <track> element accepts.
 * Embedded tracks are converted on demand by ffmpeg (they're tiny compared to video, so
 * there's nothing to gain from caching them); sidecar files are converted or passed through.
 */
export async function getSubtitleVtt(playbackInfo, videoPath, trackId) {
  const [source, rawIndex] = String(trackId).split('-');
  const index = parseInt(rawIndex, 10);
  if (!Number.isInteger(index) || index < 0) return null;

  if (source === 'embedded') {
    const track = (playbackInfo.subtitleTracks || []).find((t) => t.index === index);
    if (!track || !track.isTextBased) return null;
    return extractEmbedded(videoPath, index);
  }

  if (source === 'external') {
    const track = findSidecarSubtitles(videoPath)[index];
    if (!track) return null;

    if (track.format === 'vtt') return fs.readFileSync(track.path, 'utf8');
    if (track.format === 'srt') return srtToVtt(fs.readFileSync(track.path, 'utf8'));
    // ASS/SSA carry styling and positioning that a naive text swap would mangle, so ffmpeg
    // does the conversion.
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', track.path, '-f', 'webvtt', 'pipe:1']);
      const chunks = [];
      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`Could not convert ${track.format} subtitles`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  }

  return null;
}
