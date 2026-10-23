import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { APP_VERSION } from '../config/version.js';
import { logger } from './logger.js';
import { openUpstream, readBody, decodedBody, hostOf, lanHostOf } from './safeFetch.js';
import { parseM3u, isHlsUrl, isAdultGroup } from './m3u.js';
import { parseXmltv } from './xmltv.js';
import { logoPath } from './liveProxy.js';

// Live TV: channels from M3U playlists, with programme guides from XMLTV. Off until an admin
// turns it on (Admin → Live TV). Two kinds of source:
//
//   iptv-org  a one-click preset (a country, language or category) from the public iptv-org
//             project's playlists, which are rebuilt daily
//   m3u       any playlist URL the admin pastes, optionally with its own guide URL
//
// A refresh re-reads the playlist, upserts its channels, drops the ones that are gone, then
// streams the guide in. Each source is refreshed when added and every 12 hours while Live TV
// is on; refreshes run one at a time. Playback goes through routes/liveMedia.js.

const SETTING_KEY = 'live_tv_enabled';

// Where the presets come from. Overridable only so the test suite can stand in for it.
export const IPTV_ORG_URL = (process.env.LIVE_TV_IPTV_ORG_URL || 'https://iptv-org.github.io').replace(/\/+$/, '');
export const USER_AGENT = `Plinthio/${APP_VERSION}`;

const PLAYLIST_MAX_BYTES = 20 * 1024 * 1024;
const GUIDE_MAX_BYTES = 300 * 1024 * 1024; // unzipped; a large country's guide is ~50 MB
const PRESETS_MAX_BYTES = 5 * 1024 * 1024;
const PRESETS_TTL_MS = 24 * 60 * 60 * 1000;

const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;
const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
export const GUIDE_BEHIND_MS = 2 * 60 * 60 * 1000;
export const GUIDE_AHEAD_MS = 36 * 60 * 60 * 1000;
const WRITE_BATCH = 500;

// ─── The switch ─────────────────────────────────────────────────────────────

export async function isLiveTvEnabled(db) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [SETTING_KEY]);
  return row?.value === 'true';
}

export async function saveLiveTvEnabled(db, enabled) {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [SETTING_KEY, enabled ? 'true' : 'false']
  );
  // Sources that went stale while it was off catch up straight away.
  if (enabled) kickLiveTv();
}

// ─── iptv-org presets ───────────────────────────────────────────────────────

export const PRESET_RE = /^(countries|languages|categories)\/([a-z0-9_-]{1,32})$/;
const ADULT_CATEGORY = 'xxx';

let presetsCache = null; // { at, value }
let presetsLoading = null;

async function fetchJson(url) {
  const { res } = await openUpstream(url, {
    allowPrivateHosts: iptvOrgTestHosts(),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    timeoutMs: 20000
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`${url} answered HTTP ${res.statusCode}`);
  }
  return JSON.parse((await readBody(res, PRESETS_MAX_BYTES)).toString('utf8'));
}

const byName = (a, b) => a.name.localeCompare(b.name);
const list = (value) => (Array.isArray(value) ? value : []);

async function loadPresets() {
  const [countries, languages, categories] = await Promise.all([
    fetchJson(`${IPTV_ORG_URL}/api/countries.json`),
    fetchJson(`${IPTV_ORG_URL}/api/languages.json`),
    fetchJson(`${IPTV_ORG_URL}/api/categories.json`)
  ]);
  // Codes come back lower-case: they're used as-is in the preset ('countries/us').
  return {
    countries: list(countries)
      .filter((c) => c?.code && c?.name)
      .map((c) => ({ code: String(c.code).toLowerCase(), name: String(c.name), flag: c.flag ? String(c.flag) : '' }))
      .sort(byName),
    languages: list(languages)
      .filter((l) => l?.code && l?.name)
      .map((l) => ({ code: String(l.code).toLowerCase(), name: String(l.name) }))
      .sort(byName),
    categories: list(categories)
      .filter((c) => c?.id && c?.name && String(c.id).toLowerCase() !== ADULT_CATEGORY)
      .map((c) => ({ id: String(c.id).toLowerCase(), name: String(c.name) }))
      .sort(byName)
  };
}

/** The preset lists, cached for a day (and shared by callers arriving while they load). */
export async function getPresets() {
  if (presetsCache && Date.now() - presetsCache.at < PRESETS_TTL_MS) return presetsCache.value;
  if (!presetsLoading) {
    presetsLoading = loadPresets()
      .then((value) => {
        presetsCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => { presetsLoading = null; });
  }
  return presetsLoading;
}

/** A preset's display name ('countries/us' → 'United States'), or null if there's no such preset. */
export function presetName(presets, preset) {
  const m = String(preset || '').match(PRESET_RE);
  if (!m) return null;
  const [, kind, code] = m;
  if (kind === 'categories') {
    if (code === ADULT_CATEGORY) return null;
    return presets.categories.find((c) => c.id === code)?.name || null;
  }
  return presets[kind].find((p) => p.code === code)?.name || null;
}

export function presetPlaylistUrl(preset) {
  return `${IPTV_ORG_URL}/iptv/${preset}.m3u`;
}

// ─── Channel lists ──────────────────────────────────────────────────────────

export function isKidsUser(user) {
  return user?.kids_mode === 1 || user?.kids_mode === true;
}

// What a viewer may watch is read on every channel list, guide page and stream request, and
// only changes on a refresh or an admin edit — so it's cached per audience until one happens.
let channelsVersion = 0;
const listCache = new Map();

export function channelsChanged() {
  channelsVersion++;
  listCache.clear();
}

export const splitGroups = (value) => (value ? String(value).split(';').filter(Boolean) : []);

/**
 * The channels `user` may watch, in order, each numbered 1…n: enabled sources (oldest first,
 * then playlist order), without hidden or unplayable channels, and for a kids account only
 * those allowed for kids. A channel two sources both carry (a country preset and a language
 * preset overlap a lot) is listed once.
 */
export async function visibleChannels(db, user) {
  const audience = isKidsUser(user) ? 'kids' : 'all';
  const cached = listCache.get(audience);
  if (cached) return cached;

  const version = channelsVersion;
  const rows = await db.all(
    `SELECT c.id, c.tvg_id, c.name, c.logo, c.groups, c.stream_url, c.geo_blocked
     FROM live_channels c JOIN live_sources s ON s.id = c.source_id
     WHERE s.enabled = 1 AND c.hidden = 0 AND c.unsupported = 0${audience === 'kids' ? ' AND c.kids_allowed = 1' : ''}
     ORDER BY s.created_at, s.rowid, c.position`
  );
  const seen = new Set();
  const channels = [];
  for (const row of rows) {
    if (seen.has(row.stream_url)) continue;
    seen.add(row.stream_url);
    channels.push({
      id: row.id,
      tvgId: row.tvg_id,
      name: row.name,
      logo: logoPath(row.id, row.logo),
      groups: splitGroups(row.groups),
      number: channels.length + 1,
      geoBlocked: !!row.geo_blocked
    });
  }
  if (version === channelsVersion) listCache.set(audience, channels);
  return channels;
}

/**
 * What's on now and next for every channel with a guide, as two Maps keyed by tvg id.
 * Bounded by the start index: nothing runs for more than 12 hours, and "next" only looks 12
 * hours ahead.
 */
export async function nowAndNext(db, now = Date.now()) {
  const span = 12 * 60 * 60 * 1000;
  const current = await db.all(
    'SELECT tvg_id, title, subtitle, start, stop FROM live_programmes WHERE start > ? AND start <= ? AND stop > ?',
    [now - span, now, now]
  );
  const upcoming = await db.all(
    `SELECT p.tvg_id, p.title, p.start, p.stop FROM live_programmes p
     JOIN (SELECT tvg_id, MIN(start) AS start FROM live_programmes WHERE start > ? AND start <= ? GROUP BY tvg_id) n
       ON n.tvg_id = p.tvg_id AND n.start = p.start`,
    [now, now + span]
  );
  const nowMap = new Map(current.map((p) => [p.tvg_id, { title: p.title, subtitle: p.subtitle, start: p.start, stop: p.stop }]));
  const nextMap = new Map(upcoming.map((p) => [p.tvg_id, { title: p.title, start: p.start, stop: p.stop }]));
  return { nowMap, nextMap };
}

// ─── Sources ────────────────────────────────────────────────────────────────

const refreshing = new Set();
const lastFailure = new Map();
let queue = Promise.resolve();

export function isRefreshing(sourceId) {
  return refreshing.has(sourceId);
}

export function sourceJson(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    preset: row.preset || null,
    playlistUrl: row.playlist_url,
    guideUrl: row.guide_url || null,
    enabled: !!row.enabled,
    lastRefreshedAt: row.last_refreshed_at || null,
    lastError: row.last_error || null,
    channelCount: row.channel_count || 0,
    refreshing: refreshing.has(row.id)
  };
}

export function newSourceId() {
  return crypto.randomUUID();
}

// Hosts a source's own fetches may reach on the local network. An admin's own playlist (and
// the guide they gave for it) can live on a LAN box; a public preset never can.
// iptv-org itself is public; only the test suite's stand-in (LIVE_TV_IPTV_ORG_URL) is local.
function iptvOrgTestHosts() {
  return process.env.LIVE_TV_IPTV_ORG_URL ? [hostOf(IPTV_ORG_URL)] : [];
}

function sourcePrivateHosts(source) {
  return source.kind === 'm3u'
    ? [lanHostOf(source.playlist_url), lanHostOf(source.guide_url)]
    : iptvOrgTestHosts();
}

/** The private host a channel's stream may use: its own LAN host, and only for an admin's own playlist. */
export function channelPrivateHost(channel) {
  return channel.source_kind === 'm3u' ? lanHostOf(channel.stream_url) : null;
}

/**
 * Queues a refresh of one source (they run one at a time). Returns false if that source is
 * already queued or refreshing. Never rejects; failures land in the source's last_error.
 */
export function refreshSource(sourceId) {
  if (refreshing.has(sourceId)) return false;
  refreshing.add(sourceId);
  queue = queue
    .then(() => runRefresh(sourceId))
    .catch((err) => logger.warn('media', `Live TV refresh crashed: ${err.message}`))
    .finally(() => refreshing.delete(sourceId));
  return true;
}

// Refreshes write thousands of rows in batches. They do it on a connection of their own, so
// a batch's transaction never swallows (or collides with) a request's writes on the shared one.
let writerPromise = null;
function writer() {
  if (!writerPromise) {
    writerPromise = (async () => {
      await getDb(); // schema in place first
      const db = await open({ filename: config.dbPath, driver: sqlite3.Database });
      await db.run('PRAGMA foreign_keys = ON');
      await db.run('PRAGMA busy_timeout = 10000');
      return db;
    })().catch((err) => {
      writerPromise = null;
      throw err;
    });
  }
  return writerPromise;
}

async function inTransaction(db, fn) {
  await db.run('BEGIN IMMEDIATE');
  try {
    await fn();
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function runRefresh(sourceId) {
  const db = await getDb();
  const source = await db.get('SELECT * FROM live_sources WHERE id = ?', [sourceId]);
  if (!source) return;
  const w = await writer();
  const stamp = new Date().toISOString();

  try {
    const playlist = await loadPlaylist(source);
    const count = await saveChannels(w, source, playlist.channels, stamp);
    channelsChanged();

    let guideError = null;
    const guideUrl = source.guide_url || playlist.guideUrls[0] || null;
    if (guideUrl && count) {
      try {
        const programmes = await importGuide(w, source, guideUrl);
        logger.info('media', `Live TV: "${source.name}" refreshed, ${count} channels, ${programmes} programmes`);
      } catch (err) {
        guideError = `The guide could not be loaded: ${err.message}`;
        logger.warn('media', `Live TV: guide for "${source.name}" failed: ${err.message}`);
      }
    }

    await w.run(
      'UPDATE live_sources SET last_refreshed_at = ?, last_error = ?, channel_count = ? WHERE id = ?',
      [stamp, guideError, count, sourceId]
    );
    lastFailure.delete(sourceId);
  } catch (err) {
    lastFailure.set(sourceId, Date.now());
    await w.run('UPDATE live_sources SET last_error = ? WHERE id = ?', [err.message, sourceId]).catch(() => {});
    logger.warn('media', `Live TV: could not refresh "${source.name}": ${err.message}`);
  }

  // Removed while it was loading (the download can take a while): drop what this run wrote.
  if (!await w.get('SELECT 1 FROM live_sources WHERE id = ?', [sourceId])) {
    await w.run('DELETE FROM live_channels WHERE source_id = ?', [sourceId]);
    await pruneProgrammes(w);
    channelsChanged();
  }
}

async function loadPlaylist(source) {
  const { res, url } = await openUpstream(source.playlist_url, {
    allowPrivateHosts: sourcePrivateHosts(source),
    headers: { 'user-agent': USER_AGENT },
    timeoutMs: 30000
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`The playlist could not be downloaded (HTTP ${res.statusCode})`);
  }
  const body = await readBody(res, PLAYLIST_MAX_BYTES);
  const parsed = parseM3u(body.toString('utf8'));
  if (!parsed) throw new Error('That address did not return an M3U playlist');

  const channels = [];
  for (const channel of parsed.channels) {
    if (source.kind === 'iptv-org' && isAdultGroup(channel.groups)) continue;
    try {
      channel.url = new URL(channel.url, url).toString();
    } catch {
      continue;
    }
    channels.push(channel);
  }
  // A relative guide address is relative to the playlist, like its streams.
  const guideUrls = parsed.guideUrls.map((g) => new URL(g, url).toString());
  return { channels, guideUrls };
}

// Upserts on (source_id, stable_key), which keeps hidden / kids_allowed; whatever this
// refresh didn't touch has left the playlist and goes.
async function saveChannels(w, source, channels, stamp) {
  const insert = await w.prepare(
    `INSERT INTO live_channels (id, source_id, stable_key, tvg_id, name, logo, groups, stream_url, http_headers,
       geo_blocked, unsupported, position, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, stable_key) DO UPDATE SET
       tvg_id = excluded.tvg_id, name = excluded.name, logo = excluded.logo, groups = excluded.groups,
       stream_url = excluded.stream_url, http_headers = excluded.http_headers, geo_blocked = excluded.geo_blocked,
       unsupported = excluded.unsupported, position = excluded.position, updated_at = excluded.updated_at`
  );
  try {
    for (let i = 0; i < channels.length; i += WRITE_BATCH) {
      await inTransaction(w, async () => {
        for (const [offset, ch] of channels.slice(i, i + WRITE_BATCH).entries()) {
          const id = crypto.createHash('md5').update(`${source.id}\n${ch.stableKey}`).digest('hex');
          const headers = ch.headers.userAgent || ch.headers.referrer ? JSON.stringify(ch.headers) : null;
          await insert.run([
            id, source.id, ch.stableKey, ch.tvgId, ch.name, ch.logo, ch.groups.join(';'), ch.url, headers,
            ch.geoBlocked ? 1 : 0, isHlsUrl(ch.url) ? 0 : 1, i + offset + 1, stamp
          ]);
        }
      });
    }
  } finally {
    await insert.finalize();
  }
  await w.run('DELETE FROM live_channels WHERE source_id = ? AND (updated_at IS NULL OR updated_at <> ?)', [source.id, stamp]);
  await pruneProgrammes(w);
  return channels.length;
}

/** Drops guide entries that have ended, and those for channels no source carries any more. */
export async function pruneProgrammes(db, now = Date.now()) {
  await db.run('DELETE FROM live_programmes WHERE stop < ?', [now - GUIDE_BEHIND_MS]);
  await db.run('DELETE FROM live_programmes WHERE tvg_id NOT IN (SELECT tvg_id FROM live_channels WHERE tvg_id IS NOT NULL)');
}

/**
 * Which of a source's channels a guide channel id feeds. Exact ids first; public guides often
 * list a channel without the "@feed" suffix playlists use ("News.us" for "News.us@SD"), so a
 * bare id also feeds its suffixed channels, unless the guide lists that exact feed too.
 */
export function guideTargets(tvgIds, guideHasChannel) {
  const exact = new Set(tvgIds);
  const byBase = new Map();
  for (const id of tvgIds) {
    const base = id.split('@')[0];
    if (base === id) continue;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(id);
  }
  const memo = new Map();
  return (guideId) => {
    if (memo.has(guideId)) return memo.get(guideId);
    const out = [];
    if (exact.has(guideId)) out.push(guideId);
    for (const id of byBase.get(guideId) || []) {
      if (!guideHasChannel(id)) out.push(id);
    }
    if (!out.length && guideId.includes('@')) {
      const base = guideId.split('@')[0];
      if (exact.has(base) && !guideHasChannel(base)) out.push(base);
    }
    memo.set(guideId, out);
    return out;
  };
}

async function importGuide(w, source, guideUrl) {
  const tvgIds = (await w.all(
    'SELECT DISTINCT tvg_id FROM live_channels WHERE source_id = ? AND tvg_id IS NOT NULL',
    [source.id]
  )).map((r) => r.tvg_id);
  if (!tvgIds.length) return 0;

  const { res } = await openUpstream(guideUrl, {
    allowPrivateHosts: sourcePrivateHosts(source),
    headers: { 'user-agent': USER_AGENT },
    timeoutMs: 60000
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode}`);
  }
  const body = await decodedBody(res, GUIDE_MAX_BYTES);

  const now = Date.now();
  const guideChannels = new Set();
  const targets = guideTargets(tvgIds, (id) => guideChannels.has(id));
  const cleared = new Set();
  const insert = await w.prepare(
    `INSERT OR REPLACE INTO live_programmes (tvg_id, start, stop, title, subtitle, description, category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  try {
    return await parseXmltv(body, {
      from: now - GUIDE_BEHIND_MS,
      to: now + GUIDE_AHEAD_MS,
      onChannel: (id) => guideChannels.add(id),
      targets,
      onBatch: (programmes) => inTransaction(w, async () => {
        for (const p of programmes) {
          // A channel's old schedule goes once the new one starts arriving.
          if (!cleared.has(p.tvgId)) {
            cleared.add(p.tvgId);
            await w.run('DELETE FROM live_programmes WHERE tvg_id = ?', [p.tvgId]);
          }
          await insert.run([p.tvgId, p.start, p.stop, p.title, p.subtitle, p.description, p.category]);
        }
      })
    });
  } finally {
    await insert.finalize();
  }
}

// ─── Schedule ───────────────────────────────────────────────────────────────

export function isRefreshDue(lastRefreshedAt, lastFailureMs, now = Date.now()) {
  if (lastFailureMs && now - lastFailureMs < RETRY_FAILED_AFTER_MS) return false;
  const last = lastRefreshedAt ? Date.parse(lastRefreshedAt) : NaN;
  return !Number.isFinite(last) || now - last >= REFRESH_EVERY_MS;
}

async function tick() {
  try {
    const db = await getDb();
    if (!await isLiveTvEnabled(db)) return;
    await pruneProgrammes(db);
    const sources = await db.all('SELECT id, last_refreshed_at FROM live_sources WHERE enabled = 1');
    for (const source of sources) {
      if (isRefreshDue(source.last_refreshed_at, lastFailure.get(source.id))) refreshSource(source.id);
    }
  } catch (err) {
    logger.warn('media', `Live TV schedule tick failed: ${err.message}`);
  }
}

/** Runs a schedule pass now (after Live TV is switched on). */
export function kickLiveTv() {
  tick();
}

let started = false;

// Like the library auto-scan (services/autoScan.js): a periodic tick that refreshes whatever
// is due, so a refresh missed while the server was down is made up on the next pass.
export function initLiveTv() {
  if (started) return;
  started = true;
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
}
