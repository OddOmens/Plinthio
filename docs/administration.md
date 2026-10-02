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
  account, whether the account can be used away from home, reset two-factor (for a lost
  phone), and reset password.
- **Extend:** push back an expiring account's end date.
- **Delete:** removes the account, its progress, ratings, lists and keys.

Badges on each user show role, Kids and content limit, expiry, two-factor, and home only.
The last sign-in says when it was away from home (Tailscale or outside).

## Network

Who can use Plinthio from where: allow access from outside the home network, whether
Tailscale devices count as home, and whether two-factor is required away from home. The
**Tailscale** section says whether Tailscale (and Funnel) are reaching Plinthio, and has a
step-by-step guide with the lines to paste, for private use or a public Funnel link. It shows
where the device you're using is connecting from (open it on a phone with Wi-Fi off to check
outside access), warns about a proxy that Plinthio isn't trusting, and lists recent sign-ins
from outside. See [Using Plinthio away from home](remote-access.md).

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
| Scheduled | every 1–168 h (on by default: daily, newest 7 kept); the newest N scheduled and manual ones are kept | `plinthio-backup-<time>.sqlite` |
| Manual | **Back up now** in Server Config → Database Backup | `plinthio-backup-<time>.sqlite` |
| Pre-upgrade | automatically, before a new version first opens the database; the newest 5 are always kept, whatever the retention setting | `plinthio-backup-before-<new>-from-<old>-<time>.sqlite` |

Backups are consistent snapshots, safe to take while the server is running. They can be
downloaded and deleted from the Database Backup card.

A backup holds everything in the database: accounts, progress, bookmarks, highlights and
their notes, ratings, lists, each person's reader and display settings, server settings,
the catalog. It doesn't hold covers, avatars or caches. Covers found in folders or fetched
from providers come back with a rescan. Uploaded covers and avatars don't, so include
`/config` in your own backups for those.

### A second place for backups

`/config/backups` sits on the same disk as the server, so it protects against mistakes and
bad upgrades but not a failed disk. In **Server Config → Database Backup → Also copy backups
to**, choose a folder on another drive, a NAS share or a synced cloud folder (**Browse**, then
**Test**: it checks the server can write there and warns if it's on the same disk). Then:

- every backup is copied there as it's made, laid out as `database/plinthio-backup-*.sqlite`
  plus `files/` (avatars, covers, `ssl/`, `jwt.secret`, `.version` — turn this off with the
  checkbox if you only want the database);
- **Keep there** sets how many regular backups stay (30 by default); the newest five
  pre-upgrade ones always stay;
- a failed copy shows on the card with the reason and is retried every 15 minutes, and
  anything missed is copied once the folder is back (and on every start).

**In Docker** the folder has to be mounted into the container. Anywhere under `/media`
works if your media volume isn't read-only. For another drive, set `BACKUP_DIR` in `.env`,
uncomment the `/backups` line in `docker-compose.yml`, run `docker compose up -d`, and
choose `/backups`.

**To restore from the second place:** use a file from `database/` as the backup in the
steps below, and copy the contents of `files/` back into `config/` while the server is
stopped.

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
