import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from '../config/env.js';
import { APP_VERSION } from '../config/version.js';

// Every upgrade can run schema migrations on first start, and those are one-way. So before
// the database is opened by a new version for the first time, snapshot it exactly as the
// old version left it — rolling back is then "put the old image tag back and restore this
// file" rather than hoping the new schema is backwards compatible.
//
// The last version that ran is kept in /config/.version rather than inside the database,
// because it has to be read before anything (migrations included) touches the DB.
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

  // A plain connection with no migrations; VACUUM INTO folds in anything still in the WAL,
  // which a raw file copy could miss.
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
