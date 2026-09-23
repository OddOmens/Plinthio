import express from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { getPlaybackInfo, spawnTranscode } from '../services/transcode.js';

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
  if (await isItemHiddenForUser(db, req.params.id, req.user.id)) {
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
router.get('/:id/playback-info', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    res.json({ ...info, itemDuration: resolved.item.duration || info.duration || 0 });
  } catch (err) {
    console.error('[video] playback-info failed:', err);
    res.status(500).json({ error: 'Could not inspect this video' });
  }
});

// Transcoded (or remuxed) playback. The response is a live ffmpeg pipe of unknown length, so
// it deliberately does NOT advertise range support — the client seeks by re-requesting this
// endpoint with a different ?start=, and the player adds that offset back on for display.
router.get('/:id/transcode', authenticateToken, async (req, res) => {
  try {
    const resolved = await resolvePlayableItem(req, res);
    if (!resolved) return;

    const start = Math.max(0, parseFloat(req.query.start) || 0);
    const info = await getPlaybackInfo(req.params.id, resolved.filePath);
    const mode = info.mode === 'remux' ? 'remux' : 'transcode';

    const ffmpeg = spawnTranscode(resolved.filePath, start, mode);

    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });

    // Killing ffmpeg when the client goes away is essential — without it, every seek and
    // every abandoned playback leaves an encoder pinning a CPU core indefinitely.
    const killFfmpeg = () => {
      if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
    };
    res.on('close', killFfmpeg);
    res.on('error', killFfmpeg);

    ffmpeg.on('error', (err) => {
      console.error('[video] ffmpeg spawn failed:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Transcoding is unavailable on this server' });
    });

    ffmpeg.on('close', (code) => {
      // 255/SIGKILL is the normal result of the client disconnecting or seeking away.
      if (code && code !== 255 && stderr) {
        console.error(`[video] ffmpeg exited ${code}: ${stderr}`);
      }
      if (!res.writableEnded) res.end();
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');
    ffmpeg.stdout.pipe(res);
  } catch (err) {
    console.error('[video] transcode failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not start playback' });
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
    if (await isItemHiddenForUser(db, req.params.id, req.user.id)) {
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
    const fileSize = stat.size;
    const range = req.headers.range;
    let contentType = mime.lookup(resolvedItemPath) || 'video/mp4';
    if (resolvedItemPath.endsWith('.mkv')) contentType = 'video/x-matroska';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send(`Requested range not satisfiable\n${start} >= ${fileSize}`);
        return;
      }

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(resolvedItemPath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(resolvedItemPath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
