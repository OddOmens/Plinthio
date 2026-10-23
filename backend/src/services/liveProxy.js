import crypto from 'crypto';
import { config } from '../config/env.js';

// Live TV streams play through Plinthio rather than straight from the channel's server: most
// stream servers send no CORS headers (so hls.js in the browser couldn't read them), some
// need a particular Referer or User-Agent, and a channel on the admin's own network isn't
// reachable from a phone outside it. So every URL in a channel's playlists is rewritten to
//
//   p?u=<base64url(absolute URL)>&s=<HMAC(channel id + "\n" + URL)>&token=<media token>
//
// (relative, so it resolves next to the playlist: /api/media/live/<id>/p). The signature is
// what makes this safe: the proxy only fetches URLs it wrote itself, for that channel, so it
// can't be pointed anywhere else by editing the link.

// A key of its own, derived from the server secret, so a proxy signature can never be
// mistaken for (or turned into) anything else signed with that secret.
const KEY = crypto.createHash('sha256').update(`plinthio-live-proxy\n${config.jwtSecret}`).digest();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function sign(scope, url) {
  return b64url(crypto.createHmac('sha256', KEY).update(`${scope}\n${url}`).digest());
}

export function verify(scope, url, signature) {
  if (typeof signature !== 'string' || typeof url !== 'string' || !url) return false;
  const expected = Buffer.from(sign(scope, url));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The URL inside a `u=` parameter, or null when it isn't valid base64url text. */
export function decodeUrlParam(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function proxyPath(channelId, url, tokenQuery = '') {
  return `p?u=${b64url(url)}&s=${sign(channelId, url)}${tokenQuery}`;
}

// A channel logo's address on this server (add ?token=<media token>). Logos come from
// hundreds of different hosts, which the app's Content-Security-Policy (images from this
// server only, plus the metadata providers) would otherwise block — and fetching them here
// keeps viewers' addresses away from those hosts too. A logo the admin chose themselves
// (`custom`) gets a version in its address, so browsers drop the old one when it changes.
export function logoPath(channelId, logo, { custom = false } = {}) {
  if (!logo || !/^https?:\/\//i.test(logo)) return null;
  const path = `/api/media/live/${channelId}/logo`;
  return custom ? `${path}?v=${crypto.createHash('sha256').update(logo).digest('hex').slice(0, 10)}` : path;
}

/** Whether a body is an HLS/M3U playlist (by its first line). */
export function looksLikePlaylist(buf) {
  const head = Buffer.isBuffer(buf) ? buf.subarray(0, 64).toString('utf8') : String(buf).slice(0, 64);
  return head.replace(/^﻿/, '').trimStart().startsWith('#EXTM3U');
}

const URI_ATTR_RE = /URI="([^"]*)"/g;

/**
 * Rewrites every URI in an HLS playlist — variant and media playlists, segments, and the
 * URI="…" of tags such as #EXT-X-KEY, #EXT-X-MAP and #EXT-X-MEDIA — to signed proxy links.
 * Relative URIs resolve against `baseUrl` (where the playlist was actually served from,
 * after redirects). Anything that isn't http(s) (a data: key, a DRM scheme) is left alone;
 * the proxy wouldn't fetch it anyway.
 */
export function rewritePlaylist(text, baseUrl, channelId, tokenQuery = '') {
  const proxied = (uri) => {
    let absolute;
    try {
      absolute = new URL(uri.trim(), baseUrl);
    } catch {
      return uri;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return uri;
    return proxyPath(channelId, absolute.toString(), tokenQuery);
  };

  return String(text)
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(URI_ATTR_RE, (whole, uri) => `URI="${proxied(uri)}"`);
      }
      return proxied(trimmed);
    })
    .join('\n');
}

/** A media token carried on to rewritten links (`&token=…`), or ''. */
export function tokenQueryFor(req) {
  return req.query?.token ? `&token=${encodeURIComponent(String(req.query.token))}` : '';
}
