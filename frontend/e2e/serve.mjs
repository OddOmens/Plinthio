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
