import api from '../api/client';

// The live side of a watch party (backend: routes/party.js). Reads the party's event
// stream — Server-Sent Events, read with fetch so the session token goes in a header
// rather than the URL — and reconnects if the connection drops. Each connection carries a
// clientId, which the server echoes on the changes it made so it doesn't re-apply them.

function newClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Server clock minus ours, so "playing from 42s since server time T" can be turned into a
// position here without the two clocks agreeing.
let clockOffset = 0;
export function serverNow() {
  return Date.now() + clockOffset;
}

export function livePosition(state) {
  if (!state) return 0;
  return state.playing ? state.position + (serverNow() - state.at) / 1000 : state.position;
}

export class PartyConnection {
  constructor(code, onEvent) {
    this.code = code;
    this.onEvent = onEvent;
    this.clientId = newClientId();
    this.closed = false;
    this.retryDelay = 1000;
    this.controller = null;
  }

  async connect() {
    while (!this.closed) {
      this.controller = new AbortController();
      try {
        const token = localStorage.getItem('plinthio_token');
        const res = await fetch(`/api/party/${this.code}/events?clientId=${this.clientId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: this.controller.signal,
          cache: 'no-store'
        });
        if (!res.ok) {
          // Not a dropped connection — the party's gone, full, or off-limits. Stop.
          const body = await res.json().catch(() => ({}));
          this.onEvent({ type: 'error', status: res.status, code: body.code, message: body.error });
          return;
        }
        this.retryDelay = 1000;
        await this.read(res.body);
      } catch (err) {
        if (this.closed) return;
      }
      if (this.closed) return;
      this.onEvent({ type: 'reconnecting' });
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    }
  }

  async read(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue; // keepalive comment
        let event;
        try { event = JSON.parse(line.slice(6)); } catch (e) { continue; }
        if (event.serverTime) clockOffset = event.serverTime - Date.now();
        this.onEvent(event);
        if (event.type === 'ended') { this.closed = true; return; }
      }
    }
  }

  close() {
    this.closed = true;
    this.controller?.abort();
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  post(path, body = {}) {
    return api.post(`/party/${this.code}${path}`, { ...body, clientId: this.clientId });
  }

  action(action, position) {
    return this.post('/action', { action, position });
  }

  buffering(buffering) {
    return this.post('/buffering', { buffering }).catch(() => {});
  }

  chat(text) {
    return this.post('/chat', { text });
  }

  changeItem(itemId, autoplay = false) {
    return this.post('/item', { itemId, autoplay });
  }

  setControlMode(controlMode) {
    return this.post('/settings', { controlMode });
  }

  end() {
    return api.delete(`/party/${this.code}`);
  }
}

export async function startParty(itemId) {
  const res = await api.post('/party', { itemId });
  return res.data.party;
}
