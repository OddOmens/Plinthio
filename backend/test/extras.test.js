import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExtras } from '../src/services/extras.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const sizes = (map) => (f) => map[f] ?? 0;
const plain = (m) => Object.fromEntries([...m].map(([k, v]) => [k, v]));

describe('extras detection', () => {
  test('a film folder: subfolders and small loose files are extras of the film', () => {
    const files = [
      '/m/Quiet Harbor (2021)/Quiet.Harbor.2021.1080p.mkv',
      '/m/Quiet Harbor (2021)/Bloopers.mp4',
      '/m/Quiet Harbor (2021)/Featurettes/Making Of.mp4',
      '/m/Quiet Harbor (2021)/Behind The Scenes/Day 1/Set Tour.mp4'
    ];
    const r = plain(classifyExtras(files, '/m', 'movies', sizes({
      [files[0]]: 8 * GB, [files[1]]: 200 * MB, [files[2]]: 300 * MB, [files[3]]: 100 * MB
    })));
    assert.equal(r[files[0]], undefined, 'the film itself is not an extra');
    assert.deepEqual(r[files[1]], { type: 'Extra', parentPath: files[0], showFolder: null });
    assert.deepEqual(r[files[2]], { type: 'Featurette', parentPath: files[0], showFolder: null });
    assert.deepEqual(r[files[3]], { type: 'Behind the Scenes', parentPath: files[0], showFolder: null });
  });

  test('the file named after the folder wins over a bigger file', () => {
    const files = ['/m/Heat (1995)/Heat.1995.mkv', '/m/Heat (1995)/Heat-trailer.mkv'];
    const r = plain(classifyExtras(files, '/m', 'movies', sizes({ [files[0]]: 1 * GB, [files[1]]: 3 * GB })));
    assert.equal(r[files[0]], undefined);
    assert.equal(r[files[1]].type, 'Trailer');
  });

  test('a folder of full-length films (a collection) is not collapsed', () => {
    const files = [
      '/m/Star Wars Collection/Star Wars (1977).mkv',
      '/m/Star Wars Collection/The Empire Strikes Back (1980).mkv',
      '/m/Trilogy/Part One/Part One.mkv',
      '/m/Trilogy/Part Two/Part Two.mkv'
    ];
    const r = classifyExtras(files, '/m', 'movies', sizes({
      [files[0]]: 9 * GB, [files[1]]: 8 * GB, [files[2]]: 7 * GB, [files[3]]: 7 * GB
    }));
    assert.equal(r.size, 0);
  });

  test('films at the library root are never extras', () => {
    const files = ['/m/Alien.mkv', '/m/Aliens.mkv'];
    assert.equal(classifyExtras(files, '/m', 'movies', sizes({ [files[0]]: 9 * GB, [files[1]]: 100 * MB })).size, 0);
  });

  test('shows: only named extras folders or suffixes, tied to the show folder', () => {
    const files = [
      '/s/Night Shift/Season 1/Night.Shift.S01E01.mkv',
      '/s/Night Shift/Season 1/Night.Shift.S01E02.mkv',
      '/s/Night Shift/Extras/Bloopers.mkv',
      '/s/Night Shift/Season 1/Night.Shift.S01-featurette.mkv'
    ];
    const r = plain(classifyExtras(files, '/s', 'shows', () => 1));
    assert.equal(r[files[0]], undefined);
    assert.equal(r[files[1]], undefined);
    assert.deepEqual(r[files[2]], { type: 'Extra', parentPath: null, showFolder: 'Night Shift' });
    assert.equal(r[files[3]].type, 'Featurette');
  });

  test('other library types never have extras', () => {
    assert.equal(classifyExtras(['/b/Extras/Book.epub'], '/b', 'books').size, 0);
  });
});
