import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_LOG_FORMAT, clientAddress, isScannerPath } from '../src/utils/accessLog.js';

describe('Access log', () => {
  test('each line starts with the visitor address', () => {
    assert.ok(ACCESS_LOG_FORMAT.startsWith(':client :method :url :status '));
  });

  test('the address is the one Express resolved, written plainly', () => {
    assert.equal(clientAddress({ ip: '::ffff:203.0.113.7' }), '203.0.113.7');
    assert.equal(clientAddress({ ip: '2001:DB8::1' }), '2001:db8::1');
    assert.equal(clientAddress({ socket: { remoteAddress: '10.0.0.5' } }), '10.0.0.5');
    assert.equal(clientAddress({}), '-');
  });
});

describe('Scanner paths', () => {
  test('paths no page of the app uses are recognised', () => {
    for (const p of ['/.env', '/.git/config', '/.aws/credentials', '/info.php', '/index.php',
      '/wp-login.php', '/wp-json/gravitysmtp/v1/tests/mock-data', '/login.action', '/cgi-bin/test.cgi',
      '/admin/config.PHP', '/default.aspx']) {
      assert.equal(isScannerPath(p), true, p);
    }
  });

  test('the app\'s own pages are not, dots in a series name included', () => {
    for (const p of ['/', '/login', '/admin', '/title/42', '/live/7', '/party/ABCD', '/settings',
      '/series/Mr.%20Robot', '/series/.hack%2F%2FSIGN', '/series/Show.php', '/manga/series/Vol.2',
      '/manifest.json', '/some/unknown/page', '/actuator/env']) {
      assert.equal(isScannerPath(p), false, p);
    }
    assert.equal(isScannerPath(undefined), false);
  });
});
