import { APP_VERSION } from '../config/version.js';

// Metadata provider HTTP: named User-Agent (some providers require one), timeout, short cache
// and one retry for rate limits.
const FETCH_TIMEOUT_MS = 8000;
export const USER_AGENT = `Plinthio/${APP_VERSION} (https://github.com/OddOmens/Plinthio)`;

// A 429 with a Retry-After up to this is retried once; longer or missing fails immediately.
const MAX_RETRY_WAIT_MS = 5000;

const memory = new Map(); // key → { until, value }
const MEMORY_LIMIT = 300;

function remember(key, value, ms) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value);
  memory.set(key, { until: Date.now() + ms, value });
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Streamed so it can stop at the size limit; `res.json()` has no limit.
async function readJson(res) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared > MAX_RESPONSE_BYTES) throw new Error('The response was too large');
  if (typeof res.body?.getReader !== 'function') return res.json(); // not a real fetch response
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('The response was too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// The timeout covers the body too, so a trickling server can't hold the request open.
// Resolves { res, value } with the parsed body on success.
async function request(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    if (res.ok) return { res, value: await readJson(res) };
    // Release the unread body.
    res.body?.cancel?.().catch(() => {});
    return { res, value: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

/** `cacheMs` caches the answer (batch matches repeat queries); `timeoutMs` includes the body. */
export async function fetchJson(url, { cacheMs = 0, timeoutMs = FETCH_TIMEOUT_MS, ...options } = {}) {
  const key = cacheMs ? `${options.method || 'GET'} ${url} ${options.body || ''}` : null;
  const hit = key && memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  let { res, value } = await request(url, options, timeoutMs);
  const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
  if (res.status === 429 && retryAfter > 0 && retryAfter <= MAX_RETRY_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
    ({ res, value } = await request(url, options, timeoutMs));
  }
  if (!res.ok) {
    // Status attached so callers can tell a bad key (401/403) from a network problem.
    const err = new Error(`Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (key) remember(key, value, cacheMs);
  return value;
}
