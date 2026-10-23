import http from 'http';
import { test, expect } from '@playwright/test';
import { ADMIN, signIn } from './helpers.js';

// Live TV end to end, against a tiny IPTV server on this machine: a playlist with one HLS
// channel and one that isn't HLS, a programme guide, and the channel's own HLS playlist.
// 127.0.0.1 is a private address, which Plinthio only fetches for an admin's own playlist on
// such a host — exactly this case.
function startIptvFixture() {
  const now = Date.now();
  const xmltvTime = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  let base = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/playlist.m3u') {
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      return res.end([
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="fixture.news" group-title="News",Fixture News',
        `${base}/news/index.m3u8`,
        '#EXTINF:-1 tvg-id="fixture.radio" group-title="Music",Fixture Radio',
        `${base}/radio.mp3`,
        '#EXTINF:-1 tvg-id="fixture.shop" group-title="Shopping",Fixture Shop',
        `${base}/shop/index.m3u8`
      ].join('\n'));
    }
    if (req.url === '/guide.xml') {
      res.setHeader('Content-Type', 'application/xml');
      return res.end(`<?xml version="1.0"?><tv>
        <channel id="fixture.news"><display-name>Fixture News</display-name></channel>
        <programme channel="fixture.news" start="${xmltvTime(now - 15 * 60000)}" stop="${xmltvTime(now + 45 * 60000)}"><title>Morning Bulletin</title></programme>
        <programme channel="fixture.news" start="${xmltvTime(now + 45 * 60000)}" stop="${xmltvTime(now + 105 * 60000)}"><title>Weather Hour</title></programme>
      </tv>`);
    }
    if (req.url === '/news/index.m3u8' || req.url === '/shop/index.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6.0,\nsegment1.ts\n');
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base });
  }));
}

test('Live TV: an admin turns it on and adds a playlist; viewers see the guide and the stream plays through Plinthio', async ({ page, request }) => {
  const { server, base } = await startIptvFixture();
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  try {
    await signIn(page, request);

    // Off by default: no Live TV for viewers, and the page says so.
    expect((await (await request.get('/api/customization')).json()).liveTvEnabled).toBe(false);
    expect((await request.get('/api/live/channels', { headers: auth })).status()).toBe(404);

    await page.goto('/admin?tab=liveTv');
    await page.getByRole('switch', { name: 'Live TV' }).click();
    await expect(page.getByRole('switch', { name: 'Live TV' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Add channels' }).first().click();
    await page.getByRole('tab', { name: 'Your own playlist' }).click();
    await page.getByLabel('Name').fill('Fixture lineup');
    await page.getByLabel('Playlist address (M3U)').fill(`${base}/playlist.m3u`);
    await page.getByLabel('Programme guide address (XMLTV, optional)').fill(`${base}/guide.xml`);
    await page.getByRole('button', { name: 'Add playlist' }).click();
    await expect(page.getByText(/^Updated /).first()).toBeVisible({ timeout: 20000 });

    // The viewer side: the HLS channel with what's on now; the MP3 one isn't offered.
    await page.goto('/live');
    await expect(page.getByText('Fixture News').first()).toBeVisible();
    await expect(page.getByText('Morning Bulletin').first()).toBeVisible();
    await expect(page.getByText('Fixture Radio')).toHaveCount(0);

    // Opening it fetches the channel's playlist through Plinthio, every link rewritten to a
    // signed proxy link (the fixture has no real video, so playback itself isn't checked).
    const playlist = page.waitForResponse((res) => /\/api\/media\/live\/[a-f0-9]{32}\/index\.m3u8/.test(res.url()));
    await page.getByText('Fixture News').first().click();
    const res = await playlist;
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/^p\?u=[\w-]+&s=[\w-]+&token=/m);
  } finally {
    await cleanUp(request, auth);
    server.close();
  }
});

// Leaves Live TV as the other tests expect it: off, no lists, default filters.
async function cleanUp(request, auth) {
  const { sources } = await (await request.get('/api/live/admin/sources', { headers: auth })).json();
  for (const source of sources) await request.delete(`/api/live/admin/sources/${source.id}`, { headers: auth });
  await request.patch('/api/live/admin/filters', { headers: auth, data: { hiddenGroups: [] } });
  await request.patch('/api/customization', { headers: auth, data: { liveTvEnabled: false } });
}

test('Live TV filters: hide a whole category, make an exception, and public lists need the note first', async ({ page, request }) => {
  const { server, base } = await startIptvFixture();
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  try {
    // A public list can't be added before the note about public channels is confirmed.
    const early = await request.post('/api/live/admin/sources', { headers: auth, data: { kind: 'iptv-org', preset: 'countries/us' } });
    expect(early.status()).toBe(400);
    expect((await early.json()).code).toBe('P001');

    await request.patch('/api/customization', { headers: auth, data: { liveTvEnabled: true } });
    const { source } = await (await request.post('/api/live/admin/sources', {
      headers: auth, data: { kind: 'm3u', name: 'Fixture lineup', playlistUrl: `${base}/playlist.m3u`, guideUrl: `${base}/guide.xml` }
    })).json();
    await expect.poll(async () => {
      const { sources } = await (await request.get('/api/live/admin/sources', { headers: auth })).json();
      return sources.find((s) => s.id === source.id)?.refreshing;
    }, { timeout: 20000 }).toBe(false);

    await signIn(page, request);
    await page.goto('/live');
    await expect(page.getByText('Fixture Shop').first()).toBeVisible();

    // Choose what to show → Categories → Shopping off: gone for viewers.
    await page.goto('/admin?tab=liveTv');
    await page.getByRole('tab', { name: 'Categories' }).click();
    await page.getByRole('switch', { name: 'Shopping' }).click();
    await expect(page.getByRole('switch', { name: 'Shopping' })).toHaveAttribute('aria-checked', 'false');
    await page.goto('/live');
    await expect(page.getByText('Fixture News').first()).toBeVisible();
    await expect(page.getByText('Fixture Shop')).toHaveCount(0);

    // An exception for one channel brings it back while the filter stays.
    await page.goto('/admin?tab=liveTv');
    await page.getByRole('button', { name: 'Always show Fixture Shop' }).click();
    await expect.poll(async () => {
      const res = await request.get('/api/live/channels', { headers: auth });
      return (await res.json()).channels.map((c) => c.name);
    }).toContain('Fixture Shop');

    // The public-lists picker shows the note until someone confirms it.
    await page.getByRole('button', { name: 'Add channels' }).first().click();
    await expect(page.getByText('Before you add public channels')).toBeVisible();
  } finally {
    await cleanUp(request, auth);
    server.close();
  }
});
