// IPTV M3U playlist parser:
//
//   #EXTM3U x-tvg-url="https://example.com/guide.xml.gz"
//   #EXTINF:-1 tvg-id="News.us@SD" tvg-logo="https://…/logo.png" group-title="News;General",News 24 (720p) [Geo-blocked]
//   #EXTVLCOPT:http-referrer=https://example.com/
//   https://example.com/news/index.m3u8

// Limits for untrusted input: longer lines are dropped unread; extra channels are cut off.
export const MAX_LINE_LENGTH = 8192;
export const MAX_CHANNELS = 100000;
// Lines per slice before yielding to the event loop (parseM3uAsync).
const LINES_PER_SLICE = 2000;

// `key="value"`, unquoted values tolerated. The lookbehind anchors keys at word starts to
// avoid quadratic backtracking on long runs of letters.
const ATTRIBUTE_RE = /(?<![\w-])([A-Za-z][\w-]*)=(?:"([^"]*)"|([^\s,"]+))/g;

function parseAttributes(text) {
  const attrs = {};
  for (const m of text.matchAll(ATTRIBUTE_RE)) {
    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  return attrs;
}

// The display name follows the first comma outside quotes.
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

// "[Geo-blocked]" / "[Not 24/7]" name tags (possibly combined with ";") are stripped; geo becomes a flag.
const TAG_GEO = /^geo-?blocked$/i;
const TAG_DROP = /^(geo-?blocked|not 24\/7)$/i;

export function cleanChannelName(raw) {
  let geoBlocked = false;
  const name = String(raw || '')
    // No nested "[" and no leading-space match, to keep this linear.
    .replace(/\[([^[\]]*)\]/g, (whole, inner) => {
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

/** Only HLS over http(s) is playable. */
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

/** Adult groups, excluded from public presets. */
export function isAdultGroup(groups) {
  return groups.some((g) => /xxx|adult/i.test(g));
}

// tvg-country: first two-letter code only. tvg-language: all, lower-cased.
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

// Yields lines without splitting the whole text into an array.
function* linesOf(text) {
  let pos = 0;
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const stop = end > pos && text[end - 1] === '\r' ? end - 1 : end;
    // Over-long lines become null: counted, never copied.
    yield stop - pos > MAX_LINE_LENGTH ? null : text.slice(pos, stop);
    pos = end + 1;
  }
}

// Line-at-a-time reader shared by parseM3u and parseM3uAsync.
function playlistReader() {
  const channels = [];
  const usedKeys = new Map();
  let guideUrls = [];
  let started = false; // seen the first non-blank line
  let isPlaylist = false;
  let pending = null;
  let skippedLines = 0;
  let truncated = false;

  // Returns false to stop reading.
  function line(rawLine) {
    if (rawLine === null) {
      skippedLines++;
      if (!started) {
        started = true; // a playlist doesn't open with a line like that
        return false;
      }
      // Don't attach the next URL to the wrong channel.
      pending = null;
      return true;
    }
    const text = rawLine.trim();
    if (!text) return true;
    if (!started) {
      started = true;
      if (!text.startsWith('#EXTM3U')) return false;
      isPlaylist = true;
      const header = parseAttributes(text.slice('#EXTM3U'.length));
      guideUrls = (header['x-tvg-url'] || header['url-tvg'] || header['tvg-url'] || '')
        .split(',')
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u));
      return true;
    }
    if (text.startsWith('#EXTINF')) {
      const { attrs, name } = parseExtinf(text);
      pending = { attrs, name, group: null, headers: {} };
    } else if (text.startsWith('#EXTVLCOPT:') && pending) {
      const opt = text.slice('#EXTVLCOPT:'.length);
      const eq = opt.indexOf('=');
      if (eq > 0) {
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === 'http-user-agent' && value) pending.headers.userAgent = value;
        if ((key === 'http-referrer' || key === 'http-referer') && value) pending.headers.referrer = value;
      }
    } else if (text.startsWith('#EXTGRP:') && pending) {
      pending.group = text.slice('#EXTGRP:'.length).trim();
    } else if (text.startsWith('#')) {
      return true;
    } else if (pending) {
      if (channels.length >= MAX_CHANNELS) {
        truncated = true;
        return false;
      }
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
        url: text,
        geoBlocked,
        headers: pending.headers,
        country: playlistCountry(attrs['tvg-country']),
        languages: playlistLanguages(attrs['tvg-language'])
      });
      pending = null;
    }
    return true;
  }

  return {
    line,
    result: () => (isPlaylist ? { guideUrls, channels, skippedLines, truncated } : null)
  };
}

const withoutBom = (text) => String(text || '').replace(/^﻿/, '');

/**
 * Returns null when `text` isn't an M3U playlist, else { guideUrls, channels, skippedLines, truncated }.
 * `stableKey` (tvg-id, else name; unique per playlist) keeps a channel's identity across refreshes.
 */
export function parseM3u(text) {
  const reader = playlistReader();
  for (const line of linesOf(withoutBom(text))) {
    if (!reader.line(line)) break;
  }
  return reader.result();
}

/** parseM3u that yields to the event loop between slices. */
export async function parseM3uAsync(text) {
  const reader = playlistReader();
  let count = 0;
  for (const line of linesOf(withoutBom(text))) {
    if (!reader.line(line)) break;
    if (++count % LINES_PER_SLICE === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return reader.result();
}
