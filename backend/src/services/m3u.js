// M3U channel playlists (the IPTV flavour: #EXTM3U, then #EXTINF lines carrying tvg-* and
// group-title attributes, each followed by its stream URL). Used by services/liveTv.js.
//
//   #EXTM3U x-tvg-url="https://example.com/guide.xml.gz"
//   #EXTINF:-1 tvg-id="News.us@SD" tvg-logo="https://…/logo.png" group-title="News;General",News 24 (720p) [Geo-blocked]
//   #EXTVLCOPT:http-referrer=https://example.com/
//   https://example.com/news/index.m3u8

// A playlist is whatever the address returned, so it is read within limits. A line longer
// than this is not a channel (real ones are a few hundred characters, with the odd 2 KB
// stream address) and is dropped unread; a playlist with more channels than this is cut off.
export const MAX_LINE_LENGTH = 8192;
export const MAX_CHANNELS = 100000;
// The parser hands the event loop back after this many lines, so the server keeps answering
// requests while a 20 MB playlist is read (see parseM3uAsync).
const LINES_PER_SLICE = 2000;

// Attributes as `key="value"`; some playlists leave values unquoted, which is tolerated.
// A key starts where a word starts (the lookbehind): without that, a long run of letters with
// no "=" is scanned to its end again from every letter in it, which on one hostile 80 KB
// line held the whole server for 15 seconds.
const ATTRIBUTE_RE = /(?<![\w-])([A-Za-z][\w-]*)=(?:"([^"]*)"|([^\s,"]+))/g;

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
    // "[" up to the next "]" with no "[" between, and no leading-space match: either would
    // make a run of "[" (or of spaces) cost its length squared. The space a rewritten tag is
    // given back is squeezed with the rest just below.
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

// Lines one at a time, without first cutting a 20 MB text into an array of them.
function* linesOf(text) {
  let pos = 0;
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const stop = end > pos && text[end - 1] === '\r' ? end - 1 : end;
    // An over-long line is passed on as null: counted, never copied or looked into.
    yield stop - pos > MAX_LINE_LENGTH ? null : text.slice(pos, stop);
    pos = end + 1;
  }
}

// The reading itself, one line at a time, so it can be run straight through (parseM3u) or
// in slices (parseM3uAsync).
function playlistReader() {
  const channels = [];
  const usedKeys = new Map();
  let guideUrls = [];
  let started = false; // seen the first non-blank line
  let isPlaylist = false;
  let pending = null;
  let skippedLines = 0;
  let truncated = false;

  // Returns false once there is no point reading further.
  function line(rawLine) {
    if (rawLine === null) {
      skippedLines++;
      if (!started) {
        started = true; // a playlist doesn't open with a line like that
        return false;
      }
      // Whatever it was, the address after it mustn't be given to the wrong channel.
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
 * Parses an M3U playlist. Returns null when `text` isn't one, else
 *   { guideUrls: [string], channels: [{ stableKey, tvgId, name, logo, groups, url, geoBlocked, headers,
 *     country, languages }], skippedLines, truncated }
 * `stableKey` (the tvg-id, else the name) is unique within the playlist, so a channel keeps
 * its identity — and the admin's hide / kids choices — across refreshes. `skippedLines` counts
 * lines over MAX_LINE_LENGTH; `truncated` says the playlist had more than MAX_CHANNELS.
 */
export function parseM3u(text) {
  const reader = playlistReader();
  for (const line of linesOf(withoutBom(text))) {
    if (!reader.line(line)) break;
  }
  return reader.result();
}

/**
 * parseM3u for a playlist that may be large: the same result, read a slice at a time with
 * the event loop given a turn between slices.
 */
export async function parseM3uAsync(text) {
  const reader = playlistReader();
  let count = 0;
  for (const line of linesOf(withoutBom(text))) {
    if (!reader.line(line)) break;
    if (++count % LINES_PER_SLICE === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return reader.result();
}
