import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import zlib from 'zlib';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// A stand-in for everything Live TV talks to: iptv-org's preset lists and playlists, an
// admin's own playlist with its guide, and the channels' streams. It listens on 127.0.0.1,
// which the address guard only lets through for an admin's own playlist host.
const HOUR = 60 * 60 * 1000;
const NOW = Date.now();

function xmltvTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
}

function startUpstream() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    switch (req.url) {
      case '/api/countries.json':
        return send('application/json', JSON.stringify([
          { name: 'Zedland', code: 'ZZ', languages: ['zed'], flag: '🏳️' },
          { name: 'Atlantis', code: 'AT', languages: [], flag: '' }
        ]));
      case '/api/languages.json':
        return send('application/json', JSON.stringify([{ name: 'Zeddish', code: 'zed' }]));
      case '/api/categories.json':
        return send('application/json', JSON.stringify([{ id: 'news', name: 'News' }, { id: 'xxx', name: 'XXX' }]));
      case '/iptv/countries/zz.m3u':
        return send('audio/x-mpegurl', [
          '#EXTM3U',
          '#EXTINF:-1 tvg-id="Zed.zz" group-title="General",Zed One',
          `${base}/news/index.m3u8`,
          '#EXTINF:-1 tvg-id="Blue.zz" group-title="XXX",Blue Channel',
          `${base}/blue/index.m3u8`
        ].join('\n'));
      case '/list.m3u':
        return send('application/x-mpegurl', [
          `#EXTM3U x-tvg-url="${base}/guide.xml.gz"`,
          '#EXTINF:-1 tvg-id="News.us@SD" tvg-logo="https://img.example/news.png" group-title="News;General",News One (720p)',
          'news/index.m3u8',
          '#EXTINF:-1 tvg-id="Kids.us" group-title="Kids",Kids Fun',
          `${base}/kids/index.m3u8`,
          '#EXTINF:-1 tvg-id="Movie.us" group-title="Movies",Movie Box [Not 24/7;Geo-blocked]',
          '#EXTVLCOPT:http-referrer=https://movies.example/',
          `${base}/movie/index.m3u8`,
          '#EXTINF:-1 tvg-id="Dash.us" group-title="Movies",Dash Only',
          `${base}/dash/manifest.mpd`,
          '#EXTINF:-1 tvg-id="Evil.us" group-title="News",Evil',
          `${base}/evil/index.m3u8`
        ].join('\n'));
      case '/guide.xml.gz': {
        const programme = (channel, start, stop, title) =>
          `<programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${channel}"><title>${title}</title><desc>About ${title}</desc><category>News</category></programme>`;
        const xml = `<?xml version="1.0"?><tv><channel id="News.us"/><channel id="Kids.us"/>
          ${programme('News.us', NOW - HOUR, NOW + HOUR, 'Morning News')}
          ${programme('News.us', NOW + HOUR, NOW + 2 * HOUR, 'Noon News')}
          ${programme('News.us', NOW + 48 * HOUR, NOW + 49 * HOUR, 'Far Future')}
          ${programme('Kids.us', NOW - HOUR, NOW + 3 * HOUR, 'Cartoons')}
          ${programme('Nobody.us', NOW, NOW + HOUR, 'Unknown Channel')}
        </tv>`;
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(zlib.gzipSync(xml));
      }
      case '/news/index.m3u8':
      case '/kids/index.m3u8':
      case '/movie/index.m3u8':
        return send('application/vnd.apple.mpegurl', [
          '#EXTM3U',
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio/en.m3u8"',
          '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="a"',
          '720/media.m3u8'
        ].join('\n'));
      case '/news/720/media.m3u8':
        return send('application/vnd.apple.mpegurl', [
          '#EXTM3U',
          '#EXT-X-TARGETDURATION:6',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
          '#EXT-X-MAP:URI="init.mp4"',
          '#EXTINF:6.0,',
          'seg1.ts',
          '#EXTINF:6.0,',
          'plain-playlist',
          '#EXTINF:6.0,',
          'page.html'
        ].join('\n'));
      case '/news/720/seg1.ts':
        return send('video/mp2t', 'SEGMENT-ONE');
      case '/news/720/plain-playlist':
        return send('text/plain', '#EXTM3U\n#EXTINF:6.0,\nseg1.ts\n');
      case '/news/720/page.html':
        return send('text/html', '<script>alert(document.cookie)</script>');
      case '/evil/index.m3u8': {
        const port = server.address().port;
        return send('application/vnd.apple.mpegurl', [
          '#EXTM3U',
          '#EXTINF:6.0,',
          `http://localhost:${port}/news/720/seg1.ts`,
          '#EXTINF:6.0,',
          'http://169.254.169.254/latest/meta-data/',
          '#EXTINF:6.0,',
          '/redirect-private'
        ].join('\n'));
      }
      case '/redirect-private':
        res.writeHead(302, { location: 'http://10.0.0.1/admin' });
        return res.end();
      default:
        return send('text/plain', 'not found', 404);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` })));
}

async function send(baseUrl, method, url, token, body) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return (await res.json()).token;
}

async function mediaToken(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/auth/media-token`, { method: 'POST', headers: authed(token) });
  return (await res.json()).mediaToken;
}

// Refreshes run in the background; wait for the source to settle.
async function waitForRefresh(baseUrl, token, sourceId) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const { body } = await getJson(baseUrl, '/live/admin/sources', token);
    const source = body.sources.find((s) => s.id === sourceId);
    if (source && !source.refreshing) return source;
    if (Date.now() > deadline) throw new Error(`refresh did not finish: ${JSON.stringify(source)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Every link in a rewritten playlist (bare lines and URI="…" attributes).
function playlistLinks(text) {
  const links = text.split('\n').filter((l) => l && !l.startsWith('#'));
  for (const m of text.matchAll(/URI="([^"]*)"/g)) links.push(m[1]);
  return links;
}

describe('/api/live', () => {
  let server;
  let upstream;
  let admin;
  let viewer;
  let kid;
  let kidId;
  let sourceId;
  let channels; // name → id
  let adminMedia;

  before(async () => {
    upstream = await startUpstream();
    server = await startTestServer({ env: { TMDB_API_KEY: '', LIVE_TV_IPTV_ORG_URL: upstream.base } });
    ({ token: admin } = await setupAdmin(server.baseUrl));
    await send(server.baseUrl, 'POST', '/users', admin, { username: 'viewer', password: 'viewer-password-1' });
    viewer = await login(server.baseUrl, 'viewer', 'viewer-password-1');
    const created = await send(server.baseUrl, 'POST', '/users', admin, { username: 'kid', password: 'kid-password-1' });
    kidId = created.body.user?.id || created.body.id;
    const patched = await send(server.baseUrl, 'PATCH', `/users/${kidId}`, admin, { kidsMode: true });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    kid = await login(server.baseUrl, 'kid', 'kid-password-1');
    adminMedia = await mediaToken(server.baseUrl, admin);
  });

  after(async () => {
    await server.stop();
    await new Promise((r) => upstream.server.close(r));
  });

  test('is off by default: viewers get P700, the switch reads false', async () => {
    const custom = await getJson(server.baseUrl, '/customization', viewer);
    assert.equal(custom.body.liveTvEnabled, false);

    const status = await getJson(server.baseUrl, '/live/status', viewer);
    assert.deepEqual(status.body, { enabled: false, channelCount: 0 });

    for (const url of ['/live/channels', '/live/guide', `/live/channels/${'a'.repeat(32)}`]) {
      const res = await getJson(server.baseUrl, url, viewer);
      assert.equal(res.status, 404, url);
      assert.equal(res.body.code, 'P700', url);
    }
  });

  test('admin routes are admin-only, and work while Live TV is off', async () => {
    const denied = await getJson(server.baseUrl, '/live/admin/sources', viewer);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'P105');
    const ok = await getJson(server.baseUrl, '/live/admin/sources', admin);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.sources, []);

    const switchDenied = await send(server.baseUrl, 'PATCH', '/customization', viewer, { liveTvEnabled: true });
    assert.equal(switchDenied.status, 403);
  });

  test('adding a playlist validates it and loads it in the background', async () => {
    const bad = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'm3u', name: 'Mine', playlistUrl: 'ftp://nope' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'P001');
    const noKind = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'other' });
    assert.equal(noKind.body.code, 'P001');

    const added = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, {
      kind: 'm3u', name: 'Home playlist', playlistUrl: `${upstream.base}/list.m3u`
    });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.source.kind, 'm3u');
    assert.equal(added.body.source.name, 'Home playlist');
    assert.equal(added.body.source.guideUrl, null);
    assert.equal(added.body.source.enabled, true);
    sourceId = added.body.source.id;

    const dup = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, {
      kind: 'm3u', name: 'Again', playlistUrl: `${upstream.base}/list.m3u`
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'P004');

    const source = await waitForRefresh(server.baseUrl, admin, sourceId);
    assert.equal(source.lastError, null);
    assert.equal(source.channelCount, 5);
    assert.ok(source.lastRefreshedAt);

    const list = await getJson(server.baseUrl, '/live/admin/channels', admin);
    assert.equal(list.body.total, 5);
    channels = Object.fromEntries(list.body.channels.map((c) => [c.name, c.id]));
    assert.deepEqual(Object.keys(channels), ['News One (720p)', 'Kids Fun', 'Movie Box', 'Dash Only', 'Evil']);
    const movie = list.body.channels.find((c) => c.name === 'Movie Box');
    assert.equal(movie.geoBlocked, true);
    assert.equal(movie.sourceId, sourceId);
    assert.equal(movie.hidden, false);
    assert.equal(movie.kidsAllowed, false);
    assert.equal(list.body.channels.find((c) => c.name === 'Dash Only').unsupported, true);

    const unsupported = await getJson(server.baseUrl, '/live/admin/channels?status=unsupported', admin);
    assert.deepEqual(unsupported.body.channels.map((c) => c.name), ['Dash Only']);
    const search = await getJson(server.baseUrl, '/live/admin/channels?q=kids', admin);
    assert.deepEqual(search.body.channels.map((c) => c.name), ['Kids Fun']);
    const paged = await getJson(server.baseUrl, '/live/admin/channels?limit=2&offset=1', admin);
    assert.equal(paged.body.total, 5);
    assert.deepEqual(paged.body.channels.map((c) => c.name), ['Kids Fun', 'Movie Box']);
  });

  test('turning it on shows the playable channels with now / next from the guide', async () => {
    const on = await send(server.baseUrl, 'PATCH', '/customization', admin, { liveTvEnabled: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.liveTvEnabled, true);
    assert.equal((await getJson(server.baseUrl, '/customization', viewer)).body.liveTvEnabled, true);

    const status = await getJson(server.baseUrl, '/live/status', viewer);
    assert.deepEqual(status.body, { enabled: true, channelCount: 4 });

    const { status: code, body } = await getJson(server.baseUrl, '/live/channels', viewer);
    assert.equal(code, 200);
    assert.deepEqual(body.groups, ['General', 'Kids', 'Movies', 'News']);
    assert.deepEqual(body.channels.map((c) => [c.number, c.name]), [
      [1, 'News One (720p)'], [2, 'Kids Fun'], [3, 'Movie Box'], [4, 'Evil']
    ]);
    const news = body.channels[0];
    assert.deepEqual(news.groups, ['News', 'General']);
    assert.equal(news.geoBlocked, false);
    assert.equal(news.logo, `/api/media/live/${news.id}/logo`, 'logos are served through Plinthio');
    assert.equal(body.channels[1].logo, null, 'no logo, no link');
    assert.equal(news.now.title, 'Morning News', 'a bare guide id feeds the @SD channel');
    assert.equal(news.now.start, Math.floor((NOW - HOUR) / 1000) * 1000);
    assert.equal(news.next.title, 'Noon News');
    assert.equal(body.channels[2].geoBlocked, true);
    assert.equal(body.channels[2].now, null);

    const filtered = await getJson(server.baseUrl, '/live/channels?group=News&q=evil', viewer);
    assert.deepEqual(filtered.body.channels.map((c) => [c.number, c.name]), [[4, 'Evil']], 'numbers stay put when filtering');
  });

  test('channel detail and the guide', async () => {
    const detail = await getJson(server.baseUrl, `/live/channels/${channels['News One (720p)']}`, viewer);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.streamPath, `/api/media/live/${channels['News One (720p)']}/index.m3u8`);
    assert.equal(detail.body.channel.number, 1);
    assert.deepEqual(detail.body.programmes.map((p) => p.title), ['Morning News', 'Noon News']);
    assert.equal(detail.body.programmes[0].description, 'About Morning News');
    assert.equal(detail.body.programmes[0].category, 'News');

    const missing = await getJson(server.baseUrl, `/live/channels/${channels['Dash Only']}`, viewer);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'P002');

    const guide = await getJson(server.baseUrl, `/live/guide?from=${NOW - HOUR / 2}&hours=3&limit=2`, viewer);
    assert.equal(guide.status, 200);
    assert.equal(guide.body.from, NOW - HOUR / 2);
    assert.equal(guide.body.to, NOW - HOUR / 2 + 3 * HOUR);
    assert.equal(guide.body.total, 4);
    assert.deepEqual(guide.body.channels.map((c) => c.name), ['News One (720p)', 'Kids Fun']);
    assert.deepEqual(guide.body.channels[0].programmes.map((p) => p.title), ['Morning News', 'Noon News']);
    assert.deepEqual(Object.keys(guide.body.channels[0].programmes[0]).sort(), ['category', 'start', 'stop', 'subtitle', 'title']);
    assert.deepEqual(guide.body.channels[1].programmes.map((p) => p.title), ['Cartoons']);

    const page2 = await getJson(server.baseUrl, '/live/guide?offset=2&limit=50&group=Movies', viewer);
    assert.equal(page2.body.total, 1);
    assert.equal(page2.body.channels.length, 0);
    const defaults = await getJson(server.baseUrl, '/live/guide', viewer);
    assert.equal(defaults.body.to - defaults.body.from, 4 * HOUR);
    assert.equal(defaults.body.from % (HOUR / 2), 0, 'opens on the half hour');
  });

  test('kids accounts only see channels allowed for kids', async () => {
    assert.deepEqual((await getJson(server.baseUrl, '/live/status', kid)).body, { enabled: true, channelCount: 0 });

    const allow = await send(server.baseUrl, 'PATCH', '/live/admin/channels', admin, { ids: [channels['Kids Fun']], kidsAllowed: true });
    assert.deepEqual(allow.body, { updated: 1 });
    const bad = await send(server.baseUrl, 'PATCH', '/live/admin/channels', admin, { ids: ['nope'], hidden: true });
    assert.equal(bad.body.code, 'P001');
    const viewerTry = await send(server.baseUrl, 'PATCH', '/live/admin/channels', viewer, { ids: [channels['Kids Fun']], hidden: true });
    assert.equal(viewerTry.status, 403);

    const list = await getJson(server.baseUrl, '/live/channels', kid);
    assert.deepEqual(list.body.channels.map((c) => [c.number, c.name]), [[1, 'Kids Fun']]);
    assert.deepEqual(list.body.groups, ['Kids']);
    assert.equal((await getJson(server.baseUrl, `/live/channels/${channels['News One (720p)']}`, kid)).status, 404);

    const kidMedia = await mediaToken(server.baseUrl, kid);
    const blocked = await fetch(`${server.baseUrl}/api/media/live/${channels['News One (720p)']}/index.m3u8?token=${kidMedia}`);
    assert.equal(blocked.status, 404);
    const allowed = await fetch(`${server.baseUrl}/api/media/live/${channels['Kids Fun']}/index.m3u8?token=${kidMedia}`);
    assert.equal(allowed.status, 200);
  });

  test('hidden channels disappear, and hide / kids choices survive a refresh', async () => {
    const hide = await send(server.baseUrl, 'PATCH', '/live/admin/channels', admin, { ids: [channels['Movie Box']], hidden: true });
    assert.equal(hide.body.updated, 1);
    const list = await getJson(server.baseUrl, '/live/channels', viewer);
    assert.deepEqual(list.body.channels.map((c) => c.name), ['News One (720p)', 'Kids Fun', 'Evil']);
    const stream = await fetch(`${server.baseUrl}/api/media/live/${channels['Movie Box']}/index.m3u8?token=${adminMedia}`);
    assert.equal(stream.status, 404);

    const refresh = await send(server.baseUrl, 'POST', `/live/admin/sources/${sourceId}/refresh`, admin);
    assert.equal(refresh.status, 202);
    assert.equal(refresh.body.source.refreshing, true);
    await waitForRefresh(server.baseUrl, admin, sourceId);

    const after = await getJson(server.baseUrl, '/live/admin/channels', admin);
    const byName = Object.fromEntries(after.body.channels.map((c) => [c.name, c]));
    assert.equal(byName['Movie Box'].id, channels['Movie Box'], 'same id after a refresh');
    assert.equal(byName['Movie Box'].hidden, true);
    assert.equal(byName['Kids Fun'].kidsAllowed, true);
    const hidden = await getJson(server.baseUrl, '/live/admin/channels?status=hidden', admin);
    assert.deepEqual(hidden.body.channels.map((c) => c.name), ['Movie Box']);
  });

  test('plays through the proxy: every link rewritten, signed and carrying the token', async () => {
    const id = channels['News One (720p)'];
    const res = await fetch(`${server.baseUrl}/api/media/live/${id}/index.m3u8?token=${adminMedia}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/vnd\.apple\.mpegurl/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const master = await res.text();
    assert.ok(!master.includes(upstream.base), 'no upstream address leaks to the client');
    const links = playlistLinks(master);
    assert.equal(links.length, 2, 'the variant and the audio rendition');
    for (const link of links) {
      assert.ok(link.startsWith('p?u='), link);
      assert.equal(new URLSearchParams(link.split('?')[1]).get('token'), adminMedia);
    }

    const at = (link) => `${server.baseUrl}/api/media/live/${id}/${link}`;
    const variantLink = master.split('\n').find((l) => l.startsWith('p?u='));
    const media = await (await fetch(at(variantLink))).text();
    const mediaLinks = playlistLinks(media);
    assert.equal(mediaLinks.length, 5, 'segments, the key and the init map');
    assert.ok(media.includes('#EXT-X-KEY:METHOD=AES-128,URI="p?u='));
    assert.ok(media.includes('#EXT-X-MAP:URI="p?u='));

    const segment = await fetch(at(mediaLinks[0]));
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get('content-type'), 'video/mp2t');
    assert.equal(await segment.text(), 'SEGMENT-ONE');

    // A playlist sent as text/plain from an extension-less URL is still recognised.
    const plain = await fetch(at(mediaLinks[1]));
    assert.match(plain.headers.get('content-type'), /mpegurl/);
    assert.match(await plain.text(), /^#EXTM3U\n#EXTINF:6.0,\np\?u=/);

    // Upstream HTML is never served as a page on Plinthio's origin.
    const html = await fetch(at(mediaLinks[2]));
    assert.equal(html.headers.get('content-type'), 'application/octet-stream');
    assert.match(html.headers.get('content-security-policy'), /sandbox/);
    await html.arrayBuffer();

    // The channel's own Referer from #EXTVLCOPT goes upstream; cookies never do.
    const movieId = channels['Movie Box'];
    await send(server.baseUrl, 'PATCH', '/live/admin/channels', admin, { ids: [movieId], hidden: false });
    upstream.hits.length = 0;
    const movie = await fetch(`${server.baseUrl}/api/media/live/${movieId}/index.m3u8?token=${adminMedia}`, { headers: { cookie: 'session=secret' } });
    assert.equal(movie.status, 200);
    const hit = upstream.hits.find((h) => h.url === '/movie/index.m3u8');
    assert.equal(hit.headers.referer, 'https://movies.example/');
    assert.equal(hit.headers.cookie, undefined);
    assert.match(hit.headers['user-agent'], /^Plinthio\//);
  });

  test('logos: public addresses only, viewing rules apply, failures are a bare 404', async () => {
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    // Point one logo at the playlist's own (private) host: still refused for a logo.
    await db.run('UPDATE live_channels SET logo = ? WHERE id = ?', [`${upstream.base}/logo.png`, channels.Evil]);
    await db.close();

    const logo = (id, token = adminMedia) => fetch(`${server.baseUrl}/api/media/live/${id}/logo?token=${token}`);
    upstream.hits.length = 0;
    const privateLogo = await logo(channels.Evil);
    assert.equal(privateLogo.status, 404);
    assert.equal(await privateLogo.text(), '');
    assert.deepEqual(upstream.hits, [], 'never fetched');

    assert.equal((await logo(channels['Kids Fun'])).status, 404, 'no logo');
    assert.equal((await logo('nope')).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/api/media/live/${channels.Evil}/logo`)).status, 401, 'needs a media token');

    // The unreachable img.example host fails the same quiet way; a kids account isn't even
    // looked up for a channel it may not watch.
    assert.equal((await logo(channels['News One (720p)'])).status, 404);
    const kidMedia = await mediaToken(server.baseUrl, kid);
    assert.equal((await logo(channels['News One (720p)'], kidMedia)).status, 404);
  });

  test('only links the server signed, for that channel, are fetched', async () => {
    const id = channels['News One (720p)'];
    const master = await (await fetch(`${server.baseUrl}/api/media/live/${id}/index.m3u8?token=${adminMedia}`)).text();
    const link = master.split('\n').find((l) => l.startsWith('p?u='));
    const params = new URLSearchParams(link.split('?')[1]);

    const call = async (query, channelId = id) => {
      const res = await fetch(`${server.baseUrl}/api/media/live/${channelId}/p?${query}&token=${adminMedia}`);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const forgedUrl = Buffer.from('http://127.0.0.1:1/anything').toString('base64url');

    const unsigned = await call(`u=${params.get('u')}`);
    assert.equal(unsigned.status, 403);
    assert.equal(unsigned.body.code, 'P003');
    const forged = await call(`u=${forgedUrl}&s=${params.get('s')}`);
    assert.equal(forged.status, 403);
    const otherChannel = await call(`u=${params.get('u')}&s=${params.get('s')}`, channels['Kids Fun']);
    assert.equal(otherChannel.status, 403, 'a signature is only good for its own channel');
    const noToken = await fetch(`${server.baseUrl}/api/media/live/${id}/${link.replace(/&token=[^&]+/, '')}`);
    assert.equal(noToken.status, 401);
  });

  test('the address guard stops private and metadata addresses, but not the playlist\'s own host', async () => {
    const id = channels.Evil;
    const res = await fetch(`${server.baseUrl}/api/media/live/${id}/index.m3u8?token=${adminMedia}`);
    assert.equal(res.status, 200, 'the stream\'s own private host is allowed (an admin\'s LAN box)');
    const links = playlistLinks(await res.text());
    assert.equal(links.length, 3);

    upstream.hits.length = 0;
    for (const link of links) {
      const r = await fetch(`${server.baseUrl}/api/media/live/${id}/${link}`);
      const body = await r.json();
      assert.equal(r.status, 502, link);
      assert.equal(body.code, 'P701');
      assert.ok(body.detail, 'admins see why');
    }
    // localhost (another name for a private address) never got a request; the redirect to
    // 10.0.0.1 was refused after the first hop.
    assert.deepEqual(upstream.hits.map((h) => h.url), ['/redirect-private']);
  });

  test('public presets: lists, adult content left out, private streams refused', async () => {
    const presets = await getJson(server.baseUrl, '/live/admin/presets', admin);
    assert.equal(presets.status, 200);
    assert.deepEqual(presets.body.countries, [
      { code: 'at', name: 'Atlantis', flag: '' },
      { code: 'zz', name: 'Zedland', flag: '🏳️' }
    ]);
    assert.deepEqual(presets.body.languages, [{ code: 'zed', name: 'Zeddish' }]);
    assert.deepEqual(presets.body.categories, [{ id: 'news', name: 'News' }]);

    const adult = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'iptv-org', preset: 'categories/xxx' });
    assert.equal(adult.status, 400);
    const unknown = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'iptv-org', preset: 'countries/qq' });
    assert.equal(unknown.status, 400);

    const added = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'iptv-org', preset: 'countries/zz' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.source.name, 'Zedland');
    assert.equal(added.body.source.preset, 'countries/zz');
    const dup = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'iptv-org', preset: 'countries/zz' });
    assert.equal(dup.body.code, 'P004');

    const source = await waitForRefresh(server.baseUrl, admin, added.body.source.id);
    assert.equal(source.channelCount, 1, 'the XXX group is left out');
    const zed = (await getJson(server.baseUrl, `/live/admin/channels?source=${source.id}`, admin)).body.channels;
    assert.deepEqual(zed.map((c) => c.name), ['Zed One']);

    // The same stream as News One, listed once for viewers.
    const viewerList = await getJson(server.baseUrl, '/live/channels', viewer);
    assert.equal(viewerList.body.channels.filter((c) => c.name === 'Zed One').length, 0, 'duplicate stream listed once');

    // A public source pointing at a private address gets nothing from the proxy.
    await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { enabled: false });
    const zedList = await getJson(server.baseUrl, '/live/channels', viewer);
    assert.deepEqual(zedList.body.channels.map((c) => c.name), ['Zed One'], 'a disabled source\'s channels go');
    const blocked = await fetch(`${server.baseUrl}/api/media/live/${zed[0].id}/index.m3u8?token=${adminMedia}`);
    assert.equal(blocked.status, 502);
    assert.equal((await blocked.json()).code, 'P701');
    const disabled = await fetch(`${server.baseUrl}/api/media/live/${channels['News One (720p)']}/index.m3u8?token=${adminMedia}`);
    assert.equal(disabled.status, 404, 'a disabled source\'s channels can\'t be played');
    await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { enabled: true });
  });

  test('editing and removing sources', async () => {
    const renamed = await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { name: 'Renamed', guideUrl: 'nope' });
    assert.equal(renamed.body.code, 'P001');
    const withGuide = await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { guideUrl: `${upstream.base}/guide.xml.gz` });
    assert.equal(withGuide.body.source.guideUrl, `${upstream.base}/guide.xml.gz`);
    await waitForRefresh(server.baseUrl, admin, sourceId);
    const cleared = await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { guideUrl: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.source.guideUrl, null, 'null clears it');
    const ok = await send(server.baseUrl, 'PATCH', `/live/admin/sources/${sourceId}`, admin, { name: 'Renamed' });
    assert.equal(ok.body.source.name, 'Renamed');
    const missing = await send(server.baseUrl, 'PATCH', '/live/admin/sources/nope', admin, { name: 'x' });
    assert.equal(missing.status, 404);

    const removed = await send(server.baseUrl, 'DELETE', `/live/admin/sources/${sourceId}`, admin);
    assert.equal(removed.status, 200);
    const left = await getJson(server.baseUrl, '/live/admin/channels', admin);
    assert.deepEqual(left.body.channels.map((c) => c.name), ['Zed One'], 'its channels went with it');

    // A refresh still running when the list was removed cleans up after itself when it ends.
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    let programmes;
    for (let i = 0; i < 50; i++) {
      programmes = await db.get("SELECT COUNT(*) AS n FROM live_programmes WHERE tvg_id IN ('News.us@SD', 'Kids.us')");
      if (programmes.n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await db.close();
    assert.equal(programmes.n, 0, 'and so did their guide');
  });

  test('turning it off stops playback and hides it', async () => {
    const id = (await getJson(server.baseUrl, '/live/admin/channels', admin)).body.channels[0].id;
    await send(server.baseUrl, 'PATCH', '/customization', admin, { liveTvEnabled: false });
    const stream = await fetch(`${server.baseUrl}/api/media/live/${id}/index.m3u8?token=${adminMedia}`);
    assert.equal(stream.status, 404);
    assert.equal((await stream.json()).code, 'P700');
    assert.deepEqual((await getJson(server.baseUrl, '/live/status', viewer)).body, { enabled: false, channelCount: 0 });
    assert.equal((await getJson(server.baseUrl, '/live/admin/sources', admin)).status, 200);
  });
});
