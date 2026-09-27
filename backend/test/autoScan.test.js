import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-autoscan-'));
process.env.DATA_DIR = dataDir;

const { getAutoScanSettings, saveAutoScanSettings, syncWatchers, stopAutoScan, DEFAULT_AUTO_SCAN } =
  await import('../src/services/autoScan.js');
const { getDb } = await import('../src/config/database.js');

describe('automatic scanning settings', () => {
  after(async () => {
    stopAutoScan();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('defaults to on so a fresh install picks up new media', async () => {
    const settings = await getAutoScanSettings();
    assert.equal(settings.enabled, true);
    assert.equal(settings.watchEnabled, true);
    assert.equal(settings.intervalMinutes, DEFAULT_AUTO_SCAN.intervalMinutes);
  });

  test('saves a partial change without dropping the other fields', async () => {
    await saveAutoScanSettings({ intervalMinutes: 30 });
    const settings = await getAutoScanSettings();

    assert.equal(settings.intervalMinutes, 30);
    assert.equal(settings.enabled, true, 'enabled must survive a change to the interval alone');
    assert.equal(settings.watchEnabled, true);
  });

  test('clamps an out-of-range interval instead of accepting it', async () => {
    assert.equal((await saveAutoScanSettings({ intervalMinutes: 1 })).intervalMinutes, 5);
    assert.equal((await saveAutoScanSettings({ intervalMinutes: 999999 })).intervalMinutes, 7 * 24 * 60);
    assert.equal((await saveAutoScanSettings({ intervalMinutes: 'nonsense' })).intervalMinutes, DEFAULT_AUTO_SCAN.intervalMinutes);
  });

  test('turning watching off releases the watchers', async () => {
    const watched = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-watched-'));
    const db = await getDb();
    await db.run('INSERT OR REPLACE INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
      ['w1', 'Watched', watched, 'movies']);

    await saveAutoScanSettings({ enabled: true, watchEnabled: true });
    await syncWatchers();

    // Turning it off must not throw and must leave nothing holding the directory open.
    await saveAutoScanSettings({ watchEnabled: false });
    await syncWatchers();

    assert.equal((await getAutoScanSettings()).watchEnabled, false);
    fs.rmSync(watched, { recursive: true, force: true });
  });
});
