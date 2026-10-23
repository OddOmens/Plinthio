import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

// The dead-channel check on its own: how a stream is probed (services/liveHealth.js) and
// which channels each scheduled batch picks (services/liveTv.js), against a database of its
// own and a local stand-in for the streams.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-live-health-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'live-tv-health-test-secret';

const { checkStream, firstPlaylistLink, nextHealth } = await import('../src/services/liveHealth.js');
const { healthCandidates, runHealthChecks, channelsChanged } = await import('../src/services/liveTv.js');
const { getDb, closeDb } = await import('../src/config/database.js');

const HOUR = 60 * 60 * 1000;

let upstream;
let base;
const hits = [];
let inFlight = 0;
let maxInFlight = 0;

before(async () => {
  const server = http.createServer(async (req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    res.on('close', () => { inFlight--; });
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (req.url.startsWith('/slow/')) await new Promise((r) => setTimeout(r, 40));
    const url = req.url.replace(/^\/slow/, '');
    if (/^\/ch\d+\/index\.m3u8$/.test(url)) return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXTINF:6,\nseg.ts\n');
    if (/^\/ch\d+\/seg\.ts$/.test(url)) return send('video/mp2t', Buffer.alloc(64 * 1024, 0x47));
    switch (url) {
      case '/master.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhigh/index.m3u8\n');
      case '/low/index':
        return send('text/plain', '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\n../segs/one.ts?x=1\n');
      case '/segs/one.ts?x=1':
        res.writeHead(206, { 'content-type': 'video/mp2t' });
        return res.end(Buffer.alloc(2048, 1));
      case '/loop.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nloop.m3u8\n');
      case '/empty-seg.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXTINF:6,\nempty.ts\n');
      case '/empty.ts':
        return send('video/mp2t', '');
      case '/html':
        return send('text/html', '<html>nope</html>');
      case '/nothing.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-ENDLIST\n');
      case '/redirect':
        res.writeHead(302, { location: '/master.m3u8' });
        return res.end();
      default:
        return send('text/plain', 'not found', 404);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  upstream = server;
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => upstream.close(r));
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const local = () => ({ allowPrivateHosts: ['127.0.0.1'] });

describe('probing a stream', () => {
  test('the first link of a playlist, and whether it is another playlist', () => {
    assert.deepEqual(firstPlaylistLink('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv/a\n', 'https://x.example/live/m.m3u8'),
      { url: 'https://x.example/live/v/a', playlist: true });
    assert.deepEqual(firstPlaylistLink('#EXTM3U\r\n#EXTINF:6,\r\n/seg/1.ts\r\n', 'https://x.example/live/m.m3u8'),
      { url: 'https://x.example/seg/1.ts', playlist: false });
    assert.equal(firstPlaylistLink('#EXTM3U\n#EXTINF:6,\nsub/index.m3u8\n', 'https://x.example/').playlist, true);
    assert.equal(firstPlaylistLink('#EXTM3U\n#EXT-X-ENDLIST\n', 'https://x.example/'), null);
  });

  test('two failures in a row make a channel offline; one success puts it right', () => {
    assert.deepEqual(nextHealth({ health: null, fails: 0 }, false), { health: null, fails: 1 });
    assert.deepEqual(nextHealth({ health: 'ok', fails: 0 }, false), { health: 'ok', fails: 1 });
    assert.deepEqual(nextHealth({ health: 'ok', fails: 1 }, false), { health: 'offline', fails: 2 });
    assert.deepEqual(nextHealth({ health: 'offline', fails: 5 }, false), { health: 'offline', fails: 6 });
    assert.deepEqual(nextHealth({ health: 'offline', fails: 5 }, true), { health: 'ok', fails: 0 });
    assert.deepEqual(nextHealth(undefined, true), { health: 'ok', fails: 0 });
  });

  test('follows a master playlist to the first segment and asks for only its first 2 KB', async () => {
    hits.length = 0;
    const result = await checkStream(`${base}/redirect`, { ...local(), headers: { 'user-agent': 'Test/1', referer: 'https://ref.example/' } });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(hits.map((h) => h.url), ['/redirect', '/master.m3u8', '/low/index', '/segs/one.ts?x=1']);
    const segment = hits[3].headers;
    assert.equal(segment.range, 'bytes=0-2047');
    assert.equal(segment['user-agent'], 'Test/1', 'the channel\'s own headers, as the proxy sends them');
    assert.equal(segment.referer, 'https://ref.example/');
    assert.equal(hits[0].headers.range, undefined, 'playlists are read whole');
  });

  test('a server that ignores the range is hung up on after the first bytes', async () => {
    assert.deepEqual(await checkStream(`${base}/ch1/index.m3u8`, local()), { ok: true });
  });

  test('anything else is a failure, never a throw', async () => {
    const cases = {
      '/missing.m3u8': /playlist answered HTTP 404/,
      '/html': /did not return an HLS playlist/,
      '/nothing.m3u8': /lists nothing to play/,
      '/loop.m3u8': /Too many nested playlists/,
      '/empty-seg.m3u8': /segment was empty/,
      '/ch2/missing-seg.m3u8': /HTTP 404/
    };
    for (const [url, error] of Object.entries(cases)) {
      const result = await checkStream(`${base}${url}`, local());
      assert.equal(result.ok, false, url);
      assert.match(result.error, error, url);
    }
    assert.equal((await checkStream('ftp://example.com/x.m3u8')).ok, false);
  });

  test('goes through the address guard: a private address needs the channel\'s own allowance', async () => {
    hits.length = 0;
    const result = await checkStream(`${base}/master.m3u8`);
    assert.equal(result.ok, false);
    assert.match(result.error, /not an address Plinthio will connect to/);
    assert.equal(hits.length, 0, 'nothing was fetched');
    const metadata = await checkStream('http://169.254.169.254/latest/meta-data/', { allowPrivateHosts: ['169.254.169.254'] });
    assert.equal(metadata.ok, false, 'metadata addresses never, whoever allows them');
  });
});

describe('the schedule', () => {
  let db;
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const idOf = (name) => crypto.createHash('md5').update(name).digest('hex');
  const names = new Map();

  async function channel(id, fields = {}) {
    names.set(idOf(id), id);
    const row = {
      source_id: 'own', stable_key: id, name: id, stream_url: `${base}/slow/${id}/index.m3u8`,
      hidden: 0, unsupported: 0, health: null, health_checked_at: null, health_fails: 0, geo_blocked: 0, pinned: 0,
      position: 1, ...fields
    };
    const columns = Object.keys(row);
    await db.run(
      `INSERT INTO live_channels (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
      [idOf(id), ...Object.values(row)]
    );
  }

  before(async () => {
    db = await getDb();
    await db.run("INSERT INTO live_sources (id, kind, name, playlist_url) VALUES ('own', 'm3u', 'Own', ?)", [`${base}/list.m3u`]);
    await db.run("INSERT INTO live_sources (id, kind, name, playlist_url, enabled) VALUES ('off', 'm3u', 'Off', ?, 0)", [`${base}/off.m3u`]);
    await channel('ch1', { position: 1 });
    await channel('ch2', { health: 'ok', health_checked_at: iso(21 * HOUR), position: 2 });
    await channel('ch3', { health: 'ok', health_checked_at: iso(1 * HOUR), position: 3 });
    await channel('ch4', { health: 'ok', health_fails: 1, health_checked_at: iso(2 * HOUR), position: 4 });
    await channel('ch5', { health: 'ok', health_fails: 1, health_checked_at: iso(10 * 60 * 1000), position: 5 });
    await channel('ch6', { health: 'offline', health_fails: 2, health_checked_at: iso(2 * HOUR), position: 6 });
    await channel('ch7', { health: 'offline', health_fails: 3, health_checked_at: iso(25 * HOUR), position: 7 });
    await channel('ch8', { hidden: 1, position: 8 });
    await channel('ch9', { unsupported: 1, position: 9 });
    await channel('ch10', { source_id: 'off', position: 10 });
    await channel('ch11', { geo_blocked: 1, position: 11 }); // hidden by the default filters
    await channel('ch12', { geo_blocked: 1, pinned: 1, position: 12 }); // …unless always shown
    channelsChanged();
  });

  test('picks the channels due, longest unchecked first; leaves out what viewers can\'t get', async () => {
    const due = (await healthCandidates(db)).map((r) => names.get(r.id));
    assert.deepEqual(due, ['ch1', 'ch12', 'ch7', 'ch2', 'ch4']);
  });

  test('takes at most 20 per batch, never-checked first', async () => {
    for (let i = 100; i < 130; i++) await channel(`ch${i}`, { position: i });
    const due = await healthCandidates(db);
    assert.equal(due.length, 20);
    assert.ok(due.every((r) => !r.health_checked_at));
  });

  test('a batch checks two at a time and records what it found', async () => {
    maxInFlight = 0;
    hits.length = 0;
    const checked = await runHealthChecks();
    assert.equal(checked, 20);
    assert.equal(maxInFlight, 2, 'two checks at a time');
    assert.equal(hits.length, 40, 'a playlist and a segment each');
    const rows = await db.all("SELECT health, health_fails, health_checked_at FROM live_channels WHERE health_checked_at > ?", [iso(60 * 1000)]);
    assert.equal(rows.length, 20);
    assert.ok(rows.every((r) => r.health === 'ok' && r.health_fails === 0));

    const second = await runHealthChecks();
    assert.equal(second, 15, 'the rest of the never-checked and the due ones next');
    const failed = await db.get(`SELECT health, health_fails FROM live_channels WHERE id = ?`, [idOf('ch7')]);
    assert.deepEqual(failed, { health: 'ok', health_fails: 0 }, 'an offline channel that answers again is ok');
  });
});
