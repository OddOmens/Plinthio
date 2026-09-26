import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { extractAudiobookMetadata, extractMangaMetadata, extractBookMetadata, extractVideoMetadata } from './metadata.js';
import { logger } from './logger.js';
import { PlinthioError, codeForFsError } from '../errors.js';
import { config } from '../config/env.js';
import { getThumbnailPath } from './thumbnails.js';
import { invalidateCoverCache } from '../routes/media.js';
import { fetchVideoArtwork, isVideoArtworkAvailable } from './artwork.js';
import { extractVideoFrameCover } from './videoFrame.js';
import { findCoverInFolder, looksLikeImage } from '../utils/imageFile.js';
import { parseMediaTitle } from './titleCleaner.js';

const VIDEO_MEDIA_TYPES = ['movie', 'show', 'anime'];

const AUDIO_EXTS = new Set(['.m4b', '.mp3', '.m4a', '.flac', '.aac', '.ogg']);
const MANGA_EXTS = new Set(['.cbz', '.zip', '.cbr', '.rar', '.cb7', '.7z']);
const BOOK_EXTS = new Set(['.epub', '.pdf']);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov']);

// Per-library, not global: a slow scan of one library used to reject scans of every other
// one with "Scanner already running". The lock still exists so the same library can't be
// walked twice at once (double-inserting, or racing the stale-row prune).
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
    // walkDirectory skips unreadable subfolders so one bad folder can't sink a scan, but an
    // unreadable library root (EIO from a disconnected drive, EACCES) would then look like
    // an empty library. Read the root once up front so that fails loudly, with its code.
    try {
      fs.readdirSync(library.path);
    } catch (err) {
      throw new PlinthioError(
        codeForFsError(err) || 'P000',
        `Could not read the "${library.name}" folder (${err.code || err.message}): ${library.path}`,
        { cause: err }
      );
    }

    const files = [];
    walkDirectory(library.path, library.type, files);
    logger.info('scan', `Discovered ${files.length} candidate media files in "${library.name}"`);

    // Snapshot what's currently in the DB for this library so we can detect renamed/moved
    // files (same content, different path) instead of treating them as brand-new items,
    // which previously caused duplicates whenever a folder was renamed.
    const dbItemsBefore = await db.all('SELECT id, path, file_size FROM items WHERE library_id = ?', [libraryId]);
    // An unmounted drive usually leaves its mount point behind as an empty folder, which
    // looks exactly like "every file was deleted" — and the prune below would then wipe the
    // whole catalog (and its covers, reading progress links, custom art). Refuse instead.
    if (files.length === 0 && dbItemsBefore.length > 0) {
      throw new PlinthioError(
        'P201',
        `"${library.name}" folder is empty but the catalog has ${dbItemsBefore.length} item(s) — ` +
        'is the drive mounted? Scan skipped so nothing was removed.'
      );
    }
    const dbItemsById = new Map(dbItemsBefore.map((i) => [i.id, i]));
    const discoveredPathSet = new Set(files);

    // Orphaned rows (path no longer exists on disk) are candidates for a rename match,
    // keyed by filename + file size so we only re-link an exact, unambiguous match.
    const orphanedByKey = new Map();
    for (const item of dbItemsBefore) {
      if (!discoveredPathSet.has(item.path)) {
        const key = `${path.basename(item.path)}::${item.file_size}`;
        if (!orphanedByKey.has(key)) orphanedByKey.set(key, []);
        orphanedByKey.get(key).push(item);
      }
    }
    const claimedOrphanIds = new Set();

    let added = 0;
    let updated = 0;
    let renamed = 0;

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      const stats = fs.statSync(filePath);

      // Deterministic ID based on file path
      const computedId = crypto.createHash('md5').update(filePath).digest('hex');

      let itemId = computedId;
      let isRename = false;

      if (!dbItemsById.has(computedId)) {
        const key = `${path.basename(filePath)}::${stats.size}`;
        const candidates = (orphanedByKey.get(key) || []).filter((c) => !claimedOrphanIds.has(c.id));
        if (candidates.length === 1) {
          itemId = candidates[0].id;
          claimedOrphanIds.add(itemId);
          isRename = true;
        }
      }

      const existing = dbItemsById.get(itemId) || null;

      // If existing at the same path with an unchanged size, skip heavy metadata re-extraction
      if (existing && !isRename && existing.file_size === stats.size) {
        continue;
      }

      let meta = null;
      let mediaType = 'book';

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

      // Video rarely ships a poster next to the file, so fall back to TMDB when an admin has
      // configured a key. Best-effort: a miss or a network failure leaves the placeholder
      // cover and never fails the scan.
      if (!meta.coverPath && ['movie', 'show', 'anime'].includes(mediaType)) {
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

      if (existing) {
        await db.run(
          `UPDATE items SET
            title = ?, author = ?, series = ?, volume = ?, path = ?, cover_path = ?,
            duration = ?, total_pages = ?, file_size = ?, format = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            meta.title,
            meta.author,
            meta.series,
            meta.volume,
            filePath,
            meta.coverPath,
            meta.duration || 0,
            meta.totalPages || 0,
            stats.size,
            format,
            itemId
          ]
        );
        updated++;
        if (isRename) renamed++;

        // The file changed (that's why we're here — see the size-unchanged skip above),
        // so its cover may have too. Bust both the thumbnail cache and media.js's in-memory
        // cover_path cache, or a changed cover would silently keep serving the old image.
        for (const width of [180, 360, 720]) {
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
        added++;
      }
    }

    // Prune rows still pointing at paths that no longer exist on disk — genuine deletions
    // (renamed/moved files were already re-linked above and excluded via discoveredPathSet).
    let removed = 0;
    const staleItems = await db.all('SELECT id, cover_path, path FROM items WHERE library_id = ?', [libraryId]);
    for (const item of staleItems) {
      if (!discoveredPathSet.has(item.path)) {
        await db.run('DELETE FROM items WHERE id = ?', [item.id]);
        removed++;
        if (item.cover_path) {
          const coverFullPath = path.join(config.coversDir, item.cover_path);
          try { fs.unlinkSync(coverFullPath); } catch (e) { /* ignore missing cover */ }
        }
        for (const width of [180, 360, 720]) {
          const thumbPath = getThumbnailPath(item.id, width);
          try { fs.unlinkSync(thumbPath); } catch (e) { /* ignore missing thumbnail */ }
        }
      }
    }

    // Artwork pass. Covers used to be resolved only while a file was being added or
    // updated, so anything that came in without art — no poster in the folder, no TMDB key
    // configured at the time — stayed blank forever, since later scans skip unchanged
    // files. This re-checks every item in the library that still has no usable cover.
    const artwork = await backfillArtwork(db, library);

    await db.run('UPDATE libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?', [libraryId]);

    logger.info('scan', `Scan completed for "${library.name}"`, { added, updated, renamed, removed, artwork, total: files.length });
    return { status: 'completed', added, updated, renamed, removed, artwork, total: files.length };
  } finally {
    scanningLibraryIds.delete(libraryId);
  }
}

/**
 * Finds every item in a library whose cover is missing or unusable and tries, in order:
 * artwork sitting next to the file, TMDB (video only, and only with a key configured), and
 * for video a frame from the file itself. Returns how many covers it managed to fill in.
 *
 * Best-effort throughout: a failure here never fails the scan.
 */
async function backfillArtwork(db, library) {
  const items = await db.all(
    'SELECT id, path, title, series, media_type, duration, cover_path, cover_source FROM items WHERE library_id = ?',
    [library.id]
  );

  let filled = 0;
  for (const item of items) {
    const usable = hasUsableCover(item.cover_path);

    // Covers that predate the cover_source column carry no provenance, so classify them
    // once: if the folder still holds artwork that's where the cover came from, and for a
    // video with no folder artwork it can only have been a grabbed frame. Without this, a
    // stand-in from before the upgrade would never be replaced by a real poster.
    if (usable && !item.cover_source) {
      const source = findCoverInFolder(path.dirname(item.path))
        ? 'folder'
        : (VIDEO_MEDIA_TYPES.includes(item.media_type) ? 'frame' : 'folder');
      await db.run('UPDATE items SET cover_source = ? WHERE id = ?', [source, item.id]);
      item.cover_source = source;
    }
    // A frame grabbed from the film is a stand-in, not artwork. If a TMDB key has been
    // configured since, this is the moment to trade it for the real poster — otherwise
    // adding a key would only ever affect newly-added films.
    const provisional = usable && item.cover_source === 'frame' && await isVideoArtworkAvailable();
    if (usable && !provisional) continue;

    let coverPath = null;
    let coverSource = null;

    // 1. Art next to the file. This also re-runs for items whose stored cover turned out to
    //    be junk (a macOS `._` sidecar, a truncated download), now that the picker validates
    //    what it copies.
    const folderCover = findCoverInFolder(path.dirname(item.path));
    if (folderCover) {
      const coverFilename = `${item.id}.jpg`;
      try {
        fs.copyFileSync(folderCover, path.join(config.coversDir, coverFilename));
        coverPath = coverFilename;
        coverSource = 'folder';
      } catch (e) {
        // Unreadable source — fall through to the next strategy.
      }
    }

    // 2. TMDB, when an admin has configured a key.
    if (!coverPath && VIDEO_MEDIA_TYPES.includes(item.media_type)) {
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

    // 3. A frame from the film. Needs no API key, which is the point — a keyless install
    //    would otherwise show a blank card for every movie it has.
    // A frame is only worth grabbing if nothing better exists — and never worth re-grabbing
    // for an item that already has one.
    if (!coverPath && !provisional && VIDEO_MEDIA_TYPES.includes(item.media_type)) {
      coverPath = await extractVideoFrameCover(item.path, item.id, item.duration);
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

// A cover row is only as good as the file behind it: these libraries are full of files that
// claim to be images and aren't, and a stored path pointing at one renders as a blank card.
function hasUsableCover(coverPath) {
  if (!coverPath) return false;
  const full = path.join(config.coversDir, coverPath);
  return fs.existsSync(full) && looksLikeImage(full);
}

function dropCachedImages(itemId) {
  for (const width of [180, 360, 720]) {
    const thumbPath = getThumbnailPath(itemId, width);
    try { fs.unlinkSync(thumbPath); } catch (e) { /* nothing cached */ }
  }
  invalidateCoverCache(itemId);
}

function walkDirectory(dir, libraryType, results, visitedRealPaths = new Set()) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Error reading directory ${dir}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('@') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    // fs.Dirent.isDirectory()/isFile() report false for symlinks even when they point at a
    // real directory/file, so resolve the link target explicitly instead of skipping it —
    // symlinked library/series folders (common with Docker bind mounts and NAS shares)
    // were previously scanned as empty.
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch (err) {
        // Broken symlink — nothing to scan
        continue;
      }
      isDirectory = stats.isDirectory();
      isFile = stats.isFile();

      if (isDirectory) {
        // Guard against symlink cycles (a symlink pointing back into an ancestor directory)
        const realPath = fs.realpathSync(fullPath);
        if (visitedRealPaths.has(realPath)) continue;
        visitedRealPaths.add(realPath);
      }
    }

    if (isDirectory) {
      walkDirectory(fullPath, libraryType, results, visitedRealPaths);
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
        // Fallback for general custom libraries
        results.push(fullPath);
      }
    }
  }
}
