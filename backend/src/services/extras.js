import fs from 'fs';
import path from 'path';

// Extras: trailers, featurettes, behind-the-scenes, deleted scenes… They belong to a film
// or show, not on the shelf. This works out which scanned video files are extras, and of
// what, purely from where they sit — so it can be tested without a real disk.
//
// Recognised the way Plex/Jellyfin users already lay them out:
//   • a folder named like an extras folder:  Movie (2021)/Featurettes/Making Of.mkv
//   • a name suffix:                         Movie (2021)/Movie-trailer.mp4
//   • movies only — anything in a subfolder of a film's own folder, and loose files next to
//     the film that are much smaller than it:  Movie (2021)/Movie.mkv + Movie (2021)/Bloopers.mp4
//
// A folder holding several full-length films (a collection) is left alone: a loose sibling
// only counts as an extra when it's under EXTRA_SIZE_RATIO of the main film's size.

const EXTRA_FOLDERS = new Map([
  ['extras', 'Extra'], ['extra', 'Extra'], ['bonus', 'Extra'], ['bonus features', 'Extra'],
  ['special features', 'Extra'], ['other', 'Extra'], ['others', 'Extra'],
  ['featurettes', 'Featurette'], ['featurette', 'Featurette'],
  ['behind the scenes', 'Behind the Scenes'], ['behindthescenes', 'Behind the Scenes'], ['making of', 'Behind the Scenes'],
  ['deleted scenes', 'Deleted Scene'], ['deleted', 'Deleted Scene'],
  ['interviews', 'Interview'], ['interview', 'Interview'],
  ['scenes', 'Scene'], ['shorts', 'Short'],
  ['trailers', 'Trailer'], ['trailer', 'Trailer']
]);

const EXTRA_SUFFIX_RE = /[-._ ](trailer|featurette|behindthescenes|deleted|deletedscene|interview|scene|short|other|extra)$/i;
const SUFFIX_TYPES = {
  trailer: 'Trailer', featurette: 'Featurette', behindthescenes: 'Behind the Scenes',
  deleted: 'Deleted Scene', deletedscene: 'Deleted Scene', interview: 'Interview',
  scene: 'Scene', short: 'Short', other: 'Extra', extra: 'Extra'
};

export const EXTRA_SIZE_RATIO = 0.4;

function folderType(name) {
  return EXTRA_FOLDERS.get(name.toLowerCase().replace(/[_.]+/g, ' ').trim()) || null;
}

function suffixType(filePath) {
  const m = EXTRA_SUFFIX_RE.exec(path.basename(filePath, path.extname(filePath)));
  return m ? SUFFIX_TYPES[m[1].toLowerCase()] : null;
}

// "The.Empire.Strikes.Back.1980.1080p" and "The Empire Strikes Back (1980)" → "the empire strikes back"
function normalizeTitle(name) {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b.*$/, '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// The film a folder is for: the file named after the folder, else the largest file.
function pickMain(files, dirName, sizeOf) {
  const want = normalizeTitle(dirName);
  const named = want && files.find((f) => {
    const got = normalizeTitle(path.basename(f, path.extname(f)));
    return got && (got === want || got.startsWith(want));
  });
  if (named) return named;
  return files.reduce((best, f) => (sizeOf(f) > sizeOf(best) ? f : best), files[0]);
}

const defaultSizeOf = (f) => {
  try { return fs.statSync(f).size; } catch (e) { return 0; }
};

/**
 * @param {string[]} files   absolute paths of the video files found in the library
 * @param {string} root      the library's root folder
 * @param {string} libraryType  'movies' | 'shows' | 'anime' | …
 * @returns {Map<string, {type: string, parentPath: string|null, showFolder: string|null}>}
 *          only extras are in the map; everything else is a normal title.
 */
export function classifyExtras(files, root, libraryType, sizeOf = defaultSizeOf) {
  const result = new Map();
  if (!['movies', 'shows', 'anime'].includes(libraryType)) return result;
  const rootResolved = path.resolve(root);

  // Shows/anime: only unmistakable extras (named folder or suffix); episodes are never
  // guessed at. They're tied to the show through its top-level folder.
  if (libraryType !== 'movies') {
    for (const file of files) {
      const rel = path.relative(rootResolved, path.resolve(file)).split(path.sep);
      const dirs = rel.slice(0, -1);
      const type = dirs.map(folderType).find(Boolean) || suffixType(file);
      if (type) result.set(file, { type, parentPath: null, showFolder: dirs[0] || null });
    }
    return result;
  }

  // Movies: walk the folder tree from the root.
  const byDir = new Map();
  const childDirs = new Map();
  for (const file of files) {
    const dir = path.dirname(path.resolve(file));
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
    // Register every ancestor between the root and this folder.
    let d = dir;
    while (d.startsWith(rootResolved) && d !== rootResolved) {
      const parent = path.dirname(d);
      if (!childDirs.has(parent)) childDirs.set(parent, new Set());
      childDirs.get(parent).add(d);
      d = parent;
    }
  }

  const visit = (dir, main, inheritedType) => {
    const direct = byDir.get(dir) || [];
    const children = [...(childDirs.get(dir) || [])];
    const ownType = dir === rootResolved ? null : folderType(path.basename(dir));

    if (main) {
      // Inside a film's folder tree: everything here is one of its extras.
      const type = ownType || inheritedType;
      for (const f of direct) result.set(f, { type: suffixType(f) || type || 'Extra', parentPath: main, showFolder: null });
      for (const c of children) visit(c, main, type);
      return;
    }

    if (dir === rootResolved || direct.length === 0) {
      // The library root, or a folder of folders (e.g. a collection of per-film folders).
      for (const c of children) visit(c, null, null);
      return;
    }

    const mainFile = pickMain(direct, path.basename(dir), sizeOf);
    const mainSize = sizeOf(mainFile) || 0;
    for (const f of direct) {
      if (f === mainFile) continue;
      const type = suffixType(f);
      if (type || (mainSize > 0 && sizeOf(f) < mainSize * EXTRA_SIZE_RATIO)) {
        result.set(f, { type: type || 'Extra', parentPath: mainFile, showFolder: null });
      }
      // Otherwise it's a full-length film of its own sitting alongside (a collection folder).
    }
    for (const c of children) visit(c, mainFile, folderType(path.basename(c)));
  };

  visit(rootResolved, null, null);
  return result;
}
