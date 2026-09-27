import crypto from 'crypto';

// ─── Watch parties ───────────────────────────────────────────────────────────
// People in different places watching the same movie or episode in step. Each viewer
// streams the video from the server exactly as they would alone; a party only shares the
// playback state — playing or paused, and where — and who's there.
//
// Parties live in memory: they're minutes-to-hours long, and a server restart ending them
// is fine (everyone just reopens the link the host shares).
//
// Playback state is { playing, position, at }: `position` seconds into the video as of
// `at` (server ms). While playing, the live position is position + (now − at) / 1000, so
// clients never need a stream of position updates — only changes.

export const MAX_PARTIES = 20;
export const MAX_MEMBERS = 20;
// Someone stuck buffering longer than this stops holding everyone else up.
const BUFFER_HOLD_LIMIT_MS = 15000;
// A party everyone has left is kept this long, so a refresh or a dropped connection can
// rejoin the same party.
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
// A member can have more than one connection (two tabs); they're in the party while any
// connection is open.
export function addConnection(party, user, clientId, send) {
  let member = party.members.get(user.id);
  if (!member) {
    // `user` is kept for content-limit checks when the party changes what it's watching.
    member = { userId: user.id, name: user.username, user, joinedAt: Date.now(), connections: new Map(), bufferingSince: null };
    party.members.set(user.id, member);
  }
  member.connections.set(clientId, send);
  party.emptySince = null;
  broadcastPresence(party);
}

export function removeConnection(party, userId, clientId) {
  const member = party.members.get(userId);
  if (!member) return;
  member.connections.delete(clientId);
  if (member.connections.size > 0) return;

  party.members.delete(userId);
  if (member.bufferingSince) releaseHoldIfClear(party);
  if (party.members.size === 0) {
    party.emptySince = Date.now();
    return;
  }
  // The host left: the longest-standing member takes over, so the party carries on.
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
      // While someone's buffering, a play waits for them: it's recorded, not started.
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
      // The host's player is the clock: it corrects the shared position for the drift a
      // real player picks up (stalls, rate changes) without anyone seeing a state change.
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

// Someone started or stopped buffering. While anyone is, playback holds for everyone.
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

// A new movie or episode (the next one, or the host's pick). Starts from the top, paused
// until everyone has loaded it — each player reports buffering while it loads, and the
// host presses play (or auto-plays the next episode).
export function changeItem(party, itemId, { autoplay = false } = {}) {
  party.itemId = itemId;
  party.state = { playing: false, position: 0, at: Date.now() };
  party.held = false;
  party.resumeAfterHold = false;
  for (const m of party.members.values()) m.bufferingSince = null;
  if (autoplay) {
    // Held until everyone's player has the new video loaded, then it starts for all.
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

// ─── Housekeeping ────────────────────────────────────────────────────────────
// Drops parties everyone has left, and lets go of anyone stuck buffering.
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

// Turning the feature off ends every party.
export function endAllParties() {
  for (const party of [...parties.values()]) endParty(party, 'disabled');
}

let sweepTimer = null;
export function startPartySweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepParties(), 5000);
  sweepTimer.unref?.();
}
