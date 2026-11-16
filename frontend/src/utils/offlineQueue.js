// Progress saves made offline, sent when the connection returns. Only the latest per item
// is kept: progress is a position, not a log.
const KEY = 'plinthio_progress_queue';

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function write(queue) {
  try {
    if (Object.keys(queue).length) localStorage.setItem(KEY, JSON.stringify(queue));
    else localStorage.removeItem(KEY);
  } catch (e) {
    // Storage unavailable.
  }
}

export function queueProgress(url, data) {
  const queue = read();
  queue[url] = { data, queuedAt: Date.now() };
  write(queue);
}

let flushing = false;
export async function flushProgressQueue(api) {
  if (flushing || !navigator.onLine) return;
  const queue = read();
  const urls = Object.keys(queue);
  if (!urls.length) return;
  flushing = true;
  try {
    for (const url of urls) {
      try {
        await api.post(url, queue[url].data, { _fromQueue: true });
        const latest = read();
        // Only drop it if nothing newer was queued for the same item meanwhile.
        if (latest[url]?.queuedAt === queue[url].queuedAt) {
          delete latest[url];
          write(latest);
        }
      } catch (err) {
        if (!err.response) break; // Still offline.
        // Rejected (e.g. item gone): don't retry, but keep any newer save for the item.
        const latest = read();
        if (latest[url]?.queuedAt === queue[url].queuedAt) {
          delete latest[url];
          write(latest);
        }
      }
    }
  } finally {
    flushing = false;
  }
}
