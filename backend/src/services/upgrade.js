import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from '../config/env.js';
import { APP_VERSION } from '../config/version.js';

// Migrations are one-way, so snapshot the database before a new version first opens it.
// The last-run version lives in /config/.version because it must be read before the DB is touched.
const versionFile = () => path.join(config.dataDir, '.version');

export async function backupBeforeUpgrade() {
  const previous = fs.existsSync(versionFile()) ? fs.readFileSync(versionFile(), 'utf8').trim() : null;
  if (previous === APP_VERSION) return null;
  // Fresh install: nothing to protect.
  if (!fs.existsSync(config.dbPath)) return null;

  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const from = (previous || 'pre-1.0').replace(/[^A-Za-z0-9.-]/g, '');
  const filename = `plinthio-backup-before-${APP_VERSION}-from-${from}-${stamp}.sqlite`;
  const target = path.join(dir, filename);

  // No migrations here; VACUUM INTO includes WAL contents a raw copy could miss.
  const db = await open({ filename: config.dbPath, driver: sqlite3.Database });
  try {
    await db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    await db.close();
  }
  console.log(`[upgrade] ${previous || 'an earlier version'} → ${APP_VERSION}: database backed up to backups/${filename}`);
  return { previous, filename };
}

// Called once the new version has started cleanly (migrations done).
export function recordRunningVersion() {
  try {
    fs.writeFileSync(versionFile(), `${APP_VERSION}\n`);
  } catch (e) {
    console.warn('[upgrade] Could not record running version:', e.message);
  }
}
