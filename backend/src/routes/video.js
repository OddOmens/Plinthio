import express from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { requireEditor } from '../middleware/auth.js';
import { getPlaybackInfo } from '../services/transcode.js';
import {
  getOrStartJob, waitForPlaylist, waitForSegment, touchJob,
  buildLadder, parseProfile, formatProfile, stopItemJobs
} from '../services/hls.js';
import { listSubtitleTracks, getSubtitleVtt } from '../services/subtitles.js';
import { generateTrickplay, getTrickplayIndex, getSheetPath } from '../services/trickplay.js';
import { sendRangedFile, streamFile } from '../utils/fileStream.js';
import { serverError } from '../utils/http.js';

const router = express.Router();

// Item ids are always a 32-char hex md5 of the file path (see scanner.js).
const ITEM_ID_RE = /^[a-f0-9]{32}$/;


// Resolves an item for playback, applying the same existence + visibility + path-containment
// checks the direct stream route uses. Returns null after responding on any failure.
async function resolvePlayableItem(req, res) {
  if (!ITEM_ID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid item id' });
    return null;
  }

  const db = await getDb();
  const item = await db.get(
    `SELECT i.*, l.path as library_path
     FROM items i
     JOIN libraries l ON i.library_id = l.id
     WHERE i.id = ?`,
    [req.params.id]
  );

  if (!item) {
    res.status(404).json({ error: 'Video not found' });
    return null;
  }
  if (await isItemHiddenForUser(db, req.params.id, req.user)) {
    res.status(404).json({ error: 'Video not found' });
    return null;
  }

  const resolvedItemPath = path.resolve(item.path);
  const resolvedLibPath = path.resolve(item.library_path);
  if (resolvedItemPath !== resolvedLibPath && !resolvedItemPath.startsWith(resolvedLibPath + path.sep)) {
    res.status(403).json({ error: 'Access denied: Invalid file path traversal detected' });
    return null;
  }
  if (!fs.existsSync(resolvedItemPath)) {
    res.status(404).json({ error: 'Video file missing from disk' });
    return null;
  }

  return { item, filePath: resolvedItemPath };
}

// Tells the client whether this file can be played directly or has to go through ffmpeg,
// so the player can pick the right URL up front instead of failing first and retrying.
// ?clientHevc=1 is sent by browsers (Chrome ≥107, Edge, Safari) that can decode HEVC
// natively — when set, HEVC files are marked "direct" instead of "transcode".
router.get('/:id/playback-info', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const caps = { clientHevc: req.query.clientHevc === '1' };
    const info = await getPlaybackInfo(req.params.id, resolved.filePath, caps);
    res.json({
      ...info,
      itemDuration: resolved.item.duration || info.duration || 0,
      qualities: buildLadder(info).map((rung) => ({ name: rung.name, height: rung.height })),
      subtitles: listSubtitleTracks(info, resolved.filePath)
    });
  } catch (err) {
    console.error('[video] playback-info failed:', err);
    res.status(500).json({ error: 'Could not inspect this video' });
  }
});

// One subtitle track as WebVTT, which is what a <track> element needs. ?token= is accepted
// (see authenticateToken) because a <track> tag can't send an Authorization header.
router.get('/:id/subtitles/:trackId.vtt', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    const vtt = await getSubtitleVtt(info, resolved.filePath, req.params.trackId);
    if (!vtt) return res.status(404).json({ error: 'Subtitle track not found' });

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  } catch (err) {
    console.error('[video] subtitle extraction failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load subtitles' });
  }
});

// Remuxed/transcoded playback goes out as HLS instead of a raw live pipe: ffmpeg writes a
// growing playlist + fragmented-MP4 segments to disk (see services/hls.js), which gives the
// client real segment-level seeking instead of "restart the encode from a new offset".
// The profile in the URL ("720p-a0") names a quality rung and an audio track. It's parsed
async function resolveHlsJob(req, res, profileParam) {
  const resolved = await resolvePlayableItem(req, res);
  if (!resolved) return null;

  const parsed = profileParam ? parseProfile(profileParam) : null;
  const isSourceRemux = parsed ? (parsed.quality === 'source') : (req.query.mode === 'remux');

  // If this is a remux profile ('source-aN') or client explicitly passed clientHevc=1,
  // evaluate probe info with HEVC support enabled.
  const caps = { clientHevc: req.query.clientHevc === '1' || isSourceRemux };
  const info = await getPlaybackInfo(req.params.id, resolved.filePath, caps);
  const mode = (isSourceRemux || info.mode === 'remux') ? 'remux' : 'transcode';
  const ladder = buildLadder({ ...info, mode });

  let quality = isSourceRemux ? 'source' : ladder[0].name;
  let audioTrack = 0;

  if (profileParam) {
    if (!parsed) {
      res.status(404).json({ error: 'Unknown playback profile' });
      return null;
    }
    if (!isSourceRemux && !ladder.some((rung) => rung.name === parsed.quality)) {
      res.status(404).json({ error: 'Unknown playback profile' });
      return null;
    }
    const audioCount = info.audioTracks?.length || 1;
    if (parsed.audioTrack >= audioCount) {
      res.status(404).json({ error: 'Unknown audio track' });
      return null;
    }
    quality = parsed.quality;
    audioTrack = parsed.audioTrack;
  }

  const audioTranscode = !info.audioOk;
  return getOrStartJob(req.params.id, resolved.filePath, {
    mode,
    quality,
    audioTrack,
    audioTranscode,
    videoCodec: info.videoCodec
  });
}

router.get('/:id/hls/master.m3u8', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const caps = { clientHevc: req.query.clientHevc === '1' };
    const info = await getPlaybackInfo(req.params.id, resolved.filePath, caps);
    const ladder = buildLadder(info);
    const audioTrack = Math.max(0, parseInt(req.query.audio, 10) || 0);

    const hevcParam = req.query.clientHevc ? `&clientHevc=${req.query.clientHevc}` : '';
    const tokenQuery = req.query.token
      ? `?token=${encodeURIComponent(req.query.token)}${hevcParam}`
      : (hevcParam ? `?${hevcParam.slice(1)}` : '');

    // Advertised widths follow the source's own aspect ratio, so a 4:3 or ultrawide file
    // isn't described to the client as if it were 16:9.
    const aspect = info.width && info.height ? info.width / info.height : 16 / 9;
    const codecStr = (info.mode === 'remux' && info.videoCodec === 'hevc')
      ? 'hvc1.1.6.L93.B0,mp4a.40.2'
      : 'avc1.640028,mp4a.40.2';

    const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];
    for (const rung of ladder) {
      // HLS wants even dimensions, matching the scaler's own -2 rounding.
      const width = Math.round(rung.height * aspect / 2) * 2;
      const resolution = rung.height ? `,RESOLUTION=${width}x${rung.height}` : '';
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${rung.bitrate * 1000}${resolution},CODECS="${codecStr}"`);
      lines.push(`${formatProfile(rung.name, audioTrack)}/media.m3u8${tokenQuery}`);
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(lines.join('\n') + '\n');
  } catch (err) {
    console.error('[video] hls master playlist failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not start playback' });
  }
});

router.get('/:id/hls/:profile/media.m3u8', authenticateToken, async (req, res) => {
  try {
    const job = await resolveHlsJob(req, res, req.params.profile);
    if (!job) return;
    touchJob(job, req.user.id);

    const ready = await waitForPlaylist(job);
    if (!ready) {
      return res.status(503).json({ error: 'Still preparing this video, try again shortly' });
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');

    // Rewrite segment URIs to include token and client capabilities if present,
    // so segment requests do not fail with 401/404 in native players / hls.js.
    let playlist = fs.readFileSync(job.playlistPath, 'utf8');
    const params = [];
    if (req.query.token) params.push(`token=${encodeURIComponent(req.query.token)}`);
    if (req.query.clientHevc) params.push(`clientHevc=${encodeURIComponent(req.query.clientHevc)}`);
    if (params.length > 0) {
      const q = `?${params.join('&')}`;
      playlist = playlist.replace(/(init\.mp4|seg_\d{5}\.m4s)/g, `$1${q}`);
    }
    res.send(playlist);
  } catch (err) {
    console.error('[video] hls media playlist failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load playlist' });
  }
});

const SEGMENT_FILE_RE = /^(init\.mp4|seg_\d{5}\.m4s)$/;

router.get('/:id/hls/:profile/:segmentFile', authenticateToken, async (req, res) => {
  try {
    if (!SEGMENT_FILE_RE.test(req.params.segmentFile)) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    const job = await resolveHlsJob(req, res, req.params.profile);
    if (!job) return;
    touchJob(job, req.user.id);

    const segmentPath = await waitForSegment(job, req.params.segmentFile);
    if (!segmentPath) {
      return res.status(404).json({ error: 'Segment not available' });
    }

    res.setHeader('Content-Type', req.params.segmentFile === 'init.mp4' ? 'video/mp4' : 'video/iso.segment');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    streamFile(res, segmentPath);
  } catch (err) {
    console.error('[video] hls segment failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load segment' });
  }
});

// Explicitly stops any active ffmpeg encode/remux processes for this item when the user
// closes the player, navigates away, or switches episodes/movies.
router.post('/:id/hls/stop', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  stopItemJobs(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Scrub-preview sprite sheets. Pre-generated sheets are served if available.
// On-the-fly generation during playback is disabled to prevent massive CPU spikes on 4K/heavy files.
router.get('/:id/trickplay/index.json', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const existing = getTrickplayIndex(req.params.id);
    if (existing) return res.json(existing);

    res.status(404).json({ status: 'not_available' });
  } catch (err) {
    console.error('[video] trickplay index failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load scrub previews' });
  }
});

router.get('/:id/trickplay/sheet_:sheet.jpg', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const sheetNumber = parseInt(req.params.sheet, 10);
    if (!Number.isInteger(sheetNumber) || sheetNumber < 0) {
      return res.status(400).json({ error: 'Invalid sheet number' });
    }

    const sheetPath = getSheetPath(req.params.id, sheetNumber);
    if (!sheetPath) return res.status(404).json({ error: 'Sheet not found' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    streamFile(res, sheetPath);
  } catch (err) {
    console.error('[video] trickplay sheet failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load scrub preview' });
  }
});

// Intro/credits markers, so the player can offer a skip button.
router.get('/:id/markers', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const markers = await db.all(
      'SELECT type, start_seconds as startSeconds, end_seconds as endSeconds FROM intro_credit_markers WHERE item_id = ?',
      [req.params.id]
    );
    res.json({ markers });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.put('/:id/markers', authenticateToken, requireEditor, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }

  const { markers } = req.body;
  if (!Array.isArray(markers)) {
    return res.status(400).json({ error: 'markers must be an array' });
  }
  for (const marker of markers) {
    if (!['intro', 'credits'].includes(marker.type)) {
      return res.status(400).json({ error: 'Marker type must be intro or credits' });
    }
    if (!(marker.endSeconds > marker.startSeconds) || marker.startSeconds < 0) {
      return res.status(400).json({ error: 'Marker must end after it starts' });
    }
  }

  try {
    const db = await getDb();
    await db.run('DELETE FROM intro_credit_markers WHERE item_id = ?', [req.params.id]);
    for (const marker of markers) {
      await db.run(
        'INSERT INTO intro_credit_markers (item_id, type, start_seconds, end_seconds) VALUES (?, ?, ?, ?)',
        [req.params.id, marker.type, marker.startSeconds, marker.endSeconds]
      );
    }
    res.json({ message: 'Markers saved' });
  } catch (err) {
    serverError(req, res, err);
  }
});

/**
 * Range-seeking video stream endpoint
 * Supports HTTP 206 Partial Content for instant seeking on iOS Safari, Chrome, and desktop players.
 * Supports token via query string (?token=...) or Authorization header.
 */
router.get('/:id/stream', authenticateToken, async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const db = await getDb();
    const item = await db.get(
      `SELECT i.*, l.path as library_path 
       FROM items i 
       JOIN libraries l ON i.library_id = l.id 
       WHERE i.id = ?`,
      [req.params.id]
    );

    if (!item) {
      return res.status(404).json({ error: 'Video not found' });
    }
    if (await isItemHiddenForUser(db, req.params.id, req.user)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Path traversal security check: Canonical path must exist and start with library path
    const resolvedItemPath = path.resolve(item.path);
    const resolvedLibPath = path.resolve(item.library_path);

    if (resolvedItemPath !== resolvedLibPath && !resolvedItemPath.startsWith(resolvedLibPath + path.sep)) {
      return res.status(403).json({ error: 'Access denied: Invalid file path traversal detected' });
    }

    if (!fs.existsSync(resolvedItemPath)) {
      return res.status(404).json({ error: 'Video file missing from disk' });
    }

    const stat = fs.statSync(resolvedItemPath);
    let contentType = mime.lookup(resolvedItemPath) || 'video/mp4';
    if (resolvedItemPath.endsWith('.mkv')) contentType = 'video/x-matroska';
    sendRangedFile(req, res, resolvedItemPath, stat.size, contentType);
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
