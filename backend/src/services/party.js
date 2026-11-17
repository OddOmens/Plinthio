import crypto from 'crypto';

// ─── Watch parties ───────────────────────────────────────────────────────────
// Each viewer streams normally; a party only shares playback state and presence. In memory
// only: a restart ending parties is acceptable.
// State is { playing, position, at }: while playing, live position = position + (now − at) / 1000,
// so clients only need changes, not a stream of updates.

export const MAX_PARTIES = 20;
export const MAX_MEMBERS = 20;
// Someone stuck buffering longer than this stops holding everyone else up.
const BUFFER_HOLD_LIMIT_MS = 15000;
// How often each live connection's account is checked again (see recheckConnections).
const RECHECK_MS = 30000;
// Empty parties survive this long so a refresh or dropped connection can rejoin.
const EMPTY_PARTY_GRACE_MS = 60000;
const CHAT_HISTORY = 50;
// No 0/O or 1/I/L: codes get read out loud and typed.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const parties = new Map();

function newCode() {
  for (;;) {
    let code = '';
    for (const byte of crypto.randomBytes(6)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (!parties.has(code)) return code;
  }
}

export function livePosition(state, now = Date.now()) {
  return state.playing ? state.position + (now - state.at) / 1000 : state.position;
}

export function getParty(code) {
  return parties.get(String(code || '').toUpperCase()) || null;
}

export function partyCount() {
  return parties.size;
}

export function createParty({ host, item }) {
  const code = newCode();
  const party = {
    code,
    hostId: host.id,
    itemId: item.id,
    // 'host': only the host plays, pauses and seeks. 'everyone': anyone in the party can.
    controlMode: 'host',
    state: { playing: false, position: 0, at: Date.now() },
    // Held: paused by the server while someone buffers, resumed when they catch up.
    held: false,
    members: new Map(),
    chat: [],
    createdAt: Date.now(),
    emptySince: Date.now()
  };
  parties.set(code, party);
  return party;
}

// ─── Membership and live connections ─────────────────────────────────────────
// A member stays while any of their connections (tabs) is open.
// `check`: optional async (party) => boolean, whether the connection's sign-in and access are
// still valid; re-run periodically by recheckConnections.
export function addConnection(party, user, clientId, send, check = null) {
  let member = party.members.get(user.id);
  if (!member) {
    member = { userId: user.id, name: user.username, user, joinedAt: Date.now(), connections: new Map(), checks: new Map(), bufferingSince: null };
    party.members.set(user.id, member);
  }
  member.connections.set(clientId, send);
  if (check) member.checks.set(clientId, check);
  else member.checks.delete(clientId);
  party.emptySince = null;
  broadcastPresence(party);
}

export function removeConnection(party, userId, clientId) {
  const member = party.members.get(userId);
  if (!member) return;
  member.connections.delete(clientId);
  member.checks.delete(clientId);
  if (member.connections.size > 0) return;

  party.members.delete(userId);
  if (member.bufferingSince) releaseHoldIfClear(party);
  if (party.members.size === 0) {
    party.emptySince = Date.now();
    return;
  }
  // Host left: the longest-standing member takes over.
  if (party.hostId === userId) {
    const next = [...party.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    party.hostId = next.userId;
  }
  broadcastPresence(party);
}

export function isFull(party) {
  return party.members.size >= MAX_MEMBERS;
}

export function canControl(party, userId) {
  return party.hostId === userId || party.controlMode === 'everyone';
}

// ─── Broadcasting ────────────────────────────────────────────────────────────
export function broadcast(party, event) {
  const payload = { ...event, serverTime: Date.now() };
  for (const member of party.members.values()) {
    for (const send of member.connections.values()) send(payload);
  }
}

export function snapshot(party) {
  return {
    code: party.code,
    itemId: party.itemId,
    hostId: party.hostId,
    controlMode: party.controlMode,
    state: party.state,
    held: party.held,
    members: [...party.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ userId: m.userId, name: m.name, buffering: !!m.bufferingSince })),
    chat: party.chat,
    serverTime: Date.now()
  };
}

function broadcastPresence(party) {
  const { members, hostId, controlMode } = snapshot(party);
  broadcast(party, { type: 'presence', members, hostId, controlMode });
}

function broadcastState(party, by = null) {
  broadcast(party, { type: 'state', state: party.state, held: party.held, by });
}

// ─── Playback ────────────────────────────────────────────────────────────────
// `by` is the connection that made the change, so it doesn't re-apply its own action.
export function applyAction(party, action, position, by) {
  const now = Date.now();
  const at = Number.isFinite(position) && position >= 0 ? position : livePosition(party.state, now);
  switch (action) {
    case 'play':
      // While held, play is recorded but doesn't start.
      party.state = { playing: !party.held, position: at, at: now };
      party.resumeAfterHold = party.held;
      break;
    case 'pause':
      party.state = { playing: false, position: at, at: now };
      party.resumeAfterHold = false;
      break;
    case 'seek':
      party.state = { playing: party.state.playing, position: at, at: now };
      break;
    case 'heartbeat':
      // The host's player is the clock; heartbeats correct drift without a visible state change.
      if (!party.state.playing || party.held) return false;
      party.state = { playing: true, position: at, at: now };
      broadcast(party, { type: 'heartbeat', state: party.state, by });
      return true;
    default:
      return false;
  }
  broadcastState(party, by);
  return true;
}

// While anyone is buffering, playback holds for everyone.
export function setBuffering(party, userId, buffering) {
  const member = party.members.get(userId);
  if (!member) return;
  const was = !!member.bufferingSince;
  if (buffering === was) return;
  member.bufferingSince = buffering ? Date.now() : null;

  if (buffering && party.state.playing && !party.held) {
    const now = Date.now();
    party.state = { playing: false, position: livePosition(party.state, now), at: now };
    party.held = true;
    party.resumeAfterHold = true;
    broadcastState(party);
  } else if (!buffering) {
    releaseHoldIfClear(party);
  }
  broadcastPresence(party);
}

function releaseHoldIfClear(party) {
  if (!party.held) return;
  const stillBuffering = [...party.members.values()].some((m) => m.bufferingSince);
  if (stillBuffering) return;
  party.held = false;
  if (party.resumeAfterHold) {
    party.state = { playing: true, position: party.state.position, at: Date.now() };
  }
  party.resumeAfterHold = false;
  broadcastState(party);
}

// Switches video, paused at 0. With autoplay, held until every player has loaded it.
export function changeItem(party, itemId, { autoplay = false } = {}) {
  party.itemId = itemId;
  party.state = { playing: false, position: 0, at: Date.now() };
  party.held = false;
  party.resumeAfterHold = false;
  for (const m of party.members.values()) m.bufferingSince = null;
  if (autoplay) {
    party.held = true;
    party.resumeAfterHold = true;
    for (const m of party.members.values()) m.bufferingSince = Date.now();
  }
  broadcast(party, { type: 'item', itemId, state: party.state, held: party.held });
  broadcastPresence(party);
}

export function setControlMode(party, mode) {
  party.controlMode = mode === 'everyone' ? 'everyone' : 'host';
  broadcastPresence(party);
}

export function addChat(party, user, text) {
  const message = { id: crypto.randomUUID(), userId: user.id, name: user.username, text, at: Date.now() };
  party.chat.push(message);
  if (party.chat.length > CHAT_HISTORY) party.chat.shift();
  broadcast(party, { type: 'chat', message });
}

export function endParty(party, reason = 'ended') {
  broadcast(party, { type: 'ended', reason });
  for (const member of party.members.values()) {
    for (const send of member.connections.values()) send(null); // null closes the stream
  }
  parties.delete(party.code);
}

// Removes from the party first (host hand-over, presence), then closes the stream.
function closeConnection(party, userId, clientId) {
  const send = party.members.get(userId)?.connections.get(clientId);
  if (!send) return false;
  removeConnection(party, userId, clientId);
  send(null);
  return true;
}

// For revoked or restricted accounts; reconnecting goes through the normal checks.
export function dropUser(userId) {
  let closed = 0;
  for (const party of [...parties.values()]) {
    const member = party.members.get(userId);
    if (!member) continue;
    for (const clientId of [...member.connections.keys()]) {
      if (closeConnection(party, userId, clientId)) closed += 1;
    }
  }
  return closed;
}

// Catches changes that raise no event (expiry, network rules, direct DB edits).
// A check that throws keeps the connection for now.
let rechecking = false;
export async function recheckConnections() {
  if (rechecking) return 0;
  rechecking = true;
  let closed = 0;
  try {
    for (const party of [...parties.values()]) {
      for (const member of [...party.members.values()]) {
        for (const [clientId, check] of [...member.checks]) {
          let ok = true;
          try {
            ok = await check(party);
          } catch {
            ok = true;
          }
          if (!ok && closeConnection(party, member.userId, clientId)) closed += 1;
        }
      }
    }
  } finally {
    rechecking = false;
  }
  return closed;
}

// ─── Housekeeping ────────────────────────────────────────────────────────────
// Drops empty parties and releases anyone stuck buffering.
export function sweepParties(now = Date.now()) {
  for (const party of [...parties.values()]) {
    if (party.members.size === 0 && party.emptySince && now - party.emptySince > EMPTY_PARTY_GRACE_MS) {
      parties.delete(party.code);
      continue;
    }
    let released = false;
    for (const m of party.members.values()) {
      if (m.bufferingSince && now - m.bufferingSince > BUFFER_HOLD_LIMIT_MS) {
        m.bufferingSince = null;
        released = true;
      }
    }
    if (released) {
      releaseHoldIfClear(party);
      broadcastPresence(party);
    }
  }
}

export function endAllParties() {
  for (const party of [...parties.values()]) endParty(party, 'disabled');
}

let sweepTimer = null;
let recheckTimer = null;
export function startPartySweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepParties(), 5000);
  sweepTimer.unref?.();
  // Slower: it reads the database for every connection.
  recheckTimer = setInterval(() => { recheckConnections().catch(() => {}); }, RECHECK_MS);
  recheckTimer.unref?.();
}
