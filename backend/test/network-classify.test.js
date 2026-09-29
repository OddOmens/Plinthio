import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-net-'));
process.env.JWT_SECRET = 'test-secret';
const { classifyAddress, normalizeIp } = await import('../src/services/network.js');

test('home: loopback, private ranges, link-local, unique-local IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.10.1', '::1', 'fd12:3456::1', 'fe80::1%eth0']) {
    assert.equal(classifyAddress(ip), 'home', ip);
  }
});

test('IPv4 inside IPv6 (how Node reports dual-stack clients) is judged as IPv4', () => {
  assert.equal(normalizeIp('::ffff:192.168.1.5'), '192.168.1.5');
  assert.equal(classifyAddress('::ffff:192.168.1.5'), 'home');
  assert.equal(classifyAddress('::ffff:8.8.8.8'), 'outside');
  assert.equal(classifyAddress('::FFFF:100.100.1.1'), 'tailscale');
});

test('tailscale: 100.64/10 and its IPv6 range', () => {
  for (const ip of ['100.64.0.1', '100.101.102.103', '100.127.255.254', 'fd7a:115c:a1e0::1234']) {
    assert.equal(classifyAddress(ip), 'tailscale', ip);
  }
});

test('outside: public addresses, the edges of private ranges, and anything unparseable', () => {
  for (const ip of ['8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '2001:db8::1', '2606:4700::1111', '', 'not-an-ip', '192.168.1', '999.1.1.1']) {
    assert.equal(classifyAddress(ip), 'outside', ip || '(empty)');
  }
});
