import api from '../api/client';

// Open/close spans for the readers and players, shown in Admin → Activity. Failures are
// swallowed so tracking never interrupts playback or reading.
export function useViewSession() {
  let sessionId = null;
  // Bumped on open/close, so a start that answers late is ended instead of left "viewing".
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
