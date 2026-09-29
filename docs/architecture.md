# Architecture

For people working on Plinthio. The code's own comments explain the *why* at each spot;
this page is the map.

## Shape

One Node.js process serves the API, the media and the built web app. SQLite holds all state.
ffmpeg, ffprobe and poppler are called as child processes. No other services are involved:
no Redis, no queue, no separate transcoder.

```text
backend/            Express API and media engine (ES modules, Node 24)
  src/index.js      App setup: security headers, CSP, rate limits, route mounting, static frontend
  src/config/       env.js (settings from the environment), database.js (schema + migrations), version.js
  src/middleware/   auth.js — tokens, API keys, role checks
  src/errors.js     The P### error catalog and sendError/PlinthioError
  src/routes/       One file per API area (see api.md)
  src/services/     The work: scanning, metadata, streaming, transcoding, parties…
  src/utils/        Small shared helpers (http errors, file sniffing, usernames, xml)
  test/             node:test suites; helpers/server.js boots a throwaway server per file
  scripts/          gen-error-docs.js → docs/error-codes.md
frontend/           Vue 3 + Pinia + Tailwind, built with Vite
  src/views/        One per page (Home = shelves, Title = series/title page, Admin, Settings, Party, Lists, Requests, Downloads, Docs, Login, Setup)
  src/components/   Readers and players (MangaReader, EpubReader, AudioPlayer, VideoPlayer, PauseScreen), cards, admin panels
  src/stores/       auth, player (audio), downloads (offline), customization, dialog, theme
  src/utils/        mediaVocab (per-type words and routes), shelfEntries (series grouping), cover/mediaToken URLs, offline queue
  public/sw.js      Service worker: app shell, cover/page cache, offline downloads
docker/             Dockerfile (multi-stage), compose files, entrypoint (PUID/PGID)
scripts/            set-version.mjs (release version bump)
docs/               This documentation
```

## Backend services

| Service | Responsibility |
| --- | --- |
| `scanner.js` | Walks a library, identifies items (id = MD5 of path, with a move detector keyed on name + size), extracts metadata, marks missing and restored files, runs the artwork pass. One scan per library at a time |
| `autoScan.js` | Periodic scans and the debounced file watcher |
| `metadata.js` | Per-type extraction: audio tags, comic archives and `ComicInfo.xml`, EPUB OPF, PDF info, video file names |
| `titleCleaner.js` | File name → title, year, season/episode |
| `extras.js` | Decides which videos are extras, from folder, suffix and size |
| `archive.js` + `archive/*` | Comic archives by sniffed format (zip, rar, 7z); PDFs are dispatched to `pdf.js` behind the same page API |
| `pdf.js` | poppler: page counts, page rendering to cached JPEGs, PDF covers |
| `externalMetadata.js` | MangaDex, Google Books, Open Library, TMDB search and details |
| `credits.js`, `collections.js`, `ratings.js` | TMDB credits, facts and collections (cached on the item), rating settings and world scores |
| `artwork.js`, `thumbnails.js`, `videoFrame.js` | Covers from folders, TMDB or frames; WebP thumbnails; episode stills |
| `hls.js`, `transcode.js`, `hwaccel.js` | Playback decisions, HLS remux and transcode jobs, hardware detection and testing, encode caps |
| `subtitles.js`, `chapters.js`, `trickplay.js` | Subtitle tracks and VTT, chapter probing, scrub preview sheets |
| `party.js` | In-memory watch parties and their server-sent event streams |
| `visibility.js` | **Access control** (see below) |
| `itemView.js` | Shapes item rows for responses (ratings, series settings) |
| `backup.js`, `upgrade.js`, `updateCheck.js` | Scheduled/manual backups (`VACUUM INTO`), the pre-upgrade backup, the release check |
| `logger.js` | Console + `system_logs` table (Admin → Logs) |

## Data model

SQLite at `DATA_DIR/plinthio.sqlite`, WAL mode, foreign keys on. The schema is created and
migrated in `config/database.js` on every start. Migrations are additive: `CREATE … IF NOT
EXISTS` plus guarded `ALTER TABLE … ADD COLUMN`. A migration must be safe to run on every
boot, on both a fresh database and an old one. Anything touching `items` goes after the
items table is created.

| Table | Holds |
| --- | --- |
| `users` | Accounts: role, preferences JSON, `max_age_rating`, `allow_unrated`, `kids_mode`, `expires_at`, `token_version` |
| `api_keys` | SHA-256 of each key (`key`), `key_md5` for KOReader, last 4 characters |
| `libraries` | Folder, type, `kids_allowed` |
| `items` | One row per file: title, series, volume (episodes encode season + episode/1000), format, pages or duration, metadata, cover, `extra_type`/`extra_of`, `missing_since`, TMDB id and cached `credits_json`, KOReader hashes |
| `series_settings` | Per library + series: display name, reading direction, age rating |
| `user_progress` | Per user + item: time or page, percent, finished, skipped, EPUB CFI, playback rate |
| `kosync_progress` | KOReader's raw positions per user + document hash |
| `item_visibility` | Hidden titles (`user_id` NULL = hidden for everyone) |
| `kids_titles` | Series or single titles in Kids Mode |
| `bookmarks`, `user_ratings` | Bookmarks and notes, star ratings |
| `collections`, `collection_items`, `list_external_entries` | Custom folders and Lists (library items and outside titles) |
| `media_requests` | Requests and their review state |
| `intro_credit_markers` | Skip intro/credits ranges |
| `tmdb_collections` | Cached TMDB collection parts |
| `view_sessions`, `login_history`, `system_logs` | Activity, sign-ins, logs |
| `settings` | Server-wide key/value settings |

## Access control

Every place that returns titles or files applies the same rules, in one function:
`accessSql(user, alias)` in `services/visibility.js`. It returns an SQL fragment beginning
with `AND` that excludes:

- titles whose file is missing (`missing_since`) or that were offloaded (`offloaded_at`);
  title pages, a film's collection and lists pass `{ includeOffloaded: true }` to show
  offloaded ones greyed
- for Kids accounts, anything not in a kids library or `kids_titles`
- anything above the account's content limit (the title's rating, else its series')

It has no bind parameters, so it can be appended to any query without disturbing parameter
order. Per-user and global hides (`item_visibility`) are checked alongside it.
`isItemHiddenForUser(db, itemId, user)` combines both for single-item routes: file streams,
pages, covers, credits, watch parties.

**A new route that returns titles or files must use one of these.** The Kids Mode,
parental-control and missing-files tests exercise shelves, direct links, files and parties
to catch a route that forgets.

Roles are checked with `requireAdmin` or `requireEditor` after `authenticateToken`.

## Authentication

`middleware/auth.js`:

- **Session JWT** (`Authorization: Bearer`) carries `userId` and `tokenVersion`. Bumping
  `users.token_version` (password change, sign out everywhere) revokes all of them. User
  rows are cached for 60 s; call `invalidateUserCache(id)` after changing anything
  auth-relevant.
- **Media JWT** (`typ: 'media'`) is only accepted as `?token=` on `/api/media/*`, and a
  session JWT is never accepted in a URL.
- **API keys**: `userForApiKey`, `userForApiKeyId` (the Komga cookie), and
  `userForApiKeyMd5` (KOReader) all resolve to the same user shape.

## Errors

`errors.js` holds the catalog: code → HTTP status, message, meaning and fix. Routes call
`sendError(req, res, 'P301')` or throw `new PlinthioError('P308', …)`. Anything without a
code gets one from its HTTP status via the `/api` middleware. `serverError(req, res, err)` is
the catch-all 500.

After changing the catalog, run `npm run docs:errors` in `backend/`. A test fails if
`docs/error-codes.md` is out of date. Codes are grouped: P0xx general, P1xx auth, P2xx
libraries, P3xx playback, P4xx metadata, P5xx lists and requests, P6xx parties. P35x are
raised by the app, not the server.

## Playback pipeline

1. `GET playback-info` probes the file (ffprobe, cached) and, given the browser's HEVC
   support, picks **direct**, **remux** or **transcode**.
2. Direct play streams the file with byte ranges.
3. Remux and transcode run ffmpeg into HLS (fMP4 segments) under `cache/hls/<item>/<profile>`.
   Jobs are shared per item and profile, capped at 1 software or 2 hardware encodes, stopped
   when the player closes, and swept after `HLS_CACHE_MAX_AGE_HOURS`.
4. The player (`VideoPlayer.vue`) uses hls.js, or native HLS on Safari. When a request
   fails, it asks the server why and shows the P-code.

## Frontend notes

- **Per-type vocabulary** (Volume/Episode/Book, Read/Watch/Listen, which reader) lives in
  `utils/mediaVocab.js`. Use it rather than `if (mediaType === …)` chains in views.
- **Shelf grouping** (series cards, never loose volumes) is `utils/shelfEntries.js`, shared
  by every view mode.
- **Offline:** `stores/downloads.js` stores files in the service worker's `plinthio-offline`
  cache under token-free keys, and keeps the manifest in localStorage. `utils/offlineQueue.js`
  replays progress saved offline.
- **Customization** (server-wide switches) is fetched once into `stores/customization.js`,
  and is public so the sign-in page can be branded.
- Error toasts show the server's message and code.

## Conventions

- Match the surrounding code: comment density, naming, and the "why, not what" comment
  style.
- User-facing text is plain and specific. Say what happened and what to do.
- Every change gets a line in `CHANGELOG.md` under Unreleased (or the version being
  prepared), written for users.
- Commits are logical units, pushed when finished. Releases follow [RELEASING.md](../RELEASING.md),
  and each release gets a record in `docs/release-records/`.
- Another session or person may share the working tree: check `git status` and
  `git diff --cached` before committing.

## Tests

```bash
cd backend && npm test        # all suites, about a minute
node --test test/kids-mode.test.js   # one suite
```

- `test/helpers/server.js` starts a real server on a free port with a temporary data
  directory. `setupAdmin` runs the setup wizard. Suites create libraries in temp folders and
  scan them.
- Fixtures: `test/fixtures/tiny.mp4` and `three-pages.pdf`. Comic archives are built in the
  test with adm-zip.
- Tests that need ffmpeg or poppler skip without them. CI installs both.
- Library creation starts a background scan, so a test that scans must retry while the
  answer is `status: 'busy'` (see `missing-files.test.js`).
- The frontend has no unit tests. UI changes are checked in headless Chromium (Playwright)
  at 1440×900, 820×1180 touch and 390×844 touch, looking for console errors and horizontal
  overflow. Headless Chromium can't decode H.264, so use a WebM clip for player checks.

CI (`.github/workflows/ci.yml`) runs the backend tests, a frontend build and a Docker build on
every push and pull request.
