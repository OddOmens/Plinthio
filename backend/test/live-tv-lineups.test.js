import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// Live TV's organising and viewer extras: the admin's numbers, names and logos, line-ups
// (one of them open to kids), the dead-channel check run on demand, and each viewer's
// favourites, recently watched list, "hide for me" and search. The stand-in upstream is an
// admin's own playlist on 127.0.0.1 (which the address guard lets through for that host).
const HOUR = 60 * 60 * 1000;
const NOW = Date.now();

function xmltvTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
}

const EXTRAS = 12;

function startUpstream() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (/^\/extra\d+\/index\.m3u8$/.test(req.url)) {
      return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXTINF:6.0,\nseg.ts\n');
    }
    switch (req.url) {
      case '/list.m3u':
        return send('audio/x-mpegurl', [
          `#EXTM3U x-tvg-url="${base}/guide.xml"`,
          '#EXTINF:-1 tvg-id="Alpha.us" tvg-logo="https://img.example/alpha.png" group-title="News",Alpha',
          `${base}/ok/index.m3u8`,
          '#EXTINF:-1 tvg-id="Bravo.us" group-title="Kids",Bravo',
          `${base}/ok2/index.m3u8`,
          '#EXTINF:-1 tvg-id="Charlie.us" group-title="Sports",Charlie',
          `${base}/dead/index.m3u8`,
          '#EXTINF:-1 tvg-id="Delta.us" group-title="News",Delta',
          `${base}/seg404/index.m3u8`
        ].join('\n'));
      case '/list2.m3u':
        return send('audio/x-mpegurl', [
          '#EXTM3U',
          '#EXTINF:-1 tvg-id="AlphaCopy.us" group-title="Copies",Alpha Copy',
          `${base}/ok/index.m3u8`,
          ...Array.from({ length: EXTRAS }, (_, i) => [
            `#EXTINF:-1 tvg-id="Extra${i + 1}.us" group-title="Extra",Extra ${i + 1}`,
            `${base}/extra${i + 1}/index.m3u8`
          ]).flat()
        ].join('\n'));
      case '/guide.xml': {
        const programme = (channel, start, stop, title, subtitle = '') =>
          `<programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${channel}"><title>${title}</title>${subtitle ? `<sub-title>${subtitle}</sub-title>` : ''}</programme>`;
        return send('application/xml', `<?xml version="1.0"?><tv>
          ${programme('Alpha.us', NOW - HOUR, NOW + HOUR, 'Morning Show')}
          ${programme('Alpha.us', NOW + 5 * HOUR, NOW + 6 * HOUR, 'Evening Match', 'Final')}
          ${programme('Bravo.us', NOW - HOUR, NOW + 2 * HOUR, 'Cartoon Time')}
          ${programme('Charlie.us', NOW + 2 * HOUR, NOW + 3 * HOUR, 'Match of the Day')}
          ${programme('Charlie.us', NOW + 40 * HOUR, NOW + 41 * HOUR, 'Match Far Away')}
        </tv>`);
      }
      case '/ok/index.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720/media.m3u8\n');
      case '/ok/720/media.m3u8':
      case '/ok2/index.m3u8':
      case '/seg404/index.m3u8':
        return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg.ts\n#EXTINF:6.0,\nseg2.ts\n');
      case '/ok/720/seg.ts':
      case '/ok2/seg.ts':
        res.writeHead(206, { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-2047/100000' });
        return res.end(Buffer.alloc(2048, 0x47));
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

describe('/api/live line-ups, numbers, favourites and the channel check', () => {
  let server;
  let upstream;
  let admin;
  let viewer;
  let kid;
  let viewerMedia;
  let kidMedia;
  let sourceId;
  let ids; // name → id
  let lineups = {};

  const viewerList = async (query = '', token = viewer) => (await getJson(server.baseUrl, `/live/channels${query}`, token)).body;
  const named = (channels) => channels.map((c) => [c.number, c.name]);
  const patchChannel = (name, body) => send(server.baseUrl, 'PATCH', `/live/admin/channels/${ids[name]}`, admin, body);

  before(async () => {
    upstream = await startUpstream();
    server = await startTestServer({ env: { TMDB_API_KEY: '', LIVE_TV_IPTV_ORG_URL: upstream.base } });
    ({ token: admin } = await setupAdmin(server.baseUrl));
    await send(server.baseUrl, 'POST', '/users', admin, { username: 'viewer', password: 'viewer-password-1' });
    viewer = await login(server.baseUrl, 'viewer', 'viewer-password-1');
    const created = await send(server.baseUrl, 'POST', '/users', admin, { username: 'kid', password: 'kid-password-1' });
    const kidId = created.body.user?.id || created.body.id;
    await send(server.baseUrl, 'PATCH', `/users/${kidId}`, admin, { kidsMode: true });
    kid = await login(server.baseUrl, 'kid', 'kid-password-1');
    viewerMedia = await mediaToken(server.baseUrl, viewer);
    kidMedia = await mediaToken(server.baseUrl, kid);

    const added = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'm3u', name: 'Home', playlistUrl: `${upstream.base}/list.m3u` });
    sourceId = added.body.source.id;
    await waitForRefresh(server.baseUrl, admin, sourceId);
    const second = await send(server.baseUrl, 'POST', '/live/admin/sources', admin, { kind: 'm3u', name: 'More', playlistUrl: `${upstream.base}/list2.m3u` });
    await waitForRefresh(server.baseUrl, admin, second.body.source.id);
    await send(server.baseUrl, 'PATCH', '/customization', admin, { liveTvEnabled: true });
    const all = await getJson(server.baseUrl, '/live/admin/channels?limit=500', admin);
    ids = Object.fromEntries(all.body.channels.map((c) => [c.name, c.id]));
  });

  after(async () => {
    await server.stop();
    await new Promise((r) => upstream.server.close(r));
  });

  test('new admin channel fields, and new viewer fields, start out empty', async () => {
    const { body } = await getJson(server.baseUrl, `/live/admin/channels?q=Alpha`, admin);
    const alpha = body.channels.find((c) => c.name === 'Alpha');
    assert.equal(alpha.number, null);
    assert.equal(alpha.customName, null);
    assert.equal(alpha.customLogo, null);
    assert.deepEqual(alpha.lineupIds, []);
    assert.equal(alpha.health, null);
    assert.equal(alpha.healthCheckedAt, null);

    const list = await viewerList();
    assert.deepEqual(named(list.channels).slice(0, 5), [[1, 'Alpha'], [2, 'Bravo'], [3, 'Charlie'], [4, 'Delta'], [5, 'Extra 1']]);
    assert.equal(list.channels.length, 4 + EXTRAS, 'Alpha Copy is the same stream as Alpha');
    assert.equal(list.channels[0].favourite, false);
    assert.deepEqual(list.lineups, []);
  });

  test('channel numbers: the admin\'s first, the rest numbered on after the highest', async () => {
    assert.equal((await send(server.baseUrl, 'PATCH', `/live/admin/channels/${ids.Charlie}`, viewer, { number: 1 })).status, 403);
    const set = await patchChannel('Charlie', { number: 5 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.channel.number, 5);
    await patchChannel('Extra 3', { number: 2 });

    const list = await viewerList();
    assert.deepEqual(named(list.channels).slice(0, 5), [[2, 'Extra 3'], [5, 'Charlie'], [6, 'Alpha'], [7, 'Bravo'], [8, 'Delta']]);

    const clash = await patchChannel('Delta', { number: 5 });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'P004');
    assert.equal(clash.body.error, 'Another channel already has that number');
    for (const bad of [0, 10000, 1.5, '7']) {
      const res = await patchChannel('Delta', { number: bad });
      assert.equal(res.body.code, 'P001', String(bad));
    }
    assert.equal((await patchChannel('Delta', {})).body.code, 'P001', 'nothing to change');
    assert.equal((await send(server.baseUrl, 'PATCH', `/live/admin/channels/${'f'.repeat(32)}`, admin, { number: 9 })).status, 404);

    // A whole category, matched exactly, combined with the other filters.
    const news = await getJson(server.baseUrl, '/live/admin/channels?group=News', admin);
    assert.deepEqual(news.body.channels.map((c) => c.name), ['Alpha', 'Delta']);
    assert.equal(news.body.total, 2);
    assert.deepEqual((await getJson(server.baseUrl, '/live/admin/channels?group=News&q=del', admin)).body.channels.map((c) => c.name), ['Delta']);
    assert.equal((await getJson(server.baseUrl, '/live/admin/channels?group=New', admin)).body.total, 0, 'no partial names');
    assert.equal((await getJson(server.baseUrl, '/live/admin/channels?group=N%25', admin)).body.total, 0, 'no wildcards');
    assert.equal((await getJson(server.baseUrl, '/live/admin/channels?group=news', admin)).body.total, 0, 'names match exactly');
    assert.equal((await getJson(server.baseUrl, `/live/admin/channels?group=Extra&source=${sourceId}`, admin)).body.total, 0);
    assert.equal((await getJson(server.baseUrl, '/live/admin/channels?group=Extra&limit=500', admin)).body.total, EXTRAS);

    // Search finds the admin's numbers and names too.
    const byNumber = await getJson(server.baseUrl, '/live/admin/channels?q=5', admin);
    assert.ok(byNumber.body.channels.some((c) => c.name === 'Charlie'));

    const cleared = await patchChannel('Extra 3', { number: null });
    assert.equal(cleared.body.channel.number, null);
    assert.deepEqual(named((await viewerList()).channels).slice(0, 2), [[5, 'Charlie'], [6, 'Alpha']]);
  });

  test('the admin\'s own name and logo, kept across a refresh', async () => {
    const bad = await patchChannel('Bravo', { logo: 'ftp://img.example/b.png' });
    assert.equal(bad.body.code, 'P001');
    const set = await patchChannel('Bravo', { name: '  Bravo Kids  ', logo: 'https://img.example/bravo.png' });
    assert.equal(set.body.channel.customName, 'Bravo Kids');
    assert.equal(set.body.channel.customLogo, 'https://img.example/bravo.png');
    assert.equal(set.body.channel.name, 'Bravo', 'the playlist\'s name stays alongside');
    assert.match(set.body.channel.logo, new RegExp(`^/api/media/live/${ids.Bravo}/logo\\?v=[0-9a-f]{10}$`));

    const bravo = (await viewerList()).channels.find((c) => c.id === ids.Bravo);
    assert.equal(bravo.name, 'Bravo Kids');
    assert.match(bravo.logo, /\/logo\?v=/);
    const search = await getJson(server.baseUrl, '/live/admin/channels?q=bravo%20kids', admin);
    assert.deepEqual(search.body.channels.map((c) => c.id), [ids.Bravo]);

    await send(server.baseUrl, 'POST', `/live/admin/sources/${sourceId}/refresh`, admin);
    await waitForRefresh(server.baseUrl, admin, sourceId);
    const after = (await getJson(server.baseUrl, '/live/admin/channels?q=bravo', admin)).body.channels[0];
    assert.equal(after.customName, 'Bravo Kids');
    assert.equal((await getJson(server.baseUrl, '/live/admin/channels?q=charlie', admin)).body.channels[0].number, 5);

    const reset = await patchChannel('Bravo', { name: '', logo: null });
    assert.equal(reset.body.channel.customName, null);
    assert.equal(reset.body.channel.customLogo, null);
    assert.equal((await viewerList()).channels.find((c) => c.id === ids.Bravo).name, 'Bravo');
  });

  test('line-ups: made, filled, ordered and listed for viewers', async () => {
    assert.equal((await send(server.baseUrl, 'POST', '/live/admin/lineups', viewer, { name: 'Nope' })).status, 403);
    assert.equal((await send(server.baseUrl, 'POST', '/live/admin/lineups', admin, { name: '  ' })).body.code, 'P001');

    const kids = await send(server.baseUrl, 'POST', '/live/admin/lineups', admin, { name: 'Family' });
    assert.equal(kids.status, 201, JSON.stringify(kids.body));
    assert.deepEqual(Object.keys(kids.body.lineup).sort(), ['channelCount', 'id', 'kidsAllowed', 'name', 'position']);
    lineups.family = kids.body.lineup.id;
    lineups.sport = (await send(server.baseUrl, 'POST', '/live/admin/lineups', admin, { name: 'Sport' })).body.lineup.id;
    lineups.empty = (await send(server.baseUrl, 'POST', '/live/admin/lineups', admin, { name: 'Empty' })).body.lineup.id;

    const put = await send(server.baseUrl, 'PUT', `/live/admin/lineups/${lineups.family}/channels`, admin, { ids: [ids.Delta, ids.Alpha] });
    assert.equal(put.body.lineup.channelCount, 2);
    await send(server.baseUrl, 'POST', `/live/admin/lineups/${lineups.family}/channels`, admin, { ids: [ids.Bravo, ids.Alpha, 'f'.repeat(32)] });
    let members = await getJson(server.baseUrl, `/live/admin/lineups/${lineups.family}/channels`, admin);
    assert.deepEqual(members.body.channels.map((c) => c.name), ['Delta', 'Alpha', 'Bravo'], 'appended, no repeats, unknown ids skipped');
    assert.deepEqual(members.body.channels[0].lineupIds, [lineups.family]);
    const removed = await send(server.baseUrl, 'DELETE', `/live/admin/lineups/${lineups.family}/channels`, admin, { ids: [ids.Alpha] });
    assert.equal(removed.body.lineup.channelCount, 2);
    members = await getJson(server.baseUrl, `/live/admin/lineups/${lineups.family}/channels`, admin);
    assert.deepEqual(members.body.channels.map((c) => c.name), ['Delta', 'Bravo']);
    assert.equal((await send(server.baseUrl, 'PUT', `/live/admin/lineups/${lineups.family}/channels`, admin, { ids: ['x'] })).body.code, 'P001');
    await send(server.baseUrl, 'PUT', `/live/admin/lineups/${lineups.sport}/channels`, admin, { ids: [ids.Charlie, ids.Alpha] });

    const order = await send(server.baseUrl, 'PUT', '/live/admin/lineups/order', admin, { ids: [lineups.sport, lineups.family] });
    assert.deepEqual(order.body.lineups.map((l) => l.name), ['Sport', 'Family', 'Empty'], 'left-out line-ups go last');
    const renamed = await send(server.baseUrl, 'PATCH', `/live/admin/lineups/${lineups.family}`, admin, { name: 'Family time' });
    assert.equal(renamed.body.lineup.name, 'Family time');
    assert.equal((await send(server.baseUrl, 'PATCH', '/live/admin/lineups/nope', admin, { name: 'x' })).status, 404);
    const listed = await getJson(server.baseUrl, '/live/admin/lineups', admin);
    assert.deepEqual(listed.body.lineups.map((l) => [l.name, l.channelCount, l.kidsAllowed]), [['Sport', 2, false], ['Family time', 2, false], ['Empty', 0, false]]);

    const alpha = (await getJson(server.baseUrl, '/live/admin/channels?q=alpha', admin)).body.channels.find((c) => c.name === 'Alpha');
    assert.deepEqual(alpha.lineupIds, [lineups.sport]);

    // Viewers: line-ups with something to watch, in the admin's order; each in its own order.
    const list = await viewerList();
    assert.deepEqual(list.lineups, [
      { id: lineups.sport, name: 'Sport', channelCount: 2 },
      { id: lineups.family, name: 'Family time', channelCount: 2 }
    ]);
    const sport = await viewerList(`?lineup=${lineups.sport}`);
    assert.deepEqual(named(sport.channels), [[5, 'Charlie'], [6, 'Alpha']], 'line-up order, channel numbers kept');
    assert.deepEqual(sport.groups, ['News', 'Sports']);
    const guide = await getJson(server.baseUrl, `/live/guide?lineup=${lineups.family}&from=${NOW - HOUR}&hours=2`, viewer);
    assert.deepEqual(guide.body.channels.map((c) => c.name), ['Delta', 'Bravo']);
    assert.equal(guide.body.total, 2);
    const missing = await getJson(server.baseUrl, '/live/channels?lineup=nope', viewer);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'P002');
  });

  test('a line-up open to kids lets kids accounts watch its channels; filters still apply', async () => {
    assert.equal((await viewerList('', kid)).channels.length, 0);
    assert.equal((await send(server.baseUrl, 'PATCH', `/live/admin/lineups/${lineups.family}`, admin, { kidsAllowed: 'yes' })).body.code, 'P001');
    const open = await send(server.baseUrl, 'PATCH', `/live/admin/lineups/${lineups.family}`, admin, { kidsAllowed: true });
    assert.equal(open.body.lineup.kidsAllowed, true);

    const list = await viewerList('', kid);
    assert.deepEqual(list.channels.map((c) => c.name), ['Bravo', 'Delta']);
    assert.deepEqual((await viewerList(`?lineup=${lineups.family}`, kid)).channels.map((c) => c.name), ['Delta', 'Bravo']);
    assert.deepEqual(list.lineups.map((l) => l.name), ['Family time'], 'only line-ups with channels the kid may watch');
    assert.deepEqual((await getJson(server.baseUrl, '/live/status', kid)).body, { enabled: true, channelCount: 2 });
    assert.equal((await fetch(`${server.baseUrl}/api/media/live/${ids.Delta}/index.m3u8?token=${kidMedia}`)).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/api/media/live/${ids.Alpha}/index.m3u8?token=${kidMedia}`)).status, 404);

    await send(server.baseUrl, 'PATCH', '/live/admin/filters', admin, { hiddenGroups: ['News'] });
    assert.deepEqual((await viewerList('', kid)).channels.map((c) => c.name), ['Bravo']);
    assert.equal((await fetch(`${server.baseUrl}/api/media/live/${ids.Delta}/index.m3u8?token=${kidMedia}`)).status, 404);
    await send(server.baseUrl, 'PATCH', '/live/admin/filters', admin, { hiddenGroups: [] });

    // Removing the line-up takes the kids' access with it.
    assert.equal((await send(server.baseUrl, 'DELETE', `/live/admin/lineups/${lineups.empty}`, admin)).status, 200);
    assert.equal((await send(server.baseUrl, 'DELETE', `/live/admin/lineups/${lineups.empty}`, admin)).status, 404);
    await send(server.baseUrl, 'PATCH', `/live/admin/lineups/${lineups.family}`, admin, { kidsAllowed: false });
    assert.equal((await viewerList('', kid)).channels.length, 0);
    await send(server.baseUrl, 'PATCH', `/live/admin/lineups/${lineups.family}`, admin, { kidsAllowed: true });
  });

  test('favourites: per viewer, in the order added, and the Home row', async () => {
    assert.equal((await send(server.baseUrl, 'POST', `/live/favourites/${ids.Charlie}`, viewer)).body.favourite, true);
    assert.equal((await send(server.baseUrl, 'POST', `/live/favourites/${ids.Alpha}`, viewer)).body.favourite, true);
    assert.equal((await send(server.baseUrl, 'POST', `/live/favourites/${ids.Alpha}`, viewer)).body.favourite, true, 'twice is fine');
    assert.equal((await send(server.baseUrl, 'POST', `/live/favourites/${'f'.repeat(32)}`, viewer)).status, 404);
    assert.equal((await send(server.baseUrl, 'POST', `/live/favourites/${ids.Alpha}`, kid)).status, 404, 'kids only favourite what they may watch');

    const list = await viewerList();
    assert.deepEqual(list.channels.filter((c) => c.favourite).map((c) => c.name), ['Charlie', 'Alpha']);
    const favs = await viewerList('?lineup=favourites');
    assert.deepEqual(named(favs.channels), [[5, 'Charlie'], [6, 'Alpha']]);
    assert.equal((await viewerList('?lineup=favourites', admin)).channels.length, 0, 'each viewer has their own');

    const now = await getJson(server.baseUrl, '/live/now?limit=1', viewer);
    assert.deepEqual(now.body.channels.map((c) => c.name), ['Charlie']);
    const home = await getJson(server.baseUrl, '/live/now', viewer);
    assert.deepEqual(home.body.channels.map((c) => [c.name, c.now?.title || null, c.favourite]), [['Charlie', null, true], ['Alpha', 'Morning Show', true]]);
    assert.equal(home.body.channels[0].next.title, 'Match of the Day');

    const detail = await getJson(server.baseUrl, `/live/channels/${ids.Alpha}`, viewer);
    assert.equal(detail.body.channel.favourite, true);

    assert.equal((await send(server.baseUrl, 'DELETE', `/live/favourites/${ids.Charlie}`, viewer)).body.favourite, false);
    assert.deepEqual((await getJson(server.baseUrl, '/live/now', viewer)).body.channels.map((c) => c.name), ['Alpha']);
  });

  test('recently watched: newest first, ten at most', async () => {
    assert.deepEqual((await getJson(server.baseUrl, '/live/recent', viewer)).body.channels, []);
    for (const name of ['Alpha', 'Bravo', 'Alpha']) {
      const res = await send(server.baseUrl, 'POST', `/live/channels/${ids[name]}/watched`, viewer);
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 5));
    }
    const recent = await getJson(server.baseUrl, '/live/recent', viewer);
    assert.deepEqual(recent.body.channels.map((c) => c.name), ['Alpha', 'Bravo']);
    assert.equal(recent.body.channels[0].now.title, 'Morning Show');
    assert.equal(recent.body.channels[0].favourite, true);
    assert.equal((await send(server.baseUrl, 'POST', `/live/channels/${ids.Alpha}/watched`, kid)).status, 404);

    for (let i = 1; i <= EXTRAS; i++) {
      await send(server.baseUrl, 'POST', `/live/channels/${ids[`Extra ${i}`]}/watched`, viewer);
      await new Promise((r) => setTimeout(r, 2));
    }
    const kept = (await getJson(server.baseUrl, '/live/recent', viewer)).body.channels.map((c) => c.name);
    assert.equal(kept.length, 10);
    assert.equal(kept[0], `Extra ${EXTRAS}`);
    assert.ok(!kept.includes('Alpha'));
  });

  test('hidden for me: dropped from this viewer\'s lists only, numbers kept', async () => {
    const saved = await send(server.baseUrl, 'PATCH', '/users/preferences', viewer, {
      liveTv: { hiddenChannels: [ids.Delta, 'not-a-channel', 42], hiddenGroups: ['Sports'], showOnHome: false, somethingElse: true }
    });
    assert.equal(saved.status, 200);

    const list = await viewerList();
    assert.ok(!list.channels.some((c) => c.name === 'Delta' || c.name === 'Charlie'));
    assert.ok(!list.groups.includes('Sports'));
    assert.deepEqual(named(list.channels).slice(0, 2), [[6, 'Alpha'], [7, 'Bravo']], 'numbers stay put');
    assert.deepEqual(list.lineups.map((l) => [l.name, l.channelCount]), [['Sport', 1], ['Family time', 1]]);
    const guide = await getJson(server.baseUrl, '/live/guide?limit=200', viewer);
    assert.ok(!guide.body.channels.some((c) => c.name === 'Delta'));
    assert.equal((await getJson(server.baseUrl, `/live/channels/${ids.Delta}`, viewer)).status, 200, 'still there when asked for directly');
    assert.equal((await getJson(server.baseUrl, '/live/status', viewer)).body.channelCount, 4 + EXTRAS);
    assert.equal((await viewerList('', admin)).channels.length, 4 + EXTRAS, 'other viewers unaffected');

    const hidden = await getJson(server.baseUrl, '/live/me/hidden', viewer);
    assert.deepEqual(hidden.body, {
      channels: [{ id: ids.Delta, name: 'Delta', logo: null, number: 8 }],
      groups: ['Sports']
    });

    await send(server.baseUrl, 'PATCH', '/users/preferences', viewer, { liveTv: { hiddenChannels: [], hiddenGroups: [] } });
    assert.deepEqual((await getJson(server.baseUrl, '/live/me/hidden', viewer)).body, { channels: [], groups: [] });
  });

  test('search: channels by name, programmes by title from now on', async () => {
    const short = await getJson(server.baseUrl, '/live/search?q=a', viewer);
    assert.deepEqual(short.body, { channels: [], programmes: [] });

    const match = await getJson(server.baseUrl, '/live/search?q=match', viewer);
    assert.equal(match.status, 200);
    assert.deepEqual(match.body.programmes.map((p) => p.title), ['Match of the Day', 'Evening Match'], 'beyond the guide window is left out');
    assert.deepEqual(match.body.programmes[0], {
      channelId: ids.Charlie, channelName: 'Charlie', logo: null, number: 5,
      start: Math.floor((NOW + 2 * HOUR) / 1000) * 1000, stop: Math.floor((NOW + 3 * HOUR) / 1000) * 1000,
      title: 'Match of the Day', subtitle: null
    });
    const bySubtitle = await getJson(server.baseUrl, '/live/search?q=final', viewer);
    assert.deepEqual(bySubtitle.body.programmes.map((p) => p.title), ['Evening Match']);

    const channels = await getJson(server.baseUrl, '/live/search?q=ALPH', viewer);
    assert.deepEqual(channels.body.channels.map((c) => c.name), ['Alpha']);
    assert.equal(channels.body.channels[0].now.title, 'Morning Show');

    const limited = await getJson(server.baseUrl, '/live/search?q=extra&limit=3', viewer);
    assert.equal(limited.body.channels.length, 3);

    // Only what this viewer sees: kids get nothing from Charlie's guide.
    const kids = await getJson(server.baseUrl, '/live/search?q=match', kid);
    assert.deepEqual(kids.body.programmes, []);
    const wild = await getJson(server.baseUrl, '/live/search?q=%25%25', viewer);
    assert.deepEqual(wild.body.programmes, [], 'LIKE wildcards are taken literally');
  });

  test('the channel check: on demand, offline after two failures, hidden from viewers', async () => {
    assert.equal((await getJson(server.baseUrl, '/live/admin/health', viewer)).status, 403);
    assert.equal((await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Alpha}/check`, viewer)).status, 403);
    const start = await getJson(server.baseUrl, '/live/admin/health', admin);
    assert.deepEqual(start.body, {
      enabled: true, hideOffline: true, counts: { ok: 0, offline: 0, unchecked: 5 + EXTRAS }, lastCheckedAt: null
    });

    upstream.hits.length = 0;
    const ok = await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Alpha}/check`, admin);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.health, 'ok');
    assert.ok(Date.parse(ok.body.checkedAt));
    assert.deepEqual(upstream.hits.map((h) => h.url), ['/ok/index.m3u8', '/ok/720/media.m3u8', '/ok/720/seg.ts'], 'master, media playlist, first segment');
    assert.equal(upstream.hits[2].headers.range, 'bytes=0-2047');
    assert.equal((await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Bravo}/check`, admin)).body.health, 'ok');

    const first = await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Charlie}/check`, admin);
    assert.equal(first.body.health, null, 'one failure isn\'t enough');
    assert.match(first.body.error, /HTTP 404/);
    assert.ok((await viewerList()).channels.some((c) => c.name === 'Charlie'));
    const second = await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Charlie}/check`, admin);
    assert.equal(second.body.health, 'offline');

    const segment = await send(server.baseUrl, 'POST', `/live/admin/channels/${ids.Delta}/check`, admin);
    assert.match(segment.body.error, /segment answered HTTP 404/);

    assert.ok(!(await viewerList()).channels.some((c) => c.name === 'Charlie'), 'offline channels are hidden');
    assert.equal((await fetch(`${server.baseUrl}/api/media/live/${ids.Charlie}/index.m3u8?token=${viewerMedia}`)).status, 404);
    const offline = await getJson(server.baseUrl, '/live/admin/channels?status=offline', admin);
    assert.deepEqual(offline.body.channels.map((c) => [c.name, c.health]), [['Charlie', 'offline']]);
    assert.ok(offline.body.channels[0].healthCheckedAt);
    const visible = await getJson(server.baseUrl, '/live/admin/channels?status=visible&limit=500', admin);
    assert.ok(!visible.body.channels.some((c) => c.name === 'Charlie'));
    const overview = await getJson(server.baseUrl, '/live/admin/filters', admin);
    assert.equal(overview.body.totals.channels, 3 + EXTRAS, 'offline channels aren\'t counted while hidden');
    assert.ok(!overview.body.facets.groups.some((g) => g.id === 'Sports'));

    const health = await getJson(server.baseUrl, '/live/admin/health', admin);
    assert.deepEqual(health.body.counts, { ok: 2, offline: 1, unchecked: 2 + EXTRAS });
    assert.ok(health.body.lastCheckedAt);

    assert.equal((await send(server.baseUrl, 'PATCH', '/live/admin/health', admin, { hideOffline: 'no' })).body.code, 'P001');
    const shown = await send(server.baseUrl, 'PATCH', '/live/admin/health', admin, { hideOffline: false, enabled: false });
    assert.equal(shown.body.hideOffline, false);
    assert.equal(shown.body.enabled, false);
    assert.ok((await viewerList()).channels.some((c) => c.name === 'Charlie'), 'shown again once offline channels aren\'t hidden');
    assert.equal((await getJson(server.baseUrl, '/live/admin/health', admin)).body.enabled, false, 'saved');
    await send(server.baseUrl, 'PATCH', '/live/admin/health', admin, { hideOffline: true, enabled: true });
    assert.ok(!(await viewerList()).channels.some((c) => c.name === 'Charlie'));

    assert.equal((await send(server.baseUrl, 'POST', `/live/admin/channels/${'f'.repeat(32)}/check`, admin)).status, 404);
  });

  test('a copy of a stream the admin numbered stands in for the first copy', async () => {
    await send(server.baseUrl, 'PATCH', '/live/admin/health', admin, { hideOffline: false });
    await patchChannel('Alpha Copy', { number: 1, name: 'Alpha Prime' });
    const list = await viewerList();
    assert.deepEqual(named(list.channels).slice(0, 2), [[1, 'Alpha Prime'], [5, 'Charlie']]);
    assert.ok(!list.channels.some((c) => c.name === 'Alpha'), 'still listed once');
    // Favourites and line-ups naming the first copy follow it.
    const favs = await viewerList('?lineup=favourites');
    assert.deepEqual(named(favs.channels), [[1, 'Alpha Prime']]);
    assert.equal(favs.channels[0].id, ids['Alpha Copy']);
    const sport = await viewerList(`?lineup=${lineups.sport}`);
    assert.deepEqual(sport.channels.map((c) => c.name), ['Charlie', 'Alpha Prime']);
    assert.equal((await getJson(server.baseUrl, `/live/channels/${ids.Alpha}`, viewer)).body.channel.id, ids['Alpha Copy']);
    assert.equal((await send(server.baseUrl, 'DELETE', `/live/favourites/${ids.Alpha}`, viewer)).body.favourite, false);
    assert.deepEqual((await viewerList('?lineup=favourites')).channels, []);
  });

  test('channels that go leave line-ups and favourites with them', async () => {
    await send(server.baseUrl, 'POST', `/live/favourites/${ids.Delta}`, viewer);
    const source = (await getJson(server.baseUrl, '/live/admin/sources', admin)).body.sources.find((s) => s.id === sourceId);
    assert.ok(source);
    await send(server.baseUrl, 'DELETE', `/live/admin/sources/${sourceId}`, admin);
    const listed = await getJson(server.baseUrl, '/live/admin/lineups', admin);
    assert.deepEqual(listed.body.lineups.map((l) => [l.name, l.channelCount]), [['Sport', 0], ['Family time', 0]]);
    assert.deepEqual((await viewerList('?lineup=favourites')).channels, []);
    assert.deepEqual((await viewerList()).lineups, []);
  });

  test('Live TV off: the new viewer routes answer P700', async () => {
    await send(server.baseUrl, 'PATCH', '/customization', admin, { liveTvEnabled: false });
    for (const [method, url] of [['GET', '/live/now'], ['GET', '/live/recent'], ['GET', '/live/search?q=ab'], ['GET', '/live/me/hidden'],
      ['POST', `/live/favourites/${ids.Bravo}`], ['POST', `/live/channels/${ids.Bravo}/watched`]]) {
      const res = await send(server.baseUrl, method, url, viewer);
      assert.equal(res.body.code, 'P700', url);
    }
    assert.equal((await getJson(server.baseUrl, '/live/admin/lineups', admin)).status, 200, 'admin routes still work');
  });
});
