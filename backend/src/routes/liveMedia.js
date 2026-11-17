import express from 'express';
import { pipeline } from 'stream';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendError } from '../errors.js';
import { ITEM_ID_RE as CHANNEL_ID_RE } from '../utils/ids.js';
import {
  isLiveTvEnabled, isKidsUser, channelPrivateHost, getLiveFilters, isFilteredOut, getHealthSettings,
  upstreamHeaders, USER_AGENT
} from '../services/liveTv.js';
import { openUpstream, readBody, peek, byteLimit } from '../services/safeFetch.js';
import {
  verify, decodeUrlParam, looksLikePlaylist, rewritePlaylist, tokenQueryFor
} from '../services/liveProxy.js';

// Live TV playback, under /api/media/live so hls.js can use ?token=. Playlists are rewritten
// to signed proxy links (see services/liveProxy.js).
//
//   GET /:id/index.m3u8   the channel's playlist, rewritten
//   GET /:id/p?u=&s=      anything a rewritten playlist links to
//   GET /:id/logo         the channel's logo
//
// Only signed (or stored logo) URLs are fetched, always through safeFetch's address guard.
// Stream bytes are not buffered; only playlists and logos are read whole.

const router = express.Router();

const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const SEGMENT_MAX_BYTES = 100 * 1024 * 1024;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const PLAYLIST_TYPE = /mpegurl/i;
// Upstream bytes come from our origin, so only types a browser won't render as a page pass
// through; the rest become octet-stream. The sandbox CSP is a second guard.
const PASS_TYPE = /^(video\/[\w.+-]+|audio\/[\w.+-]+|application\/(octet-stream|mp4|mp2t)|text\/vtt|image\/(jpeg|png|gif|webp|avif))$/;
const LOGO_TYPE = /^image\/[\w.+-]+$/;
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const STREAM_LINK_INVALID = 'This stream link is not valid';
const CHANNEL_NOT_FOUND = 'Channel not found';

// Same rules as channelIndex in services/liveTv.js, for one CHANNEL_COLUMNS row (no extra query).
const CHANNEL_COLUMNS = `c.hidden, c.unsupported, c.kids_allowed, c.pinned, c.geo_blocked, c.groups, c.languages,
       c.country, c.stream_url, c.health, s.enabled AS source_enabled,
       EXISTS (SELECT 1 FROM live_lineup_channels lc JOIN live_lineups l ON l.id = lc.lineup_id
               WHERE lc.channel_id = c.id AND l.kids_allowed = 1) AS lineup_kids`;

async function mayWatch(db, channel, user) {
  if (!channel.source_enabled || channel.hidden || channel.unsupported) return false;
  if (isKidsUser(user) && !channel.kids_allowed && !channel.lineup_kids) return false;
  if (channel.health === 'offline' && (await getHealthSettings(db)).hideOffline) return false;
  return !isFilteredOut(channel, (await getLiveFilters(db)).compiled);
}

function contentType(upstream) {
  return String(upstream.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

// Stops the upstream request when the viewer goes away before it finished.
function abortOnClose(req, res) {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

function unavailable(req, res, err) {
  // Offline channels are routine: no stack trace logged, admins still see why.
  sendError(req, res, 'P701', {
    extra: req.user?.role === 'admin' && err?.message ? { detail: err.message } : undefined
  });
}

function sendPlaylist(res, text) {
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  res.send(text);
}

router.use(authenticateToken);

// The admin's logo, else the playlist's. Admins bypass the Live TV switch and viewing rules
// (their channel manager lists every channel). Failures are a bare 404.
router.get('/:logoChannel/logo', async (req, res) => {
  const notFound = () => { if (!res.headersSent) res.status(404).end(); };
  try {
    if (!CHANNEL_ID_RE.test(req.params.logoChannel)) return notFound();
    const db = await getDb();
    const channel = await db.get(
      `SELECT COALESCE(c.custom_logo, c.logo) AS logo, ${CHANNEL_COLUMNS}
       FROM live_channels c JOIN live_sources s ON s.id = c.source_id WHERE c.id = ?`,
      [req.params.logoChannel]
    );
    if (!channel?.logo) return notFound();
    if (req.user.role !== 'admin') {
      if (!await isLiveTvEnabled(db) || !await mayWatch(db, channel, req.user)) return notFound();
    }
    // Public addresses only: the URL came from a playlist, and a logo is never worth a hole.
    const { res: upstream } = await openUpstream(channel.logo, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/*', 'accept-encoding': 'identity' },
      timeoutMs: 10000,
      signal: abortOnClose(req, res)
    });
    const type = contentType(upstream);
    const length = Number(upstream.headers['content-length']);
    if (upstream.statusCode !== 200 || !LOGO_TYPE.test(type) || (Number.isFinite(length) && length > LOGO_MAX_BYTES)) {
      upstream.resume();
      return notFound();
    }
    // Read whole; one that's too big is a clean 404.
    const body = await readBody(upstream, LOGO_MAX_BYTES);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Security-Policy', SANDBOX_CSP);
    res.send(body);
  } catch (err) {
    notFound();
  }
});

router.use(async (req, res, next) => {
  try {
    if (!await isLiveTvEnabled(await getDb())) return sendError(req, res, 'P700');
    next();
  } catch (err) {
    sendError(req, res, 'P000', { err });
  }
});

// The channel in :id, if this viewer may watch it (source on, not hidden or filtered unless
// pinned, kids-allowed for kids accounts).
router.param('id', async (req, res, next, id) => {
  try {
    if (!CHANNEL_ID_RE.test(id)) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    const db = await getDb();
    const channel = await db.get(
      `SELECT c.id, c.http_headers, ${CHANNEL_COLUMNS}, s.kind AS source_kind, s.playlist_url AS source_playlist_url
       FROM live_channels c JOIN live_sources s ON s.id = c.source_id
       WHERE c.id = ?`,
      [id]
    );
    if (!channel || !await mayWatch(db, channel, req.user)) {
      return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    }
    req.channel = channel;
    next();
  } catch (err) {
    sendError(req, res, 'P000', { err });
  }
});

function fetchFor(req, res, url) {
  return openUpstream(url, {
    allowPrivateHosts: [channelPrivateHost(req.channel)],
    headers: upstreamHeaders(req.channel),
    signal: abortOnClose(req, res)
  });
}

router.get('/:id/index.m3u8', async (req, res) => {
  try {
    const { res: upstream, url } = await fetchFor(req, res, req.channel.stream_url);
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      upstream.resume();
      return unavailable(req, res, new Error(`The stream answered HTTP ${upstream.statusCode}`));
    }
    const body = await readBody(upstream, PLAYLIST_MAX_BYTES);
    if (!looksLikePlaylist(body)) return unavailable(req, res, new Error('The stream did not return an HLS playlist'));
    sendPlaylist(res, rewritePlaylist(body.toString('utf8'), url, req.channel.id, tokenQueryFor(req)));
  } catch (err) {
    unavailable(req, res, err);
  }
});

router.get('/:id/p', async (req, res) => {
  const target = decodeUrlParam(req.query.u);
  if (!target || !verify(req.channel.id, target, req.query.s)) {
    return sendError(req, res, 'P003', { message: STREAM_LINK_INVALID });
  }
  try {
    const { res: upstream, url } = await fetchFor(req, res, target);
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      upstream.resume();
      return unavailable(req, res, new Error(`The stream answered HTTP ${upstream.statusCode}`));
    }

    const type = contentType(upstream);
    let isPlaylist = PLAYLIST_TYPE.test(type) || /\.m3u8?$/i.test(new URL(url).pathname);
    if (!isPlaylist) {
      // Some servers send playlists as text/plain or octet-stream from extension-less URLs.
      const first = await peek(upstream);
      isPlaylist = !!first && looksLikePlaylist(first);
    }
    if (isPlaylist) {
      const body = await readBody(upstream, PLAYLIST_MAX_BYTES);
      if (!looksLikePlaylist(body)) return unavailable(req, res, new Error('Expected an HLS playlist'));
      return sendPlaylist(res, rewritePlaylist(body.toString('utf8'), url, req.channel.id, tokenQueryFor(req)));
    }

    res.status(200);
    res.setHeader('Content-Type', PASS_TYPE.test(type) ? type : 'application/octet-stream');
    const length = Number(upstream.headers['content-length']);
    if (Number.isFinite(length) && length <= SEGMENT_MAX_BYTES) res.setHeader('Content-Length', String(length));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Security-Policy', SANDBOX_CSP);
    pipeline(upstream, byteLimit(SEGMENT_MAX_BYTES), res, () => {});
  } catch (err) {
    unavailable(req, res, err);
  }
});

export default router;
