// Starts a throwaway Plinthio for the browser tests: a fresh data folder, a small generated
// manga library, and the backend serving the built frontend (run `npm run build` first).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../../backend');
// The fixtures are built with the backend's own dependencies, so the tests add none.
const requireBackend = createRequire(path.join(backendDir, 'package.json'));
const sharp = requireBackend('sharp');
const AdmZip = requireBackend('adm-zip');

const port = process.env.E2E_PORT || '18090';
// Fixed per port so the tests can find the library (see helpers.js libraryPath()).
const root = path.join(os.tmpdir(), `plinthio-e2e-${port}`);
fs.rmSync(root, { recursive: true, force: true });
const dataDir = path.join(root, 'config');
const seriesDir = path.join(root, 'media', 'manga', 'Test Series');
fs.mkdirSync(seriesDir, { recursive: true });

// Two volumes of 40 numbered pages. Every tenth page is taller, like a webtoon strip, so the
// scroll reader has to cope with pages of different heights.
async function page(index) {
  const height = index % 10 === 9 ? 1800 : 1200;
  const hue = (index * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}">
    <rect width="100%" height="100%" fill="hsl(${hue},60%,55%)"/>
    <text x="400" y="${height / 2}" font-size="160" text-anchor="middle" fill="#fff">${index + 1}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
}
for (const volume of [1, 2]) {
  const zip = new AdmZip();
  for (let i = 0; i < 40; i++) zip.addFile(`${String(i).padStart(3, '0')}.jpg`, await page(i));
  zip.writeZip(path.join(seriesDir, `Test Series v0${volume}.cbz`));
}

// A small EPUB for the ebook reader tests: three chapters, long enough to span pages.
function writeEpub(file) {
  const sentences = [
    'The lantern keeper climbed the stairs at dusk, counting each step as she always had.',
    'Below her the harbour settled into its evening hush, boats knocking softly at their moorings.',
    'She trimmed the wick, wiped the glass, and waited for the first ship to call for light.',
    'Some nights the fog came in so thick that the beam seemed to stop an arm’s length away.',
    'On those nights she sang to the sea, because the sea had never once complained about her voice.'
  ];
  const chapter = (n) => {
    const paras = Array.from({ length: 14 }, (_, i) =>
      `<p>${sentences.map((t, j) => (i + j) % 2 ? t : t.replace('she', 'the keeper')).join(' ')}</p>`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>
<body><h1>Chapter ${n}</h1>\n${paras}</body></html>`;
  };
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">plinthio-e2e-lantern</dc:identifier>
    <dc:title>The Lantern Keeper</dc:title>
    <dc:creator>E2E Author</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`));
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Chapter 1</a></li><li><a href="ch2.xhtml">Chapter 2</a></li><li><a href="ch3.xhtml">Chapter 3</a></li>
</ol></nav></body></html>`));
  for (const n of [1, 2, 3]) zip.addFile(`OEBPS/ch${n}.xhtml`, Buffer.from(chapter(n)));
  zip.writeZip(file);
}
const booksDir = path.join(root, 'media', 'books');
fs.mkdirSync(booksDir, { recursive: true });
writeEpub(path.join(booksDir, 'The Lantern Keeper.epub'));

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: port,
    HOST: '127.0.0.1',
    HTTPS_PORT: '',
    UPDATE_CHECK: 'false',
    NODE_ENV: 'production'
  }
});
console.log(`[e2e] data in ${root}`);

const stop = () => {
  server.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
};
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('SIGINT', () => { stop(); process.exit(0); });
server.on('exit', (code) => process.exit(code ?? 1));
