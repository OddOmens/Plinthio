import AdmZip from 'adm-zip';
import { getArchiveHandle, MAX_ENTRY_BYTES } from './handleCache.js';

// Parsing the central directory is the expensive part, so instances go through the handle cache.
function open(archivePath) {
  return new AdmZip(archivePath);
}

export default {
  async listEntries(archivePath) {
    const zip = await getArchiveHandle(archivePath, open);
    return zip.getEntries().map((entry) => ({
      name: entry.entryName,
      isDirectory: entry.isDirectory
    }));
  },

  // `maxBytes` lets a caller wanting something small (ComicInfo.xml) set a tighter limit.
  async readEntry(archivePath, name, { maxBytes = MAX_ENTRY_BYTES } = {}) {
    const zip = await getArchiveHandle(archivePath, open);
    const entry = zip.getEntry(name);
    if (!entry) return null;
    // Refuse oversized entries up front so a zip bomb is never inflated into memory.
    if (entry.header.size > Math.min(maxBytes, MAX_ENTRY_BYTES)) throw new Error('This page is too large to open');
    return entry.getData();
  }
};
