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

async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GETs (or POSTs) JSON. `cacheMs` keeps the answer that long, so a batch match asking about
 * the same series a hundred times asks the provider once.
 */
export async function fetchJson(url, { cacheMs = 0, ...options } = {}) {
  const key = cacheMs ? `${options.method || 'GET'} ${url} ${options.body || ''}` : null;
  const hit = key && memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  let res = await request(url, options);
  const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
  if (res.status === 429 && retryAfter > 0 && retryAfter <= MAX_RETRY_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
    res = await request(url, options);
  }
  if (!res.ok) {
    // The status is attached, not just interpolated into the message, so callers can tell
    // "your key is wrong" (401/403) apart from "the server can't get out" — advice that
    // sends someone to debug their firewall over a rejected credential wastes their time.
    const err = new Error(`Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const value = await res.json();
  if (key) remember(key, value, cacheMs);
  return value;
}
