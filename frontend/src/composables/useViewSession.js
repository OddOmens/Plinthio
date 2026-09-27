import api from '../api/client';

// Tracks "opened this item" → "closed this item" spans for the readers/players (manga,
// book, video, audio) so Admin → Activity can show what's actually being read/watched and
// for how long. Tracking failures are swallowed everywhere — a network hiccup here must
// never block or interrupt someone's reading/viewing session.
export function useViewSession() {
  let sessionId = null;

  async function open(itemId) {
    await close();
    if (!itemId) return;
    try {
      const res = await api.post('/activity/start', { itemId });
      sessionId = res.data.sessionId;
    } catch (err) {
      sessionId = null;
    }
  }

  async function close() {
    if (!sessionId) return;
    const id = sessionId;
    sessionId = null;
    try {
      await api.post('/activity/end', { sessionId: id });
    } catch (err) {
      // ignore — best-effort tracking
    }
  }

  return { open, close };
}
