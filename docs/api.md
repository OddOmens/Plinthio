# API

The web app is built entirely on Plinthio's own REST API, so anything it does, a script can
do. Everything is JSON under `/api`.

## Authentication

| Method | How | Use it for |
| --- | --- | --- |
| API key | `X-API-Key: plinthio_…` | Scripts, dashboards, Home Assistant |
| API key over HTTP Basic | `Authorization: Basic base64(username:key)` | Apps that only do username/password: OPDS readers, Mihon |
| Session token | `POST /api/auth/login` → `{ token }` (or, with two-factor on, `{ twoFactorRequired, challenge }` and then `POST /api/auth/login/2fa` with `{ challenge, code }` or `{ challenge, recoveryCode }`), then `Authorization: Bearer <token>` | The web app. Lasts 7 days, renewed by `POST /api/auth/refresh` (a session token only: an API key can't be exchanged for one) |
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
| `/api/auth/login`, `/api/auth/login/2fa` | 10 failed attempts per 15 min per address |
| two-factor codes at `/api/auth/login/2fa` | 10 wrong per 15 min per account (home and away counted separately), then held for 15 min, doubling each time |
| password confirmations (`PATCH /users/password`, `POST /keys`, `/auth/2fa/*`) | 10 wrong per 15 min per account, then held the same way |
| `/api/metadata/search`, `/api/metadata/details` | 30 and 60 per minute per account (editors and admins unlimited) |
| rest of `/api/auth` | 60 per 15 min |
| general API | 600 per minute |
| `/api/media`, `/api/opds`, `/api/v1`, `/api/v2`, `/api/kosync` | 1200 per minute |
| backups | 6 per 15 min |

A limited request gets HTTP 429 with P005 (or P108 for sign-in and password confirmations).
Behind a reverse proxy, set `TRUST_PROXY` so limits are per client rather than shared.

## Calling the API from another website

Browsers only let a page on another site read the API if `CORS_ORIGIN` names it (see
[Configuration](configuration.md)); by default none may. Scripts and apps aren't browsers and
are unaffected. Session tokens go in the `Authorization` header and say `"typ": "session"`;
a media token (`?token=` on `/api/media` URLs) can only `GET`.

## Routes

Roles: **V** any signed-in user, **E** editor or admin, **A** admin. "Visible" means the
response respects hidden titles, missing files, content limits and Kids Mode for the caller.

### Sign-in and account

| Route | Who | |
| --- | --- | --- |
| `GET /auth/setup-status` · `POST /auth/setup` | public | First-run wizard (only while no users exist, only from the home network, and only when the server is addressed by IP or a home-network name). `access: { remoteAccess, tailscaleIsHome, require2faOutside }` sets Admin → Network |
| `POST /auth/login` · `GET /auth/me` · `POST /auth/refresh` | public / V | Sign in, who am I, renew. From outside the home network every refused sign-in is P107, whatever the reason |
| `POST /auth/media-token` | V | Media token for URLs |
| `POST /auth/sign-out-everywhere` | V (session only, not API keys) | Revoke every token for your account and delete its API keys. Returns `apiKeysRevoked` |
| `POST /auth/login/2fa` | public | Second step of a two-factor sign-in: `{ challenge, code }` or `{ challenge, recoveryCode }`. Five tries per challenge (P111, then P113); ten wrong codes for one account hold it (P108) |
| `GET /auth/access` | public | Whether this device is home, Tailscale or outside, and whether it may sign in from there |
| `GET /auth/2fa` · `POST /auth/2fa/setup` · `/2fa/enable` · `/2fa/disable` · `/2fa/recovery-codes` | V (session only, not API keys) | Two-factor for your own account: status, start with `{ password }` (returns the `otpauth://` link and key; P107 for a wrong password), confirm with `{ code }` (this signs out every other session and returns a fresh `token` and `mediaToken` for this one), turn off or make new backup codes with `{ password, code }` (or `recoveryCode`) |
| `PATCH /users/preferences` | V | Your preferences (merged, not replaced; any keys, up to 64 KB in all). `hiddenLibraries` (library ids) and `hideKids` (true/false) hide whole libraries and kids content from you |
| `PATCH /users/password` | V (session only, not API keys) | `{ currentPassword, newPassword, revokeApiKeys? }`. Signs out every session. API keys are kept unless `revokeApiKeys` is `true`; the answer has `apiKeys` (how many remain) and `apiKeysRevoked`. A wrong current password is P107 |
| `POST /users/avatar` · `DELETE /users/avatar` · `GET /users/:id/avatar` | V | Profile picture. Reading one needs no sign-in (an `<img>` can't send one), but a home-only server refuses it from outside |
| `GET /keys` · `POST /keys` · `DELETE /keys/:id` | V (session only, not API keys) | Your API keys. Making one takes `{ name, password }` (your account password; P107 if it's wrong or missing) and returns the key once |

### Library and titles

| Route | Who | |
| --- | --- | --- |
| `GET /libraries` | V | Libraries with item counts. A Kids Mode or content-limited account gets only the libraries it can see something in, counted by what it can see |
| `POST /libraries` · `DELETE /libraries/:id` · `POST /libraries/:id/scan` · `GET /libraries/browse` | A | Manage libraries and scans |
| `PATCH /libraries/:id` `{ kidsAllowed, ignoreMissingMetadata }` | E | Kids Mode for a whole library; stop flagging its missing posters and details |
| `GET /items` | V | Visible titles. Filters: `libraryId`, `mediaType`, `author`, `series`, `search`, `progress` (`unread`, `in_progress`, `finished`, `skipped`), `genre`, `addedWithinDays`, `sort`, `limit`, `offset` |
| `GET /items/:id` · `/items/:id/extras` · `/credits` · `/collection` · `/chapters` | V | One title, its extras, TMDB credits and facts, its collection, audiobook or video chapters |
| `GET /items/series` · `/items/series/:name?library=&type=` | V | Series list and one series (volumes, counts, next volume) |
| `POST /items/series/:name/mark-read` · `/mark-unread` | V | Whole series |
| `GET /items/genres` · `/items/authors` · `/items/folders` | V | Filter data and disk folders |
| `POST /items/:id/hide` · `/unhide` (`{ global: true }` for admins) | V / A | Hide for yourself, or for everyone |
| `GET /items/hidden` | V | What you've hidden (never a title an admin has hidden from everyone, unless you're an admin) |
| `GET /series/:libraryId/:name/settings` · `PUT` | V / E | Series name, reading direction, age rating. A series the account can see no title of answers with the defaults, like one that doesn't exist |
| `GET /kids` · `GET /kids/status` · `POST /kids/titles` · `DELETE /kids/titles/:id` | E | Kids Mode series and titles |

### Progress, bookmarks, ratings

| Route | Who | |
| --- | --- | --- |
| `GET /progress/continue` | V | Continue row |
| `GET /progress/:itemId` · `POST /progress/:itemId` | V | Read or save a position (`currentTime`/`duration`, or `currentPage`/`totalPages`, or `isFinished`; `cfi` for EPUB; `playbackRate` for audio). Saving needs a title that exists and that the account may see (404 otherwise) |
| `POST /progress/finish` `{ itemIds, finished }` | V | Mark several finished or not started (mark read up to here) |
| `POST /progress/skip` `{ itemIds, skipped }` | V | Skip or unskip volumes |
| `GET /bookmarks/:itemId` · `POST /bookmarks` · `PATCH`/`DELETE /bookmarks/:id` | V | Bookmarks and notes, on titles that exist and that the account may see. Up to 500 per title; title 300 characters, note 5000 |
| `GET /highlights/:itemId` · `POST /highlights` · `PATCH`/`DELETE /highlights/:id` | V | EPUB highlights: `cfiRange`, `text`, `color` (yellow, green, blue, pink, orange), optional `note`. Each person sees only their own |
| `GET /ratings/:itemId` · `PUT` `{ rating }` · `DELETE` | V | Your stars, the community average and TMDB's score (as enabled) |
| `POST /activity/start` · `/end` · `GET /activity/me` · `GET /activity/admin` | V / A | Reading and watching sessions (`start` answers 404 for a title that doesn't exist or that the account may not see), sign-in history |
| `GET /stats/me` · `GET /stats/admin` | V / A | Statistics |

### Media (accept `?token=` media tokens)

| Route | |
| --- | --- |
| `GET /media/cover/:id?w=` · `/media/still/:id` | Cover thumbnails (WebP) or original (`raw=true`); episode stills |
| `GET /media/stream/:id` | Audio, with byte ranges |
| `GET /media/manga/:id/pages` · `/media/manga/:id/page/:index` | Page list and page images (0-based) for comics, manga and PDFs |
| `GET /media/book/:id/file` | The EPUB or PDF file itself |
| `GET /media/video/:id/playback-info?clientHevc=&videoCodecs=` | Mode (direct, remux, transcode), tracks, qualities. Apps that aren't browsers send `videoCodecs`, the full list of video codecs the device decodes (`h264`, `hevc`, `av1`, `vp9`, `vp8`, comma-separated); anything else is converted. `compatCopy: true` means a converted copy will be played: add `copy=1` to the stream and HLS URLs. `compat` is the copy's state (below) |
| `GET /media/video/:id/stream?copy=` | Direct play, with byte ranges |
| `GET /media/video/:id/hls/master.m3u8?audio=&clientHevc=&videoCodecs=&copy=` (+ variant playlists and segments, which carry the same query) · `POST …/hls/stop` | HLS |
| `GET /media/video/:id/compat` · `POST` · `DELETE` (A) | A title's [converted copy](administration.md#converted-copies): `{ status: none\|queued\|running\|done\|failed, progress, error, errorCode, codec, eligible, canRequest }`. `POST` queues one (202), or tries a failed one again; admins, or everyone when the admin allows it (P312 otherwise). P310 when the video needs no copy, P311 at the size limit. `DELETE` cancels a conversion or deletes the copy |
| `GET /media/video/:id/subtitles/:track.vtt` | Subtitles as WebVTT |
| `GET /media/video/:id/trickplay/index.json` · `sheet_N.jpg` | Scrub previews (index is 204 when the file has none) |
| `GET /media/video/:id/markers` · `PUT` (E) | Intro and credits ranges |
| `GET /media/live/:id/index.m3u8` (+ the signed `p?u=…&s=…` links inside it) · `GET /media/live/:id/logo` | Live TV channel stream and logo, through the server |

### Lists, requests, parties

| Route | Who | |
| --- | --- | --- |
| `/collections…` | V | Custom folders and Lists: create, add library or outside titles, reorder, remove |
| `GET /requests` · `POST /requests` · `DELETE /requests/:id` | V | Your requests |
| `GET /requests/pending-count` · `PATCH /requests/:id` | E | Review queue |
| `GET /live/status` · `GET /live/channels?lineup=<id>\|favourites&group=&q=` · `GET /live/channels/:id` · `GET /live/guide?from=&hours=&offset=&limit=&lineup=` | V | Live TV (when enabled): channels with now/next and the line-ups you can see, one channel's programmes, the guide grid |
| `POST/DELETE /live/favourites/:channelId` · `GET /live/now?limit=` · `POST /live/channels/:id/watched` · `GET /live/recent` · `GET /live/search?q=` · `GET /live/me/hidden` | V | Favourites, the Home "Live now" row, recently watched, channel and programme search, your personally hidden channels (hide them with `PATCH /users/preferences { liveTv: { hiddenChannels, hiddenGroups, showOnHome } }`) |
| `GET /live/admin/presets` · `GET/POST /live/admin/sources` · `PATCH/DELETE /live/admin/sources/:id` · `POST /live/admin/sources/:id/refresh` · `POST /live/admin/acknowledge` | A | Live TV lists (a public list needs the one-time acknowledgement first) |
| `GET/POST /live/admin/lineups` · `PATCH/DELETE /live/admin/lineups/:id` · `PUT /live/admin/lineups/order` · `GET/PUT/POST/DELETE /live/admin/lineups/:id/channels` | A | Line-ups (admin-made channel collections, optionally allowed for kids) |
| `PATCH /live/admin/channels/:id` (`number`, `name`, `logo`) · `POST /live/admin/channels/:id/check` · `GET/PATCH /live/admin/health` | A | Channel numbering, display name and logo; the light stream check and hiding offline channels |
| `GET/PATCH /live/admin/filters` | A | What viewers see: hide region-locked channels, and whole categories, languages, countries or stream hosts; with per-value channel counts |
| `GET /live/admin/channels?source=&q=&status=all\|visible\|hidden\|filtered\|pinned\|kids\|offline\|unsupported&group=` · `PATCH /live/admin/channels` (`ids`, `hidden`, `kidsAllowed`, `pinned`) | A | Channels, with why each is filtered; hide, allow for kids, or always show despite the filters |
| `POST /party` · `GET /party/:code` · `GET /party/:code/events` (server-sent events) · `POST /party/:code/{action,buffering,item,settings,chat}` · `DELETE /party/:code` | V | Watch parties (when enabled) |

### Metadata

| Route | Who | |
| --- | --- | --- |
| `GET /metadata/search?mediaType=&query=&year=&language=` | V (not Kids Mode) | Search providers; 30 a minute per account unless you're an editor. Results a provider marks as adult are never returned to a content-limited account. For books, `language` picks Open Library's edition, and `notices` lists a provider that didn't answer and why (`quota`, `rejected`, `unreachable`) |
| `GET /metadata/details?source=&externalId=&isbn=&region=` | V | The rest of one search result: Open Library's description, Audnexus's ISBN and genres for Audible, a Comic Vine series' creators |
| `POST /metadata/apply/:itemId` · `/metadata/cover/:itemId` · `/metadata/series-cover` | E | Apply a match, upload covers |
| `GET /metadata/admin/items` · `POST /metadata/admin/match-single/:itemId` · `/batch-match` · `/batch-clean-titles` · `/ignore-missing` `{ itemIds, ignored }` | E | Bulk tools |

### Server

| Route | Who | |
| --- | --- | --- |
| `GET /customization` · `PATCH` | public / A | Branding, theme, layout, ratings display, collections, parties, pause screen, opening sequence switches |
| `POST /customization/intro` · `DELETE` | A | Upload (multipart field `intro`) or remove the opening sequence clip |
| `GET /media/intro` | V | The opening sequence clip (range requests; `?v=` is the upload version) |
| `GET /settings/filters` · `PATCH` | V / A | Which shelf views are offered |
| `GET /settings/compat` · `PUT` `{ codec: h264\|hevc, maxGb, allowUsers, replaceOriginal }` · `POST /settings/compat/queue` `{ libraryId }` · `POST /settings/compat/retry` · `DELETE /settings/compat/copies` | A | Converted copies: the settings, the space used, the queue and every copy (`status`, `progress`, `paused`, `codec`, `sourceCodec`, `size`, `error`, `errorCode`, `replaceError`); queue every video in one library or all that needs a copy (202; `discovery` in the overview reports progress); put the failed ones back in the queue; delete every copy and empty the queue |
| `/settings/transcoding` · `/transcoding/test` · `/metadata-providers` · `/metadata-providers/enabled` · `/metadata-providers/tmdb-key` · `/metadata-providers/google-books-key` · `/metadata-providers/comicvine-key` · `/auto-scan` · `/backup/*` | A | Server settings and backups |
| `GET /admin/health` · `POST /admin/health/remove-missing` | A | Library Health (with missing and offloaded titles grouped by film, series or season), removing missing titles |
| `POST /admin/health/offload` · `/unoffload` | A | Keep titles as history (`{ itemIds }`), or undo that |
| `GET /admin/logs` · `DELETE` | A | Server log |
| `GET /users` · `POST /users` · `PATCH /users/:id` · `/:id/role` · `/:id/password` · `/:id/extend` · `DELETE /users/:id` | A | Accounts. `PATCH` takes `remoteAccess` (may use Plinthio away from home) |
| `POST /users/:id/two-factor/reset` | A | Turn off someone's two-factor and sign them out |
| `GET /admin/network` · `PATCH` | A | Away-from-home settings (`remoteAccess`, `tailscaleIsHome`, `require2faOutside`), where this device connects from, proxy warning, recent outside sign-ins |
| `GET /system/update` | A | Update check status |
| `GET /health` · `GET /errors` | public | Health check (with version) and the error catalog |

### Reading apps

| Prefix | |
| --- | --- |
| `/api/opds` | OPDS 1.2 catalog with OPDS-PSE page streaming (HTTP Basic, key as password) |
| `/api/v1`, `/api/v2` | Komga-compatible subset for Mihon. See [Reading apps](sync-apps.md) and `backend/src/routes/komga.js` for the exact list |
| `/api/kosync` | KOReader progress sync protocol |
