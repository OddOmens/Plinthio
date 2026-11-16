import crypto from 'crypto';
import { config } from '../config/env.js';

// Live streams are proxied (no CORS upstream, custom headers, LAN-only channels). Playlist URLs
// are rewritten to p?u=<base64url(URL)>&s=<HMAC(channel id + "\n" + URL)>&token=<media token>;
// the signature stops the proxy from fetching any URL it didn't write for that channel.

// Separate key derived from the server secret, so proxy signatures can't be reused elsewhere.
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

// Logos are proxied so the CSP can stay strict and viewers' addresses stay off logo hosts.
// Custom logos get a version param so browsers drop the cached one when it changes.
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
 * Rewrites every URI in an HLS playlist, including tag URI="…" attributes, to signed proxy links.
 * `baseUrl` is where the playlist was served from after redirects; non-http(s) URIs are left alone.
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
