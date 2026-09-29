# Administration

The Admin panel is for admins only. Editors do their work from title pages and the requests
queue; see [Accounts and access](accounts-and-access.md#roles).

## Libraries

- **Add Library:** browse the folders the container can see (under `/media` in Docker), pick
  one and give it a type. The first scan starts straight away.
- **Kids:** makes the whole library visible to Kids Mode accounts.
- **Scan Now:** a full scan. Titles appear as they're found.
- **Delete:** removes the library and its titles from Plinthio. Files on disk are untouched.
- **Kids Mode list:** series and titles made kids-safe one by one, with a remove button.

See [Libraries](libraries.md) for types, folder layouts and what a scan does.

## Health

Checks for what needs attention: unreachable libraries, missing files (keep them as history
or remove them for good), titles offloaded to free space, likely duplicates, clashing volume numbers, titles with no cover, description,
author or age rating, and recent video conversion failures. See
[Libraries → Library Health](libraries.md#library-health).

## Metadata

Every title in one table with filters, for fixing metadata in bulk:

- **Auto Match** per row, with the result shown inline, so you can work down a list.
- **Batch match** the selected titles. It runs in your browser one title at a time and ends
  with a summary.
- **Clean titles:** strip scene junk from titles taken from file names.
- **Search** providers manually, and apply a result to a title or a whole series.

TMDB matches need the TMDB key (P400 without it).

## Users

- **Add user:** username, password, role, and an optional access expiry.
- **Edit:** rename, role, content limit (plus whether unrated titles are allowed), Kids
  account, and reset password.
- **Extend:** push back an expiring account's end date.
- **Delete:** removes the account, its progress, ratings, lists and keys.

Badges on each user show role, Kids and content limit, and expiry.

## Logs

Live server log: scans, metadata matches, sync apps, errors. Filter by level, search, and
clear old entries. Admins also get a `detail` field on API errors in the app with the
underlying cause.

## Server Stats

Totals, disk footprint and the breakdown by media type and library.

## Activity

Who read, watched and listened to what, for how long, and sign-in history per person.

## Server Config

Every server-wide setting: shelf views, theme and layout, ratings, movie collections, watch
parties, pause screen, branding, custom CSS, metadata providers, transcoding, automatic
scanning and backups. Defaults and details are in
[Configuration](configuration.md#admin--server-config).

## Backups

Three kinds, all in `/config/backups/`:

| Kind | Made | Name |
| --- | --- | --- |
| Scheduled | every 1–168 h when turned on (off by default); the newest N are kept | `plinthio-backup-<time>.sqlite` |
| Manual | **Back up now** in Server Config → Database Backup | `plinthio-backup-<time>.sqlite` |
| Pre-upgrade | automatically, before a new version first opens the database | `plinthio-backup-before-<new>-from-<old>-<time>.sqlite` |

Backups are consistent snapshots, safe to take while the server is running. They can be
downloaded and deleted from the Database Backup card.

A backup holds everything in the database: accounts, progress, ratings, lists, settings,
the catalog. It doesn't hold covers, avatars or caches. Covers found in folders or fetched
from providers come back with a rescan. Uploaded covers and avatars don't, so include
`/config` in your own backups for those.

**To restore:**

1. `docker compose down`
2. Copy the backup over `config/plinthio.sqlite`, and delete `plinthio.sqlite-wal` and
   `plinthio.sqlite-shm` if present.
3. If the backup is from an older version, set `PLINTHIO_TAG` to that version.
4. `docker compose up -d`

## Update notices

Twice a day the server asks GitHub for the latest release: one anonymous request, nothing
about your server is sent. When a newer version exists, admins see a banner at the top with
a link to what's new. **Dismiss** hides it until the next version, on every device you use.
`UPDATE_CHECK=false` turns the check off. How to update is in
[Setup → Updating](setup.md#updating).

## Kids Mode, requests and the rest

- **Kids Mode:** [Accounts and access → Kids Mode](accounts-and-access.md#kids-mode)
- **Requests queue:** the user menu, for editors and admins. See
  [Together → Requests](together.md#requests)
- **Watch parties:** [Together → Watch parties](together.md#watch-parties)
