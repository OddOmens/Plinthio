import fs from 'fs';
import { pdfInfo, extractPdfCover } from './pdf.js';
import { runProbe } from './probe.js';
import path from 'path';
import * as mm from 'music-metadata';
import { config } from '../config/env.js';
import { getOrCreateThumbnail } from './thumbnails.js';
import { listArchiveEntries, readArchiveEntry } from './archive.js';
import { IMAGE_EXTENSIONS, findCoverInFolder } from '../utils/imageFile.js';
import { parseMediaTitle } from './titleCleaner.js';
import { stripProviderIdTags } from './providerIds.js';
import { readBookMetadata, libraryFileBeside } from './bookMetadata.js';
import { getLibraryRoots } from '../utils/libraryPath.js';
import { oneLine } from './logger.js';

// Folder art (cover.jpg…) only if it's a plain file inside a library root, never a link out.
// All extractors use this so the check can't be skipped.
async function folderCoverInLibrary(dir) {
  const found = findCoverInFolder(dir);
  if (!found) return null;
  return libraryFileBeside(found, await getLibraryRoots());
}

const COMIC_EXTENSIONS = new Set(['.cbz', '.zip', '.cbr', '.rar', '.cb7', '.7z']);

const MAX_COMICINFO_BYTES = 1024 * 1024;
const MAX_COMICINFO_VALUE = 500;

/**
 * First single-line <Tag>…</Tag> in ComicInfo.xml, shaped like a `String.match` result, or null.
 * Remembers closing-tag and line-end positions so hostile input is scanned in linear time.
 */
export function comicInfoField(xml, tag) {
  const opening = new RegExp(`<${tag}>`, 'gi');
  const closing = new RegExp(`</${tag}>`, 'gi');
  let close = -1; // where the next closing tag starts, once known to be past the opening
  let lineEnd = -1;
  let m;
  while ((m = opening.exec(xml))) {
    const start = opening.lastIndex;
    if (close < start) {
      closing.lastIndex = start;
      const found = closing.exec(xml);
      if (!found) return null; // nothing further on can close either
      close = found.index;
    }
    if (lineEnd < start) {
      lineEnd = xml.indexOf('\n', start);
      if (lineEnd === -1) lineEnd = xml.length;
    }
    if (close <= lineEnd) return [xml.slice(m.index, close), xml.slice(start, close).slice(0, MAX_COMICINFO_VALUE)];
    opening.lastIndex = lineEnd; // this line has no closing; the next candidate is after it
  }
  return null;
}

export async function extractAudiobookMetadata(filePath, itemId) {
  const result = {
    title: path.basename(filePath, path.extname(filePath)),
    author: 'Unknown Author',
    series: null,
    volume: null,
    duration: 0,
    coverPath: null
  };

  try {
    const metadata = await mm.parseFile(filePath, { duration: true });
    if (metadata.common.title) result.title = metadata.common.title;
    if (metadata.common.artist) result.author = metadata.common.artist;
    else if (metadata.common.albumartist) result.author = metadata.common.albumartist;
    else if (metadata.common.composer && metadata.common.composer.length > 0) result.author = metadata.common.composer[0];

    if (metadata.common.album && metadata.common.album !== result.title) {
      result.series = metadata.common.album;
    }

    if (metadata.format.duration) {
      result.duration = metadata.format.duration;
    }

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.writeFileSync(coverFullPath, pic.data);
      result.coverPath = coverFilename;
    }
  } catch (err) {
    console.warn(`Could not parse audio metadata for ${oneLine(filePath)}: ${oneLine(err.message)}`);
  }

  if (!result.coverPath) {
    const folderCover = await folderCoverInLibrary(path.dirname(filePath));
    if (folderCover) {
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    }
  }

  if (result.coverPath) {
    getOrCreateThumbnail(itemId, result.coverPath, 360).catch(() => {});
  }

  return result;
}

// "Solo Leveling Vol 01" → "Solo Leveling"
function stripVolumeFromName(name) {
  return name
    .replace(/\s*[-_]?\s*v(?:ol(?:ume)?)?\s*\d+(?:\.\d+)?/i, '')   // Vol 01, v01, Volume 3
    .replace(/\s*[-_]?\s*ch(?:apter)?\s*\d+(?:\.\d+)?/i, '')        // Ch. 5, Chapter 10
    .replace(/\s*[-_]?\s*#\s*\d+/i, '')                              // #12
    .replace(/\s*[-_]?\s*\(\d{4}\)/, '')                             // (2021) year suffix
    .replace(/\s*[-_]?\s*\[\d+\]/, '')                               // [42]
    .replace(/\s+$/, '')
    .trim();
}

/** Comic/manga archives. */
export async function extractMangaMetadata(filePath, itemId) {
  const fileName = path.basename(filePath, path.extname(filePath));
  const parentDir = path.dirname(filePath);
  const parentDirName = path.basename(parentDir);

  const result = {
    title: fileName,
    author: null,
    series: null,
    volume: null,
    totalPages: 0,
    coverPath: null,
    readingDirection: null,
    ageRating: null
  };

  const volMatch = fileName.match(/v(?:ol(?:ume)?)?\s*(\d+(?:\.\d+)?)/i)
    || fileName.match(/ch(?:apter)?\s*(\d+(?:\.\d+)?)/i)
    || fileName.match(/#\s*(\d+(?:\.\d+)?)/i);
  if (volMatch) {
    result.volume = parseFloat(volMatch[1]);
  }

  const siblings = (() => {
    try {
      return fs.readdirSync(parentDir).filter(f => {
        const e = path.extname(f).toLowerCase();
        return COMIC_EXTENSIONS.has(e) && f !== path.basename(filePath);
      });
    } catch { return []; }
  })();

  // Heuristic: the parent folder is a series if it has sibling archives or the file has a volume number.
  if (!result.series && (siblings.length > 0 || result.volume !== null)) {
    result.series = parentDirName;
  }

  try {
    const entries = await listArchiveEntries(filePath);

    const imageEntries = entries.filter(entry => {
      if (entry.isDirectory) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !entry.name.startsWith('__MACOSX');
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    result.totalPages = imageEntries.length;

    // First image is the cover
    if (imageEntries.length > 0) {
      const coverData = await readArchiveEntry(filePath, imageEntries[0].name);
      if (coverData) {
        const coverFilename = `${itemId}.jpg`;
        const coverFullPath = path.join(config.coversDir, coverFilename);
        fs.writeFileSync(coverFullPath, coverData);
        result.coverPath = coverFilename;
      }
    }

    // ComicInfo.xml overrides filename-derived values.
    const comicInfoEntry = entries.find(entry => path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
    if (comicInfoEntry) {
      const xmlText = (await readArchiveEntry(filePath, comicInfoEntry.name, { maxBytes: MAX_COMICINFO_BYTES }))?.toString('utf8') || '';
      const titleMatch = comicInfoField(xmlText, 'Title');
      const seriesMatch = comicInfoField(xmlText, 'Series');
      const writerMatch = comicInfoField(xmlText, 'Writer');
      const numberMatch = comicInfoField(xmlText, 'Number');
      // Seed per-series reading direction and age rating (routes/series.js).
      const mangaMatch = comicInfoField(xmlText, 'Manga');
      const ageRatingMatch = comicInfoField(xmlText, 'AgeRating');

      if (titleMatch) result.title = titleMatch[1];
      if (seriesMatch) result.series = seriesMatch[1];
      if (writerMatch) result.author = writerMatch[1];
      if (numberMatch && result.volume === null) result.volume = parseFloat(numberMatch[1]);
      if (mangaMatch) {
        result.readingDirection = /righttoleft/i.test(mangaMatch[1]) ? 'rtl' : 'ltr';
      }
      if (ageRatingMatch) result.ageRating = ageRatingMatch[1].trim();
    }
  } catch (err) {
    console.warn(`Could not parse comic archive for ${oneLine(filePath)}: ${oneLine(err.message)}`);
  }

  if (!result.coverPath) {
    const folderCover = await folderCoverInLibrary(parentDir);
    if (folderCover) {
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    }
  }

  if (result.coverPath) {
    getOrCreateThumbnail(itemId, result.coverPath, 360).catch(() => {});
  }

  return result;
}

/** EPUB/PDF. `writeCover: false` leaves the existing (possibly user-chosen) cover alone. */
export async function extractBookMetadata(filePath, itemId, { writeCover = true } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  // PDFs need a page count, and page 1 is the fallback cover; both need poppler.
  const book = await readBookMetadata(filePath, { pdfInfo: ext === '.pdf' ? pdfInfo : null });
  const result = {
    ...book,
    title: book.title || path.basename(filePath, ext),
    author: book.author || 'Unknown Author',
    coverPath: null
  };
  delete result.coverData;
  if (!writeCover) return result;

  const coverFilename = `${itemId}.jpg`;
  const coverFullPath = path.join(config.coversDir, coverFilename);
  if (book.coverData) {
    try {
      fs.writeFileSync(coverFullPath, book.coverData);
      result.coverPath = coverFilename;
    } catch (err) {
      console.warn(`Could not save EPUB cover for ${oneLine(filePath)}: ${oneLine(err.message)}`);
    }
  }

  if (!result.coverPath) {
    const folderCover = await folderCoverInLibrary(path.dirname(filePath));
    if (folderCover) {
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    }
  }
  if (!result.coverPath && ext === '.pdf') {
    result.coverPath = await extractPdfCover(filePath, itemId);
  }

  return result;
}


// "Season 01", "Series 2", "S03", "Specials": a folder that splits a show up, not the show.
const SEASON_FOLDER = /^(?:(?:season|series|staffel|saison|temporada)[\s._-]*(\d{1,3})|s(\d{1,3})|(specials?))$/i;

// `Show/Season 02/01 - Ep.mp4` → show "Show", season 2.
function showFolderInfo(filePath) {
  const dir = path.dirname(filePath);
  const folder = path.basename(dir);
  const match = folder.match(SEASON_FOLDER);
  // Id tags such as {tvdb-81189} are read by the scanner and aren't part of the name.
  if (!match) return { show: stripProviderIdTags(folder) || folder, season: null };
  const grandparent = path.basename(path.dirname(dir));
  // A season folder straight under the library root has no show folder to fall back on.
  const show = grandparent && grandparent !== '.' && grandparent !== path.sep ? grandparent : folder;
  return { show: stripProviderIdTags(show) || show, season: match[3] ? 0 : parseInt(match[1] || match[2], 10) };
}

export async function extractVideoMetadata(filePath, itemId, mediaType = 'movie') {
  const filename = path.basename(filePath, path.extname(filePath));
  const { show: parentFolder, season: folderSeason } = showFolderInfo(filePath);

  const result = {
    title: filename,
    author: null,
    series: null,
    volume: null,
    duration: 0,
    coverPath: null
  };

  const parsed = parseMediaTitle(filename);

  if (parsed.isTv) {
    const season = parsed.season || 1;
    const episode = parsed.episode || 1;
    // volume = season + episode/1000, so episodes from different seasons don't collide (max 999 per season).
    result.volume = parseInt(season, 10) + parseInt(episode, 10) / 1000;
    result.series = parsed.series || parentFolder;
    result.author = result.series;
    result.title = parsed.cleanTitle;
  } else {
    result.title = parsed.cleanTitle;
    result.author = parentFolder !== '.' && parentFolder !== 'Movies' ? parentFolder : 'Unknown';
    if (mediaType === 'show' || mediaType === 'anime') {
      result.series = parentFolder;
      // "01 - Title.mp4" in a season folder: the number is the episode.
      const numbered = folderSeason !== null && filename.match(/^(\d{1,3})\s*[-–.)]\s*(\S.*)$/);
      if (numbered) {
        result.volume = folderSeason + parseInt(numbered[1], 10) / 1000;
        result.title = parseMediaTitle(numbered[2]).cleanTitle || result.title;
      }
    }
  }

  const folderCover = await folderCoverInLibrary(path.dirname(filePath));
  if (folderCover) {
    const coverFilename = `${itemId}.jpg`;
    const coverFullPath = path.join(config.coversDir, coverFilename);
    try {
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    } catch (e) {
      // Unreadable art: the item just has no cover.
    }
  }

  // ffprobe reads only the container header; music-metadata walks the whole file (minutes over a network share).
  result.duration = await probeVideoDuration(filePath);

  return result;
}

// Best-effort: on failure or timeout duration stays 0; playback re-probes anyway.
const DURATION_PROBE_TIMEOUT_MS = 15000;

async function probeVideoDuration(filePath) {
  const result = await runProbe('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ], DURATION_PROBE_TIMEOUT_MS);
  if (!result) return 0;
  const seconds = parseFloat(result.stdout.trim());
  return result.code === 0 && Number.isFinite(seconds) ? seconds : 0;
}

function cleanReleaseTags(str) {
  return str
    .replace(/[\._]/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd|web-dl|webrip|bluray|x264|x265|hevc|aac|dts|repack|proper)\b.*$/i, '')
    .trim();
}
