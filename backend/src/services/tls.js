import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/env.js';

// Built-in LAN HTTPS. A local CA (served at /api/tls/ca.crt) issues the server certificate, so
// devices install the CA once and trust every re-issue; service workers need trusted HTTPS.
// The CA is name-constrained to private addresses/local names, so a leaked key can't impersonate
// real sites. Custom certs: cert.pem + key.pem in /config/ssl, or TLS_CERT / TLS_KEY.

const SSL_DIR = path.join(config.dataDir, 'ssl');
const CA_CERT = path.join(SSL_DIR, 'plinthio-ca.crt');
const CA_KEY = path.join(SSL_DIR, 'plinthio-ca.key');
const SERVER_CERT = path.join(SSL_DIR, 'server.crt');
const SERVER_KEY = path.join(SSL_DIR, 'server.key');
const SERVER_NAMES = path.join(SSL_DIR, 'server.names.json');
const CUSTOM_CERT = path.join(SSL_DIR, 'cert.pem');
const CUSTOM_KEY = path.join(SSL_DIR, 'key.pem');

// Under Apple's 825-day and Chrome's 398-day limits; renew a month before expiry.
const SERVER_DAYS = 397;
const CA_DAYS = 3650;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

// CA name constraints: private ranges and unregistrable local names only. Not ts.net (shared by
// all Tailscale users); tailnet names go in TLS_HOSTNAMES.
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
const PERMITTED_DNS = ['localhost', 'local', 'lan', 'home', 'internal', 'home.arpa'];

// Safe to put in a certificate and its openssl config.
const HOST_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
function isValidName(name) {
  return net.isIP(name) ? true : name.length <= 253 && HOST_NAME_RE.test(name);
}

function parsePort(raw) {
  const port = parseInt(raw || '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

export const tlsSettings = {
  port: parsePort(process.env.HTTPS_PORT),
  // E.g. the host's LAN IP, which a bridged container can't see.
  extraNames: (process.env.TLS_HOSTNAMES || '').split(',')
    .map((s) => s.trim())
    .map((s) => (net.isIP(s) ? s : s.toLowerCase()))
    .filter((s) => {
      if (!s) return false;
      if (isValidName(s)) return true;
      console.warn(`[tls] Ignoring "${s}" in TLS_HOSTNAMES: not an IP address or host name.`);
      return false;
    })
};

let state = { enabled: false, mode: null, names: [], caExtras: [] };
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

// Non-blocking variant for re-issues while running.
const execFileAsync = promisify(execFile);
async function opensslAsync(args) {
  await execFileAsync('openssl', args);
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

// TLS_HOSTNAMES entries outside the built-in ranges; only added when the CA is created.
function extraConstraintNames() {
  return tlsSettings.extraNames.filter((n) => !withinBuiltInConstraints(n));
}

function withinBuiltInConstraints(name) {
  if (net.isIP(name)) return isPrivateIp(name);
  return PERMITTED_DNS.some((d) => name === d || name.endsWith(`.${d}`));
}

// Unregistrable local names (nas.local, localhost). First-run setup requires one (routes/auth.js).
export function isPrivateHostName(name) {
  const host = String(name || '').toLowerCase();
  return !net.isIP(host) && HOST_NAME_RE.test(host) && withinBuiltInConstraints(host);
}

function caExtraNames() {
  try {
    const list = JSON.parse(fs.readFileSync(CA_NAMES, 'utf8'));
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && isValidName(n)) : [];
  } catch {
    return [];
  }
}

// A name outside the CA's constraints would invalidate the whole certificate, so it's left off.
function coveredByCa(name, extras) {
  return withinBuiltInConstraints(name) || extras.some((d) => name === d || (!net.isIP(d) && name.endsWith(`.${d}`)));
}

export function certificateNames() {
  const names = new Set(['localhost', '127.0.0.1', '::1']);
  // In Docker this is the container id; only covered when it's a local name.
  const host = os.hostname();
  if (host && /^[a-z0-9.-]+$/i.test(host)) names.add(host.toLowerCase());
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.internal) continue;
      if (iface.family === 'IPv4' || iface.family === 4) names.add(iface.address);
    }
  }
  for (const name of tlsSettings.extraNames) names.add(name);
  for (const name of learnedNames()) names.add(name);
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

// Built under temp names and renamed together so key and cert never mismatch.
function serverCertSteps(names) {
  const ext = writeTemp('server.ext', [
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid, issuer',
    `subjectAltName = ${sanList(names)}`
  ].join('\n'));
  const csr = path.join(SSL_DIR, 'server.csr');
  const newKey = `${SERVER_KEY}.new`;
  const newCert = `${SERVER_CERT}.new`;
  return {
    request: ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', newKey, '-out', csr,
      '-subj', '/O=Plinthio/CN=Plinthio'],
    sign: ['x509', '-req', '-in', csr, '-CA', CA_CERT, '-CAkey', CA_KEY,
      '-set_serial', `0x${crypto.randomBytes(16).toString('hex')}`, '-days', String(SERVER_DAYS),
      '-sha256', '-extfile', ext, '-out', newCert],
    finish() {
      fs.chmodSync(newKey, 0o600);
      fs.renameSync(newKey, SERVER_KEY);
      fs.renameSync(newCert, SERVER_CERT);
      fs.writeFileSync(SERVER_NAMES, JSON.stringify(names));
      console.log(`[tls] Issued a server certificate for: ${names.join(', ')}`);
    },
    cleanUp() {
      for (const file of [ext, csr, newKey, newCert]) fs.rmSync(file, { force: true });
    }
  };
}

function issueServerCert(names) {
  const steps = serverCertSteps(names);
  try {
    openssl(steps.request);
    openssl(steps.sign);
    steps.finish();
  } finally {
    steps.cleanUp();
  }
}

async function issueServerCertAsync(names) {
  const steps = serverCertSteps(names);
  try {
    await opensslAsync(steps.request);
    await opensslAsync(steps.sign);
    steps.finish();
  } finally {
    steps.cleanUp();
  }
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

// { custom }, { unavailable }, or { names, extras, issue } for the generated certificate.
function certificatePlan() {
  const certFile = process.env.TLS_CERT || (fs.existsSync(CUSTOM_CERT) ? CUSTOM_CERT : null);
  const keyFile = process.env.TLS_KEY || (fs.existsSync(CUSTOM_KEY) ? CUSTOM_KEY : null);
  if (certFile && keyFile) return { custom: { certFile, keyFile } };

  // Skip the openssl check once a certificate has been generated.
  if (state.mode !== 'generated' && !hasOpenssl()) {
    console.warn('[tls] HTTPS is off: `openssl` was not found to make a certificate. Install it, or put cert.pem and key.pem in ' + SSL_DIR);
    return { unavailable: true };
  }

  fs.mkdirSync(SSL_DIR, { recursive: true });
  if (!fs.existsSync(CA_CERT) || !fs.existsSync(CA_KEY)) createCa();

  const extras = caExtraNames();
  const wanted = certificateNames();
  const names = wanted.filter((n) => coveredByCa(n, extras));
  const skipped = tlsSettings.extraNames.filter((n) => !coveredByCa(n, extras));
  const issue = !serverCertIsCurrent(names);
  if (issue && skipped.length) {
    console.warn(`[tls] Left ${skipped.join(', ')} off the certificate: the local CA was made before ` +
      `${skipped.length === 1 ? 'it was' : 'they were'} added to TLS_HOSTNAMES and may not sign for ${skipped.length === 1 ? 'it' : 'them'}. ` +
      `Delete ${SSL_DIR} and restart to make a new CA (devices then need the new one installed).`);
  }
  return { names, extras, issue };
}

function credentialsFor(plan) {
  if (plan.custom) {
    state = { enabled: true, mode: 'custom', names: [] };
    return { cert: fs.readFileSync(plan.custom.certFile), key: fs.readFileSync(plan.custom.keyFile) };
  }
  if (plan.unavailable) {
    state = { enabled: false, mode: null, names: [] };
    return null;
  }
  state = { enabled: true, mode: 'generated', names: plan.names, caExtras: plan.extras };
  return { cert: fs.readFileSync(SERVER_CERT), key: fs.readFileSync(SERVER_KEY) };
}

// { key, cert } or null. Re-issues only when names or expiry require; blocking, for startup.
export function loadTlsCredentials() {
  const plan = certificatePlan();
  if (plan.issue) issueServerCert(plan.names);
  return credentialsFor(plan);
}

// Non-blocking variant for a running server; overlapping calls share one run.
let refreshing = null;
export function refreshTlsCredentials() {
  refreshing ||= (async () => {
    try {
      const plan = certificatePlan();
      if (plan.issue) await issueServerCertAsync(plan.names);
      return credentialsFor(plan);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ─── Addresses learned from requests ─────────────────────────────────────────
// Learns Host header addresses so devices are covered without TLS_HOSTNAMES. Only names the
// CA may sign are learned, and index.js only passes hosts from signed-in requests or setup, so
// strangers can't fill the slots. Capped and never rotated, so real addresses aren't pushed out.
const LEARNED_NAMES = path.join(SSL_DIR, 'learned-names.json');
const MAX_LEARNED = 16;
let warnedFull = false;

function learnedNames() {
  try {
    const list = JSON.parse(fs.readFileSync(LEARNED_NAMES, 'utf8'));
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && isValidName(n)) : [];
  } catch {
    return [];
  }
}

// True when `host` is new and the certificate should be re-issued.
export function noteRequestHost(rawHost) {
  if (state.mode !== 'generated' || !rawHost) return false;
  const host = String(rawHost).replace(/^\[|\]$/g, '').toLowerCase();
  if (state.names.includes(host)) return false;
  if (!isValidName(host)) return false;
  if (!coveredByCa(host, state.caExtras)) return false;
  const learned = learnedNames();
  if (learned.includes(host)) return false;
  if (learned.length >= MAX_LEARNED) {
    if (!warnedFull) {
      warnedFull = true;
      console.warn(`[tls] Not adding ${host} to the certificate: ${MAX_LEARNED} addresses are already learned. ` +
        `Add it to TLS_HOSTNAMES, or delete ${LEARNED_NAMES} and restart to learn again.`);
    }
    return false;
  }
  try {
    fs.writeFileSync(LEARNED_NAMES, JSON.stringify([...learned, host]));
  } catch {
    return false;
  }
  console.log(`[tls] Adding ${host} to the certificate (a device reached the server at that address).`);
  return true;
}

export function caCertificate() {
  if (state.mode !== 'generated' || !fs.existsSync(CA_CERT)) return null;
  return fs.readFileSync(CA_CERT);
}
