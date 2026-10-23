import express from 'express';
import { pipeline } from 'stream';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendError } from '../errors.js';
import { isLiveTvEnabled, isKidsUser, channelPrivateHost, USER_AGENT } from '../services/liveTv.js';
import { openUpstream, readBody, peek, byteLimit } from '../services/safeFetch.js';
import {
  verify, decodeUrlParam, looksLikePlaylist, rewritePlaylist, tokenQueryFor
} from '../services/liveProxy.js';

// Live TV playback, mounted at /api/media/live so hls.js can authenticate with ?token= like
// the video player does. Channel playlists are fetched by the server and every link in them
// rewritten to a signed proxy link (services/liveProxy.js explains why); this serves both.
//
//   GET /:id/index.m3u8   the channel's own playlist, rewritten
//   GET /:id/p?u=&s=      anything a rewritten playlist links to (a playlist again, or bytes)
//   GET /:id/logo         the channel's logo, fetched from wherever the playlist says
//
// The stream proxy only ever fetches URLs it signed (and the logo route only the URL stored
// for that channel), always through the address guard in safeFetch.js. Upstream bytes pass
// through without being buffered — only playlists and logos, both small, are read whole.

const router = express.Router();

const CHANNEL_ID_RE = /^[a-f0-9]{32}$/;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const SEGMENT_MAX_BYTES = 100 * 1024 * 1024;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const PLAYLIST_TYPE = /mpegurl/i;
// Upstream bytes are served from Plinthio's own origin, so only types a browser won't run as
// a page pass through (no HTML, SVG or XML); everything else goes out as octet-stream. The
// sandbox CSP is a second lock on the same door.
const PASS_TYPE = /^(video\/[\w.+-]+|audio\/[\w.+-]+|application\/(octet-stream|mp4|mp2t)|text\/vtt|image\/(jpeg|png|gif|webp|avif))$/;
const LOGO_TYPE = /^image\/[\w.+-]+$/;
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const STREAM_LINK_INVALID = 'This stream link is not valid';
const CHANNEL_NOT_FOUND = 'Channel not found';

function mayWatch(channel, user) {
  return !!channel.source_enabled && !channel.hidden && !channel.unsupported &&
    (!isKidsUser(user) || !!channel.kids_allowed);
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
  // Offline channels are routine, so no stack trace in the server log for each one; admins
  // still see why in the response.
  sendError(req, res, 'P701', {
    extra: req.user?.role === 'admin' && err?.message ? { detail: err.message } : undefined
  });
}

function sendPlaylist(res, text) {
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  res.send(text);
}

function upstreamHeaders(channel) {
  let extra = {};
  try {
    extra = channel.http_headers ? JSON.parse(channel.http_headers) : {};
  } catch {
    extra = {};
  }
  const headers = { 'user-agent': extra.userAgent || USER_AGENT, 'accept-encoding': 'identity' };
  if (extra.referrer) headers.referer = extra.referrer;
  return headers;
}

router.use(authenticateToken);

// A channel's logo. Not behind the Live TV switch or the viewing rules for admins, whose
// channel manager lists hidden and unplayable channels too (and works while Live TV is off).
// Any failure is a bare 404 — the app shows its own placeholder.
router.get('/:logoChannel/logo', async (req, res) => {
  const notFound = () => { if (!res.headersSent) res.status(404).end(); };
  try {
    if (!CHANNEL_ID_RE.test(req.params.logoChannel)) return notFound();
    const db = await getDb();
    const channel = await db.get(
      `SELECT c.logo, c.hidden, c.unsupported, c.kids_allowed, s.enabled AS source_enabled
       FROM live_channels c JOIN live_sources s ON s.id = c.source_id WHERE c.id = ?`,
      [req.params.logoChannel]
    );
    if (!channel?.logo) return notFound();
    if (req.user.role !== 'admin') {
      if (!await isLiveTvEnabled(db) || !mayWatch(channel, req.user)) return notFound();
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
    // Small, so read whole: a logo that turns out too big is still a clean 404.
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

// The channel in :id, if this viewer may watch it: its source is on, it isn't hidden or
// unplayable, and a kids account only gets channels allowed for kids.
router.param('id', async (req, res, next, id) => {
  try {
    if (!CHANNEL_ID_RE.test(id)) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    const db = await getDb();
    const channel = await db.get(
      `SELECT c.id, c.stream_url, c.http_headers, c.hidden, c.unsupported, c.kids_allowed,
              s.kind AS source_kind, s.enabled AS source_enabled
       FROM live_channels c JOIN live_sources s ON s.id = c.source_id
       WHERE c.id = ?`,
      [id]
    );
    if (!channel || !mayWatch(channel, req.user)) {
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
