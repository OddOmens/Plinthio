import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Writes rows straight into a running test server's database. The server holds the file in
// WAL mode, so a second connection can insert while it serves requests.
export async function seedItems(dataDir, count, overrides = {}) {
  const db = await open({ filename: path.join(dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA busy_timeout = 5000');

  const libraryId = overrides.libraryId || crypto.randomUUID();
  await db.run(
    'INSERT OR IGNORE INTO libraries (id, name, path, type) VALUES (?, ?, ?, ?)',
    [libraryId, 'Seeded', '/tmp/seeded', overrides.libraryType || 'manga']
  );

  await db.run('BEGIN');
  for (let i = 0; i < count; i++) {
    // Zero-padded so the title ordering the API uses is also the insertion ordering, which
    // makes "page 2 follows page 1" an exact assertion rather than an approximate one.
    const label = String(i).padStart(5, '0');
    await db.run(
      `INSERT INTO items (id, library_id, title, author, series, volume, path, cover_path,
        media_type, duration, total_pages, file_size, format, description, genres)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `seed-${label}`, libraryId, `Seeded Title ${label}`, `Author ${i % 7}`,
        `Series ${i % 11}`, i % 20, `/tmp/seeded/${label}.cbz`, `${label}.jpg`,
        overrides.mediaType || 'manga', 0, 180, 1024, 'cbz',
        'A long description that has no business being in a list payload', 'Action, Drama'
      ]
    );
  }
  await db.run('COMMIT');
  await db.close();

  return { libraryId };
}
