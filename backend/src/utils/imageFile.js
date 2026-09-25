import fs from 'fs';
import path from 'path';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

// Media folders are full of files that look like images by name but aren't. The worst
// offenders are macOS AppleDouble sidecars — a folder copied from a Mac carries a 4KB
// `._www.YTS.MX.jpg` next to the real `www.YTS.MX.jpg`, and since it sorts first, picking
// "the first image in the folder" picked the junk. That junk then copied cleanly into the
// cover store and only failed later, at thumbnail time, as a blank card.
export function isJunkFilename(name) {
  return name.startsWith('.') || name.startsWith('._') || name === 'Thumbs.db';
}

const MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], name: 'jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], name: 'png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], name: 'gif' }
];

/**
 * Whether a file is really a decodable image, judged by its first bytes rather than its
 * extension. Cheap enough to run over a folder listing.
 */
export function looksLikeImage(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    if (read < 12) return false;

    for (const { bytes } of MAGIC) {
      if (bytes.every((b, i) => buf[i] === b)) return true;
    }
    // RIFF....WEBP
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return true;
    // ....ftyp(avif|heic|mif1)
    if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
      const brand = buf.subarray(8, 12).toString('latin1');
      if (['avif', 'avis', 'heic', 'mif1'].includes(brand)) return true;
    }
    return false;
  } catch (err) {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) { /* already closed */ }
    }
  }
}

/**
 * Picks the best cover image sitting next to a media file. Named covers win; otherwise the
 * largest real image in the folder, on the reasoning that a poster outweighs a logo, a
 * scanlation-group banner, or a stray screenshot.
 */
export function findCoverInFolder(dirPath) {
  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch (err) {
    return null;
  }

  const candidates = files
    .filter((f) => !isJunkFilename(f))
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dirPath, f))
    .filter((full) => looksLikeImage(full));

  if (candidates.length === 0) return null;

  for (const name of ['cover', 'folder', 'poster', 'front']) {
    const match = candidates.find((f) => path.basename(f, path.extname(f)).toLowerCase() === name);
    if (match) return match;
  }

  let best = null;
  let bestSize = -1;
  for (const candidate of candidates) {
    try {
      const { size } = fs.statSync(candidate);
      if (size > bestSize) {
        best = candidate;
        bestSize = size;
      }
    } catch (e) {
      // Vanished between readdir and stat — skip it.
    }
  }
  return best;
}
