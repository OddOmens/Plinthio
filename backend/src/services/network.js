import net from 'net';
import { getDb } from '../config/database.js';
import { getSetting, setSetting } from './settings.js';

// Where a request comes from, for the "away from home" controls (routes/network.js):
//   home      — this machine or the home network: loopback, RFC 1918, link-local, IPv6 ULA
//   tailscale — a device on the admin's tailnet (Tailscale's 100.64/10 and fd7a:115c:a1e0::/48)
//   outside   — anything else: the internet
//
// It's only as good as req.ip. Behind a reverse proxy or tunnel, TRUST_PROXY must be set
// or every request looks like it came from the proxy; the Tailscale and public add-ons set
// it. A request that says it was forwarded by a proxy Plinthio hasn't been told to trust
// counts as outside (see forwardedUntrusted below), so a missing TRUST_PROXY can only ever
// make the rules stricter. On Docker Desktop (Mac, Windows) the container never sees real
// addresses at all, so everything looks like home — docs/remote-access.md says so.

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

// Strips an IPv6 zone ("fe80::1%eth0") and unwraps IPv4-mapped IPv6 ("::ffff:192.168.1.5"),
// which is how Node reports IPv4 clients on a dual-stack socket.
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
  // Something that isn't an address at all: never trust it as home.
  return 'outside';
}

// ─── Settings ───────────────────────────────────────────────────────────────
// remote_access: '1' outside access allowed, '0' home (and Tailscale) only. Missing means
//   a server set up before 1.4.0, which has always been reachable from outside — kept open
//   so an update never locks anyone out; the setup wizard always writes it.
// tailscale_is_home: '1' (default) Tailscale devices count as home; '0' as outside.
// require_2fa_outside: '1' sign-ins from outside need two-factor; accounts without it can
//   only sign in from home.
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
// A reverse proxy connects from its own address, usually a home or loopback one, and says
// who the visitor really is in a header. Express only reads that header from proxies
// TRUST_PROXY names. If it's unset (or names a different address), everyone coming through
// the proxy would look like the proxy, and so like someone at home: the whole internet could
// set up a fresh server, and home-only, two-factor-outside and the outside sign-in lock
// would stop applying. So a request carrying a forwarding header that Plinthio can't use
// counts as outside. Anyone can send these headers direct, but they can only ever demote a
// request from home to outside, never the other way, so there's nothing to gain by faking one.
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
  // A trusted proxy that only sends Forwarded or X-Real-IP: Express reads neither, so the
  // address in hand is still the proxy's.
  return !xff;
}

// "home" or "outside" once the Tailscale setting is applied — the only distinction access
// rules care about. `where` keeps the three-way answer for display.
export async function requestLocation(req) {
  // Tailscale Funnel marks requests from the internet with this header (and strips any copy a
  // visitor sends). It also passes the visitor's real address, but the header settles it even
  // if that ever changed. Anyone can send it direct, but it only ever makes a request count
  // as outside, never as home, so there's nothing to gain by faking it.
  const funnel = req.headers?.['tailscale-funnel-request'] === '?1';
  const untrustedProxy = forwardedUntrusted(req);
  const where = funnel || untrustedProxy ? 'outside' : classifyAddress(req.ip);
  const settings = await getNetworkSettings();
  const away = where === 'outside' || (where === 'tailscale' && !settings.tailscaleIsHome);
  return { where, away, ip: normalizeIp(req.ip), settings, untrustedProxy };
}

// For the "can only be used from home" answers: when the reason is a proxy without
// TRUST_PROXY, say so, or an admin behind their own proxy would have nothing to go on.
export const UNTRUSTED_PROXY_HINT = 'Plinthio is behind a reverse proxy it has not been told to trust, so it cannot tell '
  + 'where you are and treats you as away from home. Set TRUST_PROXY to the proxy\'s address and restart.';

function hasTwoFactor(user) {
  return !!(user && (user.two_factor || user.totp_enabled_at));
}

// Whether `user` may use the server from where this request comes from. Returns null when
// allowed, or { code, message? }: P109 (server closed to outside), P110 (this account is
// home-only) and, for a signed-in session ({ session: true }), P112 (two-factor is required
// away from home and this account has none). That last one is checked on every request, not
// only at sign-in: a session started at home otherwise kept working from anywhere. API keys
// are left out of it: a key is made inside a signed-in session, is a long random secret
// rather than a password someone could guess or be tricked out of, and never went through
// two-factor in the first place.
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

// Just the code (or null), for callers that send their own kind of answer.
export async function outsideAccessError(req, user, options) {
  return (await outsideAccessProblem(req, user, options))?.code || null;
}

// Remembered for Admin → Network, which tells the admin to set TRUST_PROXY: the first request
// that arrived through a proxy Plinthio doesn't trust.
let proxySeen = null;
export function noteProxyHeaders(req) {
  if (proxySeen || !forwardedUntrusted(req)) return;
  proxySeen = { at: new Date().toISOString(), from: normalizeIp(req.socket?.remoteAddress) };
}
export function proxyWarning() {
  return proxySeen;
}

// ─── Tailscale, seen working ────────────────────────────────────────────────
// Admin → Network shows whether Tailscale (and Funnel) actually reach Plinthio, from the
// requests that come through it: tailscale serve connects from loopback and says which name
// it was asked for (X-Forwarded-Host, …ts.net); Funnel also marks its requests. Only trusted
// when the connection really comes from loopback, so nobody else can fake "it works".
// The name is kept in settings so the page can show the address after a restart.
const seen = { tailscale: null, funnel: null };
let savedHost = null;

export function noteTailscale(req) {
  // Only a proxy Plinthio was told to trust (the Tailscale add-on's own container) is
  // believed about the name it was reached by; anyone else could send the header themselves.
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
