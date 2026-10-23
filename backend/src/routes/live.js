import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';
import { logoPath } from '../services/liveProxy.js';
import crypto from 'crypto';
import {
  isLiveTvEnabled, visibleChannels, channelIndex, nowAndNext, splitGroups, channelsChanged, pruneProgrammes,
  getPresets, presetName, presetPlaylistUrl, PRESET_RE,
  sourceJson, newSourceId, refreshSource,
  getLiveFilters, saveLiveFilters, cleanFilterList, filterOverview, filterReasons, streamHost,
  isFilteredOut, FILTER_LISTS, publicListsAcknowledged, acknowledgePublicLists,
  personalHiding, notHiddenBy, healthOverview, getHealthSettings, saveHealthSettings, checkChannelById, GUIDE_AHEAD_MS
} from '../services/liveTv.js';

// Live TV (services/liveTv.js). Viewers get the channel list and guide; playback itself is
// under /api/media/live (routes/liveMedia.js). Everything but /status answers P700 while
// Live TV is off — except the admin routes, so sources can be set up before switching it on.

const router = express.Router();
router.use(authenticateToken);

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = HOUR_MS / 2;
const CHANNEL_ID_RE = /^[a-f0-9]{32}$/;
const URL_MAX = 2048;

const CHANNEL_NOT_FOUND = 'Channel not found';
const LINEUP_NOT_FOUND = 'Line-up not found';
const FAVOURITES_MAX = 500;
const RECENT_KEEP = 10;
const LINEUP_CHANNELS_MAX = 5000;
const NUMBER_MAX = 9999;

// A list of channel ids from a request body, or null when it isn't one (up to `max`).
function channelIds(value, max) {
  if (!Array.isArray(value) || !value.length || value.length > max) return null;
  if (!value.every((id) => typeof id === 'string' && CHANNEL_ID_RE.test(id))) return null;
  return [...new Set(value)];
}

const likePattern = (q) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

function intParam(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function filterChannels(channels, { group, q }) {
  const wantGroup = typeof group === 'string' && group ? group : null;
  const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (!wantGroup && !needle) return channels;
  return channels.filter((c) =>
    (!wantGroup || c.groups.includes(wantGroup)) && (!needle || c.name.toLowerCase().includes(needle)));
}

function channelJson(channel, nowMap, nextMap, favourites) {
  return {
    id: channel.id,
    name: channel.name,
    logo: channel.logo,
    groups: channel.groups,
    number: channel.number,
    geoBlocked: channel.geoBlocked,
    favourite: favourites.has(channel.id),
    now: (channel.tvgId && nowMap.get(channel.tvgId)) || null,
    next: (channel.tvgId && nextMap.get(channel.tvgId)) || null
  };
}

// ─── Admin ──────────────────────────────────────────────────────────────────

const admin = express.Router();
admin.use(requireAdmin);

function httpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > URL_MAX) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadSource(db, id) {
  return db.get('SELECT * FROM live_sources WHERE id = ?', [id]);
}

admin.get('/presets', async (req, res) => {
  try {
    res.json(await getPresets());
  } catch (err) {
    sendError(req, res, 'P702', { err });
  }
});

admin.get('/sources', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM live_sources ORDER BY created_at, rowid');
    res.json({ sources: rows.map(sourceJson), publicListsAcknowledged: await publicListsAcknowledged(db) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// The note an admin confirms before adding the first public list.
admin.post('/acknowledge', async (req, res) => {
  try {
    const db = await getDb();
    await acknowledgePublicLists(db, req.user.id);
    logger.info('media', `Live TV: admin ${req.user.username} confirmed the note about public channels`);
    res.json({ publicListsAcknowledged: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.post('/sources', async (req, res) => {
  const body = req.body || {};
  try {
    const db = await getDb();
    const id = newSourceId();

    if (body.kind === 'iptv-org') {
      if (!await publicListsAcknowledged(db)) {
        return sendError(req, res, 'P001', { message: 'Confirm the note about public channels first' });
      }
      const preset = String(body.preset || '').toLowerCase();
      if (!PRESET_RE.test(preset)) return sendError(req, res, 'P001', { message: 'Choose a country, language or category' });
      let presets;
      try {
        presets = await getPresets();
      } catch (err) {
        return sendError(req, res, 'P702', { err });
      }
      const name = presetName(presets, preset);
      if (!name) return sendError(req, res, 'P001', { message: 'Choose a country, language or category' });
      if (await db.get("SELECT 1 FROM live_sources WHERE kind = 'iptv-org' AND preset = ?", [preset])) {
        return sendError(req, res, 'P004', { message: 'Those channels are already added' });
      }
      await db.run(
        "INSERT INTO live_sources (id, kind, name, preset, playlist_url) VALUES (?, 'iptv-org', ?, ?, ?)",
        [id, name, preset, presetPlaylistUrl(preset)]
      );
    } else if (body.kind === 'm3u') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
      if (!name) return sendError(req, res, 'P001', { message: 'Enter a name for these channels' });
      const playlistUrl = httpUrl(body.playlistUrl);
      if (!playlistUrl) return sendError(req, res, 'P001', { message: 'Enter the playlist address, starting with http:// or https://' });
      let guideUrl = null;
      if (body.guideUrl !== undefined && body.guideUrl !== null && String(body.guideUrl).trim() !== '') {
        guideUrl = httpUrl(body.guideUrl);
        if (!guideUrl) return sendError(req, res, 'P001', { message: 'The guide address must start with http:// or https://' });
      }
      if (await db.get('SELECT 1 FROM live_sources WHERE playlist_url = ?', [playlistUrl])) {
        return sendError(req, res, 'P004', { message: 'That playlist is already added' });
      }
      await db.run(
        "INSERT INTO live_sources (id, kind, name, playlist_url, guide_url) VALUES (?, 'm3u', ?, ?, ?)",
        [id, name, playlistUrl, guideUrl]
      );
    } else {
      return sendError(req, res, 'P001', { message: 'Choose what kind of channels to add' });
    }

    // Load it straight away, in the background; the admin page watches `refreshing`.
    refreshSource(id);
    const source = await loadSource(db, id);
    logger.info('media', `Live TV source "${source.name}" added by admin ${req.user.username}`);
    res.status(201).json({ source: sourceJson(source) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.patch('/sources/:id', async (req, res) => {
  const body = req.body || {};
  try {
    const db = await getDb();
    const source = await loadSource(db, req.params.id);
    if (!source) return sendError(req, res, 'P002', { message: 'Source not found' });

    const updates = [];
    const params = [];
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
      if (!name) return sendError(req, res, 'P001', { message: 'Enter a name for these channels' });
      updates.push('name = ?');
      params.push(name);
    }
    let guideChanged = false;
    if (body.guideUrl !== undefined) {
      let guideUrl = null;
      if (body.guideUrl !== null && String(body.guideUrl).trim() !== '') {
        guideUrl = httpUrl(body.guideUrl);
        if (!guideUrl) return sendError(req, res, 'P001', { message: 'The guide address must start with http:// or https://' });
      }
      guideChanged = guideUrl !== (source.guide_url || null);
      updates.push('guide_url = ?');
      params.push(guideUrl);
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return sendError(req, res, 'P001', { message: 'enabled must be true or false' });
      updates.push('enabled = ?');
      params.push(body.enabled ? 1 : 0);
    }

    if (updates.length) {
      await db.run(`UPDATE live_sources SET ${updates.join(', ')} WHERE id = ?`, [...params, source.id]);
      channelsChanged();
    }
    // A new guide address is worth fetching now rather than in up to 12 hours.
    if (guideChanged) refreshSource(source.id);
    res.json({ source: sourceJson(await loadSource(db, source.id)) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.delete('/sources/:id', async (req, res) => {
  try {
    const db = await getDb();
    const source = await loadSource(db, req.params.id);
    if (!source) return sendError(req, res, 'P002', { message: 'Source not found' });
    await db.run('DELETE FROM live_sources WHERE id = ?', [source.id]);
    await pruneProgrammes(db);
    channelsChanged();
    logger.info('media', `Live TV source "${source.name}" removed by admin ${req.user.username}`);
    res.json({ ok: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.post('/sources/:id/refresh', async (req, res) => {
  try {
    const db = await getDb();
    const source = await loadSource(db, req.params.id);
    if (!source) return sendError(req, res, 'P002', { message: 'Source not found' });
    refreshSource(source.id);
    res.status(202).json({ source: sourceJson(source) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Filters ────────────────────────────────────────────────────────────────

admin.get('/filters', async (req, res) => {
  try {
    res.json(await filterOverview(await getDb()));
  } catch (err) {
    serverError(req, res, err);
  }
});

const FILTER_LIST_INVALID = {
  hiddenGroups: 'Hidden categories must be a list of up to 5000 names',
  hiddenLanguages: 'Hidden languages must be a list of up to 5000 names',
  hiddenCountries: 'Hidden countries must be two-letter country codes',
  hiddenHosts: 'Hidden stream hosts must be host names, like example.com'
};

// Each field given replaces what's saved; the ones left out stay as they are.
admin.patch('/filters', async (req, res) => {
  const body = req.body || {};
  try {
    const db = await getDb();
    const next = { ...(await getLiveFilters(db)).filters };
    if (body.hideGeoBlocked !== undefined) {
      if (typeof body.hideGeoBlocked !== 'boolean') {
        return sendError(req, res, 'P001', { message: 'hideGeoBlocked must be true or false' });
      }
      next.hideGeoBlocked = body.hideGeoBlocked;
    }
    for (const key of FILTER_LISTS) {
      if (body[key] === undefined) continue;
      const cleaned = cleanFilterList(key, body[key]);
      if (!cleaned) return sendError(req, res, 'P001', { message: FILTER_LIST_INVALID[key] });
      next[key] = cleaned;
    }
    await saveLiveFilters(db, next);
    res.json(await filterOverview(db));
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Channel manager ────────────────────────────────────────────────────────

// Statuses SQL can pick out alone. 'visible' and 'filtered' also depend on the filters, so
// those are narrowed down after reading (still a single pass, even over 10k+ channels).
const ADMIN_STATUS_SQL = {
  all: '',
  visible: ' AND c.hidden = 0 AND c.unsupported = 0',
  hidden: ' AND c.hidden = 1',
  kids: ' AND c.kids_allowed = 1',
  unsupported: ' AND c.unsupported = 1',
  pinned: ' AND c.pinned = 1',
  offline: " AND c.health = 'offline'",
  filtered: ''
};
const ADMIN_STATUS_AFTER = {
  visible: (row, compiled) => !isFilteredOut(row, compiled),
  filtered: (row, compiled) => isFilteredOut(row, compiled)
};

const ADMIN_CHANNEL_COLUMNS = `c.id, c.source_id, c.name, c.logo, c.groups, c.stream_url, c.country, c.languages,
       c.geo_blocked, c.unsupported, c.hidden, c.kids_allowed, c.pinned, c.custom_number, c.custom_name, c.custom_logo,
       c.health, c.health_checked_at`;

// Channel manager rows (read with ADMIN_CHANNEL_COLUMNS), with the line-ups each is in.
async function adminChannelsJson(db, rows) {
  const { compiled } = await getLiveFilters(db);
  const lineupIds = new Map(rows.map((r) => [r.id, []]));
  if (rows.length) {
    const members = await db.all(
      `SELECT lc.channel_id, lc.lineup_id FROM live_lineup_channels lc JOIN live_lineups l ON l.id = lc.lineup_id
       WHERE lc.channel_id IN (SELECT value FROM json_each(?)) ORDER BY l.position, l.created_at, l.rowid`,
      [JSON.stringify(rows.map((r) => r.id))]
    );
    for (const m of members) lineupIds.get(m.channel_id)?.push(m.lineup_id);
  }
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    name: r.name,
    logo: r.custom_logo ? logoPath(r.id, r.custom_logo, { custom: true }) : logoPath(r.id, r.logo),
    groups: splitGroups(r.groups),
    country: r.country || null,
    languages: splitGroups(r.languages),
    host: streamHost(r.stream_url),
    geoBlocked: !!r.geo_blocked,
    unsupported: !!r.unsupported,
    hidden: !!r.hidden,
    kidsAllowed: !!r.kids_allowed,
    pinned: !!r.pinned,
    filteredBy: filterReasons(r, compiled),
    number: r.custom_number ?? null,
    customName: r.custom_name || null,
    customLogo: r.custom_logo || null,
    lineupIds: lineupIds.get(r.id) || [],
    health: r.health || null,
    healthCheckedAt: r.health_checked_at || null
  }));
}

admin.get('/channels', async (req, res) => {
  try {
    const db = await getDb();
    const where = [];
    const params = [];
    if (typeof req.query.source === 'string' && req.query.source) {
      where.push(' AND c.source_id = ?');
      params.push(req.query.source);
    }
    // One whole category (groups are stored ';'-joined), so a line-up can take all of it.
    if (typeof req.query.group === 'string' && req.query.group) {
      where.push(" AND instr(';' || COALESCE(c.groups, '') || ';', ';' || ? || ';') > 0");
      params.push(req.query.group.slice(0, 200));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      // The playlist's name, the admin's own, or (for a number) the admin's channel number.
      where.push(" AND (c.name LIKE ? ESCAPE '\\' OR c.custom_name LIKE ? ESCAPE '\\' OR c.custom_number = ?)");
      params.push(likePattern(q), likePattern(q), /^\d{1,4}$/.test(q) ? Number(q) : -1);
    }
    const status = Object.hasOwn(ADMIN_STATUS_SQL, req.query.status) ? req.query.status : 'all';
    // Offline channels aren't 'visible' while the dead-channel check hides them.
    const offline = status === 'visible' && (await getHealthSettings(db)).hideOffline
      ? " AND (c.health IS NULL OR c.health <> 'offline')"
      : '';
    const filter = `${where.join('')}${ADMIN_STATUS_SQL[status]}${offline}`;
    const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(req.query.limit, 100, 1, 500);

    const { compiled } = await getLiveFilters(db);
    const from = 'FROM live_channels c JOIN live_sources s ON s.id = c.source_id WHERE 1 = 1';
    const order = 'ORDER BY s.created_at, s.rowid, c.position';
    const after = ADMIN_STATUS_AFTER[status];
    let total;
    let rows;
    if (after) {
      const matching = (await db.all(`SELECT ${ADMIN_CHANNEL_COLUMNS} ${from}${filter} ${order}`, params)).filter((r) => after(r, compiled));
      total = matching.length;
      rows = matching.slice(offset, offset + limit);
    } else {
      ({ total } = await db.get(`SELECT COUNT(*) AS total ${from}${filter}`, params));
      rows = await db.all(`SELECT ${ADMIN_CHANNEL_COLUMNS} ${from}${filter} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    }
    res.json({ total, channels: await adminChannelsJson(db, rows) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.patch('/channels', async (req, res) => {
  const { ids, hidden, kidsAllowed, pinned } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every((id) => typeof id === 'string' && CHANNEL_ID_RE.test(id))) {
    return sendError(req, res, 'P001', { message: 'Choose up to 1000 channels' });
  }
  const sets = [];
  const params = [];
  if (typeof hidden === 'boolean') {
    sets.push('hidden = ?');
    params.push(hidden ? 1 : 0);
  }
  if (typeof kidsAllowed === 'boolean') {
    sets.push('kids_allowed = ?');
    params.push(kidsAllowed ? 1 : 0);
  }
  if (typeof pinned === 'boolean') {
    sets.push('pinned = ?');
    params.push(pinned ? 1 : 0);
  }
  if (!sets.length) return sendError(req, res, 'P001', { message: 'Nothing to change' });
  try {
    const db = await getDb();
    const result = await db.run(
      `UPDATE live_channels SET ${sets.join(', ')} WHERE id IN (SELECT value FROM json_each(?))`,
      [...params, JSON.stringify(ids)]
    );
    channelsChanged();
    res.json({ updated: result.changes || 0 });
  } catch (err) {
    serverError(req, res, err);
  }
});

// The admin's own number, name and logo for one channel. Each field given replaces what's
// saved; null (or an empty name / logo) clears it, back to the playlist's.
admin.patch('/channels/:id', async (req, res) => {
  const body = req.body || {};
  if (!CHANNEL_ID_RE.test(req.params.id)) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
  const sets = [];
  const params = [];
  if (body.number !== undefined) {
    const number = body.number;
    if (number !== null && !(Number.isInteger(number) && number >= 1 && number <= NUMBER_MAX)) {
      return sendError(req, res, 'P001', { message: 'Channel numbers go from 1 to 9999' });
    }
    sets.push('custom_number = ?');
    params.push(number);
  }
  if (body.name !== undefined) {
    if (body.name !== null && typeof body.name !== 'string') {
      return sendError(req, res, 'P001', { message: 'Enter a name for the channel, or leave it empty' });
    }
    sets.push('custom_name = ?');
    params.push(body.name?.trim().slice(0, 100) || null);
  }
  if (body.logo !== undefined) {
    let logo = null;
    if (body.logo !== null && !(typeof body.logo === 'string' && body.logo.trim() === '')) {
      logo = httpUrl(body.logo);
      if (!logo) return sendError(req, res, 'P001', { message: 'The logo address must start with http:// or https://' });
    }
    sets.push('custom_logo = ?');
    params.push(logo);
  }
  if (!sets.length) return sendError(req, res, 'P001', { message: 'Nothing to change' });
  try {
    const db = await getDb();
    if (!await db.get('SELECT 1 FROM live_channels WHERE id = ?', [req.params.id])) {
      return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    }
    if (Number.isInteger(body.number)
      && await db.get('SELECT 1 FROM live_channels WHERE custom_number = ? AND id <> ?', [body.number, req.params.id])) {
      return sendError(req, res, 'P004', { message: 'Another channel already has that number' });
    }
    try {
      await db.run(`UPDATE live_channels SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    } catch (err) {
      // Two admins giving out the same number at once.
      if (/UNIQUE/.test(err.message)) return sendError(req, res, 'P004', { message: 'Another channel already has that number' });
      throw err;
    }
    channelsChanged();
    const row = await db.get(
      `SELECT ${ADMIN_CHANNEL_COLUMNS} FROM live_channels c JOIN live_sources s ON s.id = c.source_id WHERE c.id = ?`,
      [req.params.id]
    );
    res.json({ channel: (await adminChannelsJson(db, [row]))[0] });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Checks one channel's stream now (see services/liveHealth.js) and records the result.
admin.post('/channels/:id/check', async (req, res) => {
  try {
    if (!CHANNEL_ID_RE.test(req.params.id)) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    const result = await checkChannelById(await getDb(), req.params.id);
    if (!result) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    res.json({ health: result.health, checkedAt: result.checkedAt, error: result.error });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Dead-channel check ─────────────────────────────────────────────────────

admin.get('/health', async (req, res) => {
  try {
    res.json(await healthOverview(await getDb()));
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.patch('/health', async (req, res) => {
  const body = req.body || {};
  const invalid = { enabled: 'enabled must be true or false', hideOffline: 'hideOffline must be true or false' };
  for (const key of Object.keys(invalid)) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return sendError(req, res, 'P001', { message: invalid[key] });
    }
  }
  try {
    const db = await getDb();
    await saveHealthSettings(db, body);
    res.json(await healthOverview(db));
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Line-ups ───────────────────────────────────────────────────────────────

const LINEUP_SELECT = `SELECT l.id, l.name, l.position, l.kids_allowed,
       (SELECT COUNT(*) FROM live_lineup_channels lc WHERE lc.lineup_id = l.id) AS channel_count
     FROM live_lineups l`;

function lineupJson(row) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    kidsAllowed: !!row.kids_allowed,
    channelCount: row.channel_count || 0
  };
}

const loadLineup = (db, id) => db.get(`${LINEUP_SELECT} WHERE l.id = ?`, [id]);

function lineupName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

admin.get('/lineups', async (req, res) => {
  try {
    const rows = await (await getDb()).all(`${LINEUP_SELECT} ORDER BY l.position, l.created_at, l.rowid`);
    res.json({ lineups: rows.map(lineupJson) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.post('/lineups', async (req, res) => {
  const name = lineupName(req.body?.name);
  if (!name) return sendError(req, res, 'P001', { message: 'Enter a name for the line-up' });
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.run(
      'INSERT INTO live_lineups (id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM live_lineups))',
      [id, name]
    );
    channelsChanged();
    res.status(201).json({ lineup: lineupJson(await loadLineup(db, id)) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Before /lineups/:id, so 'order' isn't taken for an id. Line-ups left out keep their
// order after the ones given.
admin.put('/lineups/order', async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((id) => typeof id === 'string')) {
    return sendError(req, res, 'P001', { message: 'Send the line-ups in their new order' });
  }
  try {
    const db = await getDb();
    const rows = await db.all('SELECT id FROM live_lineups ORDER BY position, created_at, rowid');
    const given = [...new Set(ids)].filter((id) => rows.some((r) => r.id === id));
    const order = [...given, ...rows.map((r) => r.id).filter((id) => !given.includes(id))];
    await db.run(
      'UPDATE live_lineups SET position = (SELECT key + 1 FROM json_each(?) WHERE value = live_lineups.id)',
      [JSON.stringify(order)]
    );
    channelsChanged();
    const after = await db.all(`${LINEUP_SELECT} ORDER BY l.position, l.created_at, l.rowid`);
    res.json({ lineups: after.map(lineupJson) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.patch('/lineups/:id', async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  if (body.name !== undefined) {
    const name = lineupName(body.name);
    if (!name) return sendError(req, res, 'P001', { message: 'Enter a name for the line-up' });
    sets.push('name = ?');
    params.push(name);
  }
  if (body.kidsAllowed !== undefined) {
    if (typeof body.kidsAllowed !== 'boolean') return sendError(req, res, 'P001', { message: 'kidsAllowed must be true or false' });
    sets.push('kids_allowed = ?');
    params.push(body.kidsAllowed ? 1 : 0);
  }
  try {
    const db = await getDb();
    if (!await loadLineup(db, req.params.id)) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    if (sets.length) {
      await db.run(`UPDATE live_lineups SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
      channelsChanged();
    }
    res.json({ lineup: lineupJson(await loadLineup(db, req.params.id)) });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.delete('/lineups/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM live_lineups WHERE id = ?', [req.params.id]);
    if (!result.changes) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    channelsChanged();
    res.json({ ok: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

admin.get('/lineups/:id/channels', async (req, res) => {
  try {
    const db = await getDb();
    if (!await loadLineup(db, req.params.id)) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    const rows = await db.all(
      `SELECT ${ADMIN_CHANNEL_COLUMNS} FROM live_lineup_channels lc
       JOIN live_channels c ON c.id = lc.channel_id JOIN live_sources s ON s.id = c.source_id
       WHERE lc.lineup_id = ? ORDER BY lc.position, lc.rowid`,
      [req.params.id]
    );
    res.json({ channels: await adminChannelsJson(db, rows) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// PUT replaces a line-up's channels (in the order given), POST adds to the end, DELETE takes
// out. Ids of channels that don't exist are skipped. Answers with the line-up.
async function editLineupChannels(req, res, mode) {
  const ids = channelIds(req.body?.ids, LINEUP_CHANNELS_MAX);
  if (!ids && !(mode === 'replace' && Array.isArray(req.body?.ids) && !req.body.ids.length)) {
    return sendError(req, res, 'P001', { message: 'Choose up to 5000 channels' });
  }
  try {
    const db = await getDb();
    const lineupId = req.params.id;
    if (!await loadLineup(db, lineupId)) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    const list = JSON.stringify(ids || []);
    // No transaction: the shared connection serves other requests in between, and each
    // statement here is whole on its own.
    if (mode === 'remove') {
      await db.run(
        'DELETE FROM live_lineup_channels WHERE lineup_id = ? AND channel_id IN (SELECT value FROM json_each(?))',
        [lineupId, list]
      );
    } else {
      if (mode === 'replace') await db.run('DELETE FROM live_lineup_channels WHERE lineup_id = ?', [lineupId]);
      await db.run(
        `INSERT OR IGNORE INTO live_lineup_channels (lineup_id, channel_id, position)
         SELECT ?, j.value, (SELECT COALESCE(MAX(position), 0) FROM live_lineup_channels WHERE lineup_id = ?) + j.key + 1
         FROM json_each(?) j JOIN live_channels c ON c.id = j.value`,
        [lineupId, lineupId, list]
      );
    }
    channelsChanged();
    res.json({ lineup: lineupJson(await loadLineup(db, lineupId)) });
  } catch (err) {
    serverError(req, res, err);
  }
}

admin.put('/lineups/:id/channels', (req, res) => editLineupChannels(req, res, 'replace'));
admin.post('/lineups/:id/channels', (req, res) => editLineupChannels(req, res, 'append'));
admin.delete('/lineups/:id/channels', (req, res) => editLineupChannels(req, res, 'remove'));

router.use('/admin', admin);

// ─── Viewers ────────────────────────────────────────────────────────────────

// Answers even while Live TV is off, so the app can decide whether to show it at all.
router.get('/status', async (req, res) => {
  try {
    const db = await getDb();
    if (!await isLiveTvEnabled(db)) return res.json({ enabled: false, channelCount: 0 });
    const channels = await visibleChannels(db, req.user);
    res.json({ enabled: true, channelCount: channels.length });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.use(async (req, res, next) => {
  try {
    if (!await isLiveTvEnabled(await getDb())) return sendError(req, res, 'P700');
    next();
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── What a viewer gets ─────────────────────────────────────────────────────

// The user's favourite channel ids, in the order they were added.
async function favouriteIds(db, userId) {
  return (await db.all('SELECT channel_id FROM live_favourites WHERE user_id = ? ORDER BY created_at, rowid', [userId]))
    .map((r) => r.channel_id);
}

// Ids → the channels this viewer may watch, in that order, each once.
function resolveChannels(index, ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const channel = index.byId.get(id);
    if (!channel || seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push(channel);
  }
  return out;
}

/**
 * Everything a viewer request starts from: the shared channel list for their audience
 * (services/liveTv.js caches it), what they hid for themselves, their favourites, and — for
 * ?lineup=<id>|favourites — the channels of that line-up or their favourites, in its own
 * order. `base` is null for a line-up this viewer has no such line-up for.
 */
async function viewerView(db, req, { selector = req.query.lineup } = {}) {
  const index = await channelIndex(db, req.user);
  const keep = notHiddenBy(personalHiding(req.user, index));
  const favourites = await favouriteIds(db, req.user.id);
  const favouriteSet = new Set(favourites.map((id) => index.byId.get(id)?.id || id));
  let base;
  if (selector === 'favourites') base = resolveChannels(index, favourites).filter(keep);
  else if (typeof selector === 'string' && selector) base = index.lineups.find((l) => l.id === selector)?.channels.filter(keep) || null;
  else base = index.channels.filter(keep);
  return { index, keep, favourites, favouriteSet, base };
}

// now / next for a few channels, reading only their programmes.
async function nowAndNextFor(db, channels) {
  return nowAndNext(db, Date.now(), new Set(channels.map((c) => c.tvgId).filter(Boolean)));
}

router.get('/channels', async (req, res) => {
  try {
    const db = await getDb();
    const { index, keep, favouriteSet, base } = await viewerView(db, req);
    if (!base) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    const groups = [...new Set(base.flatMap((c) => c.groups))].sort((a, b) => a.localeCompare(b));
    const lineups = index.lineups
      .map((l) => ({ id: l.id, name: l.name, channelCount: l.channels.filter(keep).length }))
      .filter((l) => l.channelCount > 0);
    const list = filterChannels(base, req.query);
    const { nowMap, nextMap } = list.length > 200 ? await nowAndNext(db) : await nowAndNextFor(db, list);
    const channels = list.map((c) => channelJson(c, nowMap, nextMap, favouriteSet));
    res.json({ groups, lineups, channels });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/channels/:id', async (req, res) => {
  try {
    const db = await getDb();
    const index = await channelIndex(db, req.user);
    const channel = index.byId.get(req.params.id);
    if (!channel) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });

    const now = Date.now();
    const { nowMap, nextMap } = await nowAndNext(db, now, new Set([channel.tvgId].filter(Boolean)));
    const favourite = await db.get('SELECT 1 FROM live_favourites WHERE user_id = ? AND channel_id IN (?, ?)', [req.user.id, channel.id, req.params.id]);
    const programmes = channel.tvgId
      ? await db.all(
        `SELECT start, stop, title, subtitle, description, category FROM live_programmes
         WHERE tvg_id = ? AND stop > ? AND start < ? ORDER BY start`,
        [channel.tvgId, now, now + 12 * HOUR_MS]
      )
      : [];
    res.json({
      channel: channelJson(channel, nowMap, nextMap, new Set(favourite ? [channel.id] : [])),
      programmes,
      streamPath: `/api/media/live/${channel.id}/index.m3u8`
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Recently watched: the player says so once a channel has played a little while.
router.post('/channels/:id/watched', async (req, res) => {
  try {
    const db = await getDb();
    const channel = (await channelIndex(db, req.user)).byId.get(req.params.id);
    if (!channel) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    await db.run(
      `INSERT INTO live_recent (user_id, channel_id, watched_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET watched_at = excluded.watched_at`,
      [req.user.id, channel.id, Date.now()]
    );
    await db.run(
      `DELETE FROM live_recent WHERE user_id = ? AND channel_id NOT IN (
         SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY watched_at DESC LIMIT ?)`,
      [req.user.id, req.user.id, RECENT_KEEP]
    );
    res.json({ ok: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/recent', async (req, res) => {
  try {
    const db = await getDb();
    const { index, keep, favouriteSet } = await viewerView(db, req, { selector: null });
    const ids = (await db.all(
      'SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY watched_at DESC LIMIT ?',
      [req.user.id, RECENT_KEEP]
    )).map((r) => r.channel_id);
    const list = resolveChannels(index, ids).filter(keep);
    const { nowMap, nextMap } = await nowAndNextFor(db, list);
    res.json({ channels: list.map((c) => channelJson(c, nowMap, nextMap, favouriteSet)) });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/favourites/:channelId', async (req, res) => {
  try {
    const db = await getDb();
    const channel = (await channelIndex(db, req.user)).byId.get(req.params.channelId);
    if (!channel) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    const { count } = await db.get('SELECT COUNT(*) AS count FROM live_favourites WHERE user_id = ?', [req.user.id]);
    if (count >= FAVOURITES_MAX && !await db.get('SELECT 1 FROM live_favourites WHERE user_id = ? AND channel_id = ?', [req.user.id, channel.id])) {
      return sendError(req, res, 'P001', { message: 'You can have up to 500 favourite channels' });
    }
    await db.run('INSERT OR IGNORE INTO live_favourites (user_id, channel_id) VALUES (?, ?)', [req.user.id, channel.id]);
    res.json({ favourite: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Works for a channel this viewer can't see any more too, so a stale favourite can go.
router.delete('/favourites/:channelId', async (req, res) => {
  try {
    if (!CHANNEL_ID_RE.test(req.params.channelId)) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });
    const db = await getDb();
    const canonical = (await channelIndex(db, req.user)).byId.get(req.params.channelId)?.id || req.params.channelId;
    await db.run(
      'DELETE FROM live_favourites WHERE user_id = ? AND channel_id IN (?, ?)',
      [req.user.id, req.params.channelId, canonical]
    );
    res.json({ favourite: false });
  } catch (err) {
    serverError(req, res, err);
  }
});

// The Home row: the viewer's favourites they can watch, with what's on.
router.get('/now', async (req, res) => {
  try {
    const db = await getDb();
    const limit = intParam(req.query.limit, 20, 1, 50);
    const { base, favouriteSet } = await viewerView(db, req, { selector: 'favourites' });
    const list = base.slice(0, limit);
    const { nowMap, nextMap } = await nowAndNextFor(db, list);
    res.json({ channels: list.map((c) => channelJson(c, nowMap, nextMap, favouriteSet)) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Channels by name and programmes by title, from now to the end of the guide, over the
// channels this viewer sees. Under two characters there's nothing to look for.
router.get('/search', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 2) return res.json({ channels: [], programmes: [] });
    const limit = intParam(req.query.limit, 30, 1, 100);
    const db = await getDb();
    const { base, favouriteSet } = await viewerView(db, req, { selector: null });

    const needle = q.toLowerCase();
    const channelHits = base.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, limit);

    const byTvg = new Map();
    for (const c of base) if (c.tvgId && !byTvg.has(c.tvgId)) byTvg.set(c.tvgId, c);
    const now = Date.now();
    const rows = byTvg.size
      ? await db.all(
        `SELECT tvg_id, start, stop, title, subtitle FROM live_programmes
         WHERE stop > ? AND start < ? AND (title LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\')
           AND tvg_id IN (SELECT value FROM json_each(?))
         ORDER BY start LIMIT ?`,
        [now, now + GUIDE_AHEAD_MS, likePattern(q), likePattern(q), JSON.stringify([...byTvg.keys()]), limit]
      )
      : [];
    const programmes = rows.map((p) => {
      const c = byTvg.get(p.tvg_id);
      return {
        channelId: c.id, channelName: c.name, logo: c.logo, number: c.number,
        start: p.start, stop: p.stop, title: p.title, subtitle: p.subtitle
      };
    });

    const { nowMap, nextMap } = await nowAndNextFor(db, channelHits);
    res.json({ channels: channelHits.map((c) => channelJson(c, nowMap, nextMap, favouriteSet)), programmes });
  } catch (err) {
    serverError(req, res, err);
  }
});

// What the viewer hid for themselves, by current name, for the "Hidden for me" list.
// Channels they can't get any more are left out.
router.get('/me/hidden', async (req, res) => {
  try {
    const db = await getDb();
    const index = await channelIndex(db, req.user);
    const hiding = personalHiding(req.user, index);
    const channels = resolveChannels(index, [...hiding.channels])
      .map((c) => ({ id: c.id, name: c.name, logo: c.logo, number: c.number }));
    res.json({ channels, groups: [...hiding.groups] });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/guide', async (req, res) => {
  try {
    const db = await getDb();
    const fromParam = parseInt(req.query.from, 10);
    // Without a start, the guide opens on the current half hour.
    const from = Number.isFinite(fromParam) ? fromParam : Math.floor(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS;
    const hours = intParam(req.query.hours, 4, 1, 12);
    const to = from + hours * HOUR_MS;
    const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(req.query.limit, 50, 1, 200);

    const { base } = await viewerView(db, req);
    if (!base) return sendError(req, res, 'P002', { message: LINEUP_NOT_FOUND });
    const matching = filterChannels(base, req.query);
    const page = matching.slice(offset, offset + limit);
    const tvgIds = [...new Set(page.map((c) => c.tvgId).filter(Boolean))];
    const rows = tvgIds.length
      ? await db.all(
        `SELECT tvg_id, start, stop, title, subtitle, category FROM live_programmes
         WHERE tvg_id IN (SELECT value FROM json_each(?)) AND stop > ? AND start < ?
         ORDER BY start`,
        [JSON.stringify(tvgIds), from, to]
      )
      : [];
    const byTvg = new Map();
    for (const { tvg_id: tvgId, ...programme } of rows) {
      if (!byTvg.has(tvgId)) byTvg.set(tvgId, []);
      byTvg.get(tvgId).push(programme);
    }

    res.json({
      from,
      to,
      total: matching.length,
      channels: page.map((c) => ({
        id: c.id,
        name: c.name,
        logo: c.logo,
        number: c.number,
        programmes: (c.tvgId && byTvg.get(c.tvgId)) || []
      }))
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
