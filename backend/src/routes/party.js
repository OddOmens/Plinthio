import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { isItemHiddenForUser } from '../services/visibility.js';
import { outsideAccessProblem } from '../services/network.js';
import { handle, serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';
import {
  MAX_PARTIES, createParty, getParty, partyCount, addConnection, removeConnection, isFull,
  canControl, snapshot, applyAction, setBuffering, changeItem, setControlMode, addChat, endParty
} from '../services/party.js';
import { getSetting, setSetting } from '../services/settings.js';
import { ITEM_ID_RE } from '../utils/ids.js';

// Watch parties (see services/party.js). Off unless an admin turns them on.
const PARTY_SETTING_KEY = 'party_mode_enabled';
const PARTY_TYPES = new Set(['movie', 'show', 'anime']);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEEPALIVE_MS = 20000;

export async function isPartyModeEnabled(db) {
  return (await getSetting(db, PARTY_SETTING_KEY)) === 'true';
}

export async function savePartyModeEnabled(db, enabled) {
  await setSetting(db, PARTY_SETTING_KEY, enabled ? 'true' : 'false');
}

const router = express.Router();
router.use(authenticateToken);

router.use(async (req, res, next) => {
  try {
    if (!await isPartyModeEnabled(await getDb())) return sendError(req, res, 'P600');
    next();
  } catch (err) {
    serverError(req, res, err);
  }
});

// The party in :code, or a P601 response.
router.param('code', (req, res, next, code) => {
  const party = getParty(code);
  if (!party) return sendError(req, res, 'P601');
  req.party = party;
  next();
});

// The account as it is now, in the shape authenticateToken gives req.user, or null if it's
// gone. A party outlives the request that joined it, so later checks read the row again
// rather than trusting what the account was when it joined.
async function currentUser(db, userId) {
  const user = await db.get(`SELECT id, username, role, preferences, expires_at, token_version, max_age_rating,
      allow_unrated, kids_mode, remote_access, (totp_enabled_at IS NOT NULL) AS two_factor FROM users WHERE id = ?`, [userId]);
  if (!user) return null;
  try {
    user.preferences = user.preferences ? JSON.parse(user.preferences) : {};
  } catch {
    user.preferences = {};
  }
  return user;
}

// Whether a party connection may stay open: the sign-in it opened with still works (account
// there and not expired; same token_version for a session, the same key still there for an
// API key), the network rules still let it in, and it may still see what the party watches.
function connectionCheck(req) {
  const keyId = req.isApiKey ? req.apiKeyId : null;
  const tokenVersion = req.isApiKey ? null : (req.user.token_version || 0);
  const userId = req.user.id;
  return async (party) => {
    const db = await getDb();
    const user = await currentUser(db, userId);
    if (!user) return false;
    if (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) return false;
    if (keyId) {
      if (!await db.get('SELECT 1 FROM api_keys WHERE id = ? AND user_id = ?', [keyId, userId])) return false;
    } else if ((user.token_version || 0) !== tokenVersion) {
      return false;
    }
    if (await outsideAccessProblem(req, user, { session: !keyId })) return false;
    return !await isItemHiddenForUser(db, party.itemId, user);
  };
}

async function loadWatchable(db, itemId, user) {
  if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) return null;
  const item = await db.get('SELECT id, media_type, extra_type FROM items WHERE id = ?', [itemId]);
  if (!item || !PARTY_TYPES.has(item.media_type)) return null;
  if (await isItemHiddenForUser(db, itemId, user)) return null;
  return item;
}

// Start a party on a movie or episode. The creator hosts.
router.post('/', handle(async (req, res) => {
  const db = await getDb();
  const item = await loadWatchable(db, req.body?.itemId, req.user);
  if (!item) return res.status(400).json({ error: 'Pick a movie or episode to watch together' });
  if (partyCount() >= MAX_PARTIES) return sendError(req, res, 'P605');
  const party = createParty({ host: req.user, item });
  logger.info('media', `${req.user.username} started watch party ${party.code}`);
  res.status(201).json({ party: snapshot(party) });
}));

router.get('/:code', handle(async (req, res) => {
  const db = await getDb();
  if (await isItemHiddenForUser(db, req.party.itemId, req.user)) return sendError(req, res, 'P603');
  res.json({ party: snapshot(req.party) });
}));

// The live connection: Server-Sent Events. Being connected is being in the party. The
// first event is a full snapshot; after that, changes (state, presence, item, chat, ended).
router.get('/:code/events', async (req, res) => {
  const clientId = String(req.query.clientId || '');
  if (!CLIENT_ID_RE.test(clientId)) return res.status(400).json({ error: 'A clientId is required' });
  const party = req.party;
  try {
    const db = await getDb();
    if (await isItemHiddenForUser(db, party.itemId, req.user)) return sendError(req, res, 'P603');
    if (!party.members.has(req.user.id) && isFull(party)) return sendError(req, res, 'P605');
  } catch (err) {
    return serverError(req, res, err);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform keeps the compression middleware from buffering the stream; the
    // X-Accel header does the same for an nginx reverse proxy in front of the server.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let open = true;
  const send = (payload) => {
    if (!open) return;
    if (payload === null) {
      open = false;
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  addConnection(party, req.user, clientId, send, connectionCheck(req));
  send({ type: 'snapshot', party: snapshot(party), you: { userId: req.user.id, clientId } });

  const keepalive = setInterval(() => open && res.write(': keepalive\n\n'), KEEPALIVE_MS);
  req.on('close', () => {
    open = false;
    clearInterval(keepalive);
    removeConnection(party, req.user.id, clientId);
  });
});

function requireMember(req, res) {
  if (!req.party.members.has(req.user.id)) {
    res.status(409).json({ error: 'Join the party first' });
    return false;
  }
  return true;
}

// play / pause / seek, and the host's heartbeat.
router.post('/:code/action', (req, res) => {
  if (!requireMember(req, res)) return;
  const { action, position, clientId } = req.body || {};
  if (!['play', 'pause', 'seek', 'heartbeat'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
  const party = req.party;
  if (action === 'heartbeat' ? party.hostId !== req.user.id : !canControl(party, req.user.id)) {
    return sendError(req, res, 'P602');
  }
  applyAction(party, action, Number(position), typeof clientId === 'string' ? clientId : null);
  res.json({ ok: true });
});

router.post('/:code/buffering', (req, res) => {
  if (!requireMember(req, res)) return;
  setBuffering(req.party, req.user.id, !!req.body?.buffering);
  res.json({ ok: true });
});

// Watch something else — the next episode, or the host's pick — only if everyone there
// is allowed to see it.
router.post('/:code/item', async (req, res) => {
  if (!requireMember(req, res)) return;
  const party = req.party;
  if (!canControl(party, req.user.id)) return sendError(req, res, 'P602');
  try {
    const db = await getDb();
    const item = await loadWatchable(db, req.body?.itemId, req.user);
    if (!item) return res.status(400).json({ error: 'Pick a movie or episode to watch together' });
    // Each member as the account is now: a limit or Kids Mode turned on since they joined counts.
    for (const member of [...party.members.values()]) {
      const user = await currentUser(db, member.userId);
      if (!user || await isItemHiddenForUser(db, item.id, user)) return sendError(req, res, 'P604');
    }
    changeItem(party, item.id, { autoplay: !!req.body?.autoplay });
    res.json({ ok: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/:code/settings', (req, res) => {
  if (!requireMember(req, res)) return;
  if (req.party.hostId !== req.user.id) return sendError(req, res, 'P602');
  const { controlMode } = req.body || {};
  if (!['host', 'everyone'].includes(controlMode)) return res.status(400).json({ error: 'controlMode must be host or everyone' });
  setControlMode(req.party, controlMode);
  res.json({ ok: true });
});

router.post('/:code/chat', (req, res) => {
  if (!requireMember(req, res)) return;
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Say something' });
  addChat(req.party, req.user, text);
  res.json({ ok: true });
});

// The host ends the party for everyone.
router.delete('/:code', (req, res) => {
  if (req.party.hostId !== req.user.id) return sendError(req, res, 'P602');
  endParty(req.party);
  logger.info('media', `${req.user.username} ended watch party ${req.party.code}`);
  res.json({ ok: true });
});

export default router;
