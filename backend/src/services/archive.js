import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { pdfInfo, renderPdfPage, MAX_PDF_PAGES } from './pdf.js';

const isPdf = (p) => path.extname(p).toLowerCase() === '.pdf';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

const ZIP_EXTS = new Set(['.cbz', '.zip']);
const RAR_EXTS = new Set(['.cbr', '.rar']);
const SEVENZIP_EXTS = new Set(['.cb7', '.7z']);

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const RAR_MAGIC = Buffer.from([0x52, 0x61, 0x72, 0x21]);
const SEVENZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

// Comic archives are often mislabelled (.cbr files that are really zips), so magic bytes
// decide the format and the extension is only a fallback.
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

// Lazy imports so CBZ-only libraries never load the RAR/7z packages.
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

// All entries, including non-images (ComicInfo.xml, EPUB's .opf).
export async function listArchiveEntries(archivePath) {
  const backend = await backendFor(archivePath);
  return backend.listEntries(archivePath);
}

// One entry's bytes, or null if missing. Throws before unpacking an entry over `maxBytes`.
export async function readArchiveEntry(archivePath, entryName, { maxBytes } = {}) {
  const backend = await backendFor(archivePath);
  return backend.readEntry(archivePath, entryName, maxBytes ? { maxBytes } : undefined);
}

// Sorted image page names from a comic archive, or one synthetic name per PDF page.
export async function getMangaPagesList(archivePath) {
  if (isPdf(archivePath)) {
    // Clamped again: this turns a file-supplied number into an array length.
    const { pages } = await pdfInfo(archivePath);
    const count = Number.isInteger(pages) && pages > 0 ? Math.min(pages, MAX_PDF_PAGES) : 0;
    return Array.from({ length: count }, (_, i) => `page-${String(i + 1).padStart(4, '0')}.jpg`);
  }
  const entries = await listArchiveEntries(archivePath);
  return sortedImageEntries(entries).map((entry) => entry.name);
}

export async function extractMangaPage(archivePath, pageIndex) {
  if (isPdf(archivePath)) {
    const rendered = await renderPdfPage(archivePath, pageIndex);
    if (!rendered) return null;
    const { pages } = await pdfInfo(archivePath);
    return {
      data: await fs.promises.readFile(rendered),
      mimeType: 'image/jpeg',
      pageNumber: pageIndex + 1,
      totalPages: pages,
      filename: `page-${pageIndex + 1}.jpg`
    };
  }
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
