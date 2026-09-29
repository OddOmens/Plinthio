import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from './env.js';
import { ALL_MEDIA_TYPES } from './mediaTypes.js';

let dbPromise = null;

// The opening promise is what's cached, not the handle: two callers arriving before the
// first open finished would otherwise each open a connection and run the migrations
// concurrently against the same file.
export function getDb() {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// For shutdown: waits for the connection (if one was ever opened) and closes it, which
// checkpoints the WAL back into the main database file.
export async function closeDb() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  dbPromise = null;
  if (db) await db.close();
}

async function openDb() {
  const db = await open({
    filename: config.dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys & WAL mode for performance
  await db.run('PRAGMA foreign_keys = ON');
  await db.run('PRAGMA journal_mode = WAL');
  // WAL lets readers run during a write, but a writer still blocks another writer. The
  // driver's 1s default was short enough that a library scan writing in bulk could surface
  // SQLITE_BUSY to someone just saving their reading position.
  await db.run('PRAGMA busy_timeout = 5000');

  await initSchema(db);

  return db;
}

async function initSchema(db) {
  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', -- 'admin' | 'editor' (can edit shared metadata) | 'viewer'
      avatar TEXT,
      expires_at DATETIME,
      preferences TEXT DEFAULT '{"enabledMediaTypes":["audiobook","manga","book","show","movie","anime"],"defaultView":"all"}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate preferences column if users table existed previously
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT '{"enabledMediaTypes":["audiobook","manga","book","show","movie","anime"],"defaultView":"all"}'`);
  } catch (e) {
    // Column already exists
  }

  // Migrate avatar column
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
  } catch (e) {
    // Column already exists
  }

  // Migrate expires_at column
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN expires_at DATETIME`);
  } catch (e) {
    // Column already exists
  }

  // token_version is embedded in every JWT and checked on every request. Bumping it (on
  // password change) instantly invalidates every previously-issued token for that user,
  // instead of leaving a stolen token valid for its full ~30-day life.
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  // Roles were originally just 'admin' / 'user'. The three-tier model (admin / editor /
  // viewer) replaces the old catch-all 'user' role with 'viewer' — the safe, read-only
  // default — rather than 'editor', so existing non-admin accounts don't silently gain
  // global metadata-edit rights; an admin can promote specific accounts afterward.
  await db.run(`UPDATE users SET role = 'viewer' WHERE role NOT IN ('admin', 'editor', 'viewer')`);

  // Sign-in tracking: a quick "last seen" per user, backed by a full history table below
  // for the actual date/time-stamped audit trail (including failed attempts).
  for (const col of ['last_login_at DATETIME', 'last_login_ip TEXT']) {
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  }

  // Parental controls: the highest age rating this account may see (NULL = no limit), and
  // whether content nobody has rated yet is allowed through for a restricted account.
  // kids_mode: the account only sees what's been marked kids-safe (a kids library, or a
  // series/title an admin or editor added to Kids Mode) — see services/visibility.js.
  for (const col of ['max_age_rating TEXT', 'allow_unrated INTEGER DEFAULT 1', 'kids_mode INTEGER DEFAULT 0']) {
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  }

  // Every sign-in attempt, success or failure. user_id is NULL for attempts against a
  // username that doesn't exist — username is still recorded so a pattern of guesses
  // against a nonexistent account is visible to an admin.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);
  `);

  // Two-factor sign-in (services/twoFactor.js), optional per account:
  //   totp_secret / totp_pending — the authenticator secret, encrypted with a key derived
  //     from the JWT secret; pending holds one being set up until its first code is checked
  //   totp_enabled_at — when it was turned on (NULL = off)
  //   totp_last_step — the 30-second step of the last code accepted, so a code can't be
  //     used twice
  //   totp_recovery — JSON list of backup codes, hashed, each with when it was used
  // Away from home (services/network.js):
  //   remote_access — 1 this account may use Plinthio from outside the home network
  //   last_login_network — home / tailscale / outside, for Admin → Users
  for (const col of [
    'totp_secret TEXT', 'totp_pending TEXT', 'totp_enabled_at DATETIME', 'totp_last_step INTEGER',
    'totp_recovery TEXT', 'remote_access INTEGER DEFAULT 1', 'last_login_network TEXT'
  ]) {
    try {
      await db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  }
  try {
    await db.exec('ALTER TABLE login_history ADD COLUMN network TEXT');
  } catch (e) {
    // Column already exists
  }

  // One "opened this item" → "closed this item" span per row, for the readers/players
  // (manga, book, video, audio). item_id carries no FK to items for the same reason as
  // user_progress/bookmarks — history must survive a library delete + re-scan — but the
  // row does cascade off the user, since per-user activity has no meaning once the
  // account itself is gone. item_title/media_type are snapshotted at open time so the
  // activity feed still reads sensibly even if the item is later deleted.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS view_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_title TEXT,
      media_type TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_seconds INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_view_sessions_user ON view_sessions(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_view_sessions_started ON view_sessions(started_at DESC);
  `);

  // API Keys for external apps / user integrations. `key` stores a SHA-256 hash of the
  // actual secret (never the raw value) — the raw key is only ever shown once, at creation.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      key_last4 TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_token ON api_keys(key);
  `);

  try {
    await db.exec(`ALTER TABLE api_keys ADD COLUMN key_last4 TEXT`);
  } catch (e) {
    // Column already exists
  }

  // KOReader sync signs in with the MD5 of the password (a key) — see routes/kosync.js.
  // Keys made before 1.0.0 have none and need re-creating for KOReader.
  try {
    await db.exec(`ALTER TABLE api_keys ADD COLUMN key_md5 TEXT`);
  } catch (e) {
    // Column already exists
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_md5 ON api_keys(key_md5)`);


  // One-time migration: any key still stored as the raw "shlf_..." secret (from before
  // keys were hashed at rest) gets rehashed in place so a DB leak no longer hands out
  // live credentials. Already-migrated rows (64-char hex hash, no prefix) are skipped.
  const legacyKeys = await db.all(`SELECT id, key FROM api_keys WHERE key LIKE 'shlf\\_%' ESCAPE '\\'`);
  if (legacyKeys.length > 0) {
    const crypto = await import('crypto');
    for (const row of legacyKeys) {
      const hash = crypto.createHash('sha256').update(row.key).digest('hex');
      const last4 = row.key.slice(-4);
      await db.run('UPDATE api_keys SET key = ?, key_last4 = ? WHERE id = ?', [hash, last4, row.id]);
    }
    console.log(`Migrated ${legacyKeys.length} API key(s) to hashed storage.`);
  }

  // Item visibility / hiding per user or global
  await db.exec(`
    CREATE TABLE IF NOT EXISTS item_visibility (
      item_id TEXT NOT NULL,
      user_id TEXT, -- NULL means hidden for all users (Admin restrict)
      hidden_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (item_id, user_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_item_vis_user ON item_visibility(user_id);
    -- Serving a file by id checks visibility by item_id (see services/visibility.js), which
    -- the user_id index above can't answer.
    CREATE INDEX IF NOT EXISTS idx_item_vis_item ON item_visibility(item_id);
  `);

  // System logs table for Admin live viewer
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL, -- 'info', 'warn', 'error'
      category TEXT NOT NULL, -- 'auth', 'scan', 'media', 'system'
      message TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp DESC);
  `);

  // Libraries table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      type TEXT NOT NULL, -- 'audiobooks', 'manga', 'books'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_scanned_at DATETIME
    );
  `);

  // Added after the fact for libraries created before automatic scanning existed.
  try {
    await db.exec('ALTER TABLE libraries ADD COLUMN last_scanned_at DATETIME');
  } catch (e) {
    // Column already exists
  }

  // TMDB collections (every film in "Shrek Collection", owned or not), cached so a collection
  // page doesn't ask TMDB each time. Refreshed weekly: announced films get dates and posters.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tmdb_collections (
      id TEXT PRIMARY KEY,
      name TEXT,
      parts_json TEXT NOT NULL,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Media items table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      series TEXT,
      volume REAL,
      path TEXT NOT NULL,
      cover_path TEXT,
      media_type TEXT NOT NULL, -- 'audiobook', 'manga', 'book'
      duration REAL DEFAULT 0,
      total_pages INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      format TEXT NOT NULL, -- 'm4b', 'mp3', 'cbz', 'cbr', 'epub', 'pdf'
      description TEXT,
      release_date TEXT,
      genres TEXT,
      themes TEXT,
      artists TEXT, -- comma-separated, mirrors 'author' (e.g. multiple MangaDex artist credits)
      publisher TEXT,
      status TEXT, -- e.g. 'ongoing', 'completed', 'hiatus', 'cancelled'
      cover_source TEXT, -- 'folder' | 'tmdb' | 'frame' | 'upload'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_items_library ON items(library_id);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(media_type);
    CREATE INDEX IF NOT EXISTS idx_items_author ON items(author);
    -- Every shelf listing ends in ORDER BY title. Without this SQLite builds a temp B-tree
    -- and sorts the whole library on each request (~370ms at 50k items, ~100ms with it).
    CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);
    CREATE INDEX IF NOT EXISTS idx_items_series ON items(series);
  `);

  // Migrate extended metadata columns onto items tables that existed previously.
  // cover_source records where a cover came from ('folder', 'tmdb', 'frame', 'upload') so a
  // later scan can tell a real poster from the video still used as a stand-in, and upgrade
  // the stand-in once a TMDB key exists.
  // age_rating is a per-item override (movies, standalone books); items in a series fall
  // back to the series' rating in series_settings.
  //
  // external_rating* hold a "world" score from an outside provider (TMDB's vote average,
  // 0–10, for movies/shows/anime) shown beside Plinthio's own star ratings.
  // external_rating_checked_at records the last lookup — hit or miss — so an item TMDB
  // doesn't know isn't re-queried every time someone opens its rating.
  //
  // tmdb_id / credits_json hold a movie's or show's full credits (cast with characters,
  // key crew, studios) fetched from TMDB the first time its page is opened; a metadata
  // match sets tmdb_id and clears credits_checked_at so the next view refetches.
  for (const col of [
    'description TEXT', 'release_date TEXT', 'genres TEXT', 'themes TEXT', 'artists TEXT', 'publisher TEXT', 'status TEXT', 'cover_source TEXT',
    'age_rating TEXT', 'chapters_json TEXT', 'extra_type TEXT', 'extra_of TEXT',
    'external_rating REAL', 'external_rating_votes INTEGER', 'external_rating_source TEXT', 'external_rating_checked_at DATETIME',
    // missing_since: the file vanished from disk. The row is kept (hidden) so progress,
    // ratings and custom art survive a drive being briefly unavailable; it's restored if the
    // file comes back, and only an admin removes it for good (Library Health).
    'missing_since DATETIME',
    // offloaded_at: an admin chose to keep this as history after removing (or before
    // removing) its file to free space. Hidden like a missing title, but shown on its title
    // page, greyed, with everyone's progress; restored if the file comes back.
    'offloaded_at DATETIME',
    'tmdb_id TEXT', 'credits_json TEXT', 'credits_checked_at DATETIME'
  ]) {
    try {
      await db.exec(`ALTER TABLE items ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  }

  // KOReader identifies a book by a hash of the file ("binary", its default) or of the file
  // name. Both are kept per item, filled in lazily by routes/kosync.js. Its last reported
  // position is kept as it sent it (an EPUB position is a KOReader XPointer, which only
  // KOReader understands) alongside the percentage Plinthio shows.
  for (const col of ['koreader_hash TEXT', 'koreader_name_hash TEXT']) {
    try {
      await db.exec(`ALTER TABLE items ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_koreader_hash ON items(koreader_hash);
    CREATE INDEX IF NOT EXISTS idx_items_koreader_name_hash ON items(koreader_name_hash);
    CREATE TABLE IF NOT EXISTS kosync_progress (
      user_id TEXT NOT NULL,
      document TEXT NOT NULL,
      item_id TEXT,
      progress TEXT,
      percentage REAL,
      device TEXT,
      device_id TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, document),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // User progress tracking table. item_id intentionally carries no FK/cascade to items:
  // a user's reading/listening/watching history must survive an item (or its whole
  // library) being deleted and later re-scanned. Item ids are derived deterministically
  // from the file's path (see scanner.js's md5(filePath)), so re-scanning the same file —
  // even after the library row itself was deleted and re-added — recreates the identical
  // item id and this row re-attaches automatically with zero extra reconciliation.
  await migrateAwayItemsCascade(db, 'user_progress');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      current_time REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      current_page INTEGER DEFAULT 0,
      total_pages INTEGER DEFAULT 0,
      progress_percent REAL DEFAULT 0,
      is_finished INTEGER DEFAULT 0,
      cfi TEXT, -- EPUB reader position (epub.js CFI string) — book progress can't be
                -- reconstructed from a page number the way manga/PDF can, so it needs its
                -- own field to actually resume where the reader left off.
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_progress_item ON user_progress(item_id);
  `);
  try {
    await db.exec(`ALTER TABLE user_progress ADD COLUMN cfi TEXT`);
  } catch (e) {
    // Column already exists
  }
  // Per-book playback speed for audiobooks, stored with progress so it follows the listener
  // across devices.
  try {
    await db.exec(`ALTER TABLE user_progress ADD COLUMN playback_rate REAL`);
  } catch (e) {
    // Column already exists
  }
  // "Skipped" — the reader chose to pass over this volume (e.g. they watched the anime
  // adaptation of it). Separate from is_finished so their real read history stays honest;
  // any actual reading progress clears it again.
  try {
    await db.exec(`ALTER TABLE user_progress ADD COLUMN is_skipped INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  await finishItemsCascadeMigration(db, 'user_progress', 'user_id, item_id, current_time, duration, current_page, total_pages, progress_percent, is_finished, cfi, playback_rate, is_skipped, updated_at');

  // Settings table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Video (shows/movies/anime) shipped scannable but was unreachable — the API rejected the
  // library type and no player existed — so no existing account could have deliberately
  // turned those types off; their stored preference simply predates the feature. Backfill
  // the video types once (guarded by a marker in settings, hence its position after that
  // table is created) so video content actually appears for accounts made before it worked,
  // without overriding any later deliberate choice.
  const videoBackfill = await db.get("SELECT value FROM settings WHERE key = 'media_types_video_backfill'");
  if (!videoBackfill) {
    const existingUsers = await db.all('SELECT id, preferences FROM users');
    let updated = 0;
    for (const user of existingUsers) {
      let prefs;
      try {
        prefs = user.preferences ? JSON.parse(user.preferences) : {};
      } catch (e) {
        continue; // Malformed prefs — leave them alone rather than clobbering.
      }
      if (!Array.isArray(prefs.enabledMediaTypes)) continue;
      const missing = ALL_MEDIA_TYPES.filter((t) => !prefs.enabledMediaTypes.includes(t));
      if (missing.length === 0) continue;
      prefs.enabledMediaTypes = [...prefs.enabledMediaTypes, ...missing];
      await db.run('UPDATE users SET preferences = ? WHERE id = ?', [JSON.stringify(prefs), user.id]);
      updated++;
    }
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('media_types_video_backfill', 'done', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    if (updated > 0) {
      console.log(`Backfilled video media types into ${updated} existing user preference(s).`);
    }
  }

  // Custom Folders / Collections
  await db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

    CREATE TABLE IF NOT EXISTS collection_items (
      collection_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, item_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_col_items_cid ON collection_items(collection_id);
    CREATE INDEX IF NOT EXISTS idx_col_items_iid ON collection_items(item_id);
  `);

  // Read lists are collections with type='readlist': same CRUD, but their items carry an
  // explicit order (a Komga-style reading order spanning several series) rather than being
  // sorted by when they were added.
  try {
    await db.exec(`ALTER TABLE collections ADD COLUMN type TEXT DEFAULT 'collection'`);
  } catch (e) {
    // Column already exists
  }
  try {
    await db.exec(`ALTER TABLE collection_items ADD COLUMN position INTEGER`);
    // Existing rows have no meaningful order yet, so seed it from the order they were added.
    await db.exec(`
      UPDATE collection_items SET position = (
        SELECT COUNT(*) FROM collection_items older
        WHERE older.collection_id = collection_items.collection_id
        AND older.added_at <= collection_items.added_at
      ) - 1
      WHERE position IS NULL
    `);
  } catch (e) {
    // Column already exists
  }

  // Lists (the ordered "readlist" collections) are grouped by what they hold — movies,
  // shows, anime, read (books + manga) or listen (audiobooks). Every list made before the
  // categories existed was a comic/book reading order, so those land in 'read'.
  try {
    await db.exec(`ALTER TABLE collections ADD COLUMN category TEXT`);
  } catch (e) {
    // Column already exists
  }
  await db.run(`UPDATE collections SET category = 'read' WHERE type = 'readlist' AND category IS NULL`);

  // List entries that aren't in the library: a title picked from an external metadata search
  // (TMDB, MangaDex, Google Books, Open Library), so a list can hold "want to watch" titles
  // the server doesn't have yet. They share the position space of collection_items, so one
  // list can interleave library items and external titles in a single order.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS list_external_entries (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      author TEXT,
      release_date TEXT,
      overview TEXT,
      cover_url TEXT,
      position INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (collection_id, source, external_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_list_ext_cid ON list_external_entries(collection_id);
  `);

  // Media requests: a user asks for a title the server doesn't have; admins and editors
  // work through them. status is one of:
  //   'pending'          — waiting for an admin/editor to look at it
  //   'accepted_pending' — accepted, not in the library yet
  //   'accepted_added'   — accepted and now in the library
  //   'rejected'
  await db.exec(`
    CREATE TABLE IF NOT EXISTS media_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      author TEXT,
      release_date TEXT,
      overview TEXT,
      cover_url TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted_pending', 'accepted_added', 'rejected')),
      response_note TEXT,
      handled_by TEXT,
      handled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_requests_user ON media_requests(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON media_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_requests_external ON media_requests(source, external_id);
  `);

  // Intro/credits markers, so the player can offer a skip button. item_id carries no
  // FK/cascade for the same reason as user_progress and bookmarks — markers are worth
  // keeping across a library wipe and re-scan, and re-attach by the path-derived item id.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS intro_credit_markers (
      item_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('intro', 'credits')),
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      PRIMARY KEY (item_id, type)
    );
  `);

  // Kids Mode: whole libraries can be kids-safe, and so can single series or titles.
  try {
    await db.exec('ALTER TABLE libraries ADD COLUMN kids_allowed INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kids_titles (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      series TEXT,          -- a whole series (with library_id), or…
      item_id TEXT,         -- …one title
      added_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kids_titles_series ON kids_titles(library_id, series) WHERE series IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kids_titles_item ON kids_titles(item_id) WHERE item_id IS NOT NULL;
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_items_missing ON items(missing_since)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_items_offloaded ON items(offloaded_at)');

  // Extras (trailers, featurettes…) hang off their film via extra_of; see services/extras.js.
  await db.exec('CREATE INDEX IF NOT EXISTS idx_items_extra_of ON items(extra_of)');

  // Per-series reader/display settings. Deliberately keyed by (library_id, series_name)
  // rather than a foreign key to a series table: `items.series` is a free-text column with
  // no series table behind it, and normalising that would mean touching every
  // series-grouping query in the app. Two libraries can hold same-named series without
  // sharing settings, which is why library_id is part of the key.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS series_settings (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      series_name TEXT NOT NULL,
      reading_direction TEXT, -- 'ltr' | 'rtl' | 'webtoon'
      age_rating TEXT,
      title_override TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (library_id, series_name),
      FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_series_settings_lookup ON series_settings(library_id, series_name);
  `);

  // Bookmarks table for Audiobooks, Manga, and Books. item_id intentionally carries no
  // FK/cascade to items, for the same reason as user_progress above — bookmarks must
  // survive a library wipe + re-scan, and will re-attach automatically via the
  // deterministic, path-derived item id.
  await migrateAwayItemsCascade(db, 'bookmarks');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'audiobook', 'manga', 'book'
      position REAL NOT NULL, -- seconds for audio, page number for manga/books
      title TEXT,
      notes TEXT,
      cfi TEXT, -- EPUB reader position (epub.js CFI string) for book bookmarks
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user_item ON bookmarks(user_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id);
  `);
  try {
    await db.exec(`ALTER TABLE bookmarks ADD COLUMN cfi TEXT`);
  } catch (e) {
    // Column already exists
  }
  await finishItemsCascadeMigration(db, 'bookmarks', 'id, user_id, item_id, type, position, title, notes, cfi, created_at');

  // Internal 1–5 star ratings, one per user per item. item_id carries no FK/cascade for the
  // same reason as user_progress and bookmarks — a rating should survive a library wipe and
  // re-attach via the path-derived item id on re-scan. The item_id index serves the
  // community average ("what does everyone on this server think of it").
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_ratings (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_ratings_item ON user_ratings(item_id);
  `);

  console.log('Database initialized successfully at:', config.dbPath);
}

// One-time migration for DBs created before item_id stopped cascading from items. SQLite
// can't ALTER a foreign key constraint in place, so this runs in two steps around the
// current CREATE TABLE IF NOT EXISTS for `table`:
//
//  1. migrateAwayItemsCascade (called BEFORE that CREATE TABLE): if `table` already exists
//     with the old `FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE`, rename
//     it aside so the CREATE TABLE right after this call creates a fresh, cascade-free
//     table under the normal name instead of no-op'ing against the old one.
//  2. finishItemsCascadeMigration (called AFTER that CREATE TABLE): if the renamed-aside
//     table is present, copy its rows into the newly-created table and drop it.
//
// A fresh install never has the old table, so both steps are harmless no-ops for it.
async function migrateAwayItemsCascade(db, table) {
  const exists = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]);
  if (!exists) return;

  const foreignKeys = await db.all(`PRAGMA foreign_key_list(${table})`);
  const hasItemsCascade = foreignKeys.some(
    (fk) => fk.table === 'items' && (fk.on_delete || '').toUpperCase() === 'CASCADE'
  );
  if (!hasItemsCascade) return;

  await db.exec(`ALTER TABLE ${table} RENAME TO ${table}_pre_cascade_fix`);
}

async function finishItemsCascadeMigration(db, table, columns) {
  const oldTable = `${table}_pre_cascade_fix`;
  const exists = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [oldTable]);
  if (!exists) return;

  // The old, renamed-aside table may predate a column that was added to the current schema
  // after this cascade migration was first written (e.g. `cfi`, added later) — copy only
  // the columns that actually exist on it, so upgrading straight from an old version in one
  // jump doesn't fail on a column the old table never had.
  const oldColumnInfo = await db.all(`PRAGMA table_info(${oldTable})`);
  const oldColumnNames = new Set(oldColumnInfo.map((c) => c.name));
  const requestedColumns = columns.split(',').map((c) => c.trim());
  const copyableColumns = requestedColumns.filter((c) => oldColumnNames.has(c)).join(', ');

  await db.run(`INSERT INTO ${table} (${copyableColumns}) SELECT ${copyableColumns} FROM ${oldTable}`);
  await db.exec(`DROP TABLE ${oldTable}`);
  console.log(`Migrated "${table}" off the items cascade FK — reading/watching history now survives a library delete + re-scan.`);
}
