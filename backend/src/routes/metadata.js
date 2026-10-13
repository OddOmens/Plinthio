import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { config } from '../config/env.js';
import {
  searchExternalMetadata,
  fetchTmdbSeason,
  fetchTmdbEpisode,
  fetchMangaDexVolumeCovers
} from '../services/externalMetadata.js';
import { getThumbnailPath, THUMB_WIDTHS } from '../services/thumbnails.js';
import { invalidateCoverCache } from './media.js';
import { downloadCover, downloadCoverBuffer, saveCoverJpeg, cleanSearchTitle } from '../services/artwork.js';
import { parseMediaTitle } from '../services/titleCleaner.js';
import multer from 'multer';
import sharp from 'sharp';
import { logger } from '../services/logger.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { AGE_RATINGS } from '../services/visibility.js';
import { resetCredits } from '../services/credits.js';

const router = express.Router();

// Cover uploads are held in memory and re-encoded by sharp before they ever touch disk.
// That normalizes anything the user drops in (PNG/WebP/HEIC/huge originals) to a consistent
// JPEG, and re-encoding strips any non-image payload smuggled inside the file.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image files can be used as cover art'));
    }
    cb(null, true);
  }
});

const ITEM_ID_RE = /^[a-f0-9]{32}$/;
// Media types a metadata provider exists for (see services/externalMetadata.js).
const MATCHABLE_TYPES = new Set(['manga', 'book', 'movie', 'show', 'anime']);

// Batch/single auto-match already has the TMDB result in hand; store its score as the item's
// world rating rather than looking it up again the first time someone opens the rating.
async function saveMatchedRating(db, itemId, result) {
  if (result?.source !== 'tmdb' || result.rating == null) return;
  await db.run(
    `UPDATE items SET external_rating = ?, external_rating_votes = ?, external_rating_source = 'tmdb',
       external_rating_checked_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [result.rating, result.ratingVotes ?? null, itemId]
  );
}

async function writeCoverJpeg(buffer, coverFilename) {
  const fullPath = path.join(config.coversDir, coverFilename);
  await sharp(buffer)
    .rotate() // honour EXIF orientation so phone photos aren't sideways
    .resize(1200, 1800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(fullPath);
  return coverFilename;
}

function clearCachedThumbnails(itemId) {
  for (const width of THUMB_WIDTHS) {
    const thumbPath = getThumbnailPath(itemId, width);
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
    }
  }
  invalidateCoverCache(itemId);
}

router.use(authenticateToken);

// Replace a single item's cover art with an uploaded image (admins and editors).
router.post('/cover/:itemId', requireEditor, coverUpload.single('cover'), async (req, res) => {
  const { itemId } = req.params;
  if (!ITEM_ID_RE.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  try {
    const db = await getDb();
    const item = await db.get('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const coverFilename = await writeCoverJpeg(req.file.buffer, `${itemId}.jpg`);
    await db.run(
      'UPDATE items SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [coverFilename, itemId]
    );
    clearCachedThumbnails(itemId);

    logger.info('media', `Cover art replaced for item ${itemId} by ${req.user.username}`);
    res.json({ message: 'Cover art updated' });
  } catch (err) {
    console.error('[metadata] cover upload failed:', err);
    res.status(500).json({ error: 'Could not process that image' });
  }
});

// Replace the cover for a whole series / folder. Applied to every volume in the series so
// the shelf, the series card and each volume all agree — matching how Jellyfin treats a
// folder image as the identity for everything under it.
router.post('/series-cover', requireEditor, coverUpload.single('cover'), async (req, res) => {
  const seriesName = (req.body.series || '').trim();
  if (!seriesName) return res.status(400).json({ error: 'Series name is required' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // Scope to the library/media type the editor is looking at, so re-arting one "Naruto"
  // doesn't overwrite a same-named series elsewhere on the server.
  let where = 'series = ?';
  const params = [seriesName];
  if (req.body.libraryId) { where += ' AND library_id = ?'; params.push(String(req.body.libraryId)); }
  if (req.body.mediaType) { where += ' AND media_type = ?'; params.push(String(req.body.mediaType)); }

  try {
    const db = await getDb();
    const items = await db.all(`SELECT id FROM items WHERE ${where}`, params);
    if (items.length === 0) return res.status(404).json({ error: 'Series not found' });

    for (const item of items) {
      await writeCoverJpeg(req.file.buffer, `${item.id}.jpg`);
      await db.run(
        'UPDATE items SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [`${item.id}.jpg`, item.id]
      );
      clearCachedThumbnails(item.id);
    }

    logger.info('media', `Cover art replaced for series "${seriesName}" (${items.length} items) by ${req.user.username}`);
    res.json({ message: `Cover art updated for ${items.length} item(s)`, count: items.length });
  } catch (err) {
    console.error('[metadata] series cover upload failed:', err);
    res.status(500).json({ error: 'Could not process that image' });
  }
});

// Multer rejects (oversized file, non-image) throw rather than calling next() with a normal
// response, so translate them here instead of letting them fall through to the generic
// 500 handler with an opaque message.
router.use((err, req, res, next) => {
  if (!err) return next();
  const tooLarge = err.code === 'LIMIT_FILE_SIZE';
  res.status(400).json({
    error: tooLarge ? 'That image is too large (15MB max)' : (err.message || 'Upload failed')
  });
});

// Search external metadata providers (MangaDex, Google Books, Open Library, TMDB)
router.get('/search', async (req, res) => {
  const { mediaType, query, year } = req.query;

  if (!mediaType || !query) {
    return res.status(400).json({ error: 'mediaType and query are required' });
  }

  try {
    // For video types the user's title often still has the year or scene tags from the
    // filename (e.g. "Resident Evil 2020", "The Batman 2022 1080p"). Strip that noise the
    // same way the scanner does so the manual search finds the right result automatically.
    const VIDEO_TYPES = new Set(['movie', 'show', 'anime']);
    const parsed = VIDEO_TYPES.has(mediaType) ? parseMediaTitle(query) : null;
    const searchQuery = parsed ? (parsed.cleanTitle || query.trim()) : query.trim();
    const searchYear = year || (parsed?.year ?? null);

    const results = await searchExternalMetadata(mediaType, searchQuery, searchYear);
    res.json({ results, searchedAs: searchQuery !== query.trim() ? searchQuery : undefined, year: searchYear });
  } catch (err) {
    if (err.code === 'MISSING_API_KEY') {
      return sendError(req, res, 'P400');
    }
    console.error(`[metadata] Search failed for mediaType="${mediaType}" query="${query}":`, err);

    if (err.status === 401 || err.status === 403) {
      return sendError(req, res, 'P401', {
        message: 'The metadata provider rejected the configured API key. For TMDB, copy either the "API Key" or the "API Read Access Token" from your TMDB account settings into Admin → Metadata. The server reached the provider fine, so this is the credential, not the network.'
      });
    }
    if (err.status === 429) {
      return sendError(req, res, 'P402');
    }

    const hint = err.name === 'AbortError'
      ? 'Request timed out: the server could not reach the metadata provider in time.'
      : 'Could not reach the external metadata provider from the server. Check the container has outbound internet access.';
    sendError(req, res, 'P403', { message: `${hint} (${err.message || 'unknown error'})` });
  }
});

// Admin / Editor: Fetch items for title cleanup & metadata inspection
router.get('/admin/items', requireEditor, async (req, res) => {
  const { libraryId, mediaType, filter = 'all', search = '', limit = 100, offset = 0 } = req.query;

  try {
    const db = await getDb();
    const conditions = [];
    const params = [];

    if (libraryId) {
      conditions.push('i.library_id = ?');
      params.push(libraryId);
    }
    if (mediaType) {
      conditions.push('i.media_type = ?');
      params.push(mediaType);
    }
    if (search && search.trim()) {
      conditions.push('(i.title LIKE ? OR i.path LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT i.id, i.library_id, i.title, i.author, i.series, i.volume, i.path,
             i.cover_path, i.cover_source, i.media_type, i.duration, i.file_size,
             i.format, i.description, i.release_date, i.genres, i.artists, i.updated_at,
             i.themes, i.publisher, i.status, i.age_rating,
             l.name as library_name, l.type as library_type
      FROM items i
      LEFT JOIN libraries l ON i.library_id = l.id
      ${whereClause}
      ORDER BY i.title ASC
    `;

    const allRows = await db.all(sql, params);

    let totalDirty = 0;
    let totalMissingCover = 0;
    let totalMissingMeta = 0;

    const enriched = allRows.map((item) => {
      const filename = path.basename(item.path);
      const parsedPath = parseMediaTitle(filename);
      const parsedTitle = parseMediaTitle(item.title);

      const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle || item.title;
      const detectedYear = parsedPath.year || parsedTitle.year || (item.release_date ? item.release_date.slice(0, 4) : null);

      const isFrame = item.cover_source === 'frame';
      const hasCover = !!item.cover_path && !isFrame;
      const hasDescription = !!(item.description && item.description.trim());
      const hasReleaseDate = !!item.release_date;

      // "Dirty" if current title differs from cleanTitle, contains release tags or trailing year
      const isDirty = (item.title !== cleanTitle) || /\b(19\d\d|20\d\d)\b/.test(item.title) || /[._]/.test(item.title);

      if (isDirty) totalDirty++;
      if (!hasCover) totalMissingCover++;
      if (!hasDescription || !hasReleaseDate) totalMissingMeta++;

      return {
        ...item,
        filename,
        cleanTitle,
        detectedYear,
        isTv: parsedPath.isTv,
        hasCover,
        isFrame,
        hasDescription,
        hasReleaseDate,
        isDirty
      };
    });

    let filtered = enriched;
    if (filter === 'dirty') {
      filtered = enriched.filter((i) => i.isDirty);
    } else if (filter === 'missing_cover') {
      filtered = enriched.filter((i) => !i.hasCover);
    } else if (filter === 'missing_meta') {
      filtered = enriched.filter((i) => !i.hasDescription || !i.hasReleaseDate);
    }

    const total = filtered.length;
    const paginated = filtered.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      items: paginated,
      total,
      totalAll: allRows.length,
      totalDirty,
      totalMissingCover,
      totalMissingMeta
    });
  } catch (err) {
    console.error('[metadata] admin/items error:', err);
    serverError(req, res, err);
  }
});

// Admin / Editor: Batch Clean Titles for selected items
router.post('/admin/batch-clean-titles', requireEditor, async (req, res) => {
  const { itemIds } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds array is required' });
  }

  try {
    const db = await getDb();
    let updatedCount = 0;
    const results = [];

    for (const id of itemIds) {
      const item = await db.get('SELECT id, title, path, release_date FROM items WHERE id = ?', [id]);
      if (!item) continue;

      const filename = path.basename(item.path);
      const parsedPath = parseMediaTitle(filename);
      const parsedTitle = parseMediaTitle(item.title);
      const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle;
      const detectedYear = parsedPath.year || parsedTitle.year;

      if (cleanTitle && cleanTitle !== item.title) {
        let releaseDate = item.release_date;
        if (!releaseDate && detectedYear) {
          releaseDate = String(detectedYear);
        }

        await db.run(
          'UPDATE items SET title = ?, release_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [cleanTitle, releaseDate, id]
        );
        updatedCount++;
        results.push({ id, oldTitle: item.title, newTitle: cleanTitle, year: detectedYear });
      }
    }

    logger.info('metadata', `Batch cleaned titles for ${updatedCount} item(s) by ${req.user.username}`);
    res.json({ message: `Cleaned ${updatedCount} title(s)`, updatedCount, results });
  } catch (err) {
    console.error('[metadata] batch-clean-titles error:', err);
    serverError(req, res, err);
  }
});

/**
 * Matches an item against external metadata providers (TMDB, MangaDex, Google Books, Open Library)
 * and updates its fields, covers, credits, and ratings with appropriate granularity:
 * - Movies: syncs as movie (title, overview, releaseDate, poster, cast/crew, TMDB rating)
 * - Shows / Anime: syncs as episode (queries specific season & episode from TMDB, sets episode title,
 *   overview, airDate, episode still, while keeping canonical series name and show credits)
 * - Manga: syncs as volume (preserves volume title "Series, Vol. X", downloads MangaDex per-volume cover,
 *   sets series, author, artists, status)
 * - Frame covers (cover_source === 'frame') are always replaced with real official artwork even if overwriteCover is false.
 */
export async function matchItemMetadata(db, item, {
  overwriteCover = false,
  useCanonicalTitle = true,
  tmdbSeasonCache = null,
  mangaDexCoverCache = null
} = {}) {
  const filename = path.basename(item.path);
  const parsedPath = parseMediaTitle(filename);
  const parsedTitle = parseMediaTitle(item.title);
  const cleanTitle = parsedPath.cleanTitle || parsedTitle.cleanTitle || item.title;
  const year = parsedPath.year || parsedTitle.year || (item.release_date ? item.release_date.slice(0, 4) : null);

  if (!MATCHABLE_TYPES.has(item.media_type)) {
    const err = new Error(`No metadata source for ${item.media_type}s yet`);
    err.code = 'UNMATCHABLE_TYPE';
    err.cleanTitle = cleanTitle;
    err.year = year;
    throw err;
  }

  const isTv = parsedPath.isTv || item.media_type === 'show' || item.media_type === 'anime';
  let season = parsedPath.season;
  let episode = parsedPath.episode;
  if (isTv && (season == null || episode == null) && item.volume != null) {
    const s = Math.floor(item.volume);
    const ep = Math.round((item.volume - s) * 1000);
    if (ep > 0) {
      season = s;
      episode = ep;
    }
  }

  let queryTitle = cleanTitle;
  if (isTv) {
    queryTitle = parsedPath.series || item.series || cleanTitle;
  } else if (item.media_type === 'manga') {
    queryTitle = item.series || cleanTitle.replace(/v(?:ol(?:ume)?)?\s*(\d+(?:\.\d+)?)/i, '').replace(/ch(?:apter)?\s*(\d+(?:\.\d+)?)/i, '').replace(/#\s*(\d+(?:\.\d+)?)/i, '').trim();
  }

  let searchResults;
  try {
    searchResults = await searchExternalMetadata(item.media_type, queryTitle, year);
  } catch (err) {
    if (err.code === 'MISSING_API_KEY') throw err;
    throw err;
  }

  if (!searchResults || searchResults.length === 0) {
    const err = new Error('No metadata found on external provider');
    err.code = 'NO_METADATA_FOUND';
    err.cleanTitle = cleanTitle;
    err.year = year;
    throw err;
  }

  const best = (year && searchResults.find((r) => (r.releaseDate || '').startsWith(String(year)))) || searchResults[0];

  let newTitle = (useCanonicalTitle && best.title) ? best.title : cleanTitle;
  let newOverview = best.overview || item.description;
  let newReleaseDate = best.releaseDate || (year ? String(year) : item.release_date);
  let newAuthor = best.author || item.author;
  let newArtists = best.artists || item.artists;
  let newSeries = item.series;
  let newVolume = item.volume;
  let targetCoverUrl = best.coverUrl;
  let matchedRating = best;

  if (isTv) {
    newSeries = best.title || item.series;
    if (best.source === 'tmdb' && season != null && episode != null) {
      let seasonData = null;
      const cacheKey = `${best.externalId}_s${season}`;
      if (tmdbSeasonCache?.has(cacheKey)) {
        seasonData = tmdbSeasonCache.get(cacheKey);
      } else {
        seasonData = await fetchTmdbSeason(best.externalId, season);
        if (tmdbSeasonCache && seasonData) {
          tmdbSeasonCache.set(cacheKey, seasonData);
        }
      }

      if (seasonData?.episodes) {
        const found = seasonData.episodes.find((e) => Number(e.episode_number) === Number(episode));
        if (found) {
          const directors = (found.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).filter(Boolean);
          const cast = (found.guest_stars || []).slice(0, 5).map((c) => c.name).filter(Boolean);

          if (useCanonicalTitle && found.name) {
            newTitle = found.name;
          } else if (parsedPath.episodeTitle) {
            newTitle = parsedPath.episodeTitle;
          }
          if (found.overview) newOverview = found.overview;
          if (found.air_date) newReleaseDate = found.air_date;
          if (found.still_path) {
            targetCoverUrl = `https://image.tmdb.org/t/p/w500${found.still_path}`;
          }
          if (directors.length) newAuthor = directors.join(', ');
          if (cast.length) newArtists = cast.join(', ');
          if (found.vote_count > 0 && typeof found.vote_average === 'number') {
            matchedRating = {
              source: 'tmdb',
              rating: found.vote_average,
              ratingVotes: found.vote_count
            };
          }
        }
      }
    } else {
      newTitle = parsedPath.episodeTitle || cleanTitle;
    }
    if (newVolume == null && season != null && episode != null) {
      newVolume = parseInt(season, 10) + parseInt(episode, 10) / 1000;
    }
  } else if (item.media_type === 'manga') {
    newSeries = best.title || item.series;
    let vol = item.volume;
    if (vol == null) {
      const volMatch = filename.match(/v(?:ol(?:ume)?)?\s*(\d+(?:\.\d+)?)/i)
        || filename.match(/ch(?:apter)?\s*(\d+(?:\.\d+)?)/i)
        || filename.match(/#\s*(\d+(?:\.\d+)?)/i)
        || item.title.match(/v(?:ol(?:ume)?)?\s*(\d+(?:\.\d+)?)/i);
      if (volMatch) vol = parseFloat(volMatch[1]);
    }
    if (vol != null) {
      newVolume = vol;
      newTitle = useCanonicalTitle ? `${best.title}, Vol. ${vol}` : item.title;
      if (best.source === 'mangadex' && best.externalId) {
        let volumeCovers = null;
        if (mangaDexCoverCache?.has(best.externalId)) {
          volumeCovers = mangaDexCoverCache.get(best.externalId);
        } else {
          volumeCovers = await fetchMangaDexVolumeCovers(best.externalId);
          if (mangaDexCoverCache) mangaDexCoverCache.set(best.externalId, volumeCovers);
        }
        if (volumeCovers) {
          const volKey = String(vol);
          const volKeyInt = String(Math.floor(vol));
          const volKeyPad = String(vol).padStart(2, '0');
          const volCover = volumeCovers.get(volKey) || volumeCovers.get(volKeyInt) || volumeCovers.get(volKeyPad);
          if (volCover) targetCoverUrl = volCover;
        }
      }
    } else {
      newTitle = (useCanonicalTitle && best.title) ? best.title : cleanTitle;
    }
  }

  const isFrame = item.cover_source === 'frame';
  const shouldDownloadCover = targetCoverUrl && (!item.cover_path || overwriteCover || isFrame);
  let newCoverPath = null;
  if (shouldDownloadCover) {
    try {
      newCoverPath = await downloadCover(targetCoverUrl, item.id);
    } catch (e) {
      logger.warn('metadata', `Cover download failed for ${item.id}: ${e.message}`);
    }
  }

  const newGenres = Array.isArray(best.genres) ? best.genres.join(', ') : (best.genres || item.genres);
  const coverToSave = newCoverPath || item.cover_path;
  const coverSource = newCoverPath ? (best.source || 'provider') : item.cover_source;

  await db.run(
    `UPDATE items SET
      title = ?, description = ?, release_date = ?, author = ?, artists = ?,
      series = COALESCE(?, series), volume = COALESCE(?, volume),
      genres = ?, cover_path = ?, cover_source = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      newTitle,
      newOverview,
      newReleaseDate,
      newAuthor,
      newArtists,
      newSeries || null,
      newVolume != null ? newVolume : null,
      newGenres,
      coverToSave,
      coverSource,
      item.id
    ]
  );

  await saveMatchedRating(db, item.id, matchedRating);
  if (best.source === 'tmdb') {
    await resetCredits(db, item, best.externalId);
  }

  const updated = await db.get('SELECT * FROM items WHERE id = ?', [item.id]);

  return {
    success: true,
    id: item.id,
    originalTitle: item.title,
    cleanTitle,
    matchedTitle: newTitle,
    year: best.releaseDate ? best.releaseDate.slice(0, 4) : year,
    posterUpdated: !!newCoverPath,
    item: updated,
    matched: best
  };
}

// Admin / Editor: Batch Find & Match Metadata with TMDB / external provider
router.post('/admin/batch-match', requireEditor, async (req, res) => {
  const { itemIds, overwriteCovers = false, useCanonicalTitle = true } = req.body;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds array is required' });
  }

  try {
    const db = await getDb();
    let matchedCount = 0;
    let skippedCount = 0;
    const results = [];
    const tmdbSeasonCache = new Map();
    const mangaDexCoverCache = new Map();

    for (const id of itemIds) {
      const item = await db.get('SELECT * FROM items WHERE id = ?', [id]);
      if (!item) {
        skippedCount++;
        continue;
      }

      try {
        const result = await matchItemMetadata(db, item, {
          overwriteCover: overwriteCovers,
          useCanonicalTitle,
          tmdbSeasonCache,
          mangaDexCoverCache
        });
        matchedCount++;
        results.push(result);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        skippedCount++;
        results.push({
          id,
          originalTitle: item.title,
          cleanTitle: err.cleanTitle || item.title,
          success: false,
          reason: err.message
        });
      }
    }

    logger.info('metadata', `Batch metadata match finished: ${matchedCount} matched, ${skippedCount} skipped by ${req.user.username}`);
    res.json({
      message: `Matched ${matchedCount} of ${itemIds.length} item(s)`,
      total: itemIds.length,
      matched: matchedCount,
      skipped: skippedCount,
      results
    });
  } catch (err) {
    console.error('[metadata] batch-match error:', err);
    serverError(req, res, err);
  }
});

// Admin / Editor: Auto-match single item
router.post('/admin/match-single/:itemId', requireEditor, async (req, res) => {
  const { itemId } = req.params;
  const { overwriteCover = false, useCanonicalTitle = true } = req.body;

  try {
    const db = await getDb();
    const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    try {
      const result = await matchItemMetadata(db, item, {
        overwriteCover,
        useCanonicalTitle
      });
      res.json({ message: 'Item matched and updated', item: result.item, matched: result.matched });
    } catch (err) {
      if (err.code === 'MISSING_API_KEY') {
        return sendError(req, res, 'P400');
      }
      if (err.code === 'UNMATCHABLE_TYPE' || err.code === 'NO_METADATA_FOUND') {
        return res.status(404).json({ error: err.message, cleanTitle: err.cleanTitle, year: err.year });
      }
      throw err;
    }
  } catch (err) {
    serverError(req, res, err);
  }
});

// Apply a chosen external metadata result to an item: updates fields and downloads the cover
router.post('/apply/:itemId', requireEditor, async (req, res) => {
  const { itemId } = req.params;
  const { title, author, artists, series, coverUrl, description, releaseDate, genres, themes, publisher, status, ageRating, source, rating, externalId } = req.body;

  try {
    const db = await getDb();
    const item = await db.get('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    let coverPath = null;
    if (coverUrl) {
      try {
        coverPath = await downloadCover(coverUrl, itemId);
      } catch (err) {
        console.warn(`Failed to download cover for item ${itemId}: ${err.message}`);
      }
    }

    const fields = [];
    const params = [];

    if (title) { fields.push('title = ?'); params.push(title); }
    if (author !== undefined) { fields.push('author = ?'); params.push(author || null); }
    if (artists !== undefined) { fields.push('artists = ?'); params.push(artists || null); }
    if (series !== undefined) { fields.push('series = ?'); params.push(series || null); }
    if (coverPath) {
      fields.push('cover_path = ?'); params.push(coverPath);
      fields.push('cover_source = ?'); params.push(typeof source === 'string' && source ? source : 'provider');
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(description || null); }
    if (releaseDate !== undefined) { fields.push('release_date = ?'); params.push(releaseDate || null); }
    if (genres !== undefined) {
      const gVal = Array.isArray(genres) ? genres.join(', ') : (genres || null);
      fields.push('genres = ?'); params.push(gVal);
    }
    if (themes !== undefined) {
      const tVal = Array.isArray(themes) ? themes.join(', ') : (themes || null);
      fields.push('themes = ?'); params.push(tVal);
    }
    if (publisher !== undefined) { fields.push('publisher = ?'); params.push(publisher || null); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status || null); }
    if (ageRating !== undefined) {
      if (ageRating && !AGE_RATINGS.includes(ageRating)) {
        return res.status(400).json({ error: `Age rating must be one of: ${AGE_RATINGS.join(', ')}` });
      }
      fields.push('age_rating = ?'); params.push(ageRating || null);
    }
    // A TMDB result carries its community score — keep it as the item's world rating so it
    // shows without a separate lookup. Other providers' results don't set one.
    if (source === 'tmdb' && typeof rating === 'number' && rating >= 0 && rating <= 10) {
      fields.push('external_rating = ?'); params.push(rating);
      fields.push('external_rating_votes = ?'); params.push(Number.isInteger(req.body.ratingVotes) ? req.body.ratingVotes : null);
      fields.push("external_rating_source = 'tmdb'");
      fields.push('external_rating_checked_at = CURRENT_TIMESTAMP');
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No metadata fields provided to apply' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(itemId);

    await db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);

    const updated = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    // A TMDB pick: the title page's cast and crew follow the title that was chosen.
    if (source === 'tmdb' && externalId) await resetCredits(db, updated, externalId);
    res.json({ message: 'Metadata updated', item: updated });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Apply a chosen external metadata result or edited fields across a series (all volumes/episodes)
router.post('/apply-series', requireEditor, async (req, res) => {
  const {
    applyToIds,
    series,
    coverUrl,
    title,
    author,
    artists,
    description,
    releaseDate,
    genres,
    themes,
    publisher,
    status,
    ageRating,
    source,
    rating,
    ratingVotes,
    externalId,
    syncEpisodes = true
  } = req.body;

  if (!Array.isArray(applyToIds) || applyToIds.length === 0) {
    return res.status(400).json({ error: 'applyToIds array is required' });
  }

  try {
    const db = await getDb();
    let coverBuffer = null;
    if (coverUrl) {
      try {
        coverBuffer = await downloadCoverBuffer(coverUrl);
      } catch (err) {
        logger.warn('metadata', `Failed to download cover buffer from ${coverUrl}: ${err.message}`);
      }
    }

    let mangaVolumeCovers = null;
    if (source === 'mangadex' && externalId) {
      mangaVolumeCovers = await fetchMangaDexVolumeCovers(externalId);
    }

    const tmdbSeasonCache = new Map();
    let updatedCount = 0;

    for (const itemId of applyToIds) {
      const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
      if (!item) continue;

      let itemCoverPath = null;
      if (mangaVolumeCovers && item.volume != null) {
        const volKey = String(item.volume);
        const volKeyInt = String(Math.floor(item.volume));
        const volCoverUrl = mangaVolumeCovers.get(volKey) || mangaVolumeCovers.get(volKeyInt);
        if (volCoverUrl) {
          try {
            itemCoverPath = await downloadCover(volCoverUrl, itemId);
          } catch (e) {
            // fallback to shared coverBuffer
          }
        }
      }

      if (!itemCoverPath && coverBuffer) {
        try {
          itemCoverPath = await saveCoverJpeg(coverBuffer, itemId);
        } catch (e) {
          logger.warn('metadata', `Failed to save cover JPEG for ${itemId}: ${e.message}`);
        }
      }

      let itemTitle = undefined;
      let itemDescription = description;
      let itemReleaseDate = releaseDate;
      let itemAuthor = author;
      let itemArtists = artists;
      let itemRating = rating;
      let itemRatingVotes = ratingVotes;

      const isTv = item.media_type === 'show' || item.media_type === 'anime';
      if (isTv && source === 'tmdb' && externalId && syncEpisodes) {
        const filename = path.basename(item.path);
        const parsedPath = parseMediaTitle(filename);
        let season = parsedPath.season;
        let episode = parsedPath.episode;
        if ((season == null || episode == null) && item.volume != null) {
          const s = Math.floor(item.volume);
          const ep = Math.round((item.volume - s) * 1000);
          if (ep > 0) { season = s; episode = ep; }
        }
        if (season != null && episode != null) {
          const cacheKey = `${externalId}_s${season}`;
          let seasonData;
          if (tmdbSeasonCache.has(cacheKey)) {
            seasonData = tmdbSeasonCache.get(cacheKey);
          } else {
            seasonData = await fetchTmdbSeason(externalId, season);
            if (seasonData) tmdbSeasonCache.set(cacheKey, seasonData);
          }
          const ep = seasonData?.episodes?.find((e) => Number(e.episode_number) === Number(episode));
          if (ep) {
            if (ep.name) itemTitle = ep.name;
            if (ep.overview) itemDescription = ep.overview;
            if (ep.air_date) itemReleaseDate = ep.air_date;
            if (ep.still_path && !itemCoverPath) {
              try {
                itemCoverPath = await downloadCover(`https://image.tmdb.org/t/p/w500${ep.still_path}`, itemId);
              } catch (e) { /* ignore */ }
            }
            if (ep.vote_count > 0 && typeof ep.vote_average === 'number') {
              itemRating = ep.vote_average;
              itemRatingVotes = ep.vote_count;
            }
            const directors = (ep.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).filter(Boolean);
            const cast = (ep.guest_stars || []).slice(0, 5).map((c) => c.name).filter(Boolean);
            if (directors.length) itemAuthor = directors.join(', ');
            if (cast.length) itemArtists = cast.join(', ');
          }
        }
      } else if (item.media_type === 'manga' && item.volume != null && (series || title)) {
        itemTitle = `${series || title}, Vol. ${item.volume}`;
      }

      const fields = [];
      const params = [];

      if (itemTitle !== undefined) { fields.push('title = ?'); params.push(itemTitle); }
      if (itemAuthor !== undefined) { fields.push('author = ?'); params.push(itemAuthor || null); }
      if (itemArtists !== undefined) { fields.push('artists = ?'); params.push(itemArtists || null); }
      if (series !== undefined) { fields.push('series = ?'); params.push(series || null); }
      if (itemCoverPath) {
        fields.push('cover_path = ?'); params.push(itemCoverPath);
        fields.push('cover_source = ?'); params.push(typeof source === 'string' && source ? source : 'provider');
      }
      if (itemDescription !== undefined) { fields.push('description = ?'); params.push(itemDescription || null); }
      if (itemReleaseDate !== undefined) { fields.push('release_date = ?'); params.push(itemReleaseDate || null); }
      if (genres !== undefined) {
        const gVal = Array.isArray(genres) ? genres.join(', ') : (genres || null);
        fields.push('genres = ?'); params.push(gVal);
      }
      if (themes !== undefined) {
        const tVal = Array.isArray(themes) ? themes.join(', ') : (themes || null);
        fields.push('themes = ?'); params.push(tVal);
      }
      if (publisher !== undefined) { fields.push('publisher = ?'); params.push(publisher || null); }
      if (status !== undefined) { fields.push('status = ?'); params.push(status || null); }
      if (ageRating !== undefined) {
        if (ageRating && !AGE_RATINGS.includes(ageRating)) {
          return res.status(400).json({ error: `Age rating must be one of: ${AGE_RATINGS.join(', ')}` });
        }
        fields.push('age_rating = ?'); params.push(ageRating || null);
      }
      if (source === 'tmdb' && typeof itemRating === 'number' && itemRating >= 0 && itemRating <= 10) {
        fields.push('external_rating = ?'); params.push(itemRating);
        fields.push('external_rating_votes = ?'); params.push(Number.isInteger(itemRatingVotes) ? itemRatingVotes : null);
        fields.push("external_rating_source = 'tmdb'");
        fields.push('external_rating_checked_at = CURRENT_TIMESTAMP');
      }

      if (fields.length > 0) {
        fields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(itemId);
        await db.run(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);
        if (source === 'tmdb' && externalId) {
          await resetCredits(db, item, externalId);
        }
        updatedCount++;
      }
    }

    res.json({ message: `Updated ${updatedCount} items in series`, updatedCount });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
