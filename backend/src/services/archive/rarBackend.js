import fs from 'fs';
import { getArchiveHandle } from './handleCache.js';

// node-unrar-js is a WASM build, so there's no system `unrar` binary (or its non-free
// licensing) to deal with in the Docker image. It's imported lazily by the dispatcher, so a
// CBZ-only library never pays for loading it.
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

// The whole archive is read into memory, matching what adm-zip already does for CBZ. Comic
// archives are page images, so this is bounded by the file itself rather than by page count.
//
// That read is cached: serving a page calls in here twice (list, then extract), and a reader
// works through hundreds of pages in one file, so re-reading a multi-hundred-MB CBR off disk
// each time dominated page-turn latency. The extractor itself is still built per call — it
// holds extraction state, and building it from an in-memory buffer is the cheap half.
async function readArchiveData(archivePath) {
  return getArchiveHandle(archivePath, (p) => Uint8Array.from(fs.readFileSync(p)).buffer);
}

async function openArchive(archivePath) {
  const factory = await getExtractorFactory();
  const cached = await readArchiveData(archivePath);
  // Hand the extractor its own copy: the WASM side may take ownership of (and detach) the
  // buffer it's given, which would poison the cached one for the next page.
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

  async readEntry(archivePath, name) {
    const extractor = await openArchive(archivePath);
    const extracted = extractor.extract({ files: [name] });
    const files = [...extracted.files];
    if (files.length === 0) return null;
    assertNotEncrypted(files[0].fileHeader);
    const { extraction } = files[0];
    return extraction ? Buffer.from(extraction) : null;
  }
};
