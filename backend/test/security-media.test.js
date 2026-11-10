import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const TINY_MP4 = path.join(testDir, 'fixtures/tiny.mp4');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SECRET = 'TOP-SECRET-SERVER-KEY';
// Making an API key asks for the account's password (setupAdmin's default).
const ADMIN_PASSWORD = 'test-password-123';
const SRT = '1\n00:00:00,000 --> 00:00:01,000\nBonjour\n';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
})();

function makeCbz(file, pages = 2) {
  const zip = new AdmZip();
  for (let i = 1; i <= pages; i++) zip.addFile(`${String(i).padStart(3, '0')}.png`, PNG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

function put(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (Buffer.isBuffer(source) || !fs.existsSync(source)) fs.writeFileSync(file, source);
  else fs.copyFileSync(source, file);
}

function link(target, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
}

// Symlinks, playlist files and path disclosure, against real files scanned by a real server.
describe('media file safety', () => {
  let server; let admin; let viewer; let viewerId;
  let root; let movies; let manga; let outside;
  let items;

  const api = (url, token, init = {}) => fetch(`${server.baseUrl}/api${url}`, { ...init, headers: { ...authed(token), ...(init.headers || {}) } });
  const post = (url, body, token = admin.token) => fetch(`${server.baseUrl}/api${url}`, {
    method: 'POST', headers: { ...authed(token), 'content-type': 'application/json' }, body: JSON.stringify(body || {})
  }).then((r) => r.json());
  const byTitle = (title) => items.find((i) => i.title === title);
  const db = async (fn) => {
    const conn = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await conn.run('PRAGMA busy_timeout = 5000');
    try { return await fn(conn); } finally { await conn.close(); }
  };
  const scan = async (libraryId) => {
    for (let i = 0; i < 100; i++) {
      const r = await post(`/libraries/${libraryId}/scan`);
      if (r.status !== 'busy') return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('scan never finished');
  };

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-secmedia-')));
    movies = path.join(root, 'movies');
    manga = path.join(root, 'manga');
    outside = path.join(root, 'outside');

    // Things the server can read but that aren't in any library.
    put(path.join(outside, 'secret.txt'), Buffer.from(SECRET));
    put(path.join(outside, 'Private Film.mp4'), TINY_MP4);
    put(path.join(outside, 'folder', 'Folder Film.mp4'), TINY_MP4);
    makeCbz(path.join(outside, 'private.cbz'));

    // Movies: a real film with a real subtitle, and every kind of link.
    put(path.join(movies, 'Real Film (2020)', 'Real Film (2020).mp4'), TINY_MP4);
    put(path.join(movies, 'Real Film (2020)', 'Real Film (2020).fr.srt'), Buffer.from(SRT));
    link(path.join(outside, 'secret.txt'), path.join(movies, 'Real Film (2020)', 'Real Film (2020).en.srt'));
    put(path.join(movies, 'Real Film (2020)', 'Real Film (2020).zz.srt'), Buffer.alloc(9 * 1024 * 1024, 'a'));
    link(path.join(movies, 'Real Film (2020)', 'Real Film (2020).mp4'), path.join(movies, 'Inside Link (2021)', 'Inside Link (2021).mp4'));
    link(path.join(outside, 'Private Film.mp4'), path.join(movies, 'Leak (2022)', 'Leak (2022).mp4'));
    link(path.join(outside, 'folder'), path.join(movies, 'Linked Folder'));
    put(path.join(movies, 'Swap (2023)', 'Swap (2023).mp4'), TINY_MP4);
    put(path.join(movies, 'Script (2024)', 'Script (2024).mp4'), Buffer.from(`ffconcat version 1.0\nfile '${path.join(outside, 'Private Film.mp4')}'\n`));
    makeCbz(path.join(movies, 'shared.cbz'));

    // Manga: real volumes, a link out, and a link into the other library.
    makeCbz(path.join(manga, 'Saga', 'Saga v01.cbz'));
    makeCbz(path.join(manga, 'Saga', 'Saga v02.cbz'));
    link(path.join(outside, 'private.cbz'), path.join(manga, 'Saga', 'Saga v03.cbz'));
    link(path.join(movies, 'shared.cbz'), path.join(manga, 'Cross', 'Cross v01.cbz'));

    const movieLib = (await post('/libraries', { name: 'Movies', path: movies, type: 'movies' })).library;
    const mangaLib = (await post('/libraries', { name: 'Manga', path: manga, type: 'manga' })).library;
    await scan(movieLib.id);
    await scan(mangaLib.id);

    items = await db((conn) => conn.all('SELECT id, title, path, media_type, missing_since FROM items'));

    await post('/users', { username: 'viewer', password: 'viewer-password-1', role: 'viewer' });
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password-1' })
    }).then((r) => r.json());
    viewer = login.token;
    viewerId = login.user.id;
  });

  after(async () => {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('symlinks', () => {
    test('a link to a file outside every library is not catalogued', () => {
      const paths = items.map((i) => i.path);
      assert.ok(!paths.some((p) => p.includes('Leak')), 'file link out');
      assert.ok(!paths.some((p) => p.includes('Linked Folder')), 'folder link out');
      assert.ok(!paths.some((p) => p.includes('Saga v03')), 'archive link out');
      assert.ok(paths.some((p) => p.endsWith('Saga v02.cbz')));
    });

    test('a link to a file inside the library is catalogued and plays', async () => {
      const item = items.find((i) => i.path.includes('Inside Link'));
      assert.ok(item, 'catalogued');
      const res = await api(`/media/video/${item.id}/stream`, admin.token);
      assert.equal(res.status, 200);
      assert.equal((await res.arrayBuffer()).byteLength, fs.statSync(TINY_MP4).size);
    });

    test('a link from one library into another works', async () => {
      const item = items.find((i) => i.path.includes('Cross v01'));
      assert.ok(item, 'catalogued');
      assert.equal((await api(`/media/manga/${item.id}/pages`, admin.token)).status, 200);
      const page = await api(`/media/manga/${item.id}/page/0`, admin.token);
      assert.equal(page.status, 200);
      assert.equal((await api(`/media/book/${item.id}/file`, admin.token)).status, 200);
    });

    test('a catalogued file later swapped for a link out is refused everywhere', async () => {
      const film = items.find((i) => i.path.includes('Swap (2023)'));
      fs.rmSync(film.path);
      fs.symlinkSync(path.join(outside, 'secret.txt'), film.path);
      for (const url of ['stream', 'playback-info', 'hls/source-a0/media.m3u8', 'subtitles/embedded-0.vtt']) {
        const res = await api(`/media/video/${film.id}/${url}`, admin.token);
        assert.equal(res.status, 403, url);
        assert.ok(!(await res.text()).includes(SECRET));
      }
      assert.equal((await api(`/media/still/${film.id}`, admin.token)).status, 404);

      const volume = items.find((i) => i.path.endsWith('Saga v02.cbz'));
      fs.rmSync(volume.path);
      fs.symlinkSync(path.join(outside, 'private.cbz'), volume.path);
      assert.equal((await api(`/media/book/${volume.id}/file`, admin.token)).status, 403);
      assert.equal((await api(`/media/manga/${volume.id}/pages`, admin.token)).status, 403);
      assert.equal((await api(`/media/manga/${volume.id}/page/0`, admin.token)).status, 403);
      assert.equal((await api(`/media/stream/${volume.id}`, admin.token)).status, 403);

      const key = (await post('/keys', { name: 'Reader', password: ADMIN_PASSWORD })).key.key;
      const komga = (url) => fetch(`${server.baseUrl}/api${url}`, { headers: { 'X-API-Key': key } });
      assert.equal((await komga(`/v1/books/${volume.id}/pages`)).status, 403);
      assert.equal((await komga(`/v1/books/${volume.id}/pages/1`)).status, 403);
    });

    test('a subtitle file that links out is not offered or served; a real one is', async () => {
      const film = byTitle('Real Film');
      assert.ok(film, 'the film was scanned');
      const info = (await getJson(server.baseUrl, `/media/video/${film.id}/playback-info`, admin.token)).body;
      const external = info.subtitles.filter((t) => t.source === 'external');
      assert.deepEqual(external.map((t) => t.language).sort(), ['fr', 'zz']);

      for (const track of external) {
        const res = await api(`/media/video/${film.id}/subtitles/${track.id}.vtt`, admin.token);
        const body = await res.text();
        assert.ok(!body.includes(SECRET));
        if (track.language === 'fr') {
          assert.equal(res.status, 200);
          assert.match(body, /^WEBVTT/);
          assert.match(body, /Bonjour/);
        } else {
          // The 9 MB one: over the size limit for a subtitle file.
          assert.equal(res.status, 404);
          assert.equal(JSON.parse(body).code, 'P307');
        }
      }
      assert.equal((await api(`/media/video/${film.id}/subtitles/external-2.vtt`, admin.token)).status, 404);
    });
  });

  describe('playlists and scripts posing as media', { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, () => {
    test('a concat script named .mp4 is not catalogued', () => {
      assert.ok(!items.some((i) => i.path.includes('Script (2024)')));
      assert.ok(server.output().includes('playlist or script'));
    });

    test('one already in the catalog is never handed to ffmpeg', async () => {
      const film = items.find((i) => i.path.includes('Inside Link'));
      const target = path.join(movies, 'Late Script (2025).mp4');
      fs.writeFileSync(target, `ffconcat version 1.0\nfile '${path.join(outside, 'Private Film.mp4')}'\n`);
      const id = 'f'.repeat(32);
      await db((conn) => conn.run(
        `INSERT INTO items (id, library_id, title, path, media_type, format, file_size)
         SELECT ?, library_id, 'Late Script', ?, 'movie', 'mp4', 10 FROM items WHERE id = ?`,
        [id, target, film.id]
      ));
      for (const url of ['hls/source-a0/media.m3u8', 'hls/720p-a0/media.m3u8', 'subtitles/embedded-0.vtt']) {
        const res = await api(`/media/video/${id}/${url}`, admin.token);
        assert.equal(res.status, 500, url);
        assert.equal((await res.json()).code, 'P304', url);
      }
      assert.ok(!fs.existsSync(path.join(server.dataDir, 'cache', 'hls', id, 'source-a0', 'media.m3u8')));
    });
  });

  describe('embedded subtitles', { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, () => {
    test('a burst of requests for one track is answered from one extraction, then from disk', async () => {
      const dir = path.join(movies, 'Subbed (2019)');
      fs.mkdirSync(dir, { recursive: true });
      const srt = path.join(root, 'in.srt');
      fs.writeFileSync(srt, SRT.replace('Bonjour', 'Embedded line'));
      const file = path.join(dir, 'Subbed (2019).mkv');
      execFileSync('ffmpeg', ['-v', 'error', '-i', TINY_MP4, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', '-y', file]);
      const id = 'e'.repeat(32);
      const film = items.find((i) => i.path.includes('Inside Link'));
      await db((conn) => conn.run(
        `INSERT INTO items (id, library_id, title, path, media_type, format, file_size)
         SELECT ?, library_id, 'Subbed', ?, 'movie', 'mkv', ? FROM items WHERE id = ?`,
        [id, file, fs.statSync(file).size, film.id]
      ));

      const info = (await getJson(server.baseUrl, `/media/video/${id}/playback-info`, admin.token)).body;
      assert.deepEqual(info.subtitles.map((t) => t.id), ['embedded-0']);

      const cacheDir = path.join(server.dataDir, 'cache', 'subtitles');
      const responses = await Promise.all(Array.from({ length: 12 }, () => api(`/media/video/${id}/subtitles/embedded-0.vtt`, admin.token)));
      const bodies = await Promise.all(responses.map((r) => r.text()));
      assert.ok(responses.every((r) => r.status === 200), `statuses: ${responses.map((r) => r.status)}`);
      assert.ok(bodies.every((b) => b === bodies[0] && /Embedded line/.test(b)));
      assert.equal(fs.readdirSync(cacheDir).filter((f) => f.endsWith('.vtt')).length, 1);

      // Served from the cached copy: still right with the cache file as the only source.
      const cached = path.join(cacheDir, fs.readdirSync(cacheDir)[0]);
      fs.writeFileSync(cached, 'WEBVTT\n\nfrom cache\n');
      assert.match(await (await api(`/media/video/${id}/subtitles/embedded-0.vtt`, admin.token)).text(), /from cache/);

      // A changed file is a different track: the old copy isn't reused.
      execFileSync('ffmpeg', ['-v', 'error', '-i', TINY_MP4, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', '-metadata', 'title=changed', '-y', file]);
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
      assert.match(await (await api(`/media/video/${id}/subtitles/embedded-0.vtt`, admin.token)).text(), /Embedded line/);
    });
  });

  describe('what a non-admin can learn', () => {
    test('the Komga API gives admins the real path and everyone else a library-relative one', async () => {
      const adminKey = (await post('/keys', { name: 'Admin phone', password: ADMIN_PASSWORD })).key.key;
      const viewerKey = (await post('/keys', { name: 'Viewer phone', password: 'viewer-password-1' }, viewer)).key.key;
      const books = async (key) => (await (await fetch(`${server.baseUrl}/api/v1/books?unpaged=true`, { headers: { 'X-API-Key': key } })).json()).content;
      const series = async (key) => (await (await fetch(`${server.baseUrl}/api/v1/series?unpaged=true`, { headers: { 'X-API-Key': key } })).json()).content;

      const forAdmin = (await books(adminKey)).find((b) => b.url.endsWith('Saga v01.cbz'));
      assert.equal(forAdmin.url, path.join(manga, 'Saga', 'Saga v01.cbz'));

      const forViewer = await books(viewerKey);
      assert.ok(forViewer.length > 0);
      for (const b of forViewer) {
        assert.equal(typeof b.url, 'string');
        assert.ok(!b.url.includes(root), b.url);
      }
      assert.ok(forViewer.some((b) => b.url === '/Saga/Saga v01.cbz'));
      const viewerSeries = await series(viewerKey);
      assert.ok(viewerSeries.length > 0);
      assert.ok(viewerSeries.every((s) => typeof s.url === 'string' && !s.url.includes(root)));
      assert.ok(viewerSeries.some((s) => s.url === '/Saga'));
      assert.ok(!JSON.stringify([forViewer, viewerSeries]).includes(root));
    });

    test('markers of a title hidden from an account are not shown to it', async () => {
      const film = byTitle('Real Film');
      await db(async (conn) => {
        await conn.run("INSERT INTO intro_credit_markers (item_id, type, start_seconds, end_seconds) VALUES (?, 'intro', 1, 2)", [film.id]);
      });
      const before = await api(`/media/video/${film.id}/markers`, viewer);
      assert.equal(before.status, 200);
      assert.equal((await before.json()).markers.length, 1);

      await db((conn) => conn.run('INSERT INTO item_visibility (item_id, user_id, hidden_by) VALUES (?, ?, ?)', [film.id, viewerId, admin.user.id]));
      const hidden = await api(`/media/video/${film.id}/markers`, viewer);
      assert.equal(hidden.status, 404);
      assert.equal((await hidden.json()).code, 'P300');
      assert.equal((await api(`/media/video/${film.id}/hls/stop`, viewer, { method: 'POST' })).status, 404);
      // Still there for the admin, and an unknown id is a 404 rather than an empty list.
      assert.equal((await api(`/media/video/${film.id}/markers`, admin.token)).status, 200);
      assert.equal((await api(`/media/video/${'9'.repeat(32)}/markers`, admin.token)).status, 404);
    });
  });
});
