import net from 'net';
import { getDb } from '../config/database.js';
import { getSetting, setSetting } from './settings.js';

// Classifies a request's origin for the "away from home" controls:
//   home      — loopback, RFC 1918, link-local, IPv6 ULA
//   tailscale — 100.64/10 and fd7a:115c:a1e0::/48
//   outside   — anything else
// Relies on req.ip, so TRUST_PROXY must be set behind a proxy; untrusted forwarded requests
// count as outside, so a missing TRUST_PROXY only makes rules stricter.

function v4ToInt(ip) {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inV4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

const HOME_V4 = [
  ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]
];
const TAILSCALE_V4 = ['100.64.0.0', 10];

// Strips IPv6 zones and unwraps IPv4-mapped IPv6 (how Node reports IPv4 on dual-stack sockets).
export function normalizeIp(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  let ip = raw.trim().replace(/%.*$/, '').toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  return ip;
}

// Expands an IPv6 address to 8 groups of 16 bits.
function v6Groups(ip) {
  const [head, tail] = ip.split('::');
  const parse = (part) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  const t = tail === undefined ? [] : parse(tail);
  const fill = tail === undefined ? [] : new Array(8 - h.length - t.length).fill(0);
  return [...h, ...fill, ...t];
}

export function classifyAddress(raw) {
  const ip = normalizeIp(raw);
  if (net.isIPv4(ip)) {
    if (HOME_V4.some(([base, bits]) => inV4(ip, base, bits))) return 'home';
    if (inV4(ip, ...TAILSCALE_V4)) return 'tailscale';
    return 'outside';
  }
  if (net.isIPv6(ip)) {
    const g = v6Groups(ip);
    if (g.every((x, i) => (i < 7 ? x === 0 : x === 1))) return 'home'; // ::1
    if (g[0] === 0xfd7a && g[1] === 0x115c && g[2] === 0xa1e0) return 'tailscale';
    if ((g[0] & 0xfe00) === 0xfc00) return 'home'; // fc00::/7, unique local
    if ((g[0] & 0xffc0) === 0xfe80) return 'home'; // fe80::/10, link-local
    return 'outside';
  }
  // Not an address: never home.
  return 'outside';
}

// ─── Settings ───────────────────────────────────────────────────────────────
// remote_access: '1' outside allowed, '0' home only; missing is treated as open so older
//   servers aren't locked out (setup always writes it).
// tailscale_is_home: '1' (default) Tailscale counts as home.
// require_2fa_outside: '1' outside use needs two-factor.
const KEYS = ['remote_access', 'tailscale_is_home', 'require_2fa_outside'];
let cache = null;

export async function getNetworkSettings(db) {
  if (cache) return cache;
  db = db || await getDb();
  const rows = await db.all(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => '?').join(', ')})`, KEYS);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = {
    remoteAccess: s.remote_access !== '0',
    remoteAccessChosen: s.remote_access === '0' || s.remote_access === '1',
    tailscaleIsHome: s.tailscale_is_home !== '0',
    require2faOutside: s.require_2fa_outside === '1'
  };
  return cache;
}

export async function saveNetworkSettings(db, { remoteAccess, tailscaleIsHome, require2faOutside }) {
  if (typeof remoteAccess === 'boolean') await setSetting(db, 'remote_access', remoteAccess ? '1' : '0');
  if (typeof tailscaleIsHome === 'boolean') await setSetting(db, 'tailscale_is_home', tailscaleIsHome ? '1' : '0');
  if (typeof require2faOutside === 'boolean') await setSetting(db, 'require_2fa_outside', require2faOutside ? '1' : '0');
  cache = null;
}

// ─── A proxy in front that isn't trusted ────────────────────────────────────
// Without TRUST_PROXY, proxied visitors would look like the (home) proxy and bypass every
// home-only rule. So unusable forwarding headers mean outside; faking them can only demote a request.
function peerIsTrustedProxy(req) {
  const trust = req.app?.get?.('trust proxy fn');
  return typeof trust === 'function' && !!trust(req.socket?.remoteAddress, 0);
}

export function forwardedUntrusted(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  const other = h.forwarded || h['x-real-ip'];
  if (!xff && !other) return false;
  if (!peerIsTrustedProxy(req)) return true;
  // Express ignores Forwarded/X-Real-IP, so without XFF req.ip is still the proxy's.
  return !xff;
}

// `away` applies the Tailscale setting; `where` keeps the three-way answer for display.
export async function requestLocation(req) {
  // Funnel marks internet requests; faking the header can only make a request count as outside.
  const funnel = req.headers?.['tailscale-funnel-request'] === '?1';
  const untrustedProxy = forwardedUntrusted(req);
  const where = funnel || untrustedProxy ? 'outside' : classifyAddress(req.ip);
  const settings = await getNetworkSettings();
  const away = where === 'outside' || (where === 'tailscale' && !settings.tailscaleIsHome);
  return { where, away, ip: normalizeIp(req.ip), settings, untrustedProxy };
}

// Explains home-only refusals caused by an untrusted proxy.
export const UNTRUSTED_PROXY_HINT = 'Plinthio is behind a reverse proxy it has not been told to trust, so it cannot tell '
  + 'where you are and treats you as away from home. Set TRUST_PROXY to the proxy\'s address and restart.';

function hasTwoFactor(user) {
  return !!(user && (user.two_factor || user.totp_enabled_at));
}

// null when allowed, else { code, message? }: P109 server home-only, P110 account home-only,
// P112 (sessions only) two-factor required outside. P112 is checked per request so a home
// session can't be carried outside; API keys are exempt as long random secrets that never had 2FA.
export async function outsideAccessProblem(req, user, { session = false } = {}) {
  const loc = await requestLocation(req);
  if (!loc.away) return null;
  if (!loc.settings.remoteAccess) {
    return { code: 'P109', message: loc.untrustedProxy ? `This server can only be used from its home network. ${UNTRUSTED_PROXY_HINT}` : undefined };
  }
  if (user && (user.remote_access === 0 || user.remote_access === false)) return { code: 'P110' };
  if (session && user && loc.settings.require2faOutside && !hasTwoFactor(user)) return { code: 'P112' };
  return null;
}

export async function outsideAccessError(req, user, options) {
  return (await outsideAccessProblem(req, user, options))?.code || null;
}

// Admin hint: latest home peer sending untrusted forwarding headers (spoofable, so only a hint).
export const PROXY_HINT_TTL_MS = 24 * 60 * 60 * 1000;
let proxySeen = null;
export function noteProxyHeaders(req) {
  if (!forwardedUntrusted(req)) return;
  const from = normalizeIp(req.socket?.remoteAddress);
  if (classifyAddress(from) !== 'home') return;
  proxySeen = { at: new Date().toISOString(), from };
}
export function proxyWarning(now = Date.now()) {
  if (proxySeen && now - Date.parse(proxySeen.at) > PROXY_HINT_TTL_MS) proxySeen = null;
  return proxySeen;
}
// For tests.
export function resetProxyWarning() {
  proxySeen = null;
}

// ─── Tailscale, seen working ────────────────────────────────────────────────
// Detects working Tailscale/Funnel from proxied requests with a *.ts.net X-Forwarded-Host.
// The host is persisted so the admin page can show it after a restart.
const seen = { tailscale: null, funnel: null };
let savedHost = null;

export function noteTailscale(req) {
  // Only trusted proxies are believed; anyone else could send the header.
  if (!peerIsTrustedProxy(req)) return;
  const host = String(req.headers['x-forwarded-host'] || '').toLowerCase().replace(/:\d+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(host)) return;
  const now = new Date().toISOString();
  if (req.headers['tailscale-funnel-request'] === '?1') seen.funnel = { at: now, from: normalizeIp(req.ip) };
  else seen.tailscale = { at: now };
  if (host !== savedHost) {
    savedHost = host;
    getDb().then((db) => setSetting(db, 'tailscale_host', host)).catch(() => {});
  }
}

export async function tailscaleStatus(db) {
  if (!savedHost) {
    savedHost = (await getSetting(db, 'tailscale_host')) || null;
  }
  return { host: savedHost, lastSeen: seen.tailscale?.at || null, funnelLastSeen: seen.funnel?.at || null };
}
