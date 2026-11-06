import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// The encode caps in services/hls.js, with real ffmpeg processes. Each "video" is a named
// pipe nobody writes to, so ffmpeg sits waiting on it: a running encode that costs nothing.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-transcode-limit-'));
process.env.DATA_DIR = dataDir;
process.env.TRANSCODE_LIMIT = '3';

const { getDb } = await import('../src/config/database.js');
const { getOrStartJob, stopItemJobs } = await import('../src/services/hls.js');

function fifo(name) {
  const file = path.join(dataDir, name);
  execFileSync('mkfifo', [file]);
  return file;
}

const start = (item, quality, userId) => getOrStartJob(item, fifo(`${item}-${quality}`), { mode: 'transcode', quality, userId });

describe('video conversion limits', () => {
  const items = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32)];

  before(async () => {
    const db = await getDb();
    // Software encoding, so the test doesn't depend on this machine's GPU.
    await db.run("INSERT INTO settings (key, value) VALUES ('transcode_hwaccel', 'none')");
  });

  after(() => {
    for (const item of items) stopItemJobs(item);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('one account runs at most two; a third stops its oldest', async () => {
    const first = await start(items[0], '1080p', 'alice');
    await new Promise((r) => setTimeout(r, 5));
    const second = await start(items[0], '720p', 'alice');
    const third = await start(items[0], '480p', 'alice');
    assert.equal(first.exited, true, 'the oldest was stopped');
    assert.equal(second.exited, false);
    assert.equal(third.exited, false);
  });

  test('past the server-wide limit a new conversion is told to try again shortly', async () => {
    await start(items[1], '720p', 'bob');
    await assert.rejects(start(items[2], '720p', 'carol'), (err) => err.plinthioCode === 'P305');
    // Remuxes copy the streams and aren't counted.
    const remux = await getOrStartJob(items[3], fifo('remux'), { mode: 'remux', userId: 'carol' });
    assert.equal(remux.exited, false);
  });
});
