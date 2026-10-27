import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// AniList, TVmaze, Audible (with Audnexus) and Comic Vine, in-process against a throwaway
// DATA_DIR. No network: every provider answer is stood in for, shaped like the real thing.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-sources-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { getDb } = await import('../src/config/database.js');
const { searchMetadata, searchExternalMetadata, fetchResultDetails } = await import('../src/services/externalMetadata.js');
const { matchItemMetadata } = await import('../src/routes/metadata.js');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let coverJpeg;
const image = () => ({
  ok: true,
  headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(coverJpeg.length) }),
  arrayBuffer: async () => coverJpeg.buffer.slice(coverJpeg.byteOffset, coverJpeg.byteOffset + coverJpeg.byteLength)
});

const anilistManga = {
  id: 154587, status: 'RELEASING',
  title: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey’s End', native: '葬送のフリーレン' },
  description: 'The adventure is over but life goes on.<br><br>(Source: Kodansha)',
  startDate: { year: 2020, month: 4, day: 28 },
  coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/frieren.jpg' },
  genres: ['Adventure', 'Drama', 'Fantasy'],
  tags: [{ name: 'Elf', rank: 95 }, { name: 'Twist ending', rank: 90, isMediaSpoiler: true }, { name: 'Travel', rank: 40 }],
  staff: { edges: [
    { role: 'Story', node: { name: { full: 'Kanehito Yamada' } } },
    { role: 'Art', node: { name: { full: 'Tsukasa Abe' } } }
  ] }
};
const tvmazeShow = {
  id: 44933, name: 'Severance', premiered: '2022-02-18', status: 'Running', genres: ['Drama', 'Mystery'],
  summary: '<p><b>Severance</b> follows Mark Scout.</p>',
  image: { medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/548/1.jpg', original: 'https://static.tvmaze.com/uploads/images/original_untouched/548/1.jpg' }
};
const audibleProduct = {
  asin: 'B08G9PRS1K', title: 'Project Hail Mary', authors: [{ name: 'Andy Weir' }, { name: 'Ken Liu - translator' }], narrators: [{ name: 'Ray Porter' }],
  series: [{ title: 'Standalone Space', sequence: '2' }], publisher_name: 'Audible Studios', release_date: '2021-05-04',
  language: 'english', publisher_summary: '<p>Ryland Grace is the sole survivor.</p>',
  product_images: { 500: 'https://m.media-amazon.com/images/I/51POf8gOyLL._SL500_.jpg' },
  category_ladders: [{ ladder: [{ name: 'Literature & Fiction' }, { name: 'Action & Adventure' }] }]
};

function mockFetch(respond) {
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push({ url: u, body: opts.body });
    const res = respond(u, opts);
    if (!res) throw new Error(`unexpected fetch ${u}`);
    return res;
  };
  return seen;
}

describe('more metadata sources', () => {
  let origFetch;
  let db;

  before(async () => {
    origFetch = globalThis.fetch;
    coverJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#533' } }).jpeg().toBuffer();
    db = await getDb();
    await db.run("INSERT INTO libraries (id, name, path, type) VALUES ('ab', 'Audiobooks', '/tmp/ab', 'audiobooks'), ('tv', 'Shows', '/tmp/tv', 'shows'), ('mg', 'Manga', '/tmp/mg', 'manga')");
  });
  after(async () => {
    globalThis.fetch = origFetch;
    delete process.env.COMICVINE_API_KEY;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('manga: MangaDex first, then AniList with its story and art credits, spoiler tags left out', async () => {
    const seen = mockFetch((u) => {
      if (u.startsWith('https://api.mangadex.org/manga')) return json({ data: [] });
      if (u === 'https://graphql.anilist.co') return json({ data: { Page: { media: [anilistManga] } } });
      return null;
    });
    const { results, unavailable } = await searchMetadata('manga', 'Frieren');
    assert.deepEqual(unavailable, []);
    assert.ok(!seen.some((r) => r.url.includes('comicvine')), 'Comic Vine is not asked without a key');
    assert.equal(JSON.parse(seen.find((r) => r.url.includes('anilist')).body).variables.type, 'MANGA');
    const [r] = results;
    assert.equal(r.source, 'anilist');
    assert.deepEqual([r.title, r.subtitle, r.author, r.artists, r.releaseDate, r.status], [
      'Frieren: Beyond Journey’s End', 'Sousou no Frieren', 'Kanehito Yamada', 'Tsukasa Abe', '2020-04-28', 'Ongoing'
    ]);
    assert.equal(r.overview, 'The adventure is over but life goes on.');
    assert.deepEqual(r.themes, ['Elf']);
  });

  test('a busy source is reported, and answers are remembered so a batch asks once', async () => {
    let anilistCalls = 0;
    mockFetch((u) => {
      if (u.startsWith('https://api.mangadex.org')) return json({}, 429);
      if (u.includes('anilist')) { anilistCalls++; return json({ data: { Page: { media: [anilistManga] } } }); }
      return null;
    });
    const first = await searchMetadata('manga', 'Frieren again');
    assert.deepEqual(first.unavailable, [{ provider: 'mangadex', reason: 'quota' }]);
    await searchMetadata('manga', 'Frieren again');
    assert.equal(anilistCalls, 1);
  });

  test('shows: TVmaze stands in when TMDB has no key, and a match takes the episode', async () => {
    mockFetch((u) => {
      if (u.startsWith('https://api.tvmaze.com/search/shows')) return json([{ score: 0.9, show: tvmazeShow }]);
      if (u === 'https://api.tvmaze.com/shows/44933/episodes') {
        return json([{ season: 1, number: 2, name: 'Half Loop', airdate: '2022-02-18', summary: '<p>Mark gives a tour.</p>', image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg' } }]);
      }
      if (u.startsWith('https://static.tvmaze.com/')) return image();
      return null;
    });
    const results = await searchExternalMetadata('show', 'Severance');
    assert.deepEqual([results[0].source, results[0].overview, results[0].status], ['tvmaze', 'Severance follows Mark Scout.', 'Running']);

    const id = 't'.repeat(32);
    await db.run(`INSERT INTO items (id, library_id, title, series, path, media_type, format) VALUES (?, 'tv', 'Severance S01E02', 'Severance', '/tmp/tv/Severance/Severance.S01E02.mkv', 'show', 'mkv')`, [id]);
    const result = await matchItemMetadata(db, await db.get('SELECT * FROM items WHERE id = ?', [id]));
    assert.deepEqual([result.item.title, result.item.series, result.item.release_date, result.item.volume], ['Half Loop', 'Severance', '2022-02-18', 1.002]);
    assert.equal(result.item.description, 'Mark gives a tour.');
    assert.ok(result.posterUpdated, 'the episode still is the cover');
    assert.equal(result.item.cover_source, 'tvmaze');
  });

  test('audiobooks: matched on Audible, filling narrators, series and number, and the full-size cover', async () => {
    const seen = mockFetch((u) => {
      if (/^https:\/\/api\.audible\.[a-z.]+\/1\.0\/catalog\/products/.test(u)) return json({ products: [audibleProduct, { ...audibleProduct, asin: 'B000000ADU', is_adult_product: true }] });
      if (u.startsWith('https://api.audnex.us/books/B08G9PRS1K')) {
        return json({ isbn: '9781603935470', genres: [{ name: 'Science Fiction & Fantasy', type: 'genre' }, { name: 'Space Opera', type: 'tag' }], image: 'https://m.media-amazon.com/images/I/81Nzlrfud+L.jpg' });
      }
      if (u.startsWith('https://m.media-amazon.com/')) return image();
      return null;
    });
    const id = 'u'.repeat(32);
    await db.run(`INSERT INTO items (id, library_id, title, author, path, media_type, format, description) VALUES (?, 'ab', 'Project Hail Mary', 'Andy Weir', '/tmp/ab/Project Hail Mary.m4b', 'audiobook', 'm4b', 'The file''s own blurb')`, [id]);
    const result = await matchItemMetadata(db, await db.get('SELECT * FROM items WHERE id = ?', [id]));

    assert.ok(seen.some((r) => r.url.includes('keywords=Project+Hail+Mary+Andy+Weir')), 'searched by title and author');
    const { item } = result;
    assert.deepEqual([item.artists, item.series, item.volume, item.publisher, item.language, item.release_date], ['Ray Porter', 'Standalone Space', 2, 'Audible Studios', 'en', '2021-05-04']);
    assert.equal(item.description, 'The file\'s own blurb', 'what the file says is kept');
    assert.equal(item.genres, 'Science Fiction & Fantasy');
    assert.equal(item.cover_source, 'audible');
    assert.ok(seen.some((r) => r.url === 'https://m.media-amazon.com/images/I/81Nzlrfud+L.jpg'), 'the full-size cover');

    const { results } = await searchMetadata('audiobook', 'Project Hail Mary', { language: 'de-DE' });
    assert.ok(seen.some((r) => r.url.startsWith('https://api.audible.de/')), 'German books are searched on audible.de');
    assert.deepEqual(results.map((r) => r.externalId), ['B08G9PRS1K'], 'adult titles left out');
    assert.deepEqual([results[0].author, results[0].artists], ['Andy Weir', 'Ray Porter'], 'a translator isn\'t an author');
    assert.equal(results[0].coverUrl, 'https://m.media-amazon.com/images/I/51POf8gOyLL.jpg', 'no size in the link');
  });

  test('comics: Comic Vine only with a key; creators from the series, covers per issue', async () => {
    process.env.COMICVINE_API_KEY = 'cv-key';
    const seen = mockFetch((u) => {
      if (u.startsWith('https://api.mangadex.org')) return json({ data: [] });
      if (u.includes('anilist')) return json({ data: { Page: { media: [] } } });
      if (u.startsWith('https://comicvine.gamespot.com/api/search/')) {
        return json({ status_code: 1, results: [{ id: 18166, name: 'Saga', start_year: '2012', publisher: { name: 'Image' }, deck: 'Star-crossed lovers.', image: { original_url: 'https://comicvine.gamespot.com/a/uploads/original/saga.jpg' } }] });
      }
      if (u.startsWith('https://comicvine.gamespot.com/api/volume/4050-18166/')) {
        return json({ status_code: 1, results: { people: [{ name: 'Fiona Staples', count: '60' }, { name: 'Brian K. Vaughan', count: '66' }] } });
      }
      if (u.startsWith('https://comicvine.gamespot.com/api/issues/')) {
        return json({ status_code: 1, results: [{ issue_number: '1', image: { original_url: 'https://comicvine.gamespot.com/a/uploads/original/saga-1.jpg' } }, { issue_number: '3', image: { original_url: 'https://comicvine.gamespot.com/a/uploads/original/saga-3.jpg' } }] });
      }
      if (u.startsWith('https://comicvine.gamespot.com/a/uploads/')) return image();
      return null;
    });
    const { results } = await searchMetadata('manga', 'Saga');
    assert.ok(seen.find((r) => r.url.includes('/api/search/')).url.includes('api_key=cv-key'));
    assert.deepEqual([results[0].source, results[0].publisher, results[0].releaseDate, results[0].overview], ['comicvine', 'Image', '2012', 'Star-crossed lovers.']);
    const details = await fetchResultDetails(results[0]);
    assert.equal(details.author, 'Brian K. Vaughan, Fiona Staples');

    const id = 'v'.repeat(32);
    await db.run(`INSERT INTO items (id, library_id, title, series, path, media_type, format) VALUES (?, 'mg', 'Saga 003', 'Saga', '/tmp/mg/Saga/Saga #3.cbz', 'manga', 'cbz')`, [id]);
    const result = await matchItemMetadata(db, await db.get('SELECT * FROM items WHERE id = ?', [id]));
    assert.equal(result.item.volume, 3);
    assert.ok(seen.some((r) => r.url === 'https://comicvine.gamespot.com/a/uploads/original/saga-3.jpg'), 'issue 3\'s own cover');
  });

  test('a bad Comic Vine key is reported as rejected', async () => {
    mockFetch((u) => {
      if (u.startsWith('https://api.mangadex.org')) return json({ data: [] });
      if (u.includes('anilist')) return json({ data: { Page: { media: [] } } });
      if (u.includes('comicvine')) return json({ status_code: 100, error: 'Invalid API Key' }, 401);
      return null;
    });
    const { unavailable } = await searchMetadata('manga', 'Saga with a bad key');
    assert.deepEqual(unavailable, [{ provider: 'comicvine', reason: 'rejected', keyed: true }]);
  });
});
