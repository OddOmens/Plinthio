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
process.env.REMUX_LIMIT = '4';

const { getDb } = await import('../src/config/database.js');
const { getOrStartJob, stopItemJobs, enforceHlsCacheBudget } = await import('../src/services/hls.js');

let fifoCount = 0;
function fifo(name) {
  const file = path.join(dataDir, `${name}-${fifoCount++}`);
  execFileSync('mkfifo', [file]);
  return file;
}

// The ffmpeg processes this test process has started and not yet lost — counted from the
// process table, so an encoder the job map has forgotten about still shows up.
function ffmpegChildren() {
  try {
    return execFileSync('ps', ['--ppid', String(process.pid), '-o', 'comm=,stat='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /^ffmpeg\b/.test(line.trim()) && !/\bZ/.test(line.trim().split(/\s+/)[1] || ''))
      .length;
  } catch (e) {
    return 0; // ps prints nothing and exits 1 when there are no children
  }
}

async function waitForChildren(count) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (ffmpegChildren() === count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(ffmpegChildren(), count, 'ffmpeg processes still running');
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
    // Remuxes copy the streams and have a limit of their own.
    const remux = await getOrStartJob(items[3], fifo('remux'), { mode: 'remux', userId: 'carol' });
    assert.equal(remux.exited, false);
  });
});

describe('parallel starts', () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(i).padStart(2, '0').repeat(16));
  const stopAll = async () => {
    for (const item of [...ids, 'a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32)]) stopItemJobs(item);
    await waitForChildren(0);
  };

  before(stopAll);
  after(stopAll);

  test('twenty requests for the same title at once start one ffmpeg', async () => {
    const file = fifo('same');
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      getOrStartJob(ids[0], file, { mode: 'transcode', quality: '720p', userId: 'dana' })));
    assert.equal(new Set(results).size, 1, 'every caller got the same job');
    assert.equal(results[0].exited, false);
    await waitForChildren(1);
    stopItemJobs(ids[0]);
    await waitForChildren(0);
  });

  test('a burst of different titles cannot pass the server-wide limit', async () => {
    const results = await Promise.allSettled(ids.slice(0, 8).map((item, i) =>
      getOrStartJob(item, fifo('burst'), { mode: 'transcode', quality: '720p', userId: `user-${i}` })));
    const started = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    assert.equal(started.length, 3);
    assert.equal(refused.length, 5);
    assert.ok(refused.every((r) => r.reason.plinthioCode === 'P305'));
    await waitForChildren(3);
    await stopAll();
  });

  test('one account bursting through titles never holds more than two encoders', async () => {
    const results = await Promise.allSettled(ids.slice(0, 6).map((item) =>
      getOrStartJob(item, fifo('mine'), { mode: 'transcode', quality: '720p', userId: 'erin' })));
    const live = results.filter((r) => r.status === 'fulfilled' && !r.value.exited);
    assert.equal(live.length, 2);
    // The two newest win, as with a quality switch.
    assert.equal(results[4].status, 'fulfilled');
    assert.equal(results[5].status, 'fulfilled');
    await waitForChildren(2);
    await stopAll();
  });

  test('stopping a title while it is still starting leaves no ffmpeg behind', async () => {
    const starting = getOrStartJob(ids[0], fifo('stopped'), { mode: 'transcode', quality: '720p', userId: 'finn' });
    stopItemJobs(ids[0], 'finn');
    await assert.rejects(starting, (err) => err.plinthioCode === 'P305');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ffmpegChildren(), 0);
  });

  test('remuxes are limited too: three per account, and a server-wide cap', async () => {
    const remux = (item, userId) => getOrStartJob(item, fifo('remux'), { mode: 'remux', userId });
    const first = await remux(ids[0], 'gale');
    await new Promise((r) => setTimeout(r, 5));
    const others = [await remux(ids[1], 'gale'), await remux(ids[2], 'gale')];
    assert.equal(first.exited, false, 'three at once is fine');
    // A fourth stops this account's oldest rather than being refused.
    const fourth = await remux(ids[3], 'gale');
    assert.equal(first.exited, true);
    assert.ok([...others, fourth].every((job) => !job.exited));
    await waitForChildren(3);

    // REMUX_LIMIT is 4 here: one more account fits, the next is told to try again.
    await remux(ids[4], 'hugo');
    await assert.rejects(remux(ids[5], 'iris'), (err) => err.plinthioCode === 'P305');
    // A parallel burst from many accounts can't pass it either.
    const burst = await Promise.allSettled(ids.slice(6, 12).map((item, i) => remux(item, `burst-${i}`)));
    assert.ok(burst.every((r) => r.status === 'rejected' && r.reason.plinthioCode === 'P305'));
    await waitForChildren(4);
    // Conversions have their own allowance and aren't blocked by remuxes.
    const encode = await getOrStartJob(ids[6], fifo('encode'), { mode: 'transcode', quality: '720p', userId: 'iris' });
    assert.equal(encode.exited, false);
  });
});

describe('HLS cache size budget', () => {
  const hlsDir = path.join(dataDir, 'cache', 'hls');
  const makeDir = (item, ageMinutes) => {
    const dir = path.join(hlsDir, item, 'source-a0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'seg_00000.m4s'), Buffer.alloc(1024 * 1024));
    const when = new Date(Date.now() - ageMinutes * 60 * 1000);
    fs.utimesSync(dir, when, when);
    return dir;
  };

  after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('past the budget the longest-idle copies go first; recent and running ones stay', async () => {
    fs.rmSync(hlsDir, { recursive: true, force: true });
    const oldest = makeDir('w'.repeat(32), 180);
    const older = makeDir('x'.repeat(32), 120);
    const recent = makeDir('y'.repeat(32), 1);
    // A running remux, whose directory is in use however old it looks.
    const running = await getOrStartJob('z'.repeat(32), fifo('budget'), { mode: 'remux', userId: 'jo' });
    fs.writeFileSync(path.join(running.dir, 'seg_00000.m4s'), Buffer.alloc(1024 * 1024));

    // 4 MB on disk, 2.5 MB allowed: the two idle ones go, oldest first, and then it stops
    // even though it's still over — what's left is in use.
    const freed = enforceHlsCacheBudget(2.5 * 1024 * 1024);
    assert.equal(freed, 2 * 1024 * 1024);
    assert.equal(fs.existsSync(oldest), false);
    assert.equal(fs.existsSync(older), false);
    assert.equal(fs.existsSync(recent), true);
    assert.equal(fs.existsSync(running.dir), true);
    assert.equal(running.exited, false);
    assert.equal(enforceHlsCacheBudget(10 * 1024 * 1024), 0);
    stopItemJobs('z'.repeat(32));
  });
});
