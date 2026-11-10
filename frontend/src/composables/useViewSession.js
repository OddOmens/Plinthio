import api from '../api/client';

// Tracks "opened this item" → "closed this item" spans for the readers/players (manga,
// book, video, audio) so Admin → Activity can show what's actually being read/watched and
// for how long. Tracking failures are swallowed everywhere — a network hiccup here must
// never block or interrupt someone's reading/viewing session.
export function useViewSession() {
  let sessionId = null;
  // Bumped by every open and close, so a start that answers after the item was closed (or
  // another opened) is ended straight away rather than left "viewing" forever.
  let generation = 0;

  async function open(itemId) {
    await close();
    if (!itemId) return;
    const mine = ++generation;
    try {
      const res = await api.post('/activity/start', { itemId });
      if (mine !== generation) {
        end(res.data.sessionId);
        return;
      }
      sessionId = res.data.sessionId;
    } catch (err) {
      if (mine === generation) sessionId = null;
    }
  }

  async function close() {
    generation++;
    if (!sessionId) return;
    const id = sessionId;
    sessionId = null;
    await end(id);
  }

  async function end(id) {
    if (!id) return;
    try {
      await api.post('/activity/end', { sessionId: id });
    } catch (err) {
      // ignore — best-effort tracking
    }
  }

  return { open, close };
}
