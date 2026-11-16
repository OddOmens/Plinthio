import fs from 'fs';
import { pdfInfo, extractPdfCover } from './pdf.js';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { extractAudiobookMetadata, extractMangaMetadata, extractBookMetadata, extractVideoMetadata } from './metadata.js';
import { logger, oneLine } from './logger.js';
import { PlinthioError, codeForFsError } from '../errors.js';
import { config } from '../config/env.js';
import { getThumbnailPath, THUMB_WIDTHS } from './thumbnails.js';
import { invalidateCoverCache } from '../routes/media.js';
import { fetchVideoArtwork, isVideoArtworkAvailable } from './artwork.js';
import sharp from 'sharp';
import { extractVideoFrameCover, FRAME_LEGACY_WIDTH } from './videoFrame.js';
import { backfillMovieCredits } from './credits.js';
import { findCoverInFolder, looksLikeImage } from '../utils/imageFile.js';
import { parseMediaTitle } from './titleCleaner.js';
import { classifyExtras } from './extras.js';
import { BOOK_META_VERSION } from './bookMetadata.js';
import { getLibraryRoots, realPathInRoots } from '../utils/libraryPath.js';
import { probeFormatName, isScriptFormat } from './probe.js';
import { queueNewVideos } from './compat.js';
import { VIDEO_EXTS } from './subtitles.js';

const VIDEO_MEDIA_TYPES = ['movie', 'show', 'anime'];

const AUDIO_EXTS = new Set(['.m4b', '.mp3', '.m4a', '.flac', '.aac', '.ogg']);
const MANGA_EXTS = new Set(['.cbz', '.zip', '.cbr', '.rar', '.cb7', '.7z']);
const BOOK_EXTS = new Set(['.epub', '.pdf']);

// Per-library lock so the same library isn't walked twice at once (double inserts, prune races).
const scanningLibraryIds = new Set();

export function isLibraryScanning(libraryId) {
  return scanningLibraryIds.has(libraryId);
}

export async function scanLibrary(libraryId) {
  if (scanningLibraryIds.has(libraryId)) {
    logger.warn('scan', `Scan already running for library ${libraryId}, skipping trigger request`);
    return { status: 'busy' };
  }

  scanningLibraryIds.add(libraryId);
  const db = await getDb();

  try {
    const library = await db.get('SELECT * FROM libraries WHERE id = ?', [libraryId]);
    if (!library) {
      throw new PlinthioError('P002', `Library ${libraryId} not found`);
    }

    logger.info('scan', `Starting scan for library "${library.name}" (${library.type})`, { path: library.path });
    if (!fs.existsSync(library.path)) {
      throw new PlinthioError('P200', `Library folder for "${library.name}" does not exist: ${library.path}`);
    }
    // walkDirectory skips unreadable folders, so check the root explicitly or an unreadable
    // drive would look like an empty library.
    try {
      fs.readdirSync(library.path);
    } catch (err) {
      throw new PlinthioError(
        codeForFsError(err) || 'P000',
        `Could not read the "${library.name}" folder (${err.code || err.message}): ${library.path}`,
        { cause: err }
      );
    }

    // Symlinks are only followed into library roots (utils/libraryPath.js); read fresh.
    const roots = await getLibraryRoots({ fresh: true });
    const files = [];
    const skippedLinks = { count: 0 };
    walkDirectory(library.path, library.type, files, new Set(), roots, skippedLinks);
    logger.info('scan', `Discovered ${files.length} candidate media files in "${library.name}"`);
    if (skippedLinks.count > 0) {
      logger.warn('scan',
        `Skipped ${skippedLinks.count} symlink(s) in "${library.name}" that point outside every library folder. ` +
        'If they lead to media you keep elsewhere on purpose, add that folder as a library or list it in SYMLINK_ALLOWED_ROOTS.');
    }

    // Extras (trailers etc.) are catalogued but kept off the shelf.
    const extras = classifyExtras(files, library.path, library.type);

    // Snapshot to detect renamed/moved files rather than adding duplicates.
    const dbItemsBefore = await db.all('SELECT id, path, file_size, format, total_pages, cover_path, media_type, title, series, volume, offloaded_at, book_meta_version FROM items WHERE library_id = ?', [libraryId]);
    // An unmounted drive leaves an empty mount point; refuse rather than mark everything missing.
    if (files.length === 0 && dbItemsBefore.length > 0) {
      throw new PlinthioError(
        'P201',
        `"${library.name}" folder is empty but the catalog has ${dbItemsBefore.length} item(s) — ` +
        (skippedLinks.count > 0
          ? `${skippedLinks.count} symlink(s) in it point outside every library folder and were skipped (see SYMLINK_ALLOWED_ROOTS). `
          : 'is the drive mounted? ') +
        'Scan skipped so nothing was removed.'
      );
    }
    const dbItemsById = new Map(dbItemsBefore.map((i) => [i.id, i]));
    // Also by path: a re-linked file keeps its old id, which isn't the hash of its new path.
    const dbItemsByPath = new Map(dbItemsBefore.map((i) => [i.path, i]));
    const discoveredPathSet = new Set(files);

    // Orphaned rows keyed by filename + size; only an unambiguous match is re-linked.
    const orphanedByKey = new Map();
    for (const item of dbItemsBefore) {
      if (!discoveredPathSet.has(item.path)) {
        const key = `${path.basename(item.path)}::${item.file_size}`;
        if (!orphanedByKey.has(key)) orphanedByKey.set(key, []);
        orphanedByKey.get(key).push(item);
      }
    }
    const claimedOrphanIds = new Set();

    // A new file matching a gone offloaded title (same episode/volume/film) takes over its row and history.
    const offloadedGone = dbItemsBefore.filter((i) => i.offloaded_at && !discoveredPathSet.has(i.path));
    const offloadedMatch = (mediaType, meta) => {
      const found = offloadedGone.filter((c) => !claimedOrphanIds.has(c.id) && c.media_type === mediaType && (
        meta.series && meta.volume != null
          ? c.series === meta.series && c.volume === meta.volume
          : mediaType === 'movie' && (c.title || '').toLowerCase() === (meta.title || '').toLowerCase()
      ));
      return found.length === 1 ? found[0] : null;
    };

    let added = 0;
    // Added or changed files, for "Convert new videos automatically".
    const changedIds = [];
    let updated = 0;
    let renamed = 0;

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      const stats = fs.statSync(filePath);

      const computedId = crypto.createHash('md5').update(filePath).digest('hex');

      let itemId = dbItemsById.has(computedId) ? computedId : (dbItemsByPath.get(filePath)?.id || computedId);
      let isRename = false;

      if (!dbItemsById.has(itemId)) {
        const key = `${path.basename(filePath)}::${stats.size}`;
        const candidates = (orphanedByKey.get(key) || []).filter((c) => !claimedOrphanIds.has(c.id));
        if (candidates.length === 1) {
          itemId = candidates[0].id;
          claimedOrphanIds.add(itemId);
          isRename = true;
        }
      }

      let existing = dbItemsById.get(itemId) || null;

      // Unchanged size at the same path: skip re-extraction.
      if (existing && !isRename && existing.file_size === stats.size) {
        // PDFs without a page count get one (and a page-one cover if none); edited fields are kept.
        if (ext === '.pdf' && !existing.total_pages) {
          try {
            const { pages } = await pdfInfo(filePath);
            const cover = existing.cover_path ? null : await extractPdfCover(filePath, itemId);
            if (pages) {
              await db.run('UPDATE items SET total_pages = ?, cover_path = COALESCE(?, cover_path), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [pages, cover, itemId]);
              if (cover) invalidateCoverCache(itemId);
            }
          } catch (err) { /* no poppler: stays as it was */ }
        }
        // Fill empty fields once for books read by an older extractor version.
        if (BOOK_EXTS.has(ext) && existing.media_type === 'book' && (existing.book_meta_version || 0) < BOOK_META_VERSION) {
          await refreshBookMetadata(db, itemId, filePath);
        }
        continue;
      }

      let meta = null;
      let mediaType = 'book';

      // Refuse playlists/scripts disguised as media (ffmpeg would open whatever they list).
      // Only text-looking files are probed, since real media is binary.
      if ((AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) && startsLikeText(filePath)) {
        const format = await probeFormatName(filePath);
        if (format === '' || isScriptFormat(format)) {
          logger.warn('scan', `Skipped "${filePath}": it is a playlist or script, not a media file`);
          discoveredPathSet.delete(filePath);
          continue;
        }
      }

      if (AUDIO_EXTS.has(ext)) {
        mediaType = 'audiobook';
        meta = await extractAudiobookMetadata(filePath, itemId);
      } else if (MANGA_EXTS.has(ext)) {
        mediaType = 'manga';
        meta = await extractMangaMetadata(filePath, itemId);
      } else if (BOOK_EXTS.has(ext)) {
        mediaType = 'book';
        meta = await extractBookMetadata(filePath, itemId);
      } else if (VIDEO_EXTS.has(ext)) {
        if (library.type === 'shows') mediaType = 'show';
        else if (library.type === 'anime') mediaType = 'anime';
        else mediaType = 'movie';
        meta = await extractVideoMetadata(filePath, itemId, mediaType);
      }

      if (!meta) continue;

      // Best-effort TMDB poster fallback for video. Extras get a frame from the clip later instead.
      if (extras.has(filePath)) meta.coverPath = null;
      if (!meta.coverPath && ['movie', 'show', 'anime'].includes(mediaType) && !extras.has(filePath)) {
        const parsedFile = parseMediaTitle(path.basename(filePath));
        meta.coverPath = await fetchVideoArtwork({
          itemId,
          title: meta.title,
          series: meta.series,
          mediaType,
          year: parsedFile.year
        });
      }

      const format = ext.replace('.', '');

      if (!existing) {
        const back = offloadedMatch(mediaType, meta);
        if (back) {
          itemId = back.id;
          existing = back;
          isRename = true;
          claimedOrphanIds.add(back.id);
        }
      }

      if (existing) {
        await db.run(
          `UPDATE items SET
            title = ?, author = ?,
            -- A film grouped into its TMDB collection keeps it; the file never names one. A
            -- book whose file names no series keeps the one set by hand.
            series = CASE WHEN media_type IN ('movie', 'book') AND ? IS NULL THEN series ELSE ? END,
            volume = CASE WHEN media_type = 'book' AND ? IS NULL THEN volume ELSE ? END, path = ?, cover_path = ?, missing_since = NULL,
            -- A file for an offloaded title that had gone means it's back; one offloaded
            -- ahead of deleting its file (never gone) stays offloaded.
            offloaded_at = CASE WHEN missing_since IS NOT NULL OR ? THEN NULL ELSE offloaded_at END,
            -- KOReader's document ids are hashes of the file and its name (routes/kosync.js).
            koreader_hash = NULL, koreader_name_hash = NULL,
            duration = ?, total_pages = ?, file_size = ?, format = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            meta.title,
            meta.author,
            meta.series,
            meta.series,
            meta.volume,
            meta.volume,
            filePath,
            meta.coverPath,
            isRename ? 1 : 0,
            meta.duration || 0,
            meta.totalPages || 0,
            stats.size,
            format,
            itemId
          ]
        );
        if (mediaType === 'book') await saveBookFields(db, itemId, meta);
        updated++;
        changedIds.push(itemId);
        if (isRename) renamed++;

        // The file changed, so clear thumbnails and media.js's cover cache.
        for (const width of THUMB_WIDTHS) {
          const thumbPath = getThumbnailPath(itemId, width);
          if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore */ }
          }
        }
        invalidateCoverCache(itemId);
      } else {
        await db.run(
          `INSERT INTO items
            (id, library_id, title, author, series, volume, path, cover_path, media_type, duration, total_pages, file_size, format)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            library.id,
            meta.title,
            meta.author,
            meta.series,
            meta.volume,
            filePath,
            meta.coverPath,
            mediaType,
            meta.duration || 0,
            meta.totalPages || 0,
            stats.size,
            format
          ]
        );
        if (mediaType === 'book') await saveBookFields(db, itemId, meta);
        added++;
        changedIds.push(itemId);
      }
    }

    await applyExtras(db, libraryId, extras);
    await unifySeriesSpellings(db, libraryId);

    // Gone files are marked missing, not deleted, so progress and custom art survive a slow
    // mount; they're hidden and return if the file reappears. Offloaded titles get missing_since
    // but aren't counted; a file that returns clears both flags.
    let removed = 0;
    let restored = 0;
    const knownItems = await db.all('SELECT id, path, missing_since, offloaded_at FROM items WHERE library_id = ?', [libraryId]);
    for (const item of knownItems) {
      const present = discoveredPathSet.has(item.path);
      if (!present && !item.missing_since) {
        await db.run('UPDATE items SET missing_since = CURRENT_TIMESTAMP WHERE id = ?', [item.id]);
        if (!item.offloaded_at) removed++;
      } else if (present && item.missing_since) {
        await db.run('UPDATE items SET missing_since = NULL, offloaded_at = NULL WHERE id = ?', [item.id]);
        restored++;
      }
    }

    // Retry covers for every item still without one (unchanged files are otherwise skipped).
    const artwork = await backfillArtwork(db, library);

    await db.run('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?', [libraryId]);

    logger.info('scan', `Scan completed for "${library.name}"`, { added, updated, renamed, missing: removed, restored, artwork, total: files.length });
    if (library.type === 'movies' && added) backfillMovieCredits().catch(() => {});
    queueNewVideos(db, changedIds);
    // `removed` counts titles newly marked missing, not deleted.
    return { status: 'completed', added, updated, renamed, removed, restored, artwork, total: files.length };
  } finally {
    scanningLibraryIds.delete(libraryId);
  }
}

/**
 * Series names from filenames vary by release group; names differing only in case or punctuation
 * are merged under the show folder's spelling, else the most common. Series settings and Kids Mode
 * entries move across. Applies to shows, anime and books.
 */
export function seriesKey(name) {
  return String(name).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function unifySeriesSpellings(db, libraryId) {
  const rows = await db.all(
    `SELECT series, media_type, path FROM items
     WHERE library_id = ? AND media_type IN ('show', 'anime', 'book') AND series IS NOT NULL`,
    [libraryId]
  );
  // key -> spelling -> { count, isFolder }
  const groups = new Map();
  for (const r of rows) {
    // Book metadata varies on a leading "The" between volumes.
    const name = r.media_type === 'book' ? String(r.series).replace(/^the\s+/i, '') : r.series;
    const key = `${r.media_type}:${seriesKey(name)}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const spellings = groups.get(key);
    const entry = spellings.get(r.series) || { count: 0, isFolder: false };
    entry.count++;
    if (!entry.isFolder && r.path.split(path.sep).includes(r.series)) entry.isFolder = true;
    spellings.set(r.series, entry);
  }

  for (const [key, spellings] of groups) {
    if (spellings.size < 2) continue;
    const mediaType = key.slice(0, key.indexOf(':'));
    // Between equally common book spellings the longer is the fuller name ("The First Law").
    const [canonical] = [...spellings.entries()].sort(([a, x], [b, y]) =>
      (y.isFolder - x.isFolder) || (y.count - x.count) || (mediaType === 'book' ? b.length - a.length : 0) || a.localeCompare(b))[0];
    const others = [...spellings.keys()].filter((name) => name !== canonical);

    await db.run('BEGIN TRANSACTION');
    try {
      for (const name of others) {
        await db.run(
          'UPDATE items SET series = ? WHERE library_id = ? AND media_type = ? AND series = ?',
          [canonical, libraryId, mediaType, name]
        );
        // Keep the canonical spelling's own settings if it has some; otherwise inherit.
        await db.run(
          `UPDATE OR IGNORE series_settings SET series_name = ? WHERE library_id = ? AND series_name = ?`,
          [canonical, libraryId, name]
        );
        await db.run('DELETE FROM series_settings WHERE library_id = ? AND series_name = ?', [libraryId, name]);
        await db.run('UPDATE OR IGNORE kids_titles SET series = ? WHERE library_id = ? AND series = ?', [canonical, libraryId, name]);
        await db.run('DELETE FROM kids_titles WHERE library_id = ? AND series = ?', [libraryId, name]);
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
    logger.info('scan', `Merged ${others.map((n) => `"${n}"`).join(', ')} into "${canonical}" (same series, different spelling)`);
  }
}

// Fills only empty catalogue fields, so edits and metadata matches survive rescans.
async function saveBookFields(db, itemId, meta) {
  await db.run(
    `UPDATE items SET
       description = COALESCE(description, ?), publisher = COALESCE(publisher, ?),
       release_date = COALESCE(release_date, ?), language = COALESCE(language, ?),
       isbn = COALESCE(isbn, ?), genres = COALESCE(genres, ?), book_meta_version = ?
     WHERE id = ?`,
    [
      meta.description || null,
      meta.publisher || null,
      meta.releaseDate || null,
      meta.language || null,
      meta.isbn || null,
      meta.genres?.length ? meta.genres.join(', ') : null,
      BOOK_META_VERSION,
      itemId
    ]
  );
}

/**
 * Re-reads an unchanged book and fills in missing fields. The title is only tidied when it
 * still matches what the file said, so typed titles stay.
 */
async function refreshBookMetadata(db, itemId, filePath) {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item) return;
  let meta;
  try {
    meta = await extractBookMetadata(filePath, itemId, { writeCover: !item.cover_path });
  } catch (err) {
    logger.warn('scan', `Could not re-read book metadata for ${filePath}: ${err.message}`);
    return;
  }

  const untouchedTitle = item.title === meta.rawTitle || item.title === path.basename(filePath, path.extname(filePath));
  const title = untouchedTitle && meta.rawTitle ? meta.title : item.title;
  const author = !item.author || item.author === 'Unknown Author' ? meta.author : item.author;
  const series = item.series || meta.series || null;
  const volume = item.volume ?? (series && series === meta.series ? meta.volume : null);
  const coverPath = item.cover_path || meta.coverPath || null;

  await db.run(
    `UPDATE items SET title = ?, author = ?, series = ?, volume = ?, cover_path = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [title, author, series, volume, coverPath, itemId]
  );
  await saveBookFields(db, itemId, meta);
  if (!item.cover_path && coverPath) {
    for (const width of THUMB_WIDTHS) {
      try { fs.unlinkSync(getThumbnailPath(itemId, width)); } catch (e) { /* none cached */ }
    }
    invalidateCoverCache(itemId);
  }
}

/**
 * Runs over every item each scan so moving clips in or out of Extras folders takes effect.
 * A show's extras take its series name so its page can list them.
 */
async function applyExtras(db, libraryId, extras) {
  const rows = await db.all('SELECT id, path, series, extra_type, extra_of FROM items WHERE library_id = ?', [libraryId]);
  const idByPath = new Map(rows.map((r) => [r.path, r.id]));

  // Series per show folder, from the episodes in it (an extra has no SxxEyy to parse).
  const seriesByShowFolder = new Map();
  for (const [, info] of extras) {
    if (info.showFolder && !seriesByShowFolder.has(info.showFolder)) seriesByShowFolder.set(info.showFolder, null);
  }
  if (seriesByShowFolder.size) {
    for (const r of rows) {
      if (extras.has(r.path) || !r.series) continue;
      for (const folder of seriesByShowFolder.keys()) {
        if (!seriesByShowFolder.get(folder) && r.path.split(path.sep).includes(folder)) seriesByShowFolder.set(folder, r.series);
      }
    }
  }

  await db.run('BEGIN TRANSACTION');
  try {
    for (const r of rows) {
      const info = extras.get(r.path);
      const type = info ? info.type : null;
      const of = info?.parentPath ? idByPath.get(info.parentPath) || null : null;
      const series = info?.showFolder ? seriesByShowFolder.get(info.showFolder) || r.series : r.series;
      if (type !== r.extra_type || of !== r.extra_of || series !== r.series) {
        await db.run('UPDATE items SET extra_type = ?, extra_of = ?, series = ? WHERE id = ?', [type, of, series, r.id]);
      }
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

// Old low-res frame grabs are exactly FRAME_LEGACY_WIDTH wide; new grabs never are.
async function isLegacyFrame(item) {
  if (item.cover_source !== 'frame') return false;
  try {
    const meta = await sharp(path.join(config.coversDir, item.cover_path)).metadata();
    return meta.width === FRAME_LEGACY_WIDTH;
  } catch (e) {
    return false;
  }
}

/**
 * Fills missing or unusable covers: folder art, then TMDB (video, with a key), then a video frame.
 * Best-effort; returns how many were filled.
 */
async function backfillArtwork(db, library) {
  const items = await db.all(
    'SELECT id, path, title, series, media_type, duration, cover_path, cover_source, extra_type FROM items WHERE library_id = ?',
    [library.id]
  );

  let filled = 0;
  for (const item of items) {
    const usable = hasUsableCover(item.cover_path);

    // Infer cover_source for covers without one, so stand-in frames can later be replaced.
    if (usable && !item.cover_source) {
      const source = findCoverInFolder(path.dirname(item.path))
        ? 'folder'
        : (VIDEO_MEDIA_TYPES.includes(item.media_type) ? 'frame' : 'folder');
      await db.run('UPDATE items SET cover_source = ? WHERE id = ?', [source, item.id]);
      item.cover_source = source;
    }
    // A frame is a stand-in: swap it for a TMDB poster once a key exists (not for extras).
    const provisional = usable && !item.extra_type && item.cover_source === 'frame' && await isVideoArtworkAvailable();
    // Extras carrying their film's poster get a frame of their own; uploaded art is kept.
    const extraWithFilmArt = usable && item.extra_type && ['folder', 'tmdb'].includes(item.cover_source);
    const legacyFrame = usable && await isLegacyFrame(item);
    if (usable && !provisional && !extraWithFilmArt && !legacyFrame) continue;

    let coverPath = null;
    let coverSource = null;

    // 1. Folder art inside library roots (not for extras: that's the film's poster).
    let folderCover = item.extra_type ? null : findCoverInFolder(path.dirname(item.path));
    if (folderCover) folderCover = realPathInRoots(folderCover, await getLibraryRoots(), 'scan');
    if (folderCover) {
      const coverFilename = `${item.id}.jpg`;
      try {
        fs.copyFileSync(folderCover, path.join(config.coversDir, coverFilename));
        coverPath = coverFilename;
        coverSource = 'folder';
      } catch (e) {
        // Unreadable: try the next source.
      }
    }

    // 2. TMDB.
    if (!coverPath && VIDEO_MEDIA_TYPES.includes(item.media_type) && !item.extra_type) {
      const parsed = parseMediaTitle(path.basename(item.path));
      coverPath = await fetchVideoArtwork({
        itemId: item.id,
        title: parsed.cleanTitle || item.title,
        series: item.series,
        mediaType: item.media_type,
        year: parsed.year
      });
      if (coverPath) coverSource = 'tmdb';
    }

    // 3. A video frame (no API key needed); not re-grabbed if the item already has one.
    if (!coverPath && (!provisional || legacyFrame) && VIDEO_MEDIA_TYPES.includes(item.media_type)) {
      // Older rows may point outside library roots.
      const source = realPathInRoots(item.path, await getLibraryRoots(), 'scan');
      coverPath = source ? await extractVideoFrameCover(source, item.id, item.duration) : null;
      if (coverPath) coverSource = 'frame';
    }

    if (!coverPath) continue;

    await db.run(
      'UPDATE items SET cover_path = ?, cover_source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [coverPath, coverSource, item.id]
    );
    dropCachedImages(item.id);
    filled++;
  }

  if (filled > 0) {
    logger.info('scan', `Filled in artwork for ${filled} item(s) in "${library.name}"`);
  }
  return filled;
}

// The stored file must exist and actually be an image.
function hasUsableCover(coverPath) {
  if (!coverPath) return false;
  const full = path.join(config.coversDir, coverPath);
  return fs.existsSync(full) && looksLikeImage(full);
}

function dropCachedImages(itemId) {
  for (const width of THUMB_WIDTHS) {
    const thumbPath = getThumbnailPath(itemId, width);
    try { fs.unlinkSync(thumbPath); } catch (e) { /* nothing cached */ }
  }
  invalidateCoverCache(itemId);
}

// Media containers have NUL bytes in their first 512 bytes; playlists and scripts don't.
function startsLikeText(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(512);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    return read > 0 && !head.subarray(0, read).includes(0);
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* already closed */ }
  }
}

function walkDirectory(dir, libraryType, results, visitedRealPaths = new Set(), roots = null, skipped = { count: 0 }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Error reading directory ${oneLine(dir)}: ${oneLine(err.message)}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('@') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    // Dirent reports false for symlinks, so resolve link targets explicitly.
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch (err) {
        // Broken symlink.
        continue;
      }
      isDirectory = stats.isDirectory();
      isFile = stats.isFile();

      // Only follow links into library roots, so the catalog can't expose arbitrary server files.
      let realPath;
      if (roots) {
        realPath = realPathInRoots(fullPath, roots, 'scan');
        if (!realPath) {
          skipped.count++;
          continue;
        }
      }

      if (isDirectory) {
        // Guard against symlink cycles.
        realPath = realPath || fs.realpathSync(fullPath);
        if (visitedRealPaths.has(realPath)) continue;
        visitedRealPaths.add(realPath);
      }
    }

    if (isDirectory) {
      walkDirectory(fullPath, libraryType, results, visitedRealPaths, roots, skipped);
    } else if (isFile) {
      const ext = path.extname(entry.name).toLowerCase();
      if (libraryType === 'audiobooks' && AUDIO_EXTS.has(ext)) {
        results.push(fullPath);
      } else if (libraryType === 'manga' && MANGA_EXTS.has(ext)) {
        results.push(fullPath);
      } else if (libraryType === 'books' && (BOOK_EXTS.has(ext) || AUDIO_EXTS.has(ext) || MANGA_EXTS.has(ext))) {
        results.push(fullPath);
      } else if ((libraryType === 'shows' || libraryType === 'movies' || libraryType === 'anime') && VIDEO_EXTS.has(ext)) {
        results.push(fullPath);
      } else if (VIDEO_EXTS.has(ext) || BOOK_EXTS.has(ext) || AUDIO_EXTS.has(ext) || MANGA_EXTS.has(ext)) {
        // Custom libraries.
        results.push(fullPath);
      }
    }
  }
}
