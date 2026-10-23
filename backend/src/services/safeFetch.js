import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import zlib from 'zlib';
import { Transform, pipeline } from 'stream';

// Outbound HTTP for Live TV: playlists, guides, channel streams and logos. Every one of those
// URLs comes from somewhere Plinthio doesn't control (a public playlist, an XMLTV file, a
// stream's own playlist), so without a guard the server would fetch whatever they name —
// the router's admin page, a container's metadata endpoint, Plinthio's own API on localhost.
//
// The guard runs where it can't be dodged: in the DNS lookup the socket itself uses to
// connect. Every address a name resolves to is checked, and the connection goes to one of
// those checked addresses, so a name that resolves somewhere public for a check and somewhere
// private a moment later (DNS rebinding) never gets a second chance. Literal IPs, which skip
// the lookup, are checked before the request. Redirects are followed by hand, each hop
// checked again.
//
// A host can be let through to private addresses (`allowPrivateHosts`) — that's how an
// admin's own playlist on a LAN IPTV box works — but link-local and cloud metadata
// addresses are never reachable, whoever asks.

export class UpstreamError extends Error {
  constructor(message, { blocked = false, status = null } = {}) {
    super(message);
    this.blocked = blocked;
    this.status = status;
  }
}

function cidrs(list) {
  const blocks = new net.BlockList();
  for (const entry of list) {
    const [base, bits] = entry.split('/');
    const type = net.isIPv6(base) ? 'ipv6' : 'ipv4';
    if (bits === undefined) blocks.addAddress(base, type);
    else blocks.addSubnet(base, Number(bits), type);
  }
  return blocks;
}

// Never reachable: "this network", link-local (169.254.169.254 is the AWS/GCP/Azure metadata
// address), multicast, reserved/broadcast, Alibaba's metadata address, and their IPv6 kin.
const NEVER = cidrs([
  '0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4', '100.100.100.200',
  '::/128', 'fe80::/10', 'ff00::/8', 'fd00:ec2::254'
]);

// Private unless the host is explicitly allowed: loopback, RFC 1918, carrier-grade NAT (also
// Tailscale's range), IETF protocol assignments, benchmarking, and IPv6 loopback / ULA.
const PRIVATE = cidrs([
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10',
  '192.0.0.0/24', '198.18.0.0/15',
  '::1/128', 'fc00::/7'
]);

// Expands an IPv6 address (with or without an embedded dotted quad) to 8 16-bit groups.
function v6Groups(ip) {
  let address = ip;
  const quad = address.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    address = `${address.slice(0, -quad[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = address.split('::');
  const parse = (part) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  const t = tail === undefined ? [] : parse(tail);
  const fill = tail === undefined ? [] : new Array(Math.max(0, 8 - h.length - t.length)).fill(0);
  return [...h, ...fill, ...t];
}

const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// The IPv4 address an IPv6 one carries, for the forms that route to it: IPv4-mapped
// (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
function embeddedV4(ip) {
  const g = v6Groups(ip);
  if (g.length !== 8) return null;
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && g[5] === 0xffff) return v4From(g[6], g[7]);
  if (zeros(0, 6) && !(g[6] === 0 && g[7] <= 1)) return v4From(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4From(g[6], g[7]);
  if (g[0] === 0x2002) return v4From(g[1], g[2]);
  return null;
}

/** Why `address` can't be fetched (`'never'` / `'private'`), or null when it can. */
export function addressBlock(address, { allowPrivate = false } = {}) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  const family = net.isIP(ip);
  if (!family) return 'never';
  const checks = [[ip, family === 6 ? 'ipv6' : 'ipv4']];
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) checks.push([v4, 'ipv4']);
  }
  for (const [addr, type] of checks) {
    if (NEVER.check(addr, type)) return 'never';
  }
  if (allowPrivate) return null;
  for (const [addr, type] of checks) {
    if (PRIVATE.check(addr, type)) return 'private';
  }
  return null;
}

// The lookup the socket connects with: resolves every address and refuses the whole name if
// any one of them is off limits (a name that is half public, half private is a rebinding
// setup, not a CDN).
function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => addressBlock(a.address, { allowPrivate }));
      if (!addresses.length || bad) {
        const error = new UpstreamError(`${hostname} resolves to an address Plinthio won't connect to (${bad?.address || 'none'})`, { blocked: true });
        error.code = 'EBLOCKED';
        return callback(error);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// Kept-alive connections are pooled per guard setting: a socket opened for an allowed private
// host is never handed to a request that wasn't allowed one.
const AGENT_OPTIONS = { keepAlive: true, maxSockets: 64, maxFreeSockets: 16 };
const agents = {
  public: { 'http:': new http.Agent(AGENT_OPTIONS), 'https:': new https.Agent(AGENT_OPTIONS) },
  private: { 'http:': new http.Agent(AGENT_OPTIONS), 'https:': new https.Agent(AGENT_OPTIONS) }
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function parseHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UpstreamError('Not a valid address', { blocked: true });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UpstreamError(`Only http and https addresses can be used (got ${url.protocol})`, { blocked: true });
  }
  if (url.username || url.password) {
    // Credentials in the URL would be sent as Basic auth to whatever host that is.
    url.username = '';
    url.password = '';
  }
  return url;
}

export function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// The host of `raw` when it plainly names something on the local network — a private IP, or a
// name only a home network can resolve (no dot, .local, .lan, .home.arpa, .internal,
// .localdomain) — else null. Only such hosts are ever let through to private addresses: a
// public name that happens to resolve privately later is exactly what DNS rebinding looks like.
export function lanHostOf(raw) {
  const host = hostOf(raw)?.replace(/^\[|\]$/g, '');
  if (!host) return null;
  if (net.isIP(host)) return addressBlock(host) === 'private' ? host : null;
  return !host.includes('.') || /\.(local|lan|home\.arpa|internal|localdomain)$/.test(host) ? host : null;
}

function requestOnce(url, { allowPrivate, headers, timeoutMs, signal }) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    const block = addressBlock(host, { allowPrivate });
    if (block) return Promise.reject(new UpstreamError(`${host} is not an address Plinthio will connect to`, { blocked: true }));
  }
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      headers,
      agent: agents[allowPrivate ? 'private' : 'public'][url.protocol],
      lookup: guardedLookup(allowPrivate),
      signal
    });
    // An idle socket timeout: covers a slow connect, a server that never answers, and a body
    // that stalls halfway.
    req.setTimeout(timeoutMs, () => req.destroy(new UpstreamError('The server took too long to answer')));
    req.once('response', resolve);
    req.once('error', (err) => reject(err instanceof UpstreamError ? err : new UpstreamError(err.message, { blocked: err.code === 'EBLOCKED' })));
    req.end();
  });
}

/**
 * Opens `rawUrl` and resolves with `{ res, url }` once the final response's headers arrive
 * (`url` is where redirects ended up — the base for resolving relative links in it). The body
 * is left unread for the caller to stream or buffer. Non-2xx statuses are returned, not thrown.
 *
 *   allowPrivateHosts  host names that may resolve to private addresses (see above)
 */
export async function openUpstream(rawUrl, { allowPrivateHosts = [], headers = {}, timeoutMs = 15000, maxRedirects = 5, signal } = {}) {
  const allowed = new Set([...allowPrivateHosts].filter(Boolean).map((h) => h.toLowerCase()));
  let url = parseHttpUrl(rawUrl);
  const requestHeaders = { accept: '*/*', ...headers };
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, {
      allowPrivate: allowed.has(url.hostname.toLowerCase()),
      headers: requestHeaders,
      timeoutMs,
      signal
    });
    if (REDIRECTS.has(res.statusCode) && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new UpstreamError('Too many redirects');
      url = parseHttpUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    return { res, url: url.toString() };
  }
}

/** A pass-through that fails once more than `maxBytes` have gone through it. */
export function byteLimit(maxBytes, message = 'The response is too large') {
  let seen = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) return callback(new UpstreamError(message));
      callback(null, chunk);
    }
  });
}

/** Reads a whole (small) body into a Buffer, refusing anything over `maxBytes`. */
export async function readBody(res, maxBytes) {
  const declared = Number(res.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    throw new UpstreamError('The response is too large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > maxBytes) {
      res.destroy();
      throw new UpstreamError('The response is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The first chunk of a stream (put back, so the stream still starts with it), or null. */
export function peek(stream) {
  return new Promise((resolve, reject) => {
    const done = (chunk) => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      if (chunk) {
        stream.pause();
        stream.unshift(chunk);
      }
      resolve(chunk);
    };
    const onData = (chunk) => done(chunk);
    const onEnd = () => done(null);
    const onError = (err) => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      reject(err);
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

/**
 * The body as a readable stream, gunzipped when it is gzip (by its magic bytes — a `.gz`
 * guide is often served as plain application/octet-stream) and capped at `maxBytes` after
 * decompression, so a small gzip bomb can't fill memory or disk.
 */
export async function decodedBody(res, maxBytes) {
  const first = await peek(res);
  const limit = byteLimit(maxBytes);
  const onDone = () => {};
  if (first && first[0] === 0x1f && first[1] === 0x8b) {
    return pipeline(res, zlib.createGunzip(), limit, onDone);
  }
  return pipeline(res, limit, onDone);
}
