import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import mime from 'mime-types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

function getSortedImageEntries(zip) {
  return zip.getEntries()
    .filter(entry => {
      if (entry.isDirectory) return false;
      const ext = path.extname(entry.entryName).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !entry.entryName.startsWith('__MACOSX');
    })
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Get list of sorted image page names from a CBZ / ZIP file
 */
export function getMangaPagesList(archivePath) {
  const zip = new AdmZip(archivePath);
  return getSortedImageEntries(zip).map(entry => entry.entryName);
}

/**
 * Extract a single page buffer from a CBZ / ZIP archive. Reuses one AdmZip instance and one
 * sorted entry list instead of re-opening and re-sorting the whole archive twice per call
 * (this used to be the cost of every single page turn in the reader, for every page).
 */
export function extractMangaPage(archivePath, pageIndex) {
  const zip = new AdmZip(archivePath);
  const pages = getSortedImageEntries(zip);

  if (pageIndex < 0 || pageIndex >= pages.length) {
    return null;
  }

  const entry = pages[pageIndex];
  const data = entry.getData();
  const mimeType = mime.lookup(entry.entryName) || 'image/jpeg';

  return {
    data,
    mimeType,
    pageNumber: pageIndex + 1,
    totalPages: pages.length,
    filename: path.basename(entry.entryName)
  };
}
