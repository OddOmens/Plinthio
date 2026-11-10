import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { config } from '../../config/env.js';
import { MAX_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES, MAX_ARCHIVE_ENTRIES } from './handleCache.js';

// Unlike the zip and rar backends, 7-Zip only gives us whole-archive extraction to a
// directory — there's no "read one entry into memory" API. So a .cb7 is unpacked once into
// the cache directory on first access and pages are then read straight off disk. The cache
// is aged out by sweepArchiveCache() below.
//
// The unpacking is done by the system's 7-Zip (the `7zip` package: in the Docker image, and
// one `apt install` away elsewhere), which gets security fixes with the rest of the system.
// The npm package used before shipped its own 7-Zip binary from 2016.
//
// A comic file is whatever somebody downloaded, so nothing is unpacked on trust. The archive
// is listed first and refused if it isn't a real 7z, would unpack to an absurd size or number
// of files, or carries links or paths that point outside its own folder. Only then is it
// unpacked, against a clock, into a temporary folder that is checked again before it is used.
const ARCHIVE_CACHE_DIR = path.join(config.cacheDir, 'archives');

const LIST_TIMEOUT_MS = 30 * 1000;
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;
// A listing is a few hundred bytes an entry; one that outgrows this has far more entries
// than MAX_ARCHIVE_ENTRIES allows anyway.
const LIST_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
// Unpacking LZMA needs as much memory as the dictionary the archive was packed with, and the
// format allows gigabytes. 7-Zip's own "ultra" setting uses 64 MB.
const MAX_DICTIONARY_BYTES = 512 * 1024 * 1024;
// Encrypted archives make 7-Zip ask for a password on the terminal. Handing it one that is
// plainly wrong makes it fail straight away instead (the archive is then reported as
// password-protected); it is ignored for an archive that isn't encrypted.
const NO_PASSWORD = '-pplinthio-has-no-password';

const PASSWORD_MESSAGE = 'This archive is password-protected, so its pages can\'t be read';
const MISSING_MESSAGE = 'CB7/7z support needs the 7zip package — install it (apt install 7zip, brew install sevenzip) '
  + 'or set PLINTHIO_7Z_BIN to a 7-Zip program';

// ─── Finding 7-Zip ──────────────────────────────────────────────────────────

function isProgram(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name) {
  const suffixes = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      if (isProgram(candidate)) return candidate;
    }
  }
  return null;
}

let binary = null;

/**
 * The 7-Zip program to run: PLINTHIO_7Z_BIN if set, else the first of 7zz, 7z and 7za on the
 * PATH (the names the full, the classic and the reduced builds install under). Remembered
 * once found; a failed search is repeated, so installing the package needs no restart.
 */
export function findSevenZip() {
  if (binary) return binary;
  const configured = (process.env.PLINTHIO_7Z_BIN || '').trim();
  if (configured) {
    const found = /[\\/]/.test(configured) ? (isProgram(configured) ? path.resolve(configured) : null) : onPath(configured);
    if (!found) throw new Error(`PLINTHIO_7Z_BIN is set to "${configured}", which is not a program this server can run`);
    binary = found;
    return binary;
  }
  for (const name of ['7zz', '7z', '7za']) {
    const found = onPath(name);
    if (found) {
      binary = found;
      return binary;
    }
  }
  throw new Error(MISSING_MESSAGE);
}

/** Forgets the remembered program (tests switch PLINTHIO_7Z_BIN). */
export function forgetSevenZip() {
  binary = null;
}

/**
 * Runs 7-Zip with `args` — an argument list handed straight to the program, never a shell —
 * and resolves with what it printed. It is killed if it runs past `timeoutMs`, and anything
 * but a clean exit (7-Zip exits 1 for warnings, 2 for errors) is an error.
 */
export function runSevenZip(args, { timeoutMs = LIST_TIMEOUT_MS, maxBuffer = 1024 * 1024 } = {}) {
  const program = findSevenZip();
  return new Promise((resolve, reject) => {
    const child = execFile(program, args, {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer,
      windowsHide: true,
      // File names in the listing and on disk as UTF-8, whatever locale the server runs in.
      env: { ...process.env, LC_ALL: 'C.UTF-8' }
    }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        binary = null; // uninstalled since it was found; look again next time
        return reject(new Error(MISSING_MESSAGE));
      }
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new Error('it holds too many files'));
      if (err.killed) return reject(new Error(`7-Zip was stopped after ${Math.round(timeoutMs / 1000)} seconds`));
      const said = `${stderr || ''}\n${stdout || ''}`;
      if (/password|encrypted/i.test(said)) return reject(new Error(PASSWORD_MESSAGE));
      const firstLine = String(stderr || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
      reject(new Error(`7-Zip reported a problem (exit ${err.code})${firstLine ? `: ${firstLine.slice(0, 200)}` : ''}`));
    });
    // Nothing is ever typed at it: with no input, a prompt fails instead of waiting.
    child.stdin?.end();
    child.on('error', () => {}); // reported through the callback above
  });
}

// ─── Reading 7-Zip's listing ────────────────────────────────────────────────

// `7z l -slt` prints the archive's own properties, a line of dashes, then one block of
// "Key = Value" lines per entry with a blank line between blocks:
//
//   Path = /library/Volume 01.cb7
//   Type = 7z
//   Method = LZMA2:24
//
//   ----------
//   Path = pages/001.jpg
//   Size = 482113
//   Attributes = A -rw-r--r--
//   Encrypted = -
//   Method = LZMA2:24
//
// Entry names are printed as they are, so a name with a line break in it can make up lines
// of its own. The reading below is therefore one-way strict: every size line is added up,
// every attribute line is looked at, and anything that isn't a plain "Key = Value" line — or
// has a slash where only a path can have one — marks the whole listing as not to be trusted.
// Invented lines can only make an archive look worse, never better.
const PATH_KEYS = new Set(['Path', 'Symbolic Link', 'Hard Link']);

function keyValue(line) {
  const at = line.indexOf(' = ');
  if (at > 0) return [line.slice(0, at), line.slice(at + 3)];
  if (line.endsWith(' =')) return [line.slice(0, -2), ''];
  return null;
}

/**
 * Parses the output of `7z l -slt` into
 *   { version, types: [string], methods: [string], malformed: bool,
 *     entries: [{ path, size, attributes, encrypted, link }] }
 * Nothing is judged here; see sevenZipRefusal.
 */
export function parseSevenZipListing(text) {
  const lines = String(text || '').split(/\r?\n/);
  const listing = { version: null, types: [], methods: [], entries: [], malformed: false };
  const banner = lines.slice(0, 8).find((l) => /^(7-Zip|p7zip)\b/.test(l));
  listing.version = banner?.match(/\b(\d{1,2}\.\d{2})\b/)?.[1] || null;

  const dashes = lines.indexOf('----------');
  if (dashes === -1) {
    listing.malformed = true;
    return listing;
  }

  for (const line of lines.slice(0, dashes)) {
    const pair = keyValue(line);
    if (!pair) continue;
    if (pair[0] === 'Type') listing.types.push(pair[1].trim());
    if (pair[0] === 'Method') listing.methods.push(pair[1]);
  }

  let entry = null;
  for (let i = dashes + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      entry = null;
      continue;
    }
    const pair = keyValue(line);
    if (!pair || !/^[A-Z][A-Za-z ]{0,40}$/.test(pair[0])) {
      listing.malformed = true;
      continue;
    }
    const [key, value] = pair;
    if (key === 'Path') {
      if (entry) listing.malformed = true; // two names in one block
      entry = { path: value, size: 0, attributes: '', encrypted: false, link: false };
      listing.entries.push(entry);
      continue;
    }
    if (!entry) {
      listing.malformed = true; // properties with no entry to belong to
      continue;
    }
    if (!PATH_KEYS.has(key) && /[\\/]/.test(value)) listing.malformed = true;
    switch (key) {
      case 'Size':
        if (/^\d{1,15}$/.test(value)) entry.size += Number(value);
        else if (value !== '') listing.malformed = true;
        break;
      case 'Attributes': entry.attributes += ` ${value}`; break;
      case 'Symbolic Link': case 'Hard Link': if (value.trim()) entry.link = true; break;
      case 'Encrypted': if (value.trim() === '+') entry.encrypted = true; break;
      case 'Method': listing.methods.push(value); break;
      default: break;
    }
  }
  return listing;
}

// "Attributes = A -rw-r--r--": Windows flag letters, then (for archives made on Linux or
// macOS) the mode as `ls -l` shows it. A file is "-", a folder "d"; "l" is a symbolic link and
// the rest are devices, pipes and sockets. Among the Windows letters, L is a reparse point —
// what junctions and Windows symlinks are.
function attributeProblem(attributes) {
  for (const token of attributes.split(/\s+/).filter(Boolean)) {
    if (/^[-a-z][-rwxsStT]{9}[+.@]?$/.test(token)) {
      if (token[0] === 'l') return 'a symbolic link';
      if (token[0] !== '-' && token[0] !== 'd') return 'a device or other special file';
    } else if (token.includes('L')) {
      return 'a link (a Windows reparse point)';
    }
  }
  return null;
}

function pathProblem(entryPath) {
  if (!entryPath || entryPath.includes('\0')) return 'an entry with no usable name';
  if (/^[\\/]/.test(entryPath) || /^[A-Za-z]:/.test(entryPath)) return 'an absolute path';
  if (entryPath.split(/[\\/]/).includes('..')) return 'a path that leads outside the archive';
  return null;
}

const UNITS = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/**
 * The largest dictionary (in bytes) the listed methods need: "LZMA2:24" is 2^24 bytes,
 * "LZMA:48m" 48 MB, "PPMD:o32:mem1g" 1 GB.
 */
export function largestDictionary(methods) {
  let largest = 0;
  for (const method of methods) {
    for (const coder of String(method).split(/\s+/)) {
      for (const part of coder.split(':').slice(1)) {
        const m = part.match(/^(?:mem)?(\d{1,12})([bkmg])?$/i);
        if (!m) continue;
        const n = Number(m[1]);
        const bytes = m[2] ? n * UNITS[m[2].toLowerCase()] : (n <= 62 ? 2 ** n : n);
        if (bytes > largest) largest = bytes;
      }
    }
  }
  return largest;
}

const gb = (bytes) => `${Math.round(bytes / 1024 ** 3 * 10) / 10} GB`;

/**
 * Why an archive with this listing must not be unpacked — a short phrase that finishes
 * "Could not extract 7z archive: …" — or null when it may be.
 */
export function sevenZipRefusal(listing, {
  maxEntries = MAX_ARCHIVE_ENTRIES,
  maxTotalBytes = MAX_ARCHIVE_TOTAL_BYTES,
  maxDictionaryBytes = MAX_DICTIONARY_BYTES
} = {}) {
  // 7-Zip decides what a file is by its content, and opens tar, zip, disk images and dozens
  // more. A .cb7 is only ever read as 7z: the other formats bring their own kinds of links and
  // their own bugs, and the zip and rar ones already have safer readers here.
  if (!listing.types.length) return 'its listing could not be read';
  const other = listing.types.find((type) => type.toLowerCase() !== '7z');
  if (other !== undefined) return `it is not a 7z archive (it is ${other.slice(0, 20) || 'unknown'})`;
  if (listing.malformed) return 'its listing has lines that cannot be trusted';
  if (listing.entries.length > maxEntries) return `it holds more than ${maxEntries} files`;

  let total = 0;
  for (const entry of listing.entries) {
    const problem = pathProblem(entry.path) || (entry.link ? 'a link' : null) || attributeProblem(entry.attributes);
    if (problem) return `it contains ${problem}`;
    if (entry.encrypted) return PASSWORD_MESSAGE;
    total += entry.size;
  }
  if (total > maxTotalBytes) return `it would unpack to more than ${gb(maxTotalBytes)}`;
  if (largestDictionary(listing.methods) > maxDictionaryBytes) return 'unpacking it would need too much memory';
  return null;
}

// ─── Unpacking ──────────────────────────────────────────────────────────────

// Keyed on path, size and mtime, so a file replaced on disk is unpacked again rather than
// served from the old copy. (The "v2" also retires folders unpacked before archives were
// checked first; the sweep below clears those out.)
function cacheDirFor(archivePath) {
  const resolved = path.resolve(archivePath);
  const st = fs.statSync(resolved);
  const hash = crypto.createHash('md5').update(`v2:${resolved}:${st.size}:${st.mtimeMs}`).digest('hex');
  return path.join(ARCHIVE_CACHE_DIR, hash);
}

/**
 * Looks over a freshly unpacked folder: only plain files and folders, within the same count
 * and size limits the listing was held to. The listing check should have caught all of it;
 * this is what is actually on disk, so it has the last word. Modes are reset on the way (an
 * archive can carry folders nobody may enter, or setuid files).
 */
export function verifyUnpacked(root, { maxEntries = MAX_ARCHIVE_ENTRIES, maxTotalBytes = MAX_ARCHIVE_TOTAL_BYTES } = {}) {
  let count = 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    fs.chmodSync(dir, 0o700);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (++count > maxEntries) throw new Error(`it holds more than ${maxEntries} files`);
      // Dirent types come from the entry itself (lstat), so a link is seen as a link.
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        fs.chmodSync(full, 0o600);
        total += fs.lstatSync(full).size;
        if (total > maxTotalBytes) throw new Error(`it unpacked to more than ${gb(maxTotalBytes)}`);
      } else {
        throw new Error('it unpacked a link or special file');
      }
    }
  }
  return { count, total };
}

let warnedOld = false;

async function unpackChecked(archivePath, dir) {
  const archive = path.resolve(archivePath);
  // `--` ends the options, so a file name can never be read as one (it is absolute anyway).
  const listing = parseSevenZipListing(await runSevenZip(
    ['l', '-slt', '-t7z', '-sccUTF-8', NO_PASSWORD, '--', archive],
    { timeoutMs: LIST_TIMEOUT_MS, maxBuffer: LIST_MAX_OUTPUT_BYTES }
  ));
  const refusal = sevenZipRefusal(listing);
  if (refusal) throw new Error(refusal);
  if (!warnedOld && listing.version && parseFloat(listing.version) < 23) {
    warnedOld = true;
    console.warn(`[archive] The 7-Zip found on this system (${findSevenZip()}) is version ${listing.version}, which no longer gets security fixes. Install the current "7zip" package.`);
  }

  const tempDir = `${dir}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    await runSevenZip(
      ['x', '-t7z', '-y', '-bd', '-bso0', '-bsp0', NO_PASSWORD, `-o${tempDir}`, '--', archive],
      { timeoutMs: EXTRACT_TIMEOUT_MS }
    );
    verifyUnpacked(tempDir);
    try {
      fs.renameSync(tempDir, dir);
    } catch (err) {
      // Another process got the same archive there first; theirs is as good.
      if (!fs.existsSync(dir)) throw err;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return dir;
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

const unpacking = new Map(); // cache folder → the unpack under way

// Extraction is written to a temp directory and renamed into place, so a half-extracted
// archive is never visible as a complete cache entry (same trick thumbnails.js uses). Two
// requests for the same archive (a page and the next one preloading) share one unpack.
async function ensureExtracted(archivePath) {
  const dir = cacheDirFor(archivePath);
  if (fs.existsSync(dir)) {
    fs.utimesSync(dir, new Date(), new Date());
    return dir;
  }
  if (!unpacking.has(dir)) {
    unpacking.set(dir, unpackChecked(archivePath, dir)
      .catch((err) => {
        // These two already say everything; the rest are reasons this archive was refused.
        if (err.message === PASSWORD_MESSAGE || err.message === MISSING_MESSAGE) throw err;
        throw new Error(`Could not extract 7z archive: ${err.message}`);
      })
      .finally(() => unpacking.delete(dir)));
  }
  return unpacking.get(dir);
}

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ name: rel, isDirectory: true });
      out.push(...walk(path.join(dir, entry.name), rel));
    } else {
      out.push({ name: rel, isDirectory: false });
    }
  }
  return out;
}

export default {
  async listEntries(archivePath) {
    const dir = await ensureExtracted(archivePath);
    return walk(dir);
  },

  async readEntry(archivePath, name, { maxBytes = MAX_ENTRY_BYTES } = {}) {
    const dir = await ensureExtracted(archivePath);
    const target = path.join(dir, name);
    // Entry names come from the archive itself, so keep the resolved read inside the cache.
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) return null;
    // Only a plain file: a symlink the archive unpacked could point anywhere on disk.
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile()) return null;
    // ...and not through a linked folder either: where the file really is must be inside too.
    if (!fs.realpathSync(target).startsWith(fs.realpathSync(dir) + path.sep)) return null;
    if (stat.size > Math.min(maxBytes, MAX_ENTRY_BYTES)) throw new Error('This page is too large to open');
    return fs.readFileSync(target);
  }
};

export function sweepArchiveCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(ARCHIVE_CACHE_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(ARCHIVE_CACHE_DIR)) {
    const dir = path.join(ARCHIVE_CACHE_DIR, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Already gone — nothing to do.
    }
  }
}
