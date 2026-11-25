import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import zlib from 'zlib';
import { Transform, pipeline } from 'stream';

// SSRF-guarded outbound HTTP for Live TV, whose URLs all come from untrusted sources.
// The check runs inside the socket's own DNS lookup, so DNS rebinding can't slip past it;
// literal IPs are checked up front, and each redirect hop is re-checked.
// `allowPrivateHosts` lets LAN playlists through, but link-local/metadata addresses are never reachable.

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

// Never reachable: "this network", link-local (cloud metadata), multicast, reserved, and IPv6 equivalents.
const NEVER = cidrs([
  '0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4', '100.100.100.200',
  '::/128', 'fe80::/10', 'ff00::/8', 'fd00:ec2::254'
]);

// Private unless allowed: loopback, RFC 1918, CGNAT (incl. Tailscale), IETF, benchmarking, IPv6 loopback/ULA.
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

// Embedded IPv4 in mapped, compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16) addresses.
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

// Refuses the whole name if any resolved address is blocked (mixed answers suggest rebinding).
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

// Separate pools so a private-allowed socket is never reused for a public-only request.
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
    // Don't send URL credentials as Basic auth.
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

// The host if it plainly names the LAN (private IP, dotless or local-only TLD), else null. Only
// these may reach private addresses; a public name resolving privately looks like rebinding.
export function lanHostOf(raw) {
  const host = hostOf(raw)?.replace(/^\[|\]$/g, '');
  if (!host) return null;
  if (net.isIP(host)) return addressBlock(host) === 'private' ? host : null;
  return !host.includes('.') || /\.(local|lan|home\.arpa|internal|localdomain)$/.test(host) ? host : null;
}

function requestOnce(url, { allowPrivate, headers, timeoutMs, signal, method = 'GET', body = null }) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    const block = addressBlock(host, { allowPrivate });
    if (block) return Promise.reject(new UpstreamError(`${host} is not an address Plinthio will connect to`, { blocked: true }));
  }
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method,
      headers,
      agent: agents[allowPrivate ? 'private' : 'public'][url.protocol],
      lookup: guardedLookup(allowPrivate),
      signal
    });
    // Idle timeout: covers slow connects, no answer, and stalled bodies.
    req.setTimeout(timeoutMs, () => req.destroy(new UpstreamError('The server took too long to answer')));
    req.once('response', resolve);
    req.once('error', (err) => reject(err instanceof UpstreamError ? err : new UpstreamError(err.message, { blocked: err.code === 'EBLOCKED' })));
    req.end(body ?? undefined);
  });
}

/**
 * Resolves `{ res, url }` at the final response's headers; `url` is after redirects. Body unread;
 * non-2xx statuses are returned, not thrown. A request with a `body` is never re-sent to a
 * redirect's target.
 */
export async function openUpstream(rawUrl, { allowPrivateHosts = [], headers = {}, timeoutMs = 15000, maxRedirects = 5, signal, method = 'GET', body = null } = {}) {
  const allowed = new Set([...allowPrivateHosts].filter(Boolean).map((h) => h.toLowerCase()));
  let url = parseHttpUrl(rawUrl);
  const requestHeaders = { accept: '*/*', ...headers };
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, {
      allowPrivate: allowed.has(url.hostname.toLowerCase()),
      headers: requestHeaders,
      timeoutMs,
      signal,
      method,
      body
    });
    if (REDIRECTS.has(res.statusCode) && res.headers.location) {
      res.resume();
      if (body !== null) throw new UpstreamError('The server answered with a redirect');
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
 * Body stream, gunzipped by magic bytes (content types are unreliable), capped at `maxBytes`
 * after decompression against gzip bombs.
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
