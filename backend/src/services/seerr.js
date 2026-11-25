import { getSetting, setSetting } from './settings.js';
import { openUpstream, readBody, hostOf } from './safeFetch.js';
import { USER_AGENT } from './providerHttp.js';
import { logger } from './logger.js';

// Passing accepted requests on to a Seerr server, which hands them to whatever fetches films
// and shows for it. Plinthio only tells it "this title was approved"; it never searches for
// or downloads anything itself.
//
// The address is the admin's own choice, so it may be on the home network, but link-local
// and metadata addresses stay unreachable (safeFetch). The API key is stored like the other
// provider keys and never returned by the API or written to the log.

const SETTINGS = { url: 'seerr_url', apiKey: 'seerr_api_key', enabled: 'seerr_enabled' };
const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 512 * 1024;

// Text from the other server, made safe to show on one line.
const plain = (text, max = 200) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim().slice(0, max);

// Seerr takes TMDB ids and knows two kinds of title.
const SEERR_KIND = { movie: 'movie', show: 'tv', anime: 'tv' };

export class SeerrError extends Error {
  constructor(reason, detail = null) {
    super(detail || reason);
    // 'invalid_url' | 'unreachable' | 'not_seerr' | 'unauthorized' | 'refused' | 'failed'
    this.reason = reason;
    this.detail = detail;
  }
}

/** `http(s)://host[:port][/base]`, without a trailing slash, query or credentials. */
export function normalizeSeerrUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new SeerrError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SeerrError('invalid_url');
  const base = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.protocol}//${url.host}${base}`;
}

export async function getSeerrConfig(db) {
  const [url, apiKey, enabled] = await Promise.all([
    getSetting(db, SETTINGS.url), getSetting(db, SETTINGS.apiKey), getSetting(db, SETTINGS.enabled)
  ]);
  return { url: url || '', apiKey: apiKey || '', enabled: enabled === '1' && !!url && !!apiKey };
}

/** What the admin page shows: never the key itself. */
export async function seerrStatus(db) {
  const config = await getSeerrConfig(db);
  return { url: config.url, hasKey: !!config.apiKey, enabled: config.enabled };
}

export async function saveSeerrConfig(db, { url, apiKey, enabled }) {
  await setSetting(db, SETTINGS.url, url);
  await setSetting(db, SETTINGS.apiKey, apiKey);
  await setSetting(db, SETTINGS.enabled, enabled ? '1' : '0');
}

export async function clearSeerrConfig(db) {
  await db.run('DELETE FROM settings WHERE key IN (?, ?, ?)', Object.values(SETTINGS));
}

async function call({ url, apiKey }, method, path, payload = null) {
  const body = payload ? JSON.stringify(payload) : null;
  let res;
  try {
    ({ res } = await openUpstream(`${url}/api/v1${path}`, {
      allowPrivateHosts: [hostOf(url)],
      method,
      body,
      timeoutMs: TIMEOUT_MS,
      maxRedirects: 0,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        'x-api-key': apiKey,
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {})
      }
    }));
  } catch (err) {
    throw new SeerrError('unreachable', plain(err.message));
  }

  let data = null;
  try {
    const text = (await readBody(res, MAX_RESPONSE_BYTES)).toString('utf8');
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: judged by the status below.
  }
  return { status: res.statusCode, data };
}

/** Checks the address and key. Resolves `{ version }`; throws a SeerrError saying what's wrong. */
export async function checkSeerr(config) {
  const me = await call(config, 'GET', '/auth/me');
  if (me.status === 401 || me.status === 403) throw new SeerrError('unauthorized');
  if (me.status !== 200 || !me.data || typeof me.data.id !== 'number') throw new SeerrError('not_seerr');
  let version = null;
  try {
    const status = await call(config, 'GET', '/status');
    if (status.status === 200 && typeof status.data?.version === 'string') version = plain(status.data.version, 40);
  } catch {
    // The key works; the version is only for show.
  }
  return { version };
}

/** Whether this request is one Seerr can take: a film or show found on TMDB. */
export function canSendToSeerr(request) {
  return request.source === 'tmdb' && !!SEERR_KIND[request.media_type] && /^\d{1,10}$/.test(String(request.external_id));
}

// Resolves { state: 'sent' | 'exists', ref }; throws a SeerrError otherwise.
async function createSeerrRequest(config, request) {
  const mediaType = SEERR_KIND[request.media_type];
  const payload = { mediaType, mediaId: Number(request.external_id) };
  if (mediaType === 'tv') payload.seasons = 'all';

  const { status, data } = await call(config, 'POST', '/request', payload);
  if (status === 201) return { state: 'sent', ref: data?.id != null ? String(data.id).slice(0, 40) : null };
  // 409: already requested there. 202: every season is already requested or available.
  if (status === 409 || status === 202) return { state: 'exists', ref: null };
  if (status === 401) throw new SeerrError('unauthorized');
  const detail = typeof data?.message === 'string' ? plain(data.message) : `HTTP ${status}`;
  // 403: the key's account may not request, or is over its quota.
  throw new SeerrError(status === 403 ? 'refused' : 'failed', detail);
}

/**
 * Sends one accepted request on and records how it went on its row. Never throws: a failure
 * is stored (and logged) so the review queue can show it and offer to try again. Returns
 * the row's new forward_* fields, or null when there was nothing to do.
 */
export async function forwardRequest(db, request, { again = false } = {}) {
  if (!canSendToSeerr(request)) return null;
  if (!again && ['sent', 'exists'].includes(request.forward_state)) return null;
  const config = await getSeerrConfig(db);
  if (!config.enabled) return null;

  let outcome;
  try {
    outcome = { ...await createSeerrRequest(config, request), reason: null, detail: null };
    logger.info('media', outcome.state === 'sent'
      ? `Request "${request.title}" sent to Seerr${outcome.ref ? ` (its request ${outcome.ref})` : ''}`
      : `Request "${request.title}" was already in Seerr`);
  } catch (err) {
    const reason = err instanceof SeerrError ? err.reason : 'failed';
    outcome = { state: 'failed', ref: null, reason, detail: err instanceof SeerrError ? err.detail : plain(err.message) };
    logger.warn('media', `Request "${request.title}" could not be sent to Seerr (${reason}${outcome.detail ? `: ${outcome.detail}` : ''})`);
  }

  await db.run(
    `UPDATE media_requests
     SET forward_target = 'seerr', forward_state = ?, forward_reason = ?, forward_detail = ?,
         forward_ref = COALESCE(?, forward_ref), forwarded_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [outcome.state, outcome.reason, outcome.detail, outcome.ref, request.id]
  );
  return outcome;
}
