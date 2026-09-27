import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';
import { koreaderPartialMd5 } from '../src/routes/kosync.js';

// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function makeCbz(file, pages) {
  const zip = new AdmZip();
  for (let i = 1; i <= pages; i++) zip.addFile(`${String(i).padStart(3, '0')}.png`, PNG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

// Mihon (Komga extension + tracker) and KOReader (kosync) against real scanned files.
describe('sync apps', () => {
  let server; let admin; let media; let apiKey; let keyId; let v1Path;
  const basic = (key) => ({ Authorization: `Basic ${Buffer.from(`admin:${key}`).toString('base64')}` });
  const komga = (url, headers = {}, init = {}) => fetch(`${server.baseUrl}/api${url}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const post = (url, body) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST', headers: { ...authed(admin.token), 'content-type': 'application/json' }, body: JSON.stringify(body || {})
  }).then((r) => r.json());

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    media = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-sync-'));
    v1Path = path.join(media, 'Saga', 'Saga v01.cbz');
    makeCbz(v1Path, 3);
    makeCbz(path.join(media, 'Saga', 'Saga v02.cbz'), 4);
    const lib = await post('/libraries', { name: 'Manga', path: media, type: 'manga' });
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${lib.library.id}/scan`);
      if (r.status !== 'busy') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const key = (await post('/keys', { name: 'Phone' })).key;
    apiKey = key.key;
    keyId = key.id;
  });
  after(async () => { await server.stop(); fs.rmSync(media, { recursive: true, force: true }); });

  describe('Komga API for Mihon', () => {
    let seriesId; let cookie; let books;

    test('asks for credentials, then signs in with username + API key', async () => {
      const anon = await komga('/v1/libraries');
      assert.equal(anon.status, 401);
      assert.match(anon.headers.get('www-authenticate'), /Basic/);
      assert.equal((await komga('/v1/libraries', basic('wrong'))).status, 401);

      const res = await komga('/v1/libraries', basic(apiKey));
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).map((l) => l.name), ['Manga']);
      cookie = res.headers.get('set-cookie').split(';')[0];
      assert.match(cookie, /^plinthio_komga=/);
    });

    test('series come back as a Komga page with the fields the extension reads', async () => {
      const page = await (await komga('/v1/series?page=0&deleted=false&sort=metadata.titleSort,asc', { 'X-API-Key': apiKey })).json();
      assert.equal(page.totalElements, 1);
      assert.equal(page.last, true);
      const s = page.content[0];
      seriesId = s.id;
      assert.equal(s.name, 'Saga');
      assert.equal(s.booksCount, 2);
      assert.equal(s.metadata.title, 'Saga');
      assert.equal(typeof s.metadata.summary, 'string');
      assert.equal(s.metadata.readingDirection, 'RIGHT_TO_LEFT');
      assert.ok(Array.isArray(s.booksMetadata.authors));
      assert.match(s.fileLastModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

      const search = await (await komga('/v1/series?search=nothing-like-it', { 'X-API-Key': apiKey })).json();
      assert.equal(search.totalElements, 0);
    });

    test('books, page lists (numbered from 1) and page images', async () => {
      const page = await (await komga(`/v1/series/${seriesId}/books?unpaged=true&media_status=READY&deleted=false`, { 'X-API-Key': apiKey })).json();
      books = page.content;
      assert.deepEqual(books.map((b) => b.metadata.numberSort), [1, 2]);
      assert.equal(books[0].media.pagesCount, 3);
      assert.equal(books[0].media.mediaProfile, 'DIVINA');
      assert.equal(books[0].seriesTitle, 'Saga');

      const pages = await (await komga(`/v1/books/${books[0].id}/pages`, { 'X-API-Key': apiKey })).json();
      assert.deepEqual(pages.map((p) => p.number), [1, 2, 3]);
      assert.equal(pages[0].mediaType, 'image/png');
      const img = await komga(`/v1/books/${books[0].id}/pages/3`, { 'X-API-Key': apiKey });
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.equal((await komga(`/v1/books/${books[0].id}/pages/4`, { 'X-API-Key': apiKey })).status, 404);
    });

    test('the tracker syncs with only the session cookie', async () => {
      const url = `/v2/series/${seriesId}/read-progress/tachiyomi`;
      let progress = await (await komga(url, { Cookie: cookie })).json();
      assert.equal(progress.booksCount, 2);
      assert.equal(progress.lastReadContinuousNumberSort, 0);
      assert.equal(progress.maxNumberSort, 2);

      const put = await komga(url, { Cookie: cookie, 'content-type': 'application/json' }, { method: 'PUT', body: JSON.stringify({ lastBookNumberSortRead: 1 }) });
      assert.equal(put.status, 204);
      progress = await (await komga(url, { Cookie: cookie })).json();
      assert.equal(progress.booksReadCount, 1);
      assert.equal(progress.lastReadContinuousNumberSort, 1);

      // Plinthio sees it too.
      const item = (await getJson(server.baseUrl, `/items/${books[0].id}`, admin.token)).body.item;
      assert.equal(item.is_finished, 1);
    });

    test('deleting the API key ends the cookie session', async () => {
      const other = await post('/keys', { name: 'Temp' });
      const res = await komga('/v1/libraries', basic(other.key.key));
      const tempCookie = res.headers.get('set-cookie').split(';')[0];
      assert.equal((await komga('/v1/libraries', { Cookie: tempCookie })).status, 200);
      await fetch(`${server.baseUrl}/api/keys/${other.key.id}`, { method: 'DELETE', headers: authed(admin.token) });
      assert.equal((await komga('/v1/libraries', { Cookie: tempCookie })).status, 401);
    });
  });

  describe('KOReader sync', () => {
    const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
    const ko = (url, init = {}, key = apiKey) => fetch(`${server.baseUrl}/api/kosync${url}`, {
      ...init,
      headers: { 'x-auth-user': 'admin', 'x-auth-key': md5(key), accept: 'application/vnd.koreader.v1+json', 'content-type': 'application/json', ...(init.headers || {}) }
    });

    test('login with username + API key; registering is refused', async () => {
      assert.equal((await ko('/users/auth')).status, 200);
      assert.equal((await ko('/users/auth', {}, 'wrong')).status, 401);
      const reg = await fetch(`${server.baseUrl}/api/kosync/users/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(reg.status, 402);
    });

    test('a position for a library book moves Plinthio\'s progress, and comes back', async () => {
      const document = koreaderPartialMd5(path.join(media, 'Saga', 'Saga v02.cbz'));
      const put = await ko('/syncs/progress', { method: 'PUT', body: JSON.stringify({ document, progress: '2', percentage: 0.5, device: 'Kobo', device_id: 'abc' }) });
      assert.equal(put.status, 200);
      assert.equal((await put.json()).document, document);

      const series = (await getJson(server.baseUrl, '/items/series/Saga', admin.token)).body.series;
      const v2 = series.volumes.find((v) => v.volume === 2);
      assert.equal(v2.current_page, 2);
      assert.equal(v2.progress_percent, 50);

      const got = await (await ko(`/syncs/progress/${document}`)).json();
      assert.equal(got.progress, '2');
      assert.equal(got.device, 'Kobo');
    });

    test('Plinthio\'s newer page is sent to KOReader; unknown books still sync between devices', async () => {
      const document = koreaderPartialMd5(path.join(media, 'Saga', 'Saga v02.cbz'));
      const items = (await getJson(server.baseUrl, '/items/series/Saga', admin.token)).body.series.volumes;
      const v2 = items.find((v) => v.volume === 2);
      await new Promise((r) => setTimeout(r, 1100)); // timestamps are to the second
      await post(`/progress/${v2.id}`, { currentPage: 3, totalPages: 4 });
      const got = await (await ko(`/syncs/progress/${document}`)).json();
      assert.equal(got.progress, '3');
      assert.equal(got.device, 'Plinthio');

      const stranger = md5('not in the library');
      assert.deepEqual(await (await ko(`/syncs/progress/${stranger}`)).json(), {});
      await ko('/syncs/progress', { method: 'PUT', body: JSON.stringify({ document: stranger, progress: '/body/DocFragment[3]', percentage: 0.2, device: 'Kindle', device_id: 'k' }) });
      assert.equal((await (await ko(`/syncs/progress/${stranger}`)).json()).progress, '/body/DocFragment[3]');
    });
  });
});
