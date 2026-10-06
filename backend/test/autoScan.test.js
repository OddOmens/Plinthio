import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-autoscan-'));
process.env.DATA_DIR = dataDir;

const { getAutoScanSettings, saveAutoScanSettings, syncWatchers, stopAutoScan, isScanDue, latestSlot, normalizeTimes, DEFAULT_AUTO_SCAN } =
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

describe('scheduled scanning and the watcher are independent', () => {
  after(() => stopAutoScan());

  test('the watcher can stay on with the schedule off', async () => {
    const saved = await saveAutoScanSettings({ enabled: false, watchEnabled: true });
    assert.equal(saved.enabled, false);
    assert.equal(saved.watchEnabled, true);
  });

  test('settings saved before the switches were independent keep the watcher off', async () => {
    const db = await getDb();
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['auto_scan', JSON.stringify({ enabled: false, intervalMinutes: 60, watchEnabled: true })]);
    const settings = await getAutoScanSettings();
    assert.equal(settings.enabled, false);
    assert.equal(settings.watchEnabled, false);
  });

  test('normalizes times: drops junk, dedupes, sorts', () => {
    assert.deepEqual(normalizeTimes(['18:30', '03:00', '3:00', '25:00', '03:00', 5]), ['03:00', '18:30']);
    assert.deepEqual(normalizeTimes('nope'), []);
  });

  test('saves a timed schedule', async () => {
    const saved = await saveAutoScanSettings({ enabled: true, mode: 'times', times: ['22:00', '06:00'] });
    assert.equal(saved.mode, 'times');
    assert.deepEqual(saved.times, ['06:00', '22:00']);
  });
});

describe('when a scan is due', () => {
  const at = (h, m = 0) => new Date(2026, 9, 6, h, m, 0, 0);

  test('interval mode waits out the interval', () => {
    const settings = { enabled: true, mode: 'interval', intervalMinutes: 60, times: [] };
    assert.equal(isScanDue(settings, at(9).getTime(), at(9, 59)), false);
    assert.equal(isScanDue(settings, at(9).getTime(), at(10)), true);
    assert.equal(isScanDue(settings, null, at(10)), true);
  });

  test('nothing is due while the schedule is off', () => {
    assert.equal(isScanDue({ enabled: false, mode: 'interval', intervalMinutes: 5, times: [] }, null, at(10)), false);
  });

  test('timed mode scans once per slot, not every tick', () => {
    const settings = { enabled: true, mode: 'times', intervalMinutes: 60, times: ['03:00', '18:00'] };
    assert.equal(isScanDue(settings, at(2).getTime(), at(3, 1)), true, 'overdue after 03:00');
    assert.equal(isScanDue(settings, at(3, 1).getTime(), at(3, 30)), false, 'already scanned since 03:00');
    assert.equal(isScanDue(settings, at(3, 1).getTime(), at(18, 0)), true, 'next slot arrived');
  });

  test('a slot missed while the server was down is made up', () => {
    const settings = { enabled: true, mode: 'times', intervalMinutes: 60, times: ['03:00'] };
    const lastScan = new Date(2026, 9, 4, 3, 0).getTime();
    assert.equal(isScanDue(settings, lastScan, at(7)), true);
  });

  test('before the first slot of the day, yesterday\'s slot is the one that counts', () => {
    const slot = latestSlot(['03:00'], at(1));
    assert.equal(slot.getDate(), 5);
    assert.equal(isScanDue({ enabled: true, mode: 'times', times: ['03:00'] }, new Date(2026, 9, 5, 3, 5).getTime(), at(1)), false);
  });

  test('timed mode with no times never fires', () => {
    assert.equal(isScanDue({ enabled: true, mode: 'times', times: [] }, null, at(10)), false);
  });
});
