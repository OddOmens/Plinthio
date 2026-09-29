import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { config } from '../config/env.js';

// Built-in HTTPS for installs reached straight over the LAN (no reverse proxy in front).
//
// A browser on another device only stops warning when the certificate chains to something it
// trusts, which a plain self-signed certificate never does. So Plinthio makes its own small
// certificate authority on first start, and issues the server certificate from it: install
// the CA once on each phone or laptop (it's downloadable from /api/tls/ca.crt) and every
// certificate the server ever re-issues — new IP address, renewal — is trusted with no more
// warnings. Service workers (offline reading, the installable app) need this too: browsers
// won't register one on an untrusted HTTPS page.
//
// The CA is name-constrained to private addresses and local host names, so a copy of its key
// could never be used to impersonate a real website on a device that trusts it.
//
// Bring your own certificate instead (mkcert, `tailscale cert`, a real one for your domain)
// by dropping cert.pem + key.pem into /config/ssl, or pointing TLS_CERT / TLS_KEY at them.

const SSL_DIR = path.join(config.dataDir, 'ssl');
const CA_CERT = path.join(SSL_DIR, 'plinthio-ca.crt');
const CA_KEY = path.join(SSL_DIR, 'plinthio-ca.key');
const SERVER_CERT = path.join(SSL_DIR, 'server.crt');
const SERVER_KEY = path.join(SSL_DIR, 'server.key');
const SERVER_NAMES = path.join(SSL_DIR, 'server.names.json');
const CUSTOM_CERT = path.join(SSL_DIR, 'cert.pem');
const CUSTOM_KEY = path.join(SSL_DIR, 'key.pem');

// Apple rejects server certificates valid for more than 825 days, and Chrome caps public ones
// at 398 — stay under both and re-issue a month before expiry.
const SERVER_DAYS = 397;
const CA_DAYS = 3650;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

// What the CA may ever sign for: loopback, RFC 1918, Tailscale's CGNAT range, IPv6 ULA /
// link-local, and the host names used on home networks.
const PERMITTED_IPS = [
  '127.0.0.0/255.0.0.0',
  '10.0.0.0/255.0.0.0',
  '172.16.0.0/255.240.0.0',
  '192.168.0.0/255.255.0.0',
  '100.64.0.0/255.192.0.0',
  '169.254.0.0/255.255.0.0',
  '0:0:0:0:0:0:0:1/FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF',
  'FC00:0:0:0:0:0:0:0/FE00:0:0:0:0:0:0:0',
  'FE80:0:0:0:0:0:0:0/FFC0:0:0:0:0:0:0:0'
];
const PERMITTED_DNS = ['localhost', 'local', 'lan', 'home', 'internal', 'home.arpa', 'ts.net'];

function parsePort(raw) {
  const port = parseInt(raw || '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

export const tlsSettings = {
  port: parsePort(process.env.HTTPS_PORT),
  // Extra names the certificate should cover, e.g. the host's LAN IP — inside Docker's
  // default bridge network the container can't see the address phones actually use.
  extraNames: (process.env.TLS_HOSTNAMES || '').split(',').map((s) => s.trim()).filter(Boolean)
};

let state = { enabled: false, mode: null, names: [] };
export function tlsStatus() {
  return { ...state };
}

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function openssl(args) {
  execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

const CA_NAMES = path.join(SSL_DIR, 'plinthio-ca.names.json');

// Names outside the built-in ranges (a public IP, a real domain) that TLS_HOSTNAMES asked
// for are added to the CA's constraints — but only when the CA is created.
function extraConstraintNames() {
  return tlsSettings.extraNames
    .map((n) => (net.isIP(n) ? n : n.toLowerCase()))
    .filter((n) => !withinBuiltInConstraints(n));
}

function withinBuiltInConstraints(name) {
  if (net.isIP(name)) return isPrivateIp(name);
  return PERMITTED_DNS.some((d) => name === d || name.endsWith(`.${d}`));
}

function caExtraNames() {
  try {
    return JSON.parse(fs.readFileSync(CA_NAMES, 'utf8'));
  } catch {
    return [];
  }
}

// A name the CA isn't allowed to sign for would make clients reject the whole certificate,
// so those are left off (and reported) rather than included.
function coveredByCa(name, extras) {
  return withinBuiltInConstraints(name) || extras.some((d) => name === d || (!net.isIP(d) && name.endsWith(`.${d}`)));
}

// Every name the server certificate should list: loopback, this machine's own addresses and
// host name, and anything from TLS_HOSTNAMES.
export function certificateNames() {
  const names = new Set(['localhost', '127.0.0.1', '::1']);
  // Inside Docker this is the container id — only useful (and only covered) when it's a
  // real local name like "nas.local".
  const host = os.hostname();
  if (host && /^[a-z0-9.-]+$/i.test(host)) names.add(host.toLowerCase());
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.internal) continue;
      if (iface.family === 'IPv4' || iface.family === 4) names.add(iface.address);
    }
  }
  for (const name of tlsSettings.extraNames) names.add(net.isIP(name) ? name : name.toLowerCase());
  return [...names].sort();
}

function sanList(names) {
  return names.map((n) => (net.isIP(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
}

function nameConstraints(extras) {
  const ips = [...PERMITTED_IPS];
  const dns = [...PERMITTED_DNS];
  for (const name of extras) {
    if (net.isIPv4(name)) ips.push(`${name}/255.255.255.255`);
    else if (!net.isIP(name)) dns.push(name);
  }
  return [
    ...ips.map((ip) => `permitted;IP:${ip}`),
    ...dns.map((d) => `permitted;DNS:${d}`)
  ].join(',');
}

function writeTemp(name, contents) {
  const file = path.join(SSL_DIR, name);
  fs.writeFileSync(file, contents, { mode: 0o600 });
  return file;
}

function createCa() {
  const extras = extraConstraintNames();
  const suffix = crypto.randomBytes(3).toString('hex');
  const cnf = writeTemp('ca.cnf', [
    '[req]',
    'distinguished_name = dn',
    'prompt = no',
    'x509_extensions = v3_ca',
    '[dn]',
    `CN = Plinthio Local CA ${suffix}`,
    'O = Plinthio',
    '[v3_ca]',
    'basicConstraints = critical, CA:TRUE, pathlen:0',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    `nameConstraints = critical, ${nameConstraints(extras)}`
  ].join('\n'));
  try {
    openssl(['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', String(CA_DAYS),
      '-keyout', CA_KEY, '-out', CA_CERT, '-config', cnf]);
  } finally {
    fs.rmSync(cnf, { force: true });
  }
  fs.chmodSync(CA_KEY, 0o600);
  fs.writeFileSync(CA_NAMES, JSON.stringify(extras));
  console.log(`[tls] Created a local certificate authority (${CA_CERT}).`);
}

function issueServerCert(names) {
  const ext = writeTemp('server.ext', [
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid, issuer',
    `subjectAltName = ${sanList(names)}`
  ].join('\n'));
  const csr = path.join(SSL_DIR, 'server.csr');
  try {
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', SERVER_KEY, '-out', csr,
      '-subj', '/O=Plinthio/CN=Plinthio']);
    openssl(['x509', '-req', '-in', csr, '-CA', CA_CERT, '-CAkey', CA_KEY,
      '-set_serial', `0x${crypto.randomBytes(16).toString('hex')}`, '-days', String(SERVER_DAYS),
      '-sha256', '-extfile', ext, '-out', SERVER_CERT]);
  } finally {
    fs.rmSync(ext, { force: true });
    fs.rmSync(csr, { force: true });
  }
  fs.chmodSync(SERVER_KEY, 0o600);
  fs.writeFileSync(SERVER_NAMES, JSON.stringify(names));
  console.log(`[tls] Issued a server certificate for: ${names.join(', ')}`);
}

function serverCertIsCurrent(names) {
  if (![SERVER_CERT, SERVER_KEY, SERVER_NAMES].every((f) => fs.existsSync(f))) return false;
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(SERVER_CERT));
    const ca = new crypto.X509Certificate(fs.readFileSync(CA_CERT));
    if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return false;
    if (new Date(cert.validTo).getTime() - Date.now() < RENEW_BEFORE_MS) return false;
    const issuedFor = JSON.parse(fs.readFileSync(SERVER_NAMES, 'utf8'));
    return JSON.stringify(issuedFor) === JSON.stringify(names);
  } catch {
    return false;
  }
}

// Returns { key, cert } for https.createServer / setSecureContext, or null when HTTPS can't
// be served. Safe to call repeatedly: it only re-issues when the names or expiry require it.
export function loadTlsCredentials() {
  const certFile = process.env.TLS_CERT || (fs.existsSync(CUSTOM_CERT) ? CUSTOM_CERT : null);
  const keyFile = process.env.TLS_KEY || (fs.existsSync(CUSTOM_KEY) ? CUSTOM_KEY : null);
  if (certFile && keyFile) {
    state = { enabled: true, mode: 'custom', names: [] };
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }

  if (!hasOpenssl()) {
    console.warn('[tls] HTTPS is off: `openssl` was not found to make a certificate. Install it, or put cert.pem and key.pem in ' + SSL_DIR);
    state = { enabled: false, mode: null, names: [] };
    return null;
  }

  fs.mkdirSync(SSL_DIR, { recursive: true });
  if (!fs.existsSync(CA_CERT) || !fs.existsSync(CA_KEY)) createCa();

  const extras = caExtraNames();
  const wanted = certificateNames();
  const names = wanted.filter((n) => coveredByCa(n, extras));
  const skipped = tlsSettings.extraNames.filter((n) => !coveredByCa(net.isIP(n) ? n : n.toLowerCase(), extras));
  if (!serverCertIsCurrent(names)) {
    if (skipped.length) {
      console.warn(`[tls] Left ${skipped.join(', ')} off the certificate: the local CA was made before ` +
        `${skipped.length === 1 ? 'it was' : 'they were'} added to TLS_HOSTNAMES and may not sign for ${skipped.length === 1 ? 'it' : 'them'}. ` +
        `Delete ${SSL_DIR} and restart to make a new CA (devices then need the new one installed).`);
    }
    issueServerCert(names);
  }

  state = { enabled: true, mode: 'generated', names };
  return { cert: fs.readFileSync(SERVER_CERT), key: fs.readFileSync(SERVER_KEY) };
}

export function caCertificate() {
  if (state.mode !== 'generated' || !fs.existsSync(CA_CERT)) return null;
  return fs.readFileSync(CA_CERT);
}
