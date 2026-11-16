import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Rendered PDF pages age out of the data volume like the other media caches; a volume being
// read keeps its folder fresh, and a sweep can't pull a folder out from under a render.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-pdf-cache-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';
const { renderPdfPage, sweepPdfPageCache } = await import('../src/services/pdf.js');
const pagesDir = path.join(dataDir, 'cache', 'pdf-pages');

const PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/three-pages.pdf');
let hasPoppler = true;
try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); } catch (e) { hasPoppler = false; }

const DAY = 24 * 60 * 60 * 1000;
const age = (dir, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(dir, t, t); };

test('the sweep drops folders past the age limit and keeps recent ones', () => {
  const oldDir = path.join(pagesDir, 'old-volume');
  const newDir = path.join(pagesDir, 'new-volume');
  for (const d of [oldDir, newDir]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '0-1600.jpg'), 'x');
  }
  age(oldDir, 3 * DAY);
  sweepPdfPageCache(DAY);
  assert.equal(fs.existsSync(oldDir), false);
  assert.equal(fs.existsSync(newDir), true);
  fs.rmSync(newDir, { recursive: true, force: true });
});

test('the sweep is a no-op before anything was rendered', () => {
  fs.rmSync(pagesDir, { recursive: true, force: true });
  assert.doesNotThrow(() => sweepPdfPageCache(0));
});

describe('with a real render', { skip: !hasPoppler && 'poppler (pdfinfo/pdftoppm) is not installed' }, () => {
  test('render, sweep with max age 0, folder gone; rendering again works', async () => {
    const page = await renderPdfPage(PDF, 0, { longSide: 200 });
    assert.ok(fs.existsSync(page));
    sweepPdfPageCache(0);
    assert.equal(fs.existsSync(path.dirname(page)), false);
    const again = await renderPdfPage(PDF, 0, { longSide: 200 });
    assert.equal(again, page);
    assert.ok(fs.existsSync(again));
  });

  test('a cache hit touches the volume folder so the sweep keeps it', async () => {
    const page = await renderPdfPage(PDF, 1, { longSide: 200 });
    const dir = path.dirname(page);
    age(dir, 3 * DAY);
    assert.equal(await renderPdfPage(PDF, 1, { longSide: 200 }), page);
    // The touch is fire-and-forget.
    for (let i = 0; i < 50 && Date.now() - fs.statSync(dir).mtimeMs > DAY; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    sweepPdfPageCache(DAY);
    assert.ok(fs.existsSync(page), 'a volume being read stays');
  });

  test('a sweep during a render leaves the rendering folder alone', async () => {
    fs.rmSync(pagesDir, { recursive: true, force: true });
    const rendering = renderPdfPage(PDF, 2, { longSide: 200 });
    // Wait for the render to create its folder, then sweep everything.
    for (let i = 0; i < 100 && !fs.existsSync(pagesDir); i++) await new Promise((r) => setTimeout(r, 5));
    sweepPdfPageCache(0);
    const page = await rendering;
    assert.ok(fs.existsSync(page));
  });
});

process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
