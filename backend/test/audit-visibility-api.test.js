import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

// Titles an account may not see must not leak through side routes: the
// "which lists is this in" lookup, the editor metadata routes, the OPDS root feed, film
// extras, and editor rights for an account with a content limit.

const id = (c) => c.repeat(32);

async function send(baseUrl, method, url, token, body) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method, headers: { ...authed(token), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await res.json()).token;
}

describe('restricted titles stay out of side routes', () => {
  let server; let admin; let db;
  let teen; let kid; let viewer; let editor; let limitedEditor;

  // Films: an Everyone film, and a Mature film with one extra (the extra carries no rating
  // of its own, as the scanner leaves it).
  const OPEN_FILM = id('a');
  const MATURE_FILM = id('b');
  const MATURE_EXTRA = id('c');
  const HIDDEN_FILM = id('d');
  const HIDDEN_EXTRA = id('e');
  const OFFLOADED_FILM = id('f');
  const OFFLOADED_EXTRA = id('9');
  const MISSING = id('0');

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    await db.run(`INSERT INTO libraries (id, name, path, type) VALUES
      ('movies', 'Movies', '/srv/secret-mount/movies', 'movies'),
      ('books-open', 'Open Books', '/srv/books-open', 'books'),
      ('books-mature', 'Mature Books', '/srv/books-mature', 'books')`);
    const film = (i, title, rating, extraOf = null, extraType = null) => db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format, age_rating, extra_of, extra_type)
       VALUES (?, 'movies', ?, ?, 'movie', 'mkv', ?, ?, ?)`,
      [i, title, `/srv/secret-mount/movies/${title}/${title}.mkv`, rating, extraOf, extraType]
    );
    await film(OPEN_FILM, 'Sunny Day', 'Everyone');
    await film(MATURE_FILM, 'Dark Night', 'Mature');
    await film(MATURE_EXTRA, 'Dark Night Trailer', null, MATURE_FILM, 'Trailer');
    await film(HIDDEN_FILM, 'Gone Film', 'Everyone');
    await film(HIDDEN_EXTRA, 'Gone Film Featurette', null, HIDDEN_FILM, 'Featurette');
    await film(OFFLOADED_FILM, 'Away Film', 'Everyone');
    await film(OFFLOADED_EXTRA, 'Away Film Trailer', null, OFFLOADED_FILM, 'Trailer');
    await db.run("UPDATE items SET offloaded_at = CURRENT_TIMESTAMP WHERE id = ?", [OFFLOADED_FILM]);
    await db.run('INSERT INTO item_visibility (item_id, user_id, hidden_by) VALUES (?, NULL, ?)', [HIDDEN_FILM, admin.user.id]);
    const book = (i, lib, title, rating) => db.run(
      `INSERT INTO items (id, library_id, title, path, media_type, format, age_rating)
       VALUES (?, ?, ?, ?, 'book', 'epub', ?)`,
      [i, lib, title, `/srv/${lib}/${title}.epub`, rating]
    );
    await book(id('1'), 'books-open', 'Picture Book', 'Everyone');
    await book(id('2'), 'books-mature', 'Grim Novel', 'Mature');

    const make = async (username, extra = {}) => {
      const created = await send(server.baseUrl, 'POST', '/users', admin.token, { username, password: `${username}-password-1`, ...extra });
      return created.body.user.id;
    };
    const teenId = await make('teen');
    assert.equal((await send(server.baseUrl, 'PATCH', `/users/${teenId}`, admin.token, { maxAgeRating: 'Teen' })).status, 200);
    const kidId = await make('kid');
    assert.equal((await send(server.baseUrl, 'PATCH', `/users/${kidId}`, admin.token, { kidsMode: true })).status, 200);
    await make('viewer');
    await make('ed', { role: 'editor' });
    // A legacy editor with a content limit, written straight to the database before it signs in.
    const limitedId = await make('limited', { role: 'editor' });
    await db.run("UPDATE users SET max_age_rating = 'Teen' WHERE id = ?", [limitedId]);

    teen = await login(server.baseUrl, 'teen', 'teen-password-1');
    kid = await login(server.baseUrl, 'kid', 'kid-password-1');
    viewer = await login(server.baseUrl, 'viewer', 'viewer-password-1');
    editor = await login(server.baseUrl, 'ed', 'ed-password-1');
    limitedEditor = await login(server.baseUrl, 'limited', 'limited-password-1');
  });
  after(async () => {
    await db.close();
    await server.stop();
  });

  describe('F4: which lists a title is in', () => {
    test('a title the account cannot see answers like one that does not exist', async () => {
      const missing = await getJson(server.baseUrl, `/collections/for-item/${MISSING}`, teen);
      assert.equal(missing.status, 404);
      const mature = await getJson(server.baseUrl, `/collections/for-item/${MATURE_FILM}`, teen);
      assert.equal(mature.status, 404);
      assert.deepEqual(mature.body, missing.body, 'same answer as a missing id');
      assert.equal(mature.body.folders, undefined);

      // Kids Mode: nothing here is marked kids-safe.
      assert.equal((await getJson(server.baseUrl, `/collections/for-item/${OPEN_FILM}`, kid)).status, 404);
      // Hidden from everyone by an admin.
      assert.equal((await getJson(server.baseUrl, `/collections/for-item/${HIDDEN_FILM}`, viewer)).status, 404);
    });

    test('a title the account can see still lists the folders', async () => {
      assert.equal((await send(server.baseUrl, 'POST', '/collections', teen, { name: 'Faves' })).status < 300, true);
      const ok = await getJson(server.baseUrl, `/collections/for-item/${OPEN_FILM}`, teen);
      assert.equal(ok.status, 200);
      assert.ok(ok.body.folders.some((f) => f.name === 'Faves'));
      // An offloaded title stays knowable, so the add-to-folder dialog still opens for it.
      assert.equal((await getJson(server.baseUrl, `/collections/for-item/${OFFLOADED_FILM}`, teen)).status, 200);
      // An admin still knows a title hidden from everyone.
      assert.equal((await getJson(server.baseUrl, `/collections/for-item/${HIDDEN_FILM}`, admin.token)).status, 200);
    });
  });

  describe('F6: editor metadata routes carry no absolute paths', () => {
    test('GET /metadata/admin/items: path for admins only', async () => {
      const ed = await getJson(server.baseUrl, '/metadata/admin/items?libraryId=movies', editor);
      assert.equal(ed.status, 200);
      assert.ok(ed.body.items.length > 0);
      for (const item of ed.body.items) {
        assert.equal(item.path, undefined, 'no absolute path for an editor');
        assert.ok(item.filename);
        assert.equal(typeof item.folder, 'string');
      }
      assert.equal(ed.body.items.find((i) => i.id === OPEN_FILM).folder, 'Sunny Day');

      const ad = await getJson(server.baseUrl, '/metadata/admin/items?libraryId=movies', admin.token);
      assert.ok(ad.body.items.every((i) => typeof i.path === 'string' && i.path.startsWith('/srv/secret-mount/')));
    });

    test('an editor search matches title and file name, never the folder path', async () => {
      const probe = await getJson(server.baseUrl, '/metadata/admin/items?search=secret-mount', editor);
      assert.equal(probe.body.total, 0, 'folder names cannot be probed');
      const byFile = await getJson(server.baseUrl, '/metadata/admin/items?search=sunny%20day.mkv', editor);
      assert.deepEqual(byFile.body.items.map((i) => i.id), [OPEN_FILM]);
      const byTitle = await getJson(server.baseUrl, '/metadata/admin/items?search=Grim', editor);
      assert.deepEqual(byTitle.body.items.map((i) => i.id), [id('2')]);
      // Admins still search the whole path.
      const adminProbe = await getJson(server.baseUrl, '/metadata/admin/items?search=secret-mount', admin.token);
      assert.ok(adminProbe.body.total > 0);
    });

    test('POST /metadata/apply returns the item without its path to an editor', async () => {
      const ed = await send(server.baseUrl, 'POST', `/metadata/apply/${OPEN_FILM}`, editor, { title: 'Sunny Day' });
      assert.equal(ed.status, 200);
      assert.equal(ed.body.item.id, OPEN_FILM);
      assert.equal(ed.body.item.path, undefined);
      assert.equal(ed.body.item.folder, 'Sunny Day');
      const ad = await send(server.baseUrl, 'POST', `/metadata/apply/${OPEN_FILM}`, admin.token, { title: 'Sunny Day' });
      assert.equal(ad.body.item.path, '/srv/secret-mount/movies/Sunny Day/Sunny Day.mkv');
    });
  });

  describe('F2: an editor with a content limit is not an editor', () => {
    test('the editor routes refuse it', async () => {
      assert.equal((await getJson(server.baseUrl, '/metadata/admin/items', limitedEditor)).status, 403);
      assert.equal((await send(server.baseUrl, 'POST', `/metadata/apply/${MATURE_FILM}`, limitedEditor, { ageRating: 'Everyone' })).status, 403);
    });

    test("series settings read for it like any limited account's", async () => {
      await db.run("INSERT INTO series_settings (id, library_id, series_name, age_rating, reading_direction) VALUES ('ss-grim', 'books-mature', 'Grim Saga', 'Mature', 'rtl')");
      await db.run("UPDATE items SET series = 'Grim Saga' WHERE id = ?", [id('2')]);
      const url = `/series/books-mature/${encodeURIComponent('Grim Saga')}/settings`;
      const limited = await getJson(server.baseUrl, url, limitedEditor);
      assert.deepEqual(limited.body.settings, { readingDirection: null, ageRating: null, titleOverride: null });
      const ed = await getJson(server.baseUrl, url, editor);
      assert.equal(ed.body.settings.ageRating, 'Mature', 'a real editor still sees it');
    });
  });

  describe('F7: OPDS root feed', () => {
    const rootFeed = async (token) => {
      const res = await fetch(`${server.baseUrl}/api/opds`, { headers: authed(token) });
      assert.equal(res.status, 200);
      return res.text();
    };

    test('an age-limited account is offered only libraries with something it can see', async () => {
      const xml = await rootFeed(teen);
      assert.match(xml, /Open Books/);
      assert.doesNotMatch(xml, /Mature Books/);
    });

    test('a Kids Mode account is offered only kids-safe libraries', async () => {
      assert.doesNotMatch(await rootFeed(kid), /Open Books|Mature Books/);
      await db.run("UPDATE libraries SET kids_allowed = 1 WHERE id = 'books-open'");
      const xml = await rootFeed(kid);
      assert.match(xml, /Open Books/);
      assert.doesNotMatch(xml, /Mature Books/);
      await db.run("UPDATE libraries SET kids_allowed = 0 WHERE id = 'books-open'");
    });

    test('an unrestricted account still gets both', async () => {
      const xml = await rootFeed(viewer);
      assert.match(xml, /Open Books/);
      assert.match(xml, /Mature Books/);
    });
  });

  describe("F14: extras follow their film's restrictions", () => {
    test('an age-limited account gets nothing of a Mature film\'s extra', async () => {
      const folders = (await getJson(server.baseUrl, '/items/folders', teen)).body.folders;
      assert.ok(!folders.some((f) => f.relativePath === 'Dark Night'), 'no folder entry');
      assert.equal((await getJson(server.baseUrl, `/items/${MATURE_EXTRA}`, teen)).status, 404);
      assert.equal((await getJson(server.baseUrl, `/items/${MATURE_FILM}/extras`, teen)).status, 404);
      assert.equal((await getJson(server.baseUrl, `/ratings/${MATURE_EXTRA}`, teen)).status, 404, 'knownSql follows the film too');
      const play = await getJson(server.baseUrl, `/media/video/${MATURE_EXTRA}/playback-info`, teen);
      assert.equal(play.status, 404);
      assert.equal(play.body.code, 'P300');
    });

    test('an extra of a film hidden from everyone is hidden too', async () => {
      assert.equal((await getJson(server.baseUrl, `/items/${HIDDEN_EXTRA}`, viewer)).status, 404);
      assert.equal((await getJson(server.baseUrl, `/items/${HIDDEN_FILM}/extras`, viewer)).status, 404);
      assert.equal((await getJson(server.baseUrl, `/media/video/${HIDDEN_EXTRA}/playback-info`, viewer)).body.code, 'P300');
      assert.equal((await getJson(server.baseUrl, `/ratings/${HIDDEN_EXTRA}`, viewer)).status, 404);
      const folders = (await getJson(server.baseUrl, '/items/folders', viewer)).body.folders;
      assert.ok(!folders.some((f) => f.relativePath === 'Gone Film'));
    });

    test('the folder list never lists extras, even for an admin', async () => {
      const folders = (await getJson(server.baseUrl, '/items/folders', admin.token)).body.folders;
      const dark = folders.find((f) => f.relativePath === 'Dark Night');
      assert.equal(dark.itemCount, 1, 'the film only, not its trailer');
    });

    test('allowed films keep their extras, offloaded ones included', async () => {
      const mature = await getJson(server.baseUrl, `/items/${MATURE_FILM}/extras`, viewer);
      assert.deepEqual(mature.body.extras.map((e) => e.id), [MATURE_EXTRA]);
      assert.equal((await getJson(server.baseUrl, `/items/${MATURE_EXTRA}`, viewer)).status, 200);
      const away = await getJson(server.baseUrl, `/items/${OFFLOADED_FILM}/extras`, teen);
      assert.equal(away.status, 200);
      assert.deepEqual(away.body.extras.map((e) => e.id), [OFFLOADED_EXTRA]);
      assert.equal((await getJson(server.baseUrl, `/items/${MISSING}/extras`, teen)).status, 404);
    });
  });
});
