import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import AdmZip from 'adm-zip';
import { config } from '../config/env.js';
import { getOrCreateThumbnail } from './thumbnails.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

/**
 * Extract metadata and cover for an audiobook file
 */
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

    // Try embedded picture
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.writeFileSync(coverFullPath, pic.data);
      result.coverPath = coverFilename;
    }
  } catch (err) {
    console.warn(`Could not parse audio metadata for ${filePath}: ${err.message}`);
  }

  // If no embedded cover, check folder for cover.jpg, folder.jpg, etc.
  if (!result.coverPath) {
    const folderCover = findCoverInFolder(path.dirname(filePath));
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

/**
 * Strip volume/chapter/number patterns from a manga filename to get a clean series title.
 * e.g. "Solo Leveling Vol 01" → "Solo Leveling"
 *      "One Piece v100" → "One Piece"
 *      "Dragon Ball Chapter 5" → "Dragon Ball"
 */
function stripVolumeFromName(name) {
  return name
    .replace(/\s*[-_]?\s*v(?:ol(?:ume)?)?\s*\d+(?:\.\d+)?/i, '')   // Vol 01, v01, Volume 3
    .replace(/\s*[-_]?\s*ch(?:apter)?\s*\d+(?:\.\d+)?/i, '')        // Ch. 5, Chapter 10
    .replace(/\s*[-_]?\s*#\s*\d+/i, '')                              // #12
    .replace(/\s*[-_]?\s*\(\d{4}\)/, '')                             // (2021) year suffix
    .replace(/\s*[-_]?\s*\[\d+\]/, '')                               // [42]
    .replace(/\s+$/, '')                                             // trailing whitespace
    .trim();
}

/**
 * Extract metadata and cover for a Manga / Comic archive (CBZ, ZIP)
 */
export async function extractMangaMetadata(filePath, itemId) {
  const fileName = path.basename(filePath, path.extname(filePath));
  const parentDir = path.dirname(filePath);
  const parentDirName = path.basename(parentDir); // e.g. "Solo Leveling" or "One Piece"

  const result = {
    title: fileName,
    author: null,
    series: null,
    volume: null,
    totalPages: 0,
    coverPath: null
  };

  // Extract volume/chapter number from filename before anything else
  const volMatch = fileName.match(/v(?:ol(?:ume)?)?\s*(\d+(?:\.\d+)?)/i)
    || fileName.match(/ch(?:apter)?\s*(\d+(?:\.\d+)?)/i)
    || fileName.match(/#\s*(\d+(?:\.\d+)?)/i);
  if (volMatch) {
    result.volume = parseFloat(volMatch[1]);
  }

  // Use parent folder name as series if it looks like a series folder
  // (not the library root itself — check if the grandparent is the library root is hard here,
  //  so we use a heuristic: if the file has a volume number OR there are sibling cbz files)
  const siblings = (() => {
    try {
      return fs.readdirSync(parentDir).filter(f => {
        const e = path.extname(f).toLowerCase();
        return (e === '.cbz' || e === '.zip') && f !== path.basename(filePath);
      });
    } catch { return []; }
  })();

  // Set series from parent folder if:
  // 1. There are sibling CBZ files (multi-volume series folder), OR
  // 2. The file has a volume number (strongly implies it's part of a series)
  if (!result.series && (siblings.length > 0 || result.volume !== null)) {
    result.series = parentDirName;
  }

  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    // Filter image entries and sort natural alphanumerically
    const imageEntries = zipEntries.filter(entry => {
      if (entry.isDirectory) return false;
      const ext = path.extname(entry.entryName).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !entry.entryName.startsWith('__MACOSX');
    }).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }));

    result.totalPages = imageEntries.length;

    // First image is the cover
    if (imageEntries.length > 0) {
      const coverData = imageEntries[0].getData();
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.writeFileSync(coverFullPath, coverData);
      result.coverPath = coverFilename;
    }

    // Check if ComicInfo.xml exists — this overrides our filename-derived values
    const comicInfoEntry = zipEntries.find(entry => path.basename(entry.entryName).toLowerCase() === 'comicinfo.xml');
    if (comicInfoEntry) {
      const xmlText = comicInfoEntry.getData().toString('utf8');
      const titleMatch = xmlText.match(/<Title>(.*?)<\/Title>/i);
      const seriesMatch = xmlText.match(/<Series>(.*?)<\/Series>/i);
      const writerMatch = xmlText.match(/<Writer>(.*?)<\/Writer>/i);
      const numberMatch = xmlText.match(/<Number>(.*?)<\/Number>/i);

      if (titleMatch) result.title = titleMatch[1];
      if (seriesMatch) result.series = seriesMatch[1]; // ComicInfo always wins
      if (writerMatch) result.author = writerMatch[1];
      if (numberMatch && result.volume === null) result.volume = parseFloat(numberMatch[1]);
    }
  } catch (err) {
    console.warn(`Could not parse manga zip for ${filePath}: ${err.message}`);
  }

  // Fallback to folder cover
  if (!result.coverPath) {
    const folderCover = findCoverInFolder(parentDir);
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

/**
 * Extract metadata and cover for an EPUB or PDF book
 */
export async function extractBookMetadata(filePath, itemId) {
  const ext = path.extname(filePath).toLowerCase();
  const result = {
    title: path.basename(filePath, ext),
    author: 'Unknown Author',
    series: null,
    volume: null,
    totalPages: 0,
    coverPath: null
  };

  if (ext === '.epub') {
    try {
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();

      // Find container.xml to locate opf rootfile
      const containerEntry = zipEntries.find(e => e.entryName === 'META-INF/container.xml');
      let opfPath = '';
      if (containerEntry) {
        const containerXml = containerEntry.getData().toString('utf8');
        const match = containerXml.match(/full-path=["']([^"']+\.opf)["']/i);
        if (match) opfPath = match[1];
      }

      // Fallback search for any .opf file
      if (!opfPath) {
        const opfEntry = zipEntries.find(e => e.entryName.endsWith('.opf'));
        if (opfEntry) opfPath = opfEntry.entryName;
      }

      if (opfPath) {
        const opfEntry = zipEntries.find(e => e.entryName === opfPath);
        if (opfEntry) {
          const opfXml = opfEntry.getData().toString('utf8');
          const titleMatch = opfXml.match(/<dc:title[^>]*>(.*?)<\/dc:title>/i);
          const creatorMatch = opfXml.match(/<dc:creator[^>]*>(.*?)<\/dc:creator>/i);

          if (titleMatch) result.title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
          if (creatorMatch) result.author = creatorMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');

          // Look for cover image reference in manifest
          const opfDir = path.dirname(opfPath);
          const coverMatch = opfXml.match(/<item[^>]+id=["'][^"']*cover[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
                             opfXml.match(/<item[^>]+href=["']([^"']+)["'][^>]+properties=["'][^"']*cover-image[^"']*["']/i);

          if (coverMatch) {
            const relativeCover = coverMatch[1];
            const targetCoverPath = path.normalize(opfDir ? `${opfDir}/${relativeCover}` : relativeCover).replace(/\\/g, '/');
            const coverEntry = zipEntries.find(e => e.entryName.toLowerCase() === targetCoverPath.toLowerCase() || e.entryName.endsWith(path.basename(relativeCover)));
            if (coverEntry) {
              const coverFilename = `${itemId}.jpg`;
              const coverFullPath = path.join(config.coversDir, coverFilename);
              fs.writeFileSync(coverFullPath, coverEntry.getData());
              result.coverPath = coverFilename;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Could not parse EPUB metadata for ${filePath}: ${err.message}`);
    }
  }

  // Fallback to folder cover
  if (!result.coverPath) {
    const folderCover = findCoverInFolder(path.dirname(filePath));
    if (folderCover) {
      const coverFilename = `${itemId}.jpg`;
      const coverFullPath = path.join(config.coversDir, coverFilename);
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    }
  }

  return result;
}

function findCoverInFolder(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    const coverNames = ['cover', 'folder', 'poster', 'front'];
    for (const name of coverNames) {
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const match = files.find(f => f.toLowerCase() === `${name}${ext}`);
        if (match) return path.join(dirPath, match);
      }
    }
    // Any single image in the folder
    const firstImg = files.find(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
    if (firstImg) return path.join(dirPath, firstImg);
  } catch (err) {
    // Ignore folder readdir errors
  }
  return null;
}

/**
 * Extract metadata and cover for a Video file (Shows, Movies, Anime)
 */
export async function extractVideoMetadata(filePath, itemId, mediaType = 'movie') {
  const filename = path.basename(filePath, path.extname(filePath));
  const parentFolder = path.basename(path.dirname(filePath));

  const result = {
    title: filename,
    author: null,
    series: null,
    volume: null,
    duration: 0,
    coverPath: null
  };

  // Check for S01E02 or 1x02 or Ep 02 pattern
  const tvPattern = /(?:s(\d+)\s*e(\d+)|(\d+)x(\d+)|(?:ep|episode)\.?\s*(\d+))/i;
  const match = filename.match(tvPattern);

  if (match) {
    const season = match[1] || match[3] || '1';
    const episode = match[2] || match[4] || match[5] || '1';
    // Encode season into the integer part so S01E05 and S02E05 don't collide on the same
    // `volume` value in a series folder that isn't split into per-season subfolders — the
    // fractional part still sorts episodes within a season correctly (up to episode 999).
    result.volume = parseInt(season, 10) + parseInt(episode, 10) / 1000;

    // Extract series name from before the match or from parent folder
    const seriesPrefix = filename.slice(0, match.index).replace(/[\._\-+]/g, ' ').trim();
    result.series = seriesPrefix || parentFolder;
    result.author = result.series;

    // Remaining part after match as episode title
    const epSuffix = filename.slice(match.index + match[0].length).replace(/[\._\-+]/g, ' ').trim();
    result.title = epSuffix ? `${match[0].toUpperCase()}: ${cleanReleaseTags(epSuffix)}` : `${result.series} - ${match[0].toUpperCase()}`;
  } else {
    const cleaned = cleanReleaseTags(filename);
    result.title = cleaned;
    result.author = parentFolder !== '.' && parentFolder !== 'Movies' ? parentFolder : 'Unknown';
    if (mediaType === 'show' || mediaType === 'anime') {
      result.series = parentFolder;
    }
  }

  // Cover fallback from folder
  const folderCover = findCoverInFolder(path.dirname(filePath));
  if (folderCover) {
    const coverFilename = `${itemId}.jpg`;
    const coverFullPath = path.join(config.coversDir, coverFilename);
    try {
      fs.copyFileSync(folderCover, coverFullPath);
      result.coverPath = coverFilename;
    } catch (e) {
      // Ignore cover copy failure
    }
  }

  // music-metadata's container parsers (MP4/QuickTime, Matroska, AVI, ...) read the
  // duration atom straight out of the file's own header without needing ffprobe — no new
  // dependency, and it's already used for audiobooks above.
  try {
    const probe = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    if (probe.format.duration) {
      result.duration = probe.format.duration;
    }
  } catch (e) {
    // Some containers/codecs aren't parseable this way — duration just stays 0, same as before.
  }

  return result;
}

function cleanReleaseTags(str) {
  return str
    .replace(/[\._]/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd|web-dl|webrip|bluray|x264|x265|hevc|aac|dts|repack|proper)\b.*$/i, '')
    .trim();
}
