import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../src/utils/fileStream.js';

test('parseRange handles the range forms browsers send', () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.deepEqual(parseRange('bytes=0-1', 1000), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

test('parseRange clamps past-EOF ends and rejects unsatisfiable ranges', () => {
  assert.deepEqual(parseRange('bytes=0-999999', 1000), { start: 0, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), false);
  assert.equal(parseRange('bytes=50-10', 1000), false);
  assert.equal(parseRange('bytes=-0', 1000), false);
  assert.equal(parseRange('bytes=abc-def', 1000), null);
});
