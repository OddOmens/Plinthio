// M3U channel playlists (the IPTV flavour: #EXTM3U, then #EXTINF lines carrying tvg-* and
// group-title attributes, each followed by its stream URL). Used by services/liveTv.js.
//
//   #EXTM3U x-tvg-url="https://example.com/guide.xml.gz"
//   #EXTINF:-1 tvg-id="News.us@SD" tvg-logo="https://…/logo.png" group-title="News;General",News 24 (720p) [Geo-blocked]
//   #EXTVLCOPT:http-referrer=https://example.com/
//   https://example.com/news/index.m3u8

// Attributes as `key="value"`; some playlists leave values unquoted, which is tolerated.
const ATTRIBUTE_RE = /([A-Za-z][\w-]*)=(?:"([^"]*)"|([^\s,"]+))/g;

function parseAttributes(text) {
  const attrs = {};
  for (const m of text.matchAll(ATTRIBUTE_RE)) {
    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  return attrs;
}

// Splits an #EXTINF line into its attributes and the display name after the first comma
// that isn't inside a quoted value.
function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let inQuotes = false;
  let comma = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      comma = i;
      break;
    }
  }
  const head = comma === -1 ? body : body.slice(0, comma);
  const name = comma === -1 ? '' : body.slice(comma + 1).trim();
  return { attrs: parseAttributes(head), name };
}

// Public playlists tag names with "[Geo-blocked]" and "[Not 24/7]" (sometimes both, as
// "[Not 24/7;Geo-blocked]"). The geo tag becomes a flag; both come out of the name.
const TAG_GEO = /^geo-?blocked$/i;
const TAG_DROP = /^(geo-?blocked|not 24\/7)$/i;

export function cleanChannelName(raw) {
  let geoBlocked = false;
  const name = String(raw || '')
    .replace(/\s*\[([^\]]*)\]/g, (whole, inner) => {
      const parts = inner.split(';').map((p) => p.trim()).filter(Boolean);
      if (parts.some((p) => TAG_GEO.test(p))) geoBlocked = true;
      const kept = parts.filter((p) => !TAG_DROP.test(p));
      if (kept.length === parts.length) return whole;
      return kept.length ? ` [${kept.join(';')}]` : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { name, geoBlocked };
}

/** Whether v1 can play a stream: HLS over http(s). */
export function isHlsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return /\.m3u8$/i.test(url.pathname) || /m3u8/i.test(url.search);
}

/** Adult content, which the public presets never bring in. */
export function isAdultGroup(groups) {
  return groups.some((g) => /xxx|adult/i.test(g));
}

// tvg-country / tvg-language, as some playlists carry them: the first country (if it's a
// two-letter code), and every language as given, lower-cased.
function playlistCountry(value) {
  const first = String(value || '').split(/[;,\s]+/).find(Boolean) || '';
  return /^[a-z]{2}$/i.test(first) ? first.toUpperCase() : null;
}

function playlistLanguages(value) {
  const codes = String(value || '')
    .split(/[;,]/)
    .map((l) => l.trim().toLowerCase().slice(0, 64))
    .filter(Boolean);
  return [...new Set(codes)].slice(0, 20);
}

/**
 * Parses an M3U playlist. Returns null when `text` isn't one, else
 *   { guideUrls: [string], channels: [{ stableKey, tvgId, name, logo, groups, url, geoBlocked, headers,
 *     country, languages }] }
 * `stableKey` (the tvg-id, else the name) is unique within the playlist, so a channel keeps
 * its identity — and the admin's hide / kids choices — across refreshes.
 */
export function parseM3u(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const firstLine = lines.find((l) => l.trim());
  if (!firstLine || !firstLine.trim().startsWith('#EXTM3U')) return null;

  const header = parseAttributes(firstLine.trim().slice('#EXTM3U'.length));
  const guideUrls = (header['x-tvg-url'] || header['url-tvg'] || header['tvg-url'] || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const channels = [];
  const usedKeys = new Map();
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const { attrs, name } = parseExtinf(line);
      pending = { attrs, name, group: null, headers: {} };
    } else if (line.startsWith('#EXTVLCOPT:') && pending) {
      const opt = line.slice('#EXTVLCOPT:'.length);
      const eq = opt.indexOf('=');
      if (eq > 0) {
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === 'http-user-agent' && value) pending.headers.userAgent = value;
        if ((key === 'http-referrer' || key === 'http-referer') && value) pending.headers.referrer = value;
      }
    } else if (line.startsWith('#EXTGRP:') && pending) {
      pending.group = line.slice('#EXTGRP:'.length).trim();
    } else if (line.startsWith('#')) {
      continue;
    } else if (pending) {
      const { attrs } = pending;
      const { name, geoBlocked } = cleanChannelName(pending.name || attrs['tvg-name'] || '');
      const displayName = name || attrs['tvg-name'] || attrs['tvg-id'] || 'Channel';
      const tvgId = attrs['tvg-id'] || null;
      const groups = (attrs['group-title'] || pending.group || '')
        .split(';')
        .map((g) => g.trim())
        .filter(Boolean);

      // Two entries can share a tvg-id (the same channel at 720p and 1080p) or a name.
      const baseKey = tvgId || displayName;
      const seen = usedKeys.get(baseKey) || 0;
      usedKeys.set(baseKey, seen + 1);
      const stableKey = seen ? `${baseKey} #${seen + 1}` : baseKey;

      channels.push({
        stableKey,
        tvgId,
        name: displayName,
        logo: /^https?:\/\//i.test(attrs['tvg-logo'] || '') ? attrs['tvg-logo'] : null,
        groups,
        url: line,
        geoBlocked,
        headers: pending.headers,
        country: playlistCountry(attrs['tvg-country']),
        languages: playlistLanguages(attrs['tvg-language'])
      });
      pending = null;
    }
  }

  return { guideUrls, channels };
}
