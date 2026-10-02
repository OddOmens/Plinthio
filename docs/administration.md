# Administration

The Admin panel is for admins only. Editors do their work from title pages and the requests
queue; see [Accounts and access](accounts-and-access.md#roles).

Its sections are grouped in a sidebar (on a phone, a list you tap into):

| Group | Sections |
| --- | --- |
| Server | Overview |
| Library | Libraries, Health, Metadata, Kids Mode |
| People | Users, Activity |
| Settings | Appearance, Features, Playback, Network, Backups |
| System | Logs |

Most settings save as you change them, with "Saved" shown beside them. Backups and custom CSS
have a Save button. Older links (`/admin?tab=settings`, `?tab=stats`) still open the right place.

## Overview

The version you're running and whether a newer one is out (**Check now**), then totals: files,
disk footprint, audio hours and accounts, and a breakdown by media type.

## Libraries

- **Add library:** browse the folders the container can see (under `/media` in Docker), pick
  one and say what's in it. The first scan starts straight away.
- **Scan:** a full scan. Titles appear as they're found.
- **Delete:** removes the library and its titles from Plinthio. Files on disk are untouched.
- **Automatic scanning:** re-scan on a schedule (15 minutes to a day) and watch folders for
  new files.

See [Libraries](libraries.md) for types, folder layouts and what a scan does.

## Health

Checks for what needs attention: unreachable libraries, missing files (keep them as history
or remove them for good), titles offloaded to free space, likely duplicates, clashing volume numbers, titles with no cover, description,
author or age rating, and recent video conversion failures. See
[Libraries → Library Health](libraries.md#library-health).

## Metadata

The **TMDB key** (checked against TMDB when saved), then every title in one table with
filters, for fixing metadata in bulk:

- **Auto Match** per row, with the result shown inline, so you can work down a list.
- **Batch match** the selected titles. It runs in your browser one title at a time and ends
  with a summary.
- **Clean titles:** strip scene junk from titles taken from file names.
- **Search** providers manually, and apply a result to a title or a whole series.

TMDB matches need the TMDB key (P400 without it).

## Kids Mode

Which whole libraries Kids Mode accounts can see (a switch each), and the series and titles
made kids-safe one by one, with a remove button. See
[Accounts and access → Kids Mode](accounts-and-access.md#kids-mode).

## Users

Each person is a row with their role and badges: expiry, two-factor, home only, Kids and
content limit. The last sign-in says when it was away from home (Tailscale or outside).
Tap a row to edit it.

- **Add user:** username, password, role, and an optional end date.
- **Edit:** rename, role, access (+1 day, +1 week, +1 month from the current end, no end
  date, or a new end), whether the account can be used away from home, Kids account, content
  limit (plus whether unrated titles are allowed), reset two-factor (for a lost phone), and a
  new password.
- **Delete** (in Edit): removes the account, its progress, ratings, lists and keys.

## Activity

Who read, watched and listened to what, for how long, and sign-in history, for everyone or
one person.

## Appearance

The server's look, beside a **live preview** of the shelf, a title page, the sign-in screen
and the pause screen: accent colour, navigation, page width and pause screen (each with
**Users can change**, and **Let people personalize** for all of them), the server name and
sign-in notice, and custom CSS.

## Features

Shelf views (Disk folders, Custom folders), which ratings show, missing films in movie
collections, and watch parties.

## Playback

Hardware acceleration (with **Test**, which runs a real encode) and the opening sequence.

## Network

Who can use Plinthio from where: allow access from outside the home network, whether
Tailscale devices count as home, and whether two-factor is required away from home. The
**Tailscale** section says whether Tailscale (and Funnel) are reaching Plinthio, and has a
step-by-step guide with the lines to paste, for private use or a public Funnel link. It shows
where the device you're using is connecting from (open it on a phone with Wi-Fi off to check
outside access), warns about a proxy that Plinthio isn't trusting, and lists recent sign-ins
from outside. See [Using Plinthio away from home](remote-access.md).

## Logs

Live server log: scans, metadata matches, sync apps, errors. Filter by level, search, pause,
and clear old entries. Admins also get a `detail` field on API errors in the app with the
underlying cause.

All the defaults are in [Configuration](configuration.md#settings-in-the-app).

## Backups

Three kinds, all in `/config/backups/`:

| Kind | Made | Name |
| --- | --- | --- |
| Scheduled | every 1–168 h (on by default: daily, newest 7 kept); the newest N scheduled and manual ones are kept | `plinthio-backup-<time>.sqlite` |
| Manual | **Back up now** in Admin → Backups | `plinthio-backup-<time>.sqlite` |
| Pre-upgrade | automatically, before a new version first opens the database; the newest 5 are always kept, whatever the retention setting | `plinthio-backup-before-<new>-from-<old>-<time>.sqlite` |

Backups are consistent snapshots, safe to take while the server is running. They can be
downloaded and deleted from the list in Admin → Backups.

A backup holds everything in the database: accounts, progress, bookmarks, highlights and
their notes, ratings, lists, each person's reader and display settings, server settings,
the catalog. It doesn't hold covers, avatars or caches. Covers found in folders or fetched
from providers come back with a rescan. Uploaded covers and avatars don't, so include
`/config` in your own backups for those.

### A second place for backups

`/config/backups` sits on the same disk as the server, so it protects against mistakes and
bad upgrades but not a failed disk. In **Admin → Backups → Also copy backups
to**, choose a folder on another drive, a NAS share or a synced cloud folder (**Browse**, then
**Test**: it checks the server can write there and warns if it's on the same disk). Then:

- every backup is copied there as it's made, laid out as `database/plinthio-backup-*.sqlite`
  plus `files/` (avatars, covers, `ssl/`, `jwt.secret`, `.version` — turn this off with the
  checkbox if you only want the database);
- **Keep there** sets how many regular backups stay (30 by default); the newest five
  pre-upgrade ones always stay;
- a failed copy shows in Admin → Backups with the reason and is retried every 15 minutes, and
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

## Requests and the rest

- **Requests queue:** the user menu, for editors and admins. See
  [Together → Requests](together.md#requests)
- **Watch parties:** [Together → Watch parties](together.md#watch-parties)
