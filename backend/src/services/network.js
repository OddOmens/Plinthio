import net from 'net';
import { getDb } from '../config/database.js';

// Where a request comes from, for the "away from home" controls (routes/network.js):
//   home      — this machine or the home network: loopback, RFC 1918, link-local, IPv6 ULA
//   tailscale — a device on the admin's tailnet (Tailscale's 100.64/10 and fd7a:115c:a1e0::/48)
//   outside   — anything else: the internet
//
// It's only as good as req.ip. Behind a reverse proxy or tunnel, TRUST_PROXY must be set
// or every request looks like it came from the proxy (see proxyWarning below); the Tailscale
// and public add-ons set it. On Docker Desktop (Mac, Windows) the container never sees real
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

async function setSetting(db, key, value) {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

export async function saveNetworkSettings(db, { remoteAccess, tailscaleIsHome, require2faOutside }) {
  if (typeof remoteAccess === 'boolean') await setSetting(db, 'remote_access', remoteAccess ? '1' : '0');
  if (typeof tailscaleIsHome === 'boolean') await setSetting(db, 'tailscale_is_home', tailscaleIsHome ? '1' : '0');
  if (typeof require2faOutside === 'boolean') await setSetting(db, 'require_2fa_outside', require2faOutside ? '1' : '0');
  cache = null;
}

// "home" or "outside" once the Tailscale setting is applied — the only distinction access
// rules care about. `where` keeps the three-way answer for display.
export async function requestLocation(req) {
  // Tailscale Funnel marks requests from the internet with this header (and strips any copy a
  // visitor sends). It also passes the visitor's real address, but the header settles it even
  // if that ever changed. Anyone can send it direct, but it only ever makes a request count
  // as outside, never as home, so there's nothing to gain by faking it.
  const funnel = req.headers?.['tailscale-funnel-request'] === '?1';
  const where = funnel ? 'outside' : classifyAddress(req.ip);
  const settings = await getNetworkSettings();
  const away = where === 'outside' || (where === 'tailscale' && !settings.tailscaleIsHome);
  return { where, away, ip: normalizeIp(req.ip), settings };
}

// Whether `user` may use the server from where this request comes from. Returns null when
// allowed, or the error code to send: P109 (server closed to outside), P110 (this account is
// home-only). Two-factor-from-outside is checked at sign-in, not here: an account without
// two-factor simply can't get a session from outside when that's required.
export async function outsideAccessError(req, user) {
  const loc = await requestLocation(req);
  if (!loc.away) return null;
  if (!loc.settings.remoteAccess) return 'P109';
  if (user && (user.remote_access === 0 || user.remote_access === false)) return 'P110';
  return null;
}

// ─── A proxy in front without TRUST_PROXY ───────────────────────────────────
// If requests carry X-Forwarded-For but Express isn't trusting it, every visitor looks like
// the proxy (usually a home address), so outside controls would wave everyone through.
// Remembered here and shown to admins in Admin → Network.
let proxySeen = null;
export function noteProxyHeaders(req, trustProxy) {
  if (trustProxy !== false) return;
  const fwd = req.headers['x-forwarded-for'];
  if (fwd && !proxySeen) proxySeen = { at: new Date().toISOString(), from: normalizeIp(req.socket?.remoteAddress) };
}
export function proxyWarning() {
  return proxySeen;
}

// Test hook: settings are cached in memory.
export function resetNetworkCache() {
  cache = null;
}
