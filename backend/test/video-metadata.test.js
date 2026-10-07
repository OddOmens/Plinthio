import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-videometa-'));
process.env.DATA_DIR = dataDir;

const { extractVideoMetadata } = await import('../src/services/metadata.js');
const { parseMediaTitle } = await import('../src/services/titleCleaner.js');

// The files needn't exist: duration probing fails quietly and the cover lookup finds nothing.
const meta = (p, type = 'show') => extractVideoMetadata(p, 'id', type);

describe('shows split into season folders', () => {
  after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('files with no S01E01 marker belong to the show, not to "Season 02"', async () => {
    const m = await meta('/media/Kids Shows/Bumble Nums/Season 02/02 - Powerhouse Peach Salsa ｜ The Bumble Nums [lSzaZmbmwKM].mp4');
    assert.equal(m.series, 'Bumble Nums');
    assert.equal(m.volume, 2.002, 'season 2, episode 2');
    assert.ok(!m.title.startsWith('02'), `the episode number is the volume, not part of the title: ${m.title}`);
  });

  test('un-numbered files still go under the show', async () => {
    const m = await meta('/media/Kids Shows/Bumble Nums/Season 03/Atomic Avocado Toast ｜ The Bumble Nums.webm');
    assert.equal(m.series, 'Bumble Nums');
    assert.equal(m.volume, null);
  });

  test('other season folder spellings and Specials', async () => {
    for (const folder of ['Season 1', 'season01', 'Series 4', 'S03', 'Staffel 2']) {
      assert.equal((await meta(`/media/Shows/Some Show/${folder}/Pilot.mkv`)).series, 'Some Show', folder);
    }
    const special = await meta('/media/Shows/Some Show/Specials/01 - Behind the Scenes.mkv');
    assert.equal(special.series, 'Some Show');
    assert.equal(special.volume, 0.001);
  });

  test('a show folder holding its files directly is unchanged', async () => {
    assert.equal((await meta('/media/Shows/Bluey/Dance Mode.mp4')).series, 'Bluey');
  });

  test('S01E05-style names inside a season folder still use the show folder', async () => {
    const m = await meta('/media/Shows/Some Show/Season 01/S01E05 - Title.mkv');
    assert.equal(m.series, 'Some Show');
    assert.equal(m.volume, 1.005);
  });

  test('a season folder directly under the library has no show above it', async () => {
    assert.equal((await meta('/Season 01/Pilot.mkv')).series, 'Season 01');
  });

  test('a show whose name merely starts with "Season" is left alone', async () => {
    assert.equal((await meta('/media/Shows/Seasons of Love/Pilot.mkv')).series, 'Seasons of Love');
  });
});

describe('episode patterns need word boundaries', () => {
  test('an NxM inside a YouTube id is not an episode', () => {
    const parsed = parseMediaTitle('15 - Groovy Movie Popcorn ｜ Cartoons For Kids ｜ The Bumble Nums [6a6x0WQn_ic]');
    assert.equal(parsed.isTv, false);
  });

  test('"ep" inside a word is not an episode', () => {
    assert.equal(parseMediaTitle('Sleep 3 Nights').isTv, false);
  });

  test('real patterns still match', () => {
    assert.deepEqual(
      ['Show.S02E05.720p', 'Show 2x05', 'Show Ep 5', 'Show Episode 5'].map((n) => parseMediaTitle(n).isTv),
      [true, true, true, true]
    );
    const p = parseMediaTitle('Show.S02E05.Title');
    assert.equal(p.season, 2);
    assert.equal(p.episode, 5);
  });
});
