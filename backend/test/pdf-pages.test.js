import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/three-pages.pdf');

// The Docker image ships poppler; a dev machine without it skips these.
let hasPoppler = true;
try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); } catch (e) { hasPoppler = false; }

// PDFs read page by page: the server renders each page to a JPEG behind the same page API
// comics use.
describe('PDF pages', { skip: !hasPoppler && 'poppler (pdfinfo/pdftoppm) is not installed' }, () => {
  let server; let admin; let media; let itemId; let libId;
  const post = (url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(body || {})
  }).then((r) => r.json());

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    media = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-pdf-'));
    fs.copyFileSync(PDF, path.join(media, 'Field Guide.pdf'));
    const lib = await post('/libraries', { name: 'Books', path: media, type: 'books' });
    libId = lib.library.id;
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${lib.library.id}/scan`);
      if (r.status !== 'busy') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const items = (await getJson(server.baseUrl, '/items', admin.token)).body.items;
    itemId = items.find((i) => i.title === 'Field Guide').id;
  });
  after(async () => { await server.stop(); fs.rmSync(media, { recursive: true, force: true }); });

  test('a scanned PDF knows its page count and gets page one as its cover', async () => {
    const item = (await getJson(server.baseUrl, `/items/${itemId}`, admin.token)).body.item;
    assert.equal(item.total_pages, 3);
    assert.equal(item.format, 'pdf');
    assert.ok(item.cover_path, 'page one became the cover');
  });

  test('pages list and render as JPEGs; past the end is a 404', async () => {
    const list = (await getJson(server.baseUrl, `/media/manga/${itemId}/pages`, admin.token)).body;
    assert.equal(list.totalPages, 3);
    const page = await fetch(`${server.baseUrl}/api/media/manga/${itemId}/page/2`, { headers: authed(admin.token) });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await page.arrayBuffer());
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    const past = await fetch(`${server.baseUrl}/api/media/manga/${itemId}/page/3`, { headers: authed(admin.token) });
    assert.equal(past.status, 404);
  });

  test('OPDS readers get page streaming for PDFs', async () => {
    const key = (await post('/keys', { name: 'Reader' })).key.key;
    const res = await fetch(`${server.baseUrl}/api/opds/library/${libId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`admin:${key}`).toString('base64')}` }
    });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /opds-pse\/stream[^>]+pse:count="3"/);
  });
});
