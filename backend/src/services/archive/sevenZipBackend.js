import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { config } from '../../config/env.js';
import { MAX_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES, MAX_ARCHIVE_ENTRIES } from './handleCache.js';

// 7-Zip can only extract whole archives, so a .cb7 is unpacked once into the cache and pages
// are read off disk. Uses the system 7-Zip so it gets OS security fixes.
//
// Archives are untrusted: the listing is checked first (real 7z, sane size and count, no
// links or escaping paths), then it's unpacked with a timeout into a temp folder that is
// verified again before use.
const ARCHIVE_CACHE_DIR = path.join(config.cacheDir, 'archives');

const LIST_TIMEOUT_MS = 30 * 1000;
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;
// A listing this large has far more entries than MAX_ARCHIVE_ENTRIES allows anyway.
const LIST_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
// LZMA needs memory equal to the archive's dictionary size, which can be gigabytes ("ultra" is 64 MB).
const MAX_DICTIONARY_BYTES = 512 * 1024 * 1024;
// A dummy password makes encrypted archives fail fast instead of prompting; unencrypted ones ignore it.
const NO_PASSWORD = '-pplinthio-has-no-password';

const PASSWORD_MESSAGE = 'This archive is password-protected, so its pages can\'t be read';
const MISSING_MESSAGE = 'CB7/7z support needs the 7zip package — install it (apt install 7zip, brew install sevenzip) '
  + 'or set PLINTHIO_7Z_BIN to a 7-Zip program';

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

// PLINTHIO_7Z_BIN, else the first of 7zz/7z/7za on PATH. Only a success is cached, so
// installing 7-Zip needs no restart.
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

// Runs 7-Zip without a shell and resolves with stdout. Killed after `timeoutMs`; any non-zero
// exit (1 = warnings, 2 = errors) rejects.
export function runSevenZip(args, { timeoutMs = LIST_TIMEOUT_MS, maxBuffer = 1024 * 1024 } = {}) {
  const program = findSevenZip();
  return new Promise((resolve, reject) => {
    const child = execFile(program, args, {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer,
      windowsHide: true,
      // UTF-8 file names regardless of server locale.
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
    // Closed stdin makes any prompt fail instead of hanging.
    child.stdin?.end();
    child.on('error', () => {}); // reported through the callback above
  });
}

// `7z l -slt` prints archive properties, a line of dashes, then a "Key = Value" block per entry:
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
// Names are printed raw, so a name containing newlines can forge lines. Parsing is therefore
// one-way strict: sizes add up, attributes accumulate, and any odd line marks the listing
// malformed, so forged lines can only make an archive look worse.
const PATH_KEYS = new Set(['Path', 'Symbolic Link', 'Hard Link']);

function keyValue(line) {
  const at = line.indexOf(' = ');
  if (at > 0) return [line.slice(0, at), line.slice(at + 3)];
  if (line.endsWith(' =')) return [line.slice(0, -2), ''];
  return null;
}

/**
 * Parses `7z l -slt` output into
 *   { version, types: [string], methods: [string], malformed: bool,
 *     entries: [{ path, size, attributes, encrypted, link }] }
 * Judging happens in sevenZipRefusal.
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

// "Attributes = A -rw-r--r--": Windows flags (L = reparse point, i.e. a link), then optionally
// a Unix mode where only "-" (file) and "d" (folder) are allowed.
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

// Why this archive must not be unpacked (finishes "Could not extract 7z archive: …"), or null.
export function sevenZipRefusal(listing, {
  maxEntries = MAX_ARCHIVE_ENTRIES,
  maxTotalBytes = MAX_ARCHIVE_TOTAL_BYTES,
  maxDictionaryBytes = MAX_DICTIONARY_BYTES
} = {}) {
  // 7-Zip opens dozens of formats by content; only 7z is allowed, as others bring their own
  // link types and bugs.
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

// Keyed on path, size and mtime so a replaced file is unpacked again. "v2" retires folders
// unpacked without the listing check.
function cacheDirFor(archivePath) {
  const resolved = path.resolve(archivePath);
  const st = fs.statSync(resolved);
  const hash = crypto.createHash('md5').update(`v2:${resolved}:${st.size}:${st.mtimeMs}`).digest('hex');
  return path.join(ARCHIVE_CACHE_DIR, hash);
}

// Final check of what actually landed on disk: plain files and folders only, within limits.
// Also resets modes (archives can carry unenterable folders or setuid files).
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
  // `--` stops a file name being read as an option.
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
      // Another process unpacked it first; use theirs.
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

// Unpacked to a temp dir then renamed, so partial extractions are never visible. Concurrent
// requests for one archive share a single unpack.
async function ensureExtracted(archivePath) {
  const dir = cacheDirFor(archivePath);
  if (fs.existsSync(dir)) {
    fs.utimesSync(dir, new Date(), new Date());
    return dir;
  }
  if (!unpacking.has(dir)) {
    unpacking.set(dir, unpackChecked(archivePath, dir)
      .catch((err) => {
        // These messages stand alone; others are refusal reasons needing the prefix.
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
    // Entry names come from the archive, so keep the read inside the cache folder.
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) return null;
    // Plain files only: a symlink could point anywhere.
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile()) return null;
    // Nor through a linked folder: the real path must be inside too.
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
      // Already gone.
    }
  }
}
