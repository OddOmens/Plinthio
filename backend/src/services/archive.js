import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

const ZIP_EXTS = new Set(['.cbz', '.zip']);
const RAR_EXTS = new Set(['.cbr', '.rar']);
const SEVENZIP_EXTS = new Set(['.cb7', '.7z']);

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const RAR_MAGIC = Buffer.from([0x52, 0x61, 0x72, 0x21]);
const SEVENZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

// Comic archives are frequently mislabelled — .cbr files that are really zips are extremely
// common, because people rename rather than repack. So the first bytes of the file decide
// the format, and the extension is only a fallback for when the file can't be sniffed.
function sniffFormat(archivePath) {
  let header = null;
  try {
    const fd = fs.openSync(archivePath, 'r');
    try {
      const buf = Buffer.alloc(6);
      const read = fs.readSync(fd, buf, 0, 6, 0);
      header = buf.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    header = null;
  }

  if (header) {
    if (header.subarray(0, 4).equals(ZIP_MAGIC)) return 'zip';
    if (header.subarray(0, 4).equals(RAR_MAGIC)) return 'rar';
    if (header.equals(SEVENZIP_MAGIC)) return 'sevenzip';
  }

  const ext = path.extname(archivePath).toLowerCase();
  if (ZIP_EXTS.has(ext)) return 'zip';
  if (RAR_EXTS.has(ext)) return 'rar';
  if (SEVENZIP_EXTS.has(ext)) return 'sevenzip';
  return null;
}

// Backends are imported lazily so a library of plain CBZs never loads the RAR/7z code (or
// trips over those packages not being installed).
async function backendFor(archivePath) {
  switch (sniffFormat(archivePath)) {
    case 'zip':
      return (await import('./archive/zipBackend.js')).default;
    case 'rar':
      return (await import('./archive/rarBackend.js')).default;
    case 'sevenzip':
      return (await import('./archive/sevenZipBackend.js')).default;
    default:
      throw new Error(`Unrecognised archive format: ${path.basename(archivePath)}`);
  }
}

function sortedImageEntries(entries) {
  return entries
    .filter((entry) => {
      if (entry.isDirectory) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !entry.name.startsWith('__MACOSX');
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Lists every entry in an archive, whatever its format. Used by the scanner/metadata code
 * that needs non-image entries too (ComicInfo.xml, EPUB's .opf).
 */
export async function listArchiveEntries(archivePath) {
  const backend = await backendFor(archivePath);
  return backend.listEntries(archivePath);
}

export async function readArchiveEntry(archivePath, entryName) {
  const backend = await backendFor(archivePath);
  return backend.readEntry(archivePath, entryName);
}

/**
 * Sorted image page names from a comic archive (CBZ/ZIP, CBR/RAR, CB7/7z).
 */
export async function getMangaPagesList(archivePath) {
  const entries = await listArchiveEntries(archivePath);
  return sortedImageEntries(entries).map((entry) => entry.name);
}

/**
 * Extract a single page from a comic archive.
 */
export async function extractMangaPage(archivePath, pageIndex) {
  const backend = await backendFor(archivePath);
  const pages = sortedImageEntries(await backend.listEntries(archivePath));

  if (pageIndex < 0 || pageIndex >= pages.length) {
    return null;
  }

  const entry = pages[pageIndex];
  const data = await backend.readEntry(archivePath, entry.name);
  if (!data) return null;

  return {
    data,
    mimeType: mime.lookup(entry.name) || 'image/jpeg',
    pageNumber: pageIndex + 1,
    totalPages: pages.length,
    filename: path.basename(entry.name)
  };
}
