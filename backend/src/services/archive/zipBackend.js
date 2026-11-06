import AdmZip from 'adm-zip';
import { getArchiveHandle, MAX_ENTRY_BYTES } from './handleCache.js';

// `new AdmZip(path)` reads and parses the archive's central directory up front, so it's the
// expensive part of serving a page — hence the shared handle cache rather than a fresh
// instance per call. Entry objects come off the cached instance, so getData() below reads
// straight out of the already-parsed archive.
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

  async readEntry(archivePath, name) {
    const zip = await getArchiveHandle(archivePath, open);
    const entry = zip.getEntry(name);
    if (!entry) return null;
    // A page is never this big; refusing it up front stops a tiny "zip bomb" entry from
    // being inflated into memory.
    if (entry.header.size > MAX_ENTRY_BYTES) throw new Error('This page is too large to open');
    return entry.getData();
  }
};
