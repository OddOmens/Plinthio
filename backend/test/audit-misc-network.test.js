import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Admin → Network's "requests with forwarding headers arrived from X" hint: anyone can send
// those headers without signing in, so only a peer where the admin's own proxy could be
// (this machine, the home network) is remembered, the latest replaces the earlier, and it
// expires.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-net-hint-'));
process.env.JWT_SECRET = 'test-secret';
const { noteProxyHeaders, proxyWarning, resetProxyWarning, PROXY_HINT_TTL_MS } = await import('../src/services/network.js');

// No app, so no TRUST_PROXY: every peer is untrusted, as with TRUST_PROXY unset.
const req = (remoteAddress, headers = { 'x-forwarded-for': '203.0.113.9' }) => ({ headers, socket: { remoteAddress } });

beforeEach(() => resetProxyWarning());

test('forwarding headers from a public address leave no hint', () => {
  noteProxyHeaders(req('8.8.8.8'));
  noteProxyHeaders(req('::ffff:198.51.100.7', { forwarded: 'for=1.2.3.4' }));
  noteProxyHeaders(req('2606:4700::1111', { 'x-real-ip': '1.2.3.4' }));
  assert.equal(proxyWarning(), null);
});

test('a Tailscale-range address leaves no hint either', () => {
  noteProxyHeaders(req('100.101.102.103'));
  assert.equal(proxyWarning(), null);
});

test('a request without forwarding headers leaves no hint', () => {
  noteProxyHeaders(req('192.168.1.10', {}));
  assert.equal(proxyWarning(), null);
});

test('a home or loopback peer is recorded, and a later one replaces it', () => {
  noteProxyHeaders(req('::ffff:192.168.1.10'));
  assert.equal(proxyWarning().from, '192.168.1.10');
  noteProxyHeaders(req('172.18.0.5'));
  assert.equal(proxyWarning().from, '172.18.0.5');
  // A public sender afterwards doesn't replace the home one.
  noteProxyHeaders(req('8.8.8.8'));
  assert.equal(proxyWarning().from, '172.18.0.5');
});

test('the hint expires after a day', () => {
  noteProxyHeaders(req('127.0.0.1'));
  const seen = proxyWarning();
  assert.ok(seen);
  const at = Date.parse(seen.at);
  assert.ok(proxyWarning(at + PROXY_HINT_TTL_MS - 1000));
  assert.equal(proxyWarning(at + PROXY_HINT_TTL_MS + 1000), null);
  assert.equal(proxyWarning(), null, 'and stays cleared');
});
