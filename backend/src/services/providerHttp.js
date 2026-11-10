import { APP_VERSION } from '../config/version.js';

// How Plinthio talks to metadata providers: one User-Agent that names the app (several
// providers ask for that, and Comic Vine refuses requests without one), a timeout, and for
// the providers with per-minute limits a short memory and one polite retry.
const FETCH_TIMEOUT_MS = 8000;
export const USER_AGENT = `Plinthio/${APP_VERSION} (https://github.com/OddOmens/Plinthio)`;

// A 429 that says to come back within this long is waited out once; a longer wait (or none
// given, as with Google's daily quota) is reported straight away.
const MAX_RETRY_WAIT_MS = 5000;

const memory = new Map(); // key → { until, value }
const MEMORY_LIMIT = 300;

function remember(key, value, ms) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value);
  memory.set(key, { until: Date.now() + ms, value });
}

// Providers answer with a few KB of JSON, a few hundred for a long search. Anything past
// this is not an answer worth holding in memory.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// The body as parsed JSON, read a piece at a time so it can be stopped at the size limit
// (`res.json()` reads whatever is sent, however much).
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

// One request, start to finish, under one clock: the timeout covers reading the body too.
// It used to stop once the headers arrived, so a server that sent headers and then trickled
// (or never finished) the body held the request open for good. Resolves with the response
// and, when it is a success, its parsed body.
async function request(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    if (res.ok) return { res, value: await readJson(res) };
    // Not going to be read: let the connection go.
    res.body?.cancel?.().catch(() => {});
    return { res, value: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GETs (or POSTs) JSON. `cacheMs` keeps the answer that long, so a batch match asking about
 * the same series a hundred times asks the provider once. `timeoutMs` is for the whole
 * exchange, body included.
 */
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
    // The status is attached, not just interpolated into the message, so callers can tell
    // "your key is wrong" (401/403) apart from "the server can't get out" — advice that
    // sends someone to debug their firewall over a rejected credential wastes their time.
    const err = new Error(`Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (key) remember(key, value, cacheMs);
  return value;
}
