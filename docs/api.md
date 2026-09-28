# API

The web app is built entirely on Plinthio's own REST API, so anything it does, a script can
do. Everything is JSON under `/api`.

## Authentication

| Method | How | Use it for |
| --- | --- | --- |
| API key | `X-API-Key: plinthio_…` | Scripts, dashboards, Home Assistant |
| API key over HTTP Basic | `Authorization: Basic base64(username:key)` | Apps that only do username/password: OPDS readers, Mihon |
| Session token | `POST /api/auth/login` → `{ token }`, then `Authorization: Bearer <token>` | The web app. Lasts 7 days, renewed by `POST /api/auth/refresh` |
| Media token | `POST /api/auth/media-token` → `{ mediaToken }`, then `?token=<mediaToken>` | URLs that can't carry headers (`<img>`, `<video>`). Only accepted on `/api/media/*`, valid 24 h |
| Komga session cookie | Set by `/api/v1` and `/api/v2` after a key sign-in | Mihon's tracker. Only honoured on those paths |
| kosync headers | `x-auth-user: <username>`, `x-auth-key: md5(key)` | KOReader. Only on `/api/kosync` |

An API key acts as its owner, with their role, content limit and Kids Mode. A session token
in a URL is refused, as is a media token in a header (P102).

```bash
KEY=plinthio_...
curl -H "X-API-Key: $KEY" "http://plinthio:8088/api/items?mediaType=manga&progress=in_progress"
```

## Errors

Every error is JSON with a code:

```json
{ "error": "The media file is missing from disk", "code": "P301" }
```

Admins also get `detail` with the underlying cause. `GET /api/errors` returns the whole
catalog (no sign-in needed). See [Error codes](error-codes.md).

## Rate limits

| Scope | Limit |
| --- | --- |
| `/api/auth/login` | 10 per 15 min per address |
| rest of `/api/auth` | 60 per 15 min |
| general API | 600 per minute |
| `/api/media`, `/api/opds`, `/api/v1`, `/api/v2`, `/api/kosync` | 1200 per minute |
| backups | 6 per 15 min |

A limited request gets HTTP 429 with P005 (or P108 for sign-in). Behind a reverse proxy, set
`TRUST_PROXY` so limits are per client rather than shared.

## Routes

Roles: **V** any signed-in user, **E** editor or admin, **A** admin. "Visible" means the
response respects hidden titles, missing files, content limits and Kids Mode for the caller.

### Sign-in and account

| Route | Who | |
| --- | --- | --- |
| `GET /auth/setup-status` · `POST /auth/setup` | public | First-run wizard (only while no users exist) |
| `POST /auth/login` · `GET /auth/me` · `POST /auth/refresh` | public / V | Sign in, who am I, renew |
| `POST /auth/media-token` | V | Media token for URLs |
| `POST /auth/sign-out-everywhere` | V | Revoke every token for your account |
| `PATCH /users/preferences` · `PATCH /users/password` | V | Your preferences (merged, not replaced) and password |
| `POST /users/avatar` · `DELETE /users/avatar` · `GET /users/:id/avatar` | V | Profile picture |
| `GET /keys` · `POST /keys` · `DELETE /keys/:id` | V | Your API keys (a new key is returned once) |

### Library and titles

| Route | Who | |
| --- | --- | --- |
| `GET /libraries` | V | Libraries with visible item counts |
| `POST /libraries` · `DELETE /libraries/:id` · `POST /libraries/:id/scan` · `GET /libraries/browse` | A | Manage libraries and scans |
| `PATCH /libraries/:id` `{ kidsAllowed }` | E | Kids Mode for a whole library |
| `GET /items` | V | Visible titles. Filters: `libraryId`, `mediaType`, `author`, `series`, `search`, `progress` (`unread`, `in_progress`, `finished`, `skipped`), `genre`, `addedWithinDays`, `sort`, `limit`, `offset` |
| `GET /items/:id` · `/items/:id/extras` · `/credits` · `/collection` · `/chapters` | V | One title, its extras, TMDB credits and facts, its collection, audiobook or video chapters |
| `GET /items/series` · `/items/series/:name?library=&type=` | V | Series list and one series (volumes, counts, next volume) |
| `POST /items/series/:name/mark-read` · `/mark-unread` | V | Whole series |
| `GET /items/genres` · `/items/authors` · `/items/folders` | V | Filter data and disk folders |
| `POST /items/:id/hide` · `/unhide` (`{ global: true }` for admins) | V / A | Hide for yourself, or for everyone |
| `GET /items/hidden` | V | What you've hidden |
| `GET /series/:libraryId/:name/settings` · `PUT` | V / E | Series name, reading direction, age rating |
| `GET /kids` · `GET /kids/status` · `POST /kids/titles` · `DELETE /kids/titles/:id` | E | Kids Mode series and titles |

### Progress, bookmarks, ratings

| Route | Who | |
| --- | --- | --- |
| `GET /progress/continue` | V | Continue row |
| `GET /progress/:itemId` · `POST /progress/:itemId` | V | Read or save a position (`currentTime`/`duration`, or `currentPage`/`totalPages`, or `isFinished`; `cfi` for EPUB; `playbackRate` for audio) |
| `POST /progress/finish` `{ itemIds, finished }` | V | Mark several finished or not started (mark read up to here) |
| `POST /progress/skip` `{ itemIds, skipped }` | V | Skip or unskip volumes |
| `GET /bookmarks/:itemId` · `POST /bookmarks` · `PATCH`/`DELETE /bookmarks/:id` | V | Bookmarks and notes |
| `GET /ratings/:itemId` · `PUT` `{ rating }` · `DELETE` | V | Your stars, the community average and TMDB's score (as enabled) |
| `POST /activity/start` · `/end` · `GET /activity/me` · `GET /activity/admin` | V / A | Reading and watching sessions, sign-in history |
| `GET /stats/me` · `GET /stats/admin` | V / A | Statistics |

### Media (accept `?token=` media tokens)

| Route | |
| --- | --- |
| `GET /media/cover/:id?w=` · `/media/still/:id` | Cover thumbnails (WebP) or original (`raw=true`); episode stills |
| `GET /media/stream/:id` | Audio, with byte ranges |
| `GET /media/manga/:id/pages` · `/media/manga/:id/page/:index` | Page list and page images (0-based) for comics, manga and PDFs |
| `GET /media/book/:id/file` | The EPUB or PDF file itself |
| `GET /media/video/:id/playback-info?clientHevc=` | Mode (direct, remux, transcode), tracks, qualities |
| `GET /media/video/:id/stream` | Direct play, with byte ranges |
| `GET /media/video/:id/hls/master.m3u8?audio=` (+ variant playlists and segments) · `POST …/hls/stop` | HLS |
| `GET /media/video/:id/subtitles/:track.vtt` | Subtitles as WebVTT |
| `GET /media/video/:id/trickplay/index.json` · `sheet_N.jpg` | Scrub previews |
| `GET /media/video/:id/markers` · `PUT` (E) | Intro and credits ranges |

### Lists, requests, parties

| Route | Who | |
| --- | --- | --- |
| `/collections…` | V | Custom folders and Lists: create, add library or outside titles, reorder, remove |
| `GET /requests` · `POST /requests` · `DELETE /requests/:id` | V | Your requests |
| `GET /requests/pending-count` · `PATCH /requests/:id` | E | Review queue |
| `POST /party` · `GET /party/:code` · `GET /party/:code/events` (server-sent events) · `POST /party/:code/{action,buffering,item,settings,chat}` · `DELETE /party/:code` | V | Watch parties (when enabled) |

### Metadata

| Route | Who | |
| --- | --- | --- |
| `GET /metadata/search?mediaType=&query=&year=` | V | Search providers |
| `POST /metadata/apply/:itemId` · `/metadata/cover/:itemId` · `/metadata/series-cover` | E | Apply a match, upload covers |
| `GET /metadata/admin/items` · `POST /metadata/admin/match-single/:itemId` · `/batch-match` · `/batch-clean-titles` | E | Bulk tools |

### Server

| Route | Who | |
| --- | --- | --- |
| `GET /customization` · `PATCH` | public / A | Branding, theme, layout, ratings display, collections, parties, pause screen, opening sequence switches |
| `POST /customization/intro` · `DELETE` | A | Upload (multipart field `intro`) or remove the opening sequence clip |
| `GET /media/intro` | V | The opening sequence clip (range requests; `?v=` is the upload version) |
| `GET /settings/filters` · `PATCH` | V / A | Which shelf views are offered |
| `/settings/transcoding` · `/transcoding/test` · `/metadata-providers` · `/metadata-providers/tmdb-key` · `/auto-scan` · `/backup/*` | A | Server settings and backups |
| `GET /admin/health` · `POST /admin/health/remove-missing` | A | Library Health, removing missing titles |
| `GET /admin/logs` · `DELETE` | A | Server log |
| `GET /users` · `POST /users` · `PATCH /users/:id` · `/:id/role` · `/:id/password` · `/:id/extend` · `DELETE /users/:id` | A | Accounts |
| `GET /system/update` | A | Update check status |
| `GET /health` · `GET /errors` | public | Health check (with version) and the error catalog |

### Reading apps

| Prefix | |
| --- | --- |
| `/api/opds` | OPDS 1.2 catalog with OPDS-PSE page streaming (HTTP Basic, key as password) |
| `/api/v1`, `/api/v2` | Komga-compatible subset for Mihon. See [Reading apps](sync-apps.md) and `backend/src/routes/komga.js` for the exact list |
| `/api/kosync` | KOReader progress sync protocol |
