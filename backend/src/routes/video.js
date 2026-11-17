import express from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { requireEditor, requireAdmin } from '../middleware/auth.js';
import { getPlaybackInfo, parseClientVideoCodecs } from '../services/transcode.js';
import {
  needsCopy, compatProbeId, copyState, readyCopy, requestCopy, removeCopy, getCompatSettings
} from '../services/compat.js';
import {
  getOrStartJob, waitForPlaylist, waitForSegment, touchJob,
  buildLadder, parseProfile, formatProfile, stopItemJobs
} from '../services/hls.js';
import { listSubtitleTracks, getSubtitleVtt } from '../services/subtitles.js';
import { generateTrickplay, getTrickplayIndex, getSheetPath } from '../services/trickplay.js';
import { sendRangedFile, streamFile } from '../utils/fileStream.js';
import { handle, serverError } from '../utils/http.js';
import { sendError, codeForFsError } from '../errors.js';
import { ITEM_ID_RE } from '../utils/ids.js';
import { requireLibraryFile } from '../utils/libraryPath.js';

// A playback failure's code: ffmpeg/ffprobe errors are tagged by the services (P303 can't
// start, P304 conversion failed, P302 unreadable file); filesystem errors map to P301/P302.
function playbackError(req, res, err, message) {
  const code = err?.plinthioCode || codeForFsError(err, { playback: true }) || 'P000';
  sendError(req, res, code, { err, message: err?.plinthioCode ? undefined : message });
}

const router = express.Router();

// Existence, visibility and containment checks for routes that read the file; null after
// responding on failure. `filePath` is the real (symlink-resolved, in-library) path to open;
// `namePath` is the catalogued path, for the extension and sibling subtitle files.
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
    sendError(req, res, 'P300');
    return null;
  }
  if (await isItemHiddenForUser(db, req.params.id, req.user)) {
    sendError(req, res, 'P300');
    return null;
  }

  const resolvedItemPath = path.resolve(item.path);
  const resolvedLibPath = path.resolve(item.library_path);
  if (resolvedItemPath !== resolvedLibPath && !resolvedItemPath.startsWith(resolvedLibPath + path.sep)) {
    res.status(403).json({ error: 'Access denied: Invalid file path traversal detected' });
    return null;
  }
  const realPath = await requireLibraryFile(req, res, resolvedItemPath);
  if (!realPath) return null;

  return { item, filePath: realPath, namePath: resolvedItemPath };
}

// For routes that don't read the file: false after answering 400/P300.
async function requireVisibleItem(req, res) {
  if (!ITEM_ID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid item id' });
    return false;
  }
  const db = await getDb();
  const item = await db.get('SELECT id FROM items WHERE id = ?', [req.params.id]);
  if (!item || await isItemHiddenForUser(db, req.params.id, req.user)) {
    sendError(req, res, 'P300');
    return false;
  }
  return true;
}

// A file ffprobe couldn't parse, or saw as a playlist/script, is never handed to ffmpeg.
function refuseUnprobed(req, res, info) {
  if (!info.probeFailed) return false;
  sendError(req, res, 'P304', {
    message: info.unsafeFormat ? 'This file is not a media file and cannot be converted' : undefined
  });
  return true;
}

// Client codecs: ?clientHevc=1 from browsers, ?videoCodecs=h264,hevc (full list) from apps.
function clientCaps(req, { hevc = false } = {}) {
  return {
    clientHevc: hevc || req.query.clientHevc === '1',
    videoCodecs: parseClientVideoCodecs(req.query.videoCodecs)
  };
}

// Query passed on to playlist URLs so later requests are judged the same and can sign in.
function carriedQuery(req) {
  const params = [];
  for (const name of ['token', 'clientHevc', 'videoCodecs', 'copy']) {
    if (typeof req.query[name] === 'string' && req.query[name]) params.push(`${name}=${encodeURIComponent(req.query[name])}`);
  }
  return params.length ? `?${params.join('&')}` : '';
}

// ?copy=1 plays a title's converted copy (services/compat.js) instead of its file; playback-info
// says when to ask for it. Without a finished copy the file itself is played.
async function copyFor(req, resolved) {
  if (req.query.copy !== '1') return null;
  return readyCopy(await getDb(), req.params.id, resolved.filePath);
}

// Whether the file can play directly or needs ffmpeg, so the player picks the right URL first.
router.get('/:id/playback-info', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const caps = clientCaps(req);
    const fileInfo = await getPlaybackInfo(req.params.id, resolved.filePath, caps);
    const db = await getDb();

    // Undecodable video is transcoded unless an H.264 copy exists (client then adds ?copy=1).
    // Subtitles still come from the original file.
    let info = fileInfo;
    if (fileInfo.mode === 'transcode' && !fileInfo.probeFailed) {
      const copy = await readyCopy(db, req.params.id, resolved.filePath);
      const copyInfo = copy ? await getPlaybackInfo(compatProbeId(req.params.id), copy.path, caps) : null;
      if (copyInfo && !copyInfo.probeFailed && copyInfo.mode !== 'transcode') {
        info = { ...copyInfo, subtitleTracks: fileInfo.subtitleTracks, compatCopy: true };
      }
    }

    res.json({
      ...info,
      itemDuration: resolved.item.duration || info.duration || 0,
      qualities: buildLadder(info).map((rung) => ({ name: rung.name, height: rung.height })),
      subtitles: await listSubtitleTracks(fileInfo, resolved.namePath),
      compat: await compatFor(db, req, fileInfo)
    });
  } catch (err) {
    playbackError(req, res, err, 'Could not inspect this video');
  }
});

// Where this title's converted copy stands, and whether this account may ask for one.
async function compatFor(db, req, fileInfo) {
  const settings = await getCompatSettings(db);
  return {
    ...await copyState(db, req.params.id),
    eligible: needsCopy(fileInfo),
    canRequest: req.user.role === 'admin' || settings.allowUsers
  };
}

router.get('/:id/compat', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;
    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    res.json(await compatFor(await getDb(), req, info));
  } catch (err) {
    playbackError(req, res, err, 'Could not check this video');
  }
});

// Queues an H.264 copy (non-admins only if allowed); retries a failed one. Refusals: P310
// (nothing to convert), P311 (size limit), P312 (admins only).
router.post('/:id/compat', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;
    const db = await getDb();
    if (req.user.role !== 'admin' && !(await getCompatSettings(db)).allowUsers) {
      return sendError(req, res, 'P312');
    }
    await requestCopy(db, req.params.id, resolved.filePath, req.user.id);
    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    res.status(202).json(await compatFor(db, req, info));
  } catch (err) {
    playbackError(req, res, err, 'Could not start converting this video');
  }
});

// Cancels a conversion, or deletes the finished copy.
router.delete('/:id/compat', authenticateToken, requireAdmin, handle(async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
  await removeCopy(await getDb(), req.params.id);
  res.json({ ok: true });
}));

// One subtitle track as WebVTT; ?token= since <track> can't send an Authorization header.
router.get('/:id/subtitles/:trackId.vtt', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    const isEmbedded = String(req.params.trackId).startsWith('embedded-');
    if (isEmbedded && refuseUnprobed(req, res, info)) return;

    // Shared, cached extraction: a departed request stops waiting, and ffmpeg stops if no one is.
    const gone = new AbortController();
    res.on('close', () => { if (!res.writableEnded) gone.abort(); });
    const vtt = await getSubtitleVtt(info, resolved.filePath, req.params.trackId, {
      signal: gone.signal,
      sidecarsOf: resolved.namePath
    });
    if (!vtt) return sendError(req, res, 'P307');

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(vtt);
  } catch (err) {
    playbackError(req, res, err, 'Could not load subtitles');
  }
});

// Remux/transcode goes out as on-disk HLS (services/hls.js) for real segment seeking.
// The URL profile ("720p-a0") names a quality rung and an audio track.
async function resolveHlsJob(req, res, profileParam) {
  const resolved = await resolvePlayableItem(req, res);
  if (!resolved) return null;

  const parsed = profileParam ? parseProfile(profileParam) : null;
  const isSourceRemux = parsed ? (parsed.quality === 'source') : (req.query.mode === 'remux');

  // Remux profiles ('source-aN') and clientHevc=1 are judged with HEVC support on.
  const caps = clientCaps(req, { hevc: isSourceRemux });
  // The title's converted copy when the client was told to play that (?copy=1).
  const copy = await copyFor(req, resolved);
  const filePath = copy ? copy.path : resolved.filePath;
  const info = await getPlaybackInfo(copy ? compatProbeId(req.params.id) : req.params.id, filePath, caps);
  if (refuseUnprobed(req, res, info)) return null;
  const mode = (isSourceRemux || info.mode === 'remux') ? 'remux' : 'transcode';
  const ladder = buildLadder({ ...info, mode });

  let quality = isSourceRemux ? 'source' : ladder[0].name;
  let audioTrack = 0;

  if (profileParam) {
    if (!parsed) {
      sendError(req, res, 'P306', { message: 'Unknown playback profile', status: 404 });
      return null;
    }
    if (!isSourceRemux && !ladder.some((rung) => rung.name === parsed.quality)) {
      sendError(req, res, 'P306', { message: 'Unknown playback profile', status: 404 });
      return null;
    }
    const audioCount = info.audioTracks?.length || 1;
    if (parsed.audioTrack >= audioCount) {
      sendError(req, res, 'P306', { message: 'Unknown audio track', status: 404 });
      return null;
    }
    quality = parsed.quality;
    audioTrack = parsed.audioTrack;
  }

  const audioTranscode = !info.audioOk;
  return getOrStartJob(req.params.id, filePath, {
    userId: req.user.id,
    mode,
    quality,
    audioTrack,
    audioTranscode,
    videoCodec: info.videoCodec,
    variant: copy && mode === 'remux' ? 'copy' : null
  });
}

router.get('/:id/hls/master.m3u8', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const caps = clientCaps(req);
    const copy = await copyFor(req, resolved);
    const info = copy
      ? await getPlaybackInfo(compatProbeId(req.params.id), copy.path, caps)
      : await getPlaybackInfo(req.params.id, resolved.filePath, caps);
    const ladder = buildLadder(info);
    const audioTrack = Math.max(0, parseInt(req.query.audio, 10) || 0);

    const tokenQuery = carriedQuery(req);

    // Advertised sizes follow the source's aspect ratio, not 16:9.
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
    playbackError(req, res, err, 'Could not start playback');
  }
});

router.get('/:id/hls/:profile/media.m3u8', authenticateToken, async (req, res) => {
  try {
    const job = await resolveHlsJob(req, res, req.params.profile);
    if (!job) return;
    touchJob(job, req.user.id);

    const ready = await waitForPlaylist(job);
    if (!ready) {
      return sendError(req, res, 'P305');
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');

    // Segment URIs carry the token and client capabilities, or native players get 401/404.
    let playlist = fs.readFileSync(job.playlistPath, 'utf8');
    const q = carriedQuery(req);
    if (q) playlist = playlist.replace(/(init\.mp4|seg_\d{5}\.m4s)/g, `$1${q}`);
    res.send(playlist);
  } catch (err) {
    playbackError(req, res, err, 'Could not load playlist');
  }
});

const SEGMENT_FILE_RE = /^(init\.mp4|seg_\d{5}\.m4s)$/;

router.get('/:id/hls/:profile/:segmentFile', authenticateToken, async (req, res) => {
  try {
    if (!SEGMENT_FILE_RE.test(req.params.segmentFile)) {
      return sendError(req, res, 'P306', { message: 'Invalid segment name' });
    }

    const job = await resolveHlsJob(req, res, req.params.profile);
    if (!job) return;
    touchJob(job, req.user.id);

    const segmentPath = await waitForSegment(job, req.params.segmentFile);
    if (!segmentPath) {
      return res.status(404).json({ error: 'Segment not available' });
    }

    res.setHeader('Content-Type', req.params.segmentFile === 'init.mp4' ? 'video/mp4' : 'video/iso.segment');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    streamFile(res, segmentPath);
  } catch (err) {
    playbackError(req, res, err, 'Could not load segment');
  }
});

// Stops this item's ffmpeg jobs when the player closes or switches title.
router.post('/:id/hls/stop', authenticateToken, handle(async (req, res) => {
  if (!await requireVisibleItem(req, res)) return;
  stopItemJobs(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// Pre-generated scrub-preview sprites only; generating during playback spikes CPU on 4K files.
router.get('/:id/trickplay/index.json', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const existing = getTrickplayIndex(req.params.id);
    if (existing) return res.json(existing);

    // No sheets is normal: 204 keeps it out of the browser console.
    res.status(204).end();
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
    res.setHeader('Cache-Control', 'private, max-age=604800');
    streamFile(res, sheetPath);
  } catch (err) {
    console.error('[video] trickplay sheet failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not load scrub preview' });
  }
});

// Intro/credits markers, so the player can offer a skip button.
router.get('/:id/markers', authenticateToken, handle(async (req, res) => {
  // Visibility checked: markers would still reveal a hidden title.
  if (!await requireVisibleItem(req, res)) return;
  const db = await getDb();
  const markers = await db.all(
    'SELECT type, start_seconds as startSeconds, end_seconds as endSeconds FROM intro_credit_markers WHERE item_id = ?',
    [req.params.id]
  );
  res.json({ markers });
}));

router.put('/:id/markers', authenticateToken, requireEditor, async (req, res) => {
  try {
    if (!await requireVisibleItem(req, res)) return;
  } catch (err) {
    return serverError(req, res, err);
  }

  const { markers } = req.body || {};
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

// Direct-play video with range support; accepts ?token=.
router.get('/:id/stream', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const { filePath, namePath } = resolved;
    const copy = await copyFor(req, resolved);
    if (copy) return sendRangedFile(req, res, copy.path, copy.size, 'video/mp4');
    const stat = fs.statSync(filePath);
    let contentType = mime.lookup(namePath) || 'video/mp4';
    if (namePath.endsWith('.mkv')) contentType = 'video/x-matroska';
    sendRangedFile(req, res, filePath, stat.size, contentType);
  } catch (err) {
    playbackError(req, res, err, 'Could not stream this video');
  }
});

export default router;
