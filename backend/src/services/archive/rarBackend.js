import fs from 'fs';
import { getArchiveHandle, MAX_ENTRY_BYTES } from './handleCache.js';

// node-unrar-js is WASM, so no system `unrar` binary (or its non-free license) is needed.
// Loaded lazily so CBZ-only libraries never pay for it.
let createExtractorFromData = null;

async function getExtractorFactory() {
  if (!createExtractorFromData) {
    try {
      ({ createExtractorFromData } = await import('node-unrar-js'));
    } catch (err) {
      throw new Error('CBR/RAR support requires the node-unrar-js package — run `npm install` in backend/');
    }
  }
  return createExtractorFromData;
}

// The whole archive is read into memory and cached, since each page needs a list and an
// extract. The extractor is built per call because it holds extraction state.
async function readArchiveData(archivePath) {
  return getArchiveHandle(archivePath, (p) => Uint8Array.from(fs.readFileSync(p)).buffer);
}

async function openArchive(archivePath) {
  const factory = await getExtractorFactory();
  const cached = await readArchiveData(archivePath);
  // Pass a copy: the WASM side may detach the buffer it's given, which would break the cached one.
  return factory({ data: cached.slice(0) });
}

function assertNotEncrypted(header) {
  if (header?.flags?.encrypted) {
    throw new Error('This archive is password-protected, so its pages can\'t be read');
  }
}

export default {
  async listEntries(archivePath) {
    const extractor = await openArchive(archivePath);
    const list = extractor.getFileList();
    return [...list.fileHeaders].map((header) => {
      assertNotEncrypted(header);
      return { name: header.name, isDirectory: header.flags.directory };
    });
  },

  async readEntry(archivePath, name, { maxBytes = MAX_ENTRY_BYTES } = {}) {
    const extractor = await openArchive(archivePath);
    const header = [...extractor.getFileList().fileHeaders].find((h) => h.name === name);
    if (header?.unpSize > Math.min(maxBytes, MAX_ENTRY_BYTES)) throw new Error('This page is too large to open');
    const extracted = extractor.extract({ files: [name] });
    const files = [...extracted.files];
    if (files.length === 0) return null;
    assertNotEncrypted(files[0].fileHeader);
    const { extraction } = files[0];
    return extraction ? Buffer.from(extraction) : null;
  }
};
