import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const TINY_MP4 = path.join(testDir, 'fixtures/tiny.mp4');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-ids-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';
// No TMDB key: nothing here may reach the network.
delete process.env.TMDB_API_KEY;

const { getDb } = await import('../src/config/database.js');
const { scanLibrary } = await import('../src/services/scanner.js');
const { parseProviderIdTags, stripProviderIdTags, parseNfoIds, fileProviderIds } = await import('../src/services/providerIds.js');
const { parseMediaTitle, suggestCleanTitle } = await import('../src/services/titleCleaner.js');
const { matchLibraryTitles } = await import('../src/services/listMatching.js');

let mediaRoot;

function makeVideo(relPath) {
  const full = path.join(mediaRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(TINY_MP4, full);
  return full;
}

function write(relPath, text) {
  const full = path.join(mediaRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

async function addLibrary(id, type, dir) {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)', [id, id, dir, type]);
}

const admin = { id: 'u-admin', role: 'admin' };

describe('provider ids: parsing', () => {
  test('reads every tag style', () => {
    assert.deepEqual(parseProviderIdTags('The Matrix (1999) {tmdb-603}'), { tmdb: '603', imdb: null, tvdb: null });
    assert.deepEqual(parseProviderIdTags('The Matrix (1999) [tmdbid-603]'), { tmdb: '603', imdb: null, tvdb: null });
    assert.deepEqual(parseProviderIdTags('The Matrix (1999) [tmdbid=603]'), { tmdb: '603', imdb: null, tvdb: null });
    assert.deepEqual(parseProviderIdTags('The Matrix {imdb-tt0133093} {tmdb-603}'), { tmdb: '603', imdb: 'tt0133093', tvdb: null });
    assert.deepEqual(parseProviderIdTags('Breaking Bad (2008) [tvdbid-81189]'), { tmdb: null, imdb: null, tvdb: '81189' });
    assert.deepEqual(parseProviderIdTags('Breaking Bad {TVDB-81189}'), { tmdb: null, imdb: null, tvdb: '81189' });
  });

  test('ignores ids of the wrong shape and ordinary brackets', () => {
    const none = { tmdb: null, imdb: null, tvdb: null };
    assert.deepEqual(parseProviderIdTags('Film {tmdb-tt0133093}'), none);
    assert.deepEqual(parseProviderIdTags('Film {imdb-603}'), none);
    assert.deepEqual(parseProviderIdTags('Film [1080p] [YTS.AM] (1999)'), none);
    assert.deepEqual(parseProviderIdTags('Film {tmdb-0}'), none);
  });

  test('tags never reach a title, and a tag\'s number is not taken for a year', () => {
    assert.equal(stripProviderIdTags('The Matrix (1999) {tmdb-603}'), 'The Matrix (1999)');
    const film = parseMediaTitle('The Matrix (1999) {tmdb-603}.mkv');
    assert.equal(film.cleanTitle, 'The Matrix');
    assert.equal(film.year, '1999');
    const numbered = parseMediaTitle('Arrival {tmdb-2016}.mkv');
    assert.equal(numbered.cleanTitle, 'Arrival');
    assert.equal(numbered.year, null);
    assert.deepEqual(suggestCleanTitle({ title: 'Arrival {imdb-tt2543164}' }), { title: 'Arrival', year: null });
  });

  test('reads .nfo files: XML ids, a bare IMDb id, and provider links', () => {
    const kodi = `<?xml version="1.0"?><movie><title>The Matrix</title>
      <uniqueid type="imdb" default="true">tt0133093</uniqueid>
      <uniqueid default="false" type="tmdb">603</uniqueid></movie>`;
    assert.deepEqual(parseNfoIds(kodi, 'movie'), { tmdb: '603', imdb: 'tt0133093', tvdb: null });
    assert.deepEqual(parseNfoIds('<movie><id>tt0133093</id><tmdbid>603</tmdbid></movie>', 'movie'),
      { tmdb: '603', imdb: 'tt0133093', tvdb: null });
    assert.deepEqual(parseNfoIds('<tvshow><tvdbid>81189</tvdbid><imdb_id>tt0903747</imdb_id></tvshow>', 'show'),
      { tmdb: null, imdb: 'tt0903747', tvdb: '81189' });
    assert.deepEqual(parseNfoIds('Release notes\nhttps://www.imdb.com/title/tt0133093/\n', 'movie'),
      { tmdb: null, imdb: 'tt0133093', tvdb: null });
    assert.deepEqual(parseNfoIds('https://www.themoviedb.org/movie/603-the-matrix', 'movie').tmdb, '603');
    // A film link says nothing about a show, and the other way round.
    assert.equal(parseNfoIds('https://www.themoviedb.org/movie/603', 'show').tmdb, null);
    assert.equal(parseNfoIds('https://www.themoviedb.org/tv/1396', 'show').tmdb, '1396');
    // An episode's own .nfo carries the episode's ids, not the show's.
    assert.deepEqual(parseNfoIds('<episodedetails><uniqueid type="tvdb">349232</uniqueid></episodedetails>', 'show'),
      { tmdb: null, imdb: null, tvdb: null });
  });
});

describe('provider ids: scanning', () => {
  before(() => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-ids-media-'));
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  test('a film takes ids from its folder, its file name and its .nfo; the name wins', async () => {
    const dir = path.join(mediaRoot, 'Films');
    makeVideo('Films/The Matrix (1999) {tmdb-603}/The Matrix (1999).mp4');
    makeVideo('Films/Arrival (2016)/Arrival (2016) [imdbid-tt2543164].mp4');
    makeVideo('Films/Heat (1995) {tmdb-949}/Heat (1995).mp4');
    write('Films/Heat (1995) {tmdb-949}/movie.nfo', '<movie><tmdbid>1</tmdbid><imdbid>tt0113277</imdbid></movie>');
    makeVideo('Films/Plain Film (2001)/Plain Film (2001).mp4');
    await addLibrary('lib-films', 'movies', dir);
    await scanLibrary('lib-films');

    const db = await getDb();
    const rows = await db.all("SELECT title, author, tmdb_id, imdb_id, tvdb_id FROM items WHERE library_id = 'lib-films' ORDER BY title");
    assert.deepEqual(rows, [
      { title: 'Arrival', author: 'Arrival (2016)', tmdb_id: null, imdb_id: 'tt2543164', tvdb_id: null },
      { title: 'Heat', author: 'Heat (1995)', tmdb_id: '949', imdb_id: 'tt0113277', tvdb_id: null },
      { title: 'Plain Film', author: 'Plain Film (2001)', tmdb_id: null, imdb_id: null, tvdb_id: null },
      { title: 'The Matrix', author: 'The Matrix (1999)', tmdb_id: '603', imdb_id: null, tvdb_id: null }
    ]);
  });

  test('a library root\'s own movie.nfo is ignored, and so is a linked .nfo', async () => {
    const dir = path.join(mediaRoot, 'Flat');
    makeVideo('Flat/Loose Film (2010).mp4');
    write('Flat/movie.nfo', '<movie><tmdbid>42</tmdbid></movie>');
    makeVideo('Flat/Linked (2011)/Linked (2011).mp4');
    const outside = write('outside.nfo', '<movie><tmdbid>77</tmdbid></movie>');
    fs.symlinkSync(outside, path.join(dir, 'Linked (2011)', 'movie.nfo'));
    await addLibrary('lib-flat', 'movies', dir);
    await scanLibrary('lib-flat');

    const db = await getDb();
    const rows = await db.all("SELECT tmdb_id FROM items WHERE library_id = 'lib-flat'");
    assert.deepEqual(rows.map((r) => r.tmdb_id), [null, null]);
  });

  test('every episode takes the show folder\'s ids, and the tag stays out of the series name', async () => {
    const dir = path.join(mediaRoot, 'Shows');
    makeVideo('Shows/Breaking Bad {tvdb-81189}/Season 01/S01E01.mp4');
    makeVideo('Shows/Breaking Bad {tvdb-81189}/Season 01/Breaking Bad - S01E02 - Cat\'s in the Bag.mp4');
    makeVideo('Shows/Dark/Season 1/Dark - S01E01.mp4');
    write('Shows/Dark/tvshow.nfo', '<tvshow><uniqueid type="tmdb">70523</uniqueid><uniqueid type="tvdb">334824</uniqueid></tvshow>');
    // An episode .nfo beside the file must not be read as the show's.
    write('Shows/Dark/Season 1/Dark - S01E01.nfo', '<episodedetails><uniqueid type="tmdb">999999</uniqueid></episodedetails>');
    await addLibrary('lib-shows', 'shows', dir);
    await scanLibrary('lib-shows');

    const db = await getDb();
    const rows = await db.all("SELECT series, volume, tmdb_id, tvdb_id FROM items WHERE library_id = 'lib-shows' ORDER BY series, volume");
    assert.deepEqual(rows, [
      { series: 'Breaking Bad', volume: 1.001, tmdb_id: null, tvdb_id: '81189' },
      { series: 'Breaking Bad', volume: 1.002, tmdb_id: null, tvdb_id: '81189' },
      { series: 'Dark', volume: 1.001, tmdb_id: '70523', tvdb_id: '334824' }
    ]);
  });

  test('ids apply when the disk changes, so a match made by hand survives later scans', async () => {
    const dir = path.join(mediaRoot, 'Manual');
    const file = makeVideo('Manual/Solaris (1972) {tmdb-593}/Solaris (1972).mp4');
    await addLibrary('lib-manual', 'movies', dir);
    await scanLibrary('lib-manual');
    const db = await getDb();
    const item = await db.get("SELECT id, tmdb_id FROM items WHERE library_id = 'lib-manual'");
    assert.equal(item.tmdb_id, '593');

    // An admin matches it to something else; the unchanged folder must not undo that.
    await db.run("UPDATE items SET tmdb_id = '2103', credits_checked_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
    await scanLibrary('lib-manual');
    let row = await db.get('SELECT tmdb_id, credits_checked_at FROM items WHERE id = ?', [item.id]);
    assert.equal(row.tmdb_id, '2103');
    assert.ok(row.credits_checked_at);

    // A new .nfo is a change on disk: its ids apply (the folder tag still wins for TMDB) and
    // the cached credits are dropped, because the id they were fetched for was replaced.
    write('Manual/Solaris (1972) {tmdb-593}/movie.nfo', '<movie><imdbid>tt0069293</imdbid></movie>');
    await scanLibrary('lib-manual');
    row = await db.get('SELECT tmdb_id, imdb_id, credits_checked_at FROM items WHERE id = ?', [item.id]);
    assert.deepEqual(row, { tmdb_id: '593', imdb_id: 'tt0069293', credits_checked_at: null });
    assert.ok(fs.existsSync(file));
  });

  test('titles and series scanned before tags were understood are tidied, settings kept', async () => {
    const dir = path.join(mediaRoot, 'Legacy');
    makeVideo('Legacy/Severance {tvdb-371980}/Season 01/S01E01.mp4');
    await addLibrary('lib-legacy', 'shows', dir);
    await scanLibrary('lib-legacy');
    const db = await getDb();
    // What an older version stored for this folder.
    await db.run(`UPDATE items SET series = 'Severance {tvdb-371980}', author = 'Severance {tvdb-371980}',
      tvdb_id = NULL, file_ids = NULL WHERE library_id = 'lib-legacy'`);
    await db.run(`INSERT INTO series_settings (id, library_id, series_name, age_rating)
      VALUES ('ss-legacy', 'lib-legacy', 'Severance {tvdb-371980}', 'mature')`);

    await scanLibrary('lib-legacy');
    const row = await db.get("SELECT series, author, tvdb_id FROM items WHERE library_id = 'lib-legacy'");
    assert.deepEqual(row, { series: 'Severance', author: 'Severance', tvdb_id: '371980' });
    const settings = await db.all("SELECT series_name, age_rating FROM series_settings WHERE library_id = 'lib-legacy'");
    assert.deepEqual(settings, [{ series_name: 'Severance', age_rating: 'mature' }]);
  });

  test('list entries match the library by TMDB id before falling back to the title', async () => {
    const db = await getDb();
    await db.run(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES ('u-admin', 'idsadmin', 'x', 'admin')`);
    const matrix = await db.get("SELECT id FROM items WHERE library_id = 'lib-films' AND title = 'The Matrix'");
    const plain = await db.get("SELECT id FROM items WHERE library_id = 'lib-films' AND title = 'Plain Film'");

    const matches = await matchLibraryTitles(db, admin, [
      // The provider's own title differs from the file's: only the id can match it.
      { id: 'e1', media_type: 'movie', source: 'tmdb', external_id: '603', title: 'Matrix' },
      // Same number, but a show: TMDB numbers films and shows separately.
      { id: 'e2', media_type: 'show', source: 'tmdb', external_id: '603', title: 'Some Show' },
      // No id in the library: the title still matches.
      { id: 'e3', media_type: 'movie', source: 'tmdb', external_id: '12345', title: 'plain film' },
      // Another provider's id is never compared with a TMDB one.
      { id: 'e4', media_type: 'movie', source: 'tvmaze', external_id: '603', title: 'Unrelated' }
    ]);
    assert.deepEqual([...matches.entries()].sort(), [
      ['e1', { id: matrix.id, title: 'The Matrix' }],
      ['e3', { id: plain.id, title: 'Plain Film' }]
    ]);
  });

  test('the change key is empty for an untagged file and moves with an .nfo', () => {
    const dir = path.join(mediaRoot, 'Keys');
    const file = makeVideo('Keys/Quiet Film (2003)/Quiet Film (2003).mp4');
    assert.equal(fileProviderIds(file, 'movie', dir).key, '');
    assert.equal(fileProviderIds(file, 'book', dir).key, '');
    write('Keys/Quiet Film (2003)/Quiet Film (2003).nfo', 'https://www.imdb.com/title/tt0000001/');
    const withNfo = fileProviderIds(file, 'movie', dir);
    assert.match(withNfo.key, /^Quiet Film \(2003\)\.nfo:\d+:\d+$/);
    assert.equal(withNfo.ids().imdb, 'tt0000001');
  });
});
