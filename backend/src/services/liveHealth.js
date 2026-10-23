import { openUpstream, readBody } from './safeFetch.js';
import { looksLikePlaylist } from './liveProxy.js';

// Is a channel's stream still there? Public lists carry plenty of channels whose server has
// gone, and a viewer only finds out after the player gives up. This asks the way a player
// would, but stops as soon as the answer is known: the channel's playlist, the first media
// playlist it leads to (a few hops at most), then the first 2 KB of the first segment. No
// video is decoded or kept — a stream that hands over bytes counts as alive.
//
// Every request goes through the same address guard as playback (safeFetch.js), with the
// same private-host allowance and headers the stream proxy would use for that channel.
// services/liveTv.js decides which channels to check and when.

const REQUEST_TIMEOUT_MS = 10000;
const CHECK_TIMEOUT_MS = 30000; // the whole check, however many hops and redirects
const MAX_PLAYLISTS = 3;
const PLAYLIST_MAX_BYTES = 1024 * 1024;

/**
 * The first link in an HLS playlist, resolved against `baseUrl`, and whether it is another
 * playlist (a variant of a master playlist, or anything named .m3u8) rather than a segment.
 */
export function firstPlaylistLink(text, baseUrl) {
  let variant = false;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      variant = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    let url;
    try {
      url = new URL(line, baseUrl);
    } catch {
      return null;
    }
    return { url: url.toString(), playlist: variant || /\.m3u8?$/i.test(url.pathname) };
  }
  return null;
}

// Whether a response carries any bytes: reads its first chunk only (the request asked for
// 2 KB; from a server that ignores the range, nothing past that chunk is read), then hangs up.
async function hasBytes(res) {
  try {
    for await (const chunk of res) {
      if (chunk.length) return true;
    }
    return false;
  } finally {
    res.destroy();
  }
}

/**
 * Checks one stream. Resolves with `{ ok: true }` or `{ ok: false, error }`; never rejects.
 *
 *   allowPrivateHosts, headers  as the stream proxy would send them for this channel
 */
export async function checkStream(streamUrl, { allowPrivateHosts = [], headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  timer.unref?.();
  const open = (url, extra = {}) => openUpstream(url, {
    allowPrivateHosts,
    headers: { ...headers, ...extra },
    timeoutMs,
    signal: controller.signal
  });
  try {
    let url = streamUrl;
    for (let hop = 0; hop < MAX_PLAYLISTS; hop++) {
      const { res, url: servedFrom } = await open(url);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return { ok: false, error: `The playlist answered HTTP ${res.statusCode}` };
      }
      const body = await readBody(res, PLAYLIST_MAX_BYTES);
      if (!looksLikePlaylist(body)) return { ok: false, error: 'The stream did not return an HLS playlist' };
      const link = firstPlaylistLink(body.toString('utf8'), servedFrom);
      if (!link) return { ok: false, error: 'The playlist lists nothing to play' };
      if (link.playlist) {
        url = link.url;
        continue;
      }
      const { res: segment } = await open(link.url, { range: 'bytes=0-2047' });
      if (segment.statusCode !== 200 && segment.statusCode !== 206) {
        segment.resume();
        return { ok: false, error: `The first segment answered HTTP ${segment.statusCode}` };
      }
      if (!await hasBytes(segment)) return { ok: false, error: 'The first segment was empty' };
      return { ok: true };
    }
    return { ok: false, error: 'Too many nested playlists' };
  } catch (err) {
    return { ok: false, error: controller.signal.aborted ? 'The check took too long' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A channel's health after a check: one success makes it 'ok' (and clears the failures);
 * it is 'offline' after two failures in a row. Before that it keeps what it was (null for
 * a channel never seen working).
 */
export function nextHealth({ health = null, fails = 0 } = {}, ok) {
  if (ok) return { health: 'ok', fails: 0 };
  const count = (fails || 0) + 1;
  return { health: count >= 2 ? 'offline' : health, fails: count };
}
