import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { pickPageWidth } from '../src/services/pageImages.js';

// The reader asks for pages at screen width (?w=); everything else (downloads, Mihon, OPDS)
// still gets the page exactly as stored in the archive.
describe('screen-sized manga pages', () => {
  let server; let admin; let media; let itemId; let original;
  const post = (url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(body || {})
  }).then((r) => r.json());
  const fetchPage = (query = '') => fetch(`${server.baseUrl}/api/media/manga/${itemId}/page/0${query}`, { headers: authed(admin.token) });

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    media = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-pages-'));
    fs.mkdirSync(path.join(media, 'Big Scans'));
    // A noisy 2400×3600 page, like a high-resolution scan (a flat colour would compress to
    // almost nothing and prove little).
    const noise = Buffer.alloc(600 * 900 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251;
    original = await sharp(noise, { raw: { width: 600, height: 900, channels: 3 } })
      .resize(2400, 3600, { kernel: 'nearest' }).jpeg({ quality: 92 }).toBuffer();
    const zip = new AdmZip();
    zip.addFile('001.jpg', original);
    zip.writeZip(path.join(media, 'Big Scans', 'Big Scans v01.cbz'));
    const lib = await post('/libraries', { name: 'Manga', path: media, type: 'manga' });
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${lib.library.id}/scan`);
      if (r.status !== 'busy') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    itemId = (await getJson(server.baseUrl, '/items', admin.token)).body.items[0].id;
  });
  after(async () => { await server.stop(); fs.rmSync(media, { recursive: true, force: true }); });

  test('widths round up to a few standard sizes; anything odd means the original', () => {
    assert.equal(pickPageWidth('390'), 720);
    assert.equal(pickPageWidth('1170'), 1440);
    assert.equal(pickPageWidth('2160'), 2160);
    assert.equal(pickPageWidth('5000'), null);
    assert.equal(pickPageWidth('abc'), null);
    assert.equal(pickPageWidth('-4'), null);
    assert.equal(pickPageWidth(undefined), null);
  });

  test('without ?w= the page is the untouched original', async () => {
    const res = await fetchPage();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(original));
  });

  test('with ?w= it is scaled to that width, smaller, and served again from cache', async () => {
    const res = await fetchPage('?w=1170');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 1440);
    assert.equal(meta.height, 2160);
    assert.ok(bytes.length < original.length / 2, `${bytes.length} should be well under ${original.length}`);

    const again = Buffer.from(await (await fetchPage('?w=1170')).arrayBuffer());
    assert.ok(again.equals(bytes));
  });

  test('a page is never scaled up', async () => {
    const meta = await sharp(Buffer.from(await (await fetchPage('?w=2160')).arrayBuffer())).metadata();
    assert.equal(meta.width, 2160);
  });
});
