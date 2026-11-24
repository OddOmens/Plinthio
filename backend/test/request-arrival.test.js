import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const TINY_MP4 = path.join(testDir, 'fixtures/tiny.mp4');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-arrival-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';
// No TMDB key: nothing here may reach the network.
delete process.env.TMDB_API_KEY;

const { getDb } = await import('../src/config/database.js');
const { scanLibrary } = await import('../src/services/scanner.js');
const { markArrivedRequests, markIfArrived } = await import('../src/services/requestAutomation.js');

let mediaRoot;
let db;

function makeVideo(relPath) {
  const full = path.join(mediaRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(TINY_MP4, full);
}

async function request(id, fields) {
  const row = { media_type: 'movie', source: 'tmdb', external_id: id, title: id, release_date: null, status: 'accepted_pending', ...fields };
  await db.run(
    `INSERT INTO media_requests (id, user_id, media_type, source, external_id, title, release_date, status)
     VALUES (?, 'u-1', ?, ?, ?, ?, ?, ?)`,
    [id, row.media_type, row.source, row.external_id, row.title, row.release_date, row.status]
  );
}

const statusOf = async (id) => (await db.get('SELECT status FROM media_requests WHERE id = ?', [id])).status;

describe('requests are marked as added when the title arrives', () => {
  before(async () => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-arrival-media-'));
    db = await getDb();
    await db.run("INSERT INTO users (id, username, password_hash, role) VALUES ('u-1', 'asker', 'x', 'viewer')");
    await db.run('INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)', ['lib-films', 'Films', path.join(mediaRoot, 'Films'), 'movies']);
    await db.run('INSERT INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)', ['lib-shows', 'Shows', path.join(mediaRoot, 'Shows'), 'shows']);
    fs.mkdirSync(path.join(mediaRoot, 'Films'), { recursive: true });
    fs.mkdirSync(path.join(mediaRoot, 'Shows'), { recursive: true });
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  test('nothing is marked while the library does not have it', async () => {
    await request('by-id', { external_id: '603', title: 'A Name The File Does Not Use' });
    await request('by-title', { external_id: '2543164', title: 'Arrival', release_date: '2016-11-10', status: 'pending' });
    await request('remake', { external_id: '5', title: 'Heat', release_date: '1972-01-01' });
    await request('rejected', { external_id: '6', title: 'Plain Film', status: 'rejected' });
    await request('show', { media_type: 'show', external_id: '1396', title: 'Breaking Bad' });
    await request('book', { media_type: 'book', source: 'open-library', external_id: 'OL1W', title: 'Arrival' });

    makeVideo('Films/Unrelated (2001)/Unrelated (2001).mp4');
    await scanLibrary('lib-films');
    for (const id of ['by-id', 'remake', 'show', 'book']) assert.equal(await statusOf(id), 'accepted_pending', id);
    assert.equal(await statusOf('by-title'), 'pending');
  });

  test('a scan that finds the film marks its request: by TMDB id, or by name and year', async () => {
    makeVideo('Films/The Matrix (1999) {tmdb-603}/The Matrix (1999).mp4');
    makeVideo('Films/Arrival (2016)/Arrival (2016).mp4');
    makeVideo('Films/Heat (1995)/Heat (1995).mp4');
    makeVideo('Films/Plain Film (2001)/Plain Film (2001).mp4');
    await scanLibrary('lib-films');

    assert.equal(await statusOf('by-id'), 'accepted_added');
    // Still waiting for review, but it is here now: nothing left to decide.
    assert.equal(await statusOf('by-title'), 'accepted_added');
    const marked = await db.get("SELECT auto_added_at, handled_at, handled_by FROM media_requests WHERE id = 'by-title'");
    assert.ok(marked.auto_added_at && marked.handled_at);
    assert.equal(marked.handled_by, null);

    // The 1972 "Heat" was asked for; the library's is the 1995 one.
    assert.equal(await statusOf('remake'), 'accepted_pending');
    // A rejected request stays rejected, and a film is not a book of the same name.
    assert.equal(await statusOf('rejected'), 'rejected');
    assert.equal(await statusOf('book'), 'accepted_pending');
  });

  test('a show is found by its series name', async () => {
    makeVideo('Shows/Breaking Bad/Season 01/Breaking Bad - S01E01.mp4');
    await scanLibrary('lib-shows');
    assert.equal(await statusOf('show'), 'accepted_added');
  });

  test('a request a reviewer moved back is left alone from then on', async () => {
    await db.run("UPDATE media_requests SET status = 'accepted_pending' WHERE id = 'by-id'");
    assert.equal(await markArrivedRequests(db), 0);
    await scanLibrary('lib-films');
    assert.equal(await statusOf('by-id'), 'accepted_pending');
  });

  test('one request can be checked on its own, as when it is accepted the moment it is made', async () => {
    await request('here', { external_id: '2543164', title: 'Arrival', release_date: '2016-11-10' });
    await request('not-here', { external_id: '27205', title: 'Inception', release_date: '2010-07-16' });
    const row = (id) => db.get('SELECT * FROM media_requests WHERE id = ?', [id]);
    assert.equal(await markIfArrived(db, await row('here')), true);
    assert.equal(await statusOf('here'), 'accepted_added');
    assert.equal(await markIfArrived(db, await row('not-here')), false);
    assert.equal(await statusOf('not-here'), 'accepted_pending');
  });

  test('a file that has gone missing does not count', async () => {
    await request('gone', { external_id: '77', title: 'Unrelated', release_date: '2001-05-05' });
    fs.rmSync(path.join(mediaRoot, 'Films/Unrelated (2001)'), { recursive: true });
    await scanLibrary('lib-films');
    assert.equal(await statusOf('gone'), 'accepted_pending');
  });
});
