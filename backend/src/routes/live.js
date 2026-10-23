import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';
import { logoPath } from '../services/liveProxy.js';
import {
  isLiveTvEnabled, visibleChannels, nowAndNext, splitGroups, channelsChanged, pruneProgrammes,
  getPresets, presetName, presetPlaylistUrl, PRESET_RE,
  sourceJson, newSourceId, refreshSource,
  getLiveFilters, saveLiveFilters, cleanFilterList, filterOverview, filterReasons, streamHost,
  isFilteredOut, FILTER_LISTS, publicListsAcknowledged, acknowledgePublicLists
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

function channelJson(channel, nowMap, nextMap) {
  return {
    id: channel.id,
    name: channel.name,
    logo: channel.logo,
    groups: channel.groups,
    number: channel.number,
    geoBlocked: channel.geoBlocked,
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
  filtered: ''
};
const ADMIN_STATUS_AFTER = {
  visible: (row, compiled) => !isFilteredOut(row, compiled),
  filtered: (row, compiled) => isFilteredOut(row, compiled)
};

admin.get('/channels', async (req, res) => {
  try {
    const db = await getDb();
    const where = [];
    const params = [];
    if (typeof req.query.source === 'string' && req.query.source) {
      where.push(' AND c.source_id = ?');
      params.push(req.query.source);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push(" AND c.name LIKE ? ESCAPE '\\'");
      params.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    }
    const status = Object.hasOwn(ADMIN_STATUS_SQL, req.query.status) ? req.query.status : 'all';
    const filter = `${where.join('')}${ADMIN_STATUS_SQL[status]}`;
    const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(req.query.limit, 100, 1, 500);

    const { compiled } = await getLiveFilters(db);
    const toJson = (r) => ({
      id: r.id,
      sourceId: r.source_id,
      name: r.name,
      logo: logoPath(r.id, r.logo),
      groups: splitGroups(r.groups),
      country: r.country || null,
      languages: splitGroups(r.languages),
      host: streamHost(r.stream_url),
      geoBlocked: !!r.geo_blocked,
      unsupported: !!r.unsupported,
      hidden: !!r.hidden,
      kidsAllowed: !!r.kids_allowed,
      pinned: !!r.pinned,
      filteredBy: filterReasons(r, compiled)
    });

    const from = 'FROM live_channels c JOIN live_sources s ON s.id = c.source_id WHERE 1 = 1';
    const columns = `c.id, c.source_id, c.name, c.logo, c.groups, c.stream_url, c.country, c.languages,
       c.geo_blocked, c.unsupported, c.hidden, c.kids_allowed, c.pinned`;
    const order = 'ORDER BY s.created_at, s.rowid, c.position';
    const after = ADMIN_STATUS_AFTER[status];
    if (after) {
      const matching = (await db.all(`SELECT ${columns} ${from}${filter} ${order}`, params)).filter((r) => after(r, compiled));
      return res.json({ total: matching.length, channels: matching.slice(offset, offset + limit).map(toJson) });
    }
    const { total } = await db.get(`SELECT COUNT(*) AS total ${from}${filter}`, params);
    const rows = await db.all(`SELECT ${columns} ${from}${filter} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json({ total, channels: rows.map(toJson) });
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

router.get('/channels', async (req, res) => {
  try {
    const db = await getDb();
    const all = await visibleChannels(db, req.user);
    const groups = [...new Set(all.flatMap((c) => c.groups))].sort((a, b) => a.localeCompare(b));
    const { nowMap, nextMap } = await nowAndNext(db);
    const channels = filterChannels(all, req.query).map((c) => channelJson(c, nowMap, nextMap));
    res.json({ groups, channels });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/channels/:id', async (req, res) => {
  try {
    const db = await getDb();
    const channel = (await visibleChannels(db, req.user)).find((c) => c.id === req.params.id);
    if (!channel) return sendError(req, res, 'P002', { message: CHANNEL_NOT_FOUND });

    const now = Date.now();
    const { nowMap, nextMap } = await nowAndNext(db, now);
    const programmes = channel.tvgId
      ? await db.all(
        `SELECT start, stop, title, subtitle, description, category FROM live_programmes
         WHERE tvg_id = ? AND stop > ? AND start < ? ORDER BY start`,
        [channel.tvgId, now, now + 12 * HOUR_MS]
      )
      : [];
    res.json({
      channel: channelJson(channel, nowMap, nextMap),
      programmes,
      streamPath: `/api/media/live/${channel.id}/index.m3u8`
    });
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

    const matching = filterChannels(await visibleChannels(db, req.user), req.query);
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
