import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import zlib from 'zlib';
import { Readable } from 'stream';

// The proxy signs with a key derived from the server secret (config/env.js), so set one up
// before anything imports it.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-live-unit-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'live-tv-unit-test-secret';

const { parseM3u, cleanChannelName, isHlsUrl, isAdultGroup } = await import('../src/services/m3u.js');
const { parseXmltv, parseXmltvTime } = await import('../src/services/xmltv.js');
const { rewritePlaylist, sign, verify, decodeUrlParam, looksLikePlaylist, logoPath } = await import('../src/services/liveProxy.js');
const { addressBlock, openUpstream, readBody, decodedBody } = await import('../src/services/safeFetch.js');
const {
  guideTargets, isRefreshDue, iptvOrgDetails, hostGroup, filterReasons, isFilteredOut, cleanFilterList
} = await import('../src/services/liveTv.js');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('M3U playlists', () => {
  const playlist = [
    '#EXTM3U x-tvg-url="https://guide.example/epg.xml.gz,https://guide.example/other.xml"',
    '#EXTINF:-1 tvg-id="News.us@SD" tvg-logo="https://img.example/news.png" group-title="News;General",News 24 (720p) [Geo-blocked]',
    'https://cdn.example/news/index.m3u8',
    '#EXTINF:-1 tvg-id="" tvg-name="Fallback" group-title="Movies",Movie Box [Not 24/7;Geo-blocked]',
    '#EXTVLCOPT:http-referrer=https://movies.example/',
    '#EXTVLCOPT:http-user-agent=Mozilla/5.0 Test',
    'https://cdn.example/movies/live.m3u8?token=abc',
    '#EXTINF:-1 tvg-id="News.us@SD" group-title="News",News 24 (1080p)',
    'https://cdn.example/news/hd.m3u8',
    '#EXTINF:-1,Comma, In "Name"',
    'rtmp://cdn.example/live/stream',
    '#EXTINF:-1 group-title="XXX",Late',
    'https://cdn.example/late.mpd',
    'https://orphan.example/no-extinf.m3u8'
  ].join('\r\n');

  test('reads channels, attributes and the guide address', () => {
    const parsed = parseM3u(playlist);
    assert.deepEqual(parsed.guideUrls, ['https://guide.example/epg.xml.gz', 'https://guide.example/other.xml']);
    assert.equal(parsed.channels.length, 5, 'a URL with no #EXTINF before it is not a channel');

    const [news, movie, newsHd, comma, late] = parsed.channels;
    assert.equal(news.tvgId, 'News.us@SD');
    assert.equal(news.name, 'News 24 (720p)');
    assert.equal(news.geoBlocked, true);
    assert.deepEqual(news.groups, ['News', 'General']);
    assert.equal(news.logo, 'https://img.example/news.png');
    assert.equal(news.stableKey, 'News.us@SD');

    assert.equal(movie.tvgId, null);
    assert.equal(movie.name, 'Movie Box');
    assert.equal(movie.geoBlocked, true);
    assert.equal(movie.stableKey, 'Movie Box', 'no tvg-id: keyed by name');
    assert.deepEqual(movie.headers, { referrer: 'https://movies.example/', userAgent: 'Mozilla/5.0 Test' });

    assert.equal(newsHd.stableKey, 'News.us@SD #2', 'a repeated tvg-id still gets its own key');
    assert.equal(comma.name, 'Comma, In "Name"');
    assert.deepEqual(late.groups, ['XXX']);
  });

  test('country and languages from tvg-country / tvg-language', () => {
    const [a, b] = parseM3u([
      '#EXTM3U',
      '#EXTINF:-1 tvg-country="us;ca" tvg-language="English; Spanish;english",A',
      'https://cdn.example/a.m3u8',
      '#EXTINF:-1 tvg-country="INT",B',
      'https://cdn.example/b.m3u8'
    ].join('\n')).channels;
    assert.equal(a.country, 'US', 'the first code, upper case');
    assert.deepEqual(a.languages, ['english', 'spanish']);
    assert.equal(b.country, null, 'not a two-letter code');
    assert.deepEqual(b.languages, []);
  });

  test('is not fooled by things that are not playlists', () => {
    assert.equal(parseM3u('<html>nope</html>'), null);
    assert.equal(parseM3u(''), null);
    assert.deepEqual(parseM3u('﻿#EXTM3U\n').channels, []);
  });

  test('tags come out of names; only the geo tag becomes a flag', () => {
    assert.deepEqual(cleanChannelName('Plain [Not 24/7]'), { name: 'Plain', geoBlocked: false });
    assert.deepEqual(cleanChannelName('Both [Not 24/7;Geo-blocked]'), { name: 'Both', geoBlocked: true });
    assert.deepEqual(cleanChannelName('Kept [Live] [Geo-blocked]'), { name: 'Kept [Live]', geoBlocked: true });
  });

  test('HLS detection and the adult filter', () => {
    assert.equal(isHlsUrl('https://a.example/x/index.m3u8'), true);
    assert.equal(isHlsUrl('http://a.example/play?type=m3u8'), true);
    assert.equal(isHlsUrl('https://a.example/manifest.mpd'), false);
    assert.equal(isHlsUrl('rtmp://a.example/live.m3u8'), false);
    assert.equal(isHlsUrl('not a url'), false);
    assert.equal(isAdultGroup(['News', 'XXX']), true);
    assert.equal(isAdultGroup(['adult entertainment']), true);
    assert.equal(isAdultGroup(['Kids']), false);
  });
});

describe('XMLTV guides', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  const stamp = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
  };
  const hour = 60 * 60 * 1000;
  const programme = (channel, start, stop, inner) =>
    `<programme start="${stamp(start)}" stop="${stamp(stop)}" channel="${channel}">${inner}</programme>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><tv>
    <channel id="News.us"><display-name>News</display-name></channel>
    <channel id="Other.us@SD"><display-name>Other</display-name></channel>
    ${programme('News.us', now - hour, now + hour, '<title lang="en">Morning &amp; Noon</title><title lang="fr">Matin</title><sub-title>Part 1</sub-title><desc>Café <![CDATA[<b>talk</b>]]></desc><category>News</category><category>Talk</category>')}
    ${programme('News.us', now + hour, now + 2 * hour, '<title>Next Up</title>')}
    ${programme('News.us', now - 5 * hour, now - 4 * hour, '<title>Long Gone</title>')}
    ${programme('News.us', now + 40 * hour, now + 41 * hour, '<title>Too Far Ahead</title>')}
    ${programme('Unknown.us', now, now + hour, '<title>Nobody Watches</title>')}
    ${programme('Other.us@SD', now, now + hour, '<title>Stray & ampersand</title>')}
  </tv>`;

  test('parses XMLTV times with and without offsets', () => {
    assert.equal(parseXmltvTime('20261022120000 +0000'), now);
    assert.equal(parseXmltvTime('20261022140000 +0200'), now);
    assert.equal(parseXmltvTime('20261022070000 -0500'), now);
    assert.equal(parseXmltvTime('202610221200'), now);
    assert.equal(parseXmltvTime('garbage'), null);
  });

  test('streams a gzipped guide, keeping only wanted channels inside the window', async () => {
    const gz = zlib.gzipSync(Buffer.from(xml));
    // Feed it in small pieces, as a download would arrive.
    const pieces = [];
    for (let i = 0; i < gz.length; i += 64) pieces.push(gz.subarray(i, i + 64));
    const body = await decodedBody(Readable.from(pieces), 10 * 1024 * 1024);

    const channels = [];
    const got = [];
    const targets = guideTargets(['News.us@SD', 'Other.us@SD'], (id) => channels.includes(id));
    const total = await parseXmltv(body, {
      from: now - 2 * hour,
      to: now + 36 * hour,
      onChannel: (id) => channels.push(id),
      targets,
      onBatch: async (batch) => { got.push(...batch); }
    });

    assert.deepEqual(channels, ['News.us', 'Other.us@SD']);
    assert.equal(total, 3);
    const titles = got.map((p) => `${p.tvgId}:${p.title}`);
    assert.deepEqual(titles, ['News.us@SD:Morning & Noon', 'News.us@SD:Next Up', 'Other.us@SD:Stray & ampersand']);
    const first = got[0];
    assert.equal(first.subtitle, 'Part 1');
    assert.equal(first.description, 'Café <b>talk</b>');
    assert.equal(first.category, 'News', 'the first category');
    assert.equal(first.start, now - hour);
    assert.equal(first.stop, now + hour);
  });

  test('refuses a guide that unzips past the size cap', async () => {
    const gz = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024, 0x20));
    const body = await decodedBody(Readable.from([gz]), 1024 * 1024);
    await assert.rejects(
      parseXmltv(body, { from: 0, to: Infinity, targets: () => [], onBatch: async () => {} }),
      /too large/
    );
  });

  test('a bare guide id feeds its "@feed" channels unless the guide lists that feed itself', () => {
    const listed = new Set(['News.us', 'Sport.us@East']);
    const targets = guideTargets(['News.us@SD', 'News.us@West', 'Sport.us@East', 'Plain.us'], (id) => listed.has(id));
    assert.deepEqual(targets('News.us'), ['News.us@SD', 'News.us@West']);
    assert.deepEqual(targets('Sport.us'), [], 'Sport.us@East has its own schedule');
    assert.deepEqual(targets('Sport.us@East'), ['Sport.us@East']);
    assert.deepEqual(targets('Plain.us@HD'), ['Plain.us'], 'a feed-only guide still feeds a plain id');
    assert.deepEqual(targets('Nope'), []);
  });

  test('refresh schedule: every 12 hours, failures retried after an hour', () => {
    const t = Date.UTC(2026, 9, 22, 12);
    assert.equal(isRefreshDue(null, null, t), true);
    assert.equal(isRefreshDue(new Date(t - 11 * 3600e3).toISOString(), null, t), false);
    assert.equal(isRefreshDue(new Date(t - 13 * 3600e3).toISOString(), null, t), true);
    assert.equal(isRefreshDue(null, t - 30 * 60e3, t), false);
    assert.equal(isRefreshDue(null, t - 61 * 60e3, t), true);
  });
});

describe('stream proxy links', () => {
  const channelId = 'a'.repeat(32);

  test('rewrites every URI in a playlist to a signed link carrying the token', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="aud"',
      '720p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2560000',
      'https://other.example/1080p.m3u8',
      '#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1.bin",IV=0x1',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,AAAA"',
      '#EXTINF:6.0,',
      '/abs/seg1.ts',
      ''
    ].join('\n');
    const out = rewritePlaylist(master, 'https://cdn.example/live/ch/index.m3u8', channelId, '&token=t0k');
    const lines = out.split('\n');

    const links = [];
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      links.push(line);
    }
    for (const m of out.matchAll(/URI="([^"]*)"/g)) links.push(m[1]);

    const expected = [
      'https://cdn.example/live/ch/720p/index.m3u8',
      'https://other.example/1080p.m3u8',
      'https://cdn.example/abs/seg1.ts',
      'https://cdn.example/live/ch/audio/en.m3u8',
      'https://cdn.example/live/keys/k1.bin',
      'https://cdn.example/live/ch/init.mp4'
    ];
    const decoded = [];
    for (const link of links) {
      if (link.startsWith('data:')) continue;
      const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
      assert.ok(link.startsWith('p?u='), link);
      assert.equal(params.get('token'), 't0k');
      const url = decodeUrlParam(params.get('u'));
      assert.ok(verify(channelId, url, params.get('s')), `signature for ${url}`);
      decoded.push(url);
    }
    assert.deepEqual(decoded.sort(), [...expected].sort());
    assert.ok(out.includes('URI="data:text/plain;base64,AAAA"'), 'non-http URIs are left alone');
    assert.ok(out.includes('#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="aud"'), 'other tags untouched');
    assert.ok(!/https?:\/\//.test(out.replace(/data:[^"]*/, '')), 'no raw upstream address survives');
  });

  test('signatures are bound to the URL and the channel', () => {
    const url = 'https://cdn.example/seg.ts';
    const s = sign(channelId, url);
    assert.equal(verify(channelId, url, s), true);
    assert.equal(verify(channelId, `${url}?x`, s), false);
    assert.equal(verify('b'.repeat(32), url, s), false);
    assert.equal(verify(channelId, url, `${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`), false);
    assert.equal(verify(channelId, url, ''), false);
    assert.equal(verify(channelId, url, undefined), false);
    assert.equal(decodeUrlParam('not/base64url!'), null);
  });

  test('logos are served from this server, per channel', () => {
    assert.equal(logoPath(channelId, 'https://img.example/a.png'), `/api/media/live/${channelId}/logo`);
    assert.equal(logoPath(channelId, 'javascript:alert(1)'), null);
    assert.equal(logoPath(channelId, null), null);
  });

  test('recognises playlists by their first line', () => {
    assert.equal(looksLikePlaylist(Buffer.from('﻿  #EXTM3U\n')), true);
    assert.equal(looksLikePlaylist(Buffer.from('<html>')), false);
  });
});

describe('address guard', () => {
  test('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '100.64.0.1', '::1', 'fd12::1', '::ffff:192.168.1.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:0101::1']) {
      assert.ok(addressBlock(ip), `${ip} should be blocked`);
    }
    for (const ip of ['169.254.169.254', '0.0.0.0', 'fe80::1', '224.0.0.1', '100.100.100.200', 'fd00:ec2::254', '::ffff:169.254.169.254']) {
      assert.equal(addressBlock(ip), 'never', `${ip} is never allowed`);
      assert.equal(addressBlock(ip, { allowPrivate: true }), 'never', `${ip} stays blocked for an allowed host`);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '172.32.0.1']) {
      assert.equal(addressBlock(ip), null, `${ip} is public`);
    }
    assert.equal(addressBlock('192.168.1.1', { allowPrivate: true }), null);
    assert.equal(addressBlock('not-an-ip'), 'never');
  });

  describe('when fetching', () => {
    let server;
    let port;
    before(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/redirect-private') {
          res.writeHead(302, { location: 'http://10.0.0.1/secret' });
          return res.end();
        }
        if (req.url === '/redirect-loop') {
          res.writeHead(302, { location: '/redirect-loop' });
          return res.end();
        }
        if (req.url === '/redirect-ok') {
          res.writeHead(301, { location: '/hello' });
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(req.headers.cookie ? 'cookie!' : 'hello');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      port = server.address().port;
    });
    after(() => new Promise((r) => server.close(r)));

    test('refuses a private address unless that host is allowed', async () => {
      await assert.rejects(openUpstream(`http://127.0.0.1:${port}/hello`), (err) => err.blocked === true);
      const { res, url } = await openUpstream(`http://127.0.0.1:${port}/hello`, { allowPrivateHosts: ['127.0.0.1'] });
      assert.equal((await readBody(res, 1000)).toString(), 'hello');
      assert.equal(url, `http://127.0.0.1:${port}/hello`);
    });

    test('checks names at connect time, so a name for a private address is refused', async () => {
      await assert.rejects(openUpstream(`http://localhost:${port}/hello`, { allowPrivateHosts: ['127.0.0.1'] }), (err) => err.blocked === true);
    });

    test('re-checks every redirect, and stops after five', async () => {
      const allow = { allowPrivateHosts: ['127.0.0.1'] };
      const ok = await openUpstream(`http://127.0.0.1:${port}/redirect-ok`, allow);
      assert.equal(ok.url, `http://127.0.0.1:${port}/hello`);
      ok.res.resume();
      await assert.rejects(openUpstream(`http://127.0.0.1:${port}/redirect-private`, allow), (err) => err.blocked === true);
      await assert.rejects(openUpstream(`http://127.0.0.1:${port}/redirect-loop`, allow), /Too many redirects/);
    });

    test('only http and https', async () => {
      await assert.rejects(openUpstream('file:///etc/passwd'), (err) => err.blocked === true);
      await assert.rejects(openUpstream('ftp://example.com/x'), (err) => err.blocked === true);
    });

    test('caps how much is read', async () => {
      const { res } = await openUpstream(`http://127.0.0.1:${port}/hello`, { allowPrivateHosts: ['127.0.0.1'] });
      await assert.rejects(readBody(res, 2), /too large/);
    });
  });
});

describe('lanHostOf: which hosts may reach private addresses', () => {
  test('private IPs and home-network names count; public names never do', async () => {
    const { lanHostOf } = await import('../src/services/safeFetch.js');
    assert.equal(lanHostOf('http://192.168.1.20:8080/live.m3u'), '192.168.1.20');
    assert.equal(lanHostOf('http://[fd12::5]/a.m3u8'), 'fd12::5');
    assert.equal(lanHostOf('http://iptvbox/channels.m3u'), 'iptvbox');
    assert.equal(lanHostOf('http://tuner.local/lineup.m3u'), 'tuner.local');
    assert.equal(lanHostOf('http://media.home.arpa/x.m3u'), 'media.home.arpa');
    // A public name could be re-pointed at the home network later (DNS rebinding).
    assert.equal(lanHostOf('https://streams.example.com/live.m3u8'), null);
    assert.equal(lanHostOf('http://8.8.8.8/a.m3u8'), null);
    // Link-local / metadata addresses are never "LAN" either.
    assert.equal(lanHostOf('http://169.254.169.254/latest'), null);
    assert.equal(lanHostOf('not a url'), null);
  });
});

describe('Live TV filters', () => {
  const data = {
    countries: new Map([['News.us', 'US']]),
    feeds: new Map([['News.us@SD', 'eng;spa'], ['News.us@HD', '']]),
    mainFeeds: new Map([['News.us', 'eng']])
  };

  test('iptv-org details: the feed, else the main feed; the country from the id as a fallback', () => {
    assert.deepEqual(iptvOrgDetails('News.us@SD', data), { country: 'US', languages: ['eng', 'spa'] });
    assert.deepEqual(iptvOrgDetails('News.us@HD', data), { country: 'US', languages: ['eng'] }, 'a feed with no languages');
    assert.deepEqual(iptvOrgDetails('News.us', data), { country: 'US', languages: ['eng'] });
    assert.deepEqual(iptvOrgDetails('Other.fr@SD', data), { country: 'FR', languages: null });
    assert.deepEqual(iptvOrgDetails('News.us@SD', null), { country: 'US', languages: null }, 'no data at all');
    assert.deepEqual(iptvOrgDetails('NoCountry@SD', data), { country: null, languages: null });
    assert.deepEqual(iptvOrgDetails(null, data), { country: null, languages: null });
  });

  test('stream hosts are grouped by their registered domain', () => {
    assert.equal(hostGroup('abc.jmp2.uk'), 'jmp2.uk');
    assert.equal(hostGroup('a.b.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(hostGroup('example.com'), 'example.com');
    assert.equal(hostGroup('10.0.0.5'), '10.0.0.5');
    assert.equal(hostGroup('[::1]'), '[::1]');
    assert.equal(hostGroup('tvbox'), 'tvbox');
    assert.equal(hostGroup(null), null);
  });

  test('which filters catch a channel', () => {
    const compiled = {
      hideGeoBlocked: true,
      groups: new Set(['Shopping']),
      languages: new Set(['spa', 'cat']),
      countries: new Set(['FR']),
      hosts: new Set(['jmp2.uk'])
    };
    const row = (fields) => ({ geo_blocked: 0, groups: 'News', languages: 'eng', country: 'US', stream_url: 'https://cdn.example/x.m3u8', pinned: 0, ...fields });
    assert.deepEqual(filterReasons(row({}), compiled), []);
    assert.deepEqual(filterReasons(row({ geo_blocked: 1 }), compiled), [{ type: 'geoBlocked', value: true }]);
    assert.deepEqual(filterReasons(row({ groups: 'News;Shopping' }), compiled), [{ type: 'group', value: 'Shopping' }]);
    assert.deepEqual(filterReasons(row({ languages: 'spa;eng' }), compiled), [], 'one of its languages is still shown');
    assert.deepEqual(filterReasons(row({ languages: 'spa;cat' }), compiled), [{ type: 'language', value: 'spa' }, { type: 'language', value: 'cat' }]);
    assert.deepEqual(filterReasons(row({ languages: null }), compiled), []);
    assert.deepEqual(filterReasons(row({ country: 'FR' }), compiled), [{ type: 'country', value: 'FR' }]);
    assert.deepEqual(filterReasons(row({ stream_url: 'https://jmp2.uk/x.m3u8' }), compiled), [{ type: 'host', value: 'jmp2.uk' }]);
    assert.deepEqual(filterReasons(row({ stream_url: 'https://a.b.jmp2.uk/x.m3u8' }), compiled), [{ type: 'host', value: 'jmp2.uk' }]);
    assert.deepEqual(filterReasons(row({ stream_url: 'https://notjmp2.uk/x.m3u8' }), compiled), []);
    const everything = row({ geo_blocked: 1, groups: 'Shopping', country: 'FR' });
    assert.equal(filterReasons(everything, compiled).length, 3);
    assert.equal(filterReasons(everything, compiled, { first: true }).length, 1);
    assert.equal(isFilteredOut(everything, compiled), true);
    assert.equal(isFilteredOut({ ...everything, pinned: 1 }, compiled), false, 'pinned passes the filters by');
  });

  test('filter lists are cleaned, or refused', () => {
    assert.deepEqual(cleanFilterList('hiddenCountries', ['fr', 'FR', ' es ']), ['FR', 'ES']);
    assert.equal(cleanFilterList('hiddenCountries', ['France']), null);
    assert.deepEqual(cleanFilterList('hiddenHosts', ['*.Jmp2.UK', '.cdn.example.', '[::1]']), ['jmp2.uk', 'cdn.example', '[::1]']);
    assert.equal(cleanFilterList('hiddenHosts', ['https://jmp2.uk']), null);
    assert.deepEqual(cleanFilterList('hiddenLanguages', ['SPA', 'spa']), ['spa']);
    assert.equal(cleanFilterList('hiddenGroups', [' ']), null);
    assert.equal(cleanFilterList('hiddenGroups', 'News'), null);
  });
});
