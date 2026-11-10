# Administration

The Admin panel is for admins only. Editors do their work from title pages and the requests
queue; see [Accounts and access](accounts-and-access.md#roles).

Its sections are grouped in a sidebar (on a phone, a list you tap into):

| Group | Sections |
| --- | --- |
| Server | Overview |
| Library | Libraries, Health, Metadata, Kids Mode |
| People | Users, Activity |
| Settings | Appearance, Features, Playback, Live TV, Network, Backups |
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
author or age rating (unless their missing metadata is ignored, see Metadata), and recent video conversion failures. See
[Libraries → Library Health](libraries.md#library-health).

## Metadata

The **TMDB key**. Release images come with a key built in, so this works with no setup;
paste your own (checked against TMDB when saved) to use it instead, and **Use built-in key**
goes back. Then every title in one table with
filters, for fixing metadata in bulk:

- **Auto Match** per row, with the result shown inline, so you can work down a list.
- **Batch match** the selected titles. It runs in your browser one title at a time and ends
  with a summary.
- **Clean titles:** tidy titles that still look like file names (dots, release tags, [ids],
  a year in brackets, a "｜ channel" tail from a video download). Titles from a match or an
  edit are left alone.
- **Ignore missing info:** stop flagging the selected titles' missing poster and details,
  for home videos and anything else with nothing to find online. **Ignored** lists them, to
  flag them again. **Home videos** above the table does the same for whole libraries,
  including titles added later.
- **Search** providers manually, and apply a result to a title or a whole series.

TMDB matches need a TMDB key, built in or your own (P400 without one).

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

Hardware acceleration (with **Test**, which runs a real encode), converted copies and the
opening sequence.

### Converted copies

Some video doesn't play everywhere. Most Apple devices can't decode AV1 (only those with a
hardware decoder can: iPhone 15 Pro, M3 Macs and later), and none decode VP9 or VP8. Older
formats play in no browser at all. For those the server converts the video as it streams,
which costs a full conversion every time someone presses play. A converted copy is that
conversion done once, in the background, at the video's own size, to H.264, which
everything plays; afterwards a device that
needs it is sent the copy, and devices that play the original still get the original.

**What gets a copy.** Any video that isn't already 8-bit H.264 or HEVC:

| Video | Why it needs one |
| --- | --- |
| AV1, VP9, VP8 | Most Apple devices can't decode them |
| 10-bit H.264 | Browsers and Apple devices only decode 8-bit H.264 |
| MPEG-2, MPEG-4 (Xvid, DivX), VC-1, WMV and other older formats | No browser or Apple device plays them |

HEVC (H.265) and ordinary H.264 are left alone: asking for a copy of one answers P310.
Every audio track is carried over (AAC and MP3 as they are, anything else as AAC, up to
5.1), with text subtitles and chapters. Interlaced video is deinterlaced.

**The settings:**

- **Size limit:** no copy is started, and a running one is stopped, once the copies add up
  to this much. A 1080p film is roughly 4–8 GB in H.264.
- **Let everyone ask for a copy:** off, only admins see **Convert** on a title's page and
  can start a conversion from the apps.
- **Convert a library:** looks through one library, or all of them, and queues every video
  that needs a copy. To convert one title instead, open its page: a film that needs a copy
  has a **Convert** button, which then shows the conversion's progress and **Converted**
  when the copy is ready; a series has **Convert all** (admins), which queues the episodes
  that need one.
- **Replace the original with its copy** (off by default): when a copy is finished it is
  moved into the library in the original's place (`Film.mkv` becomes `Film.mp4`) and the
  original is deleted. The title keeps its id, so progress, ratings, artwork and lists stay
  with it. This is the one setting that changes your media files: it can't be undone, H.264
  files are usually larger than the AV1 they replace, and the media folder must be writable
  (no `:ro` on the Docker volume). A file that can't be replaced, because the folder is
  read-only or the file is a symlink, keeps its copy in the data folder and says why in the
  list. Picture-based subtitles (Blu-ray, DVD) are not carried over, and HDR video is
  converted without tone mapping, so keep the original of anything where those matter.

**The queue.** Conversions run one at a time, oldest request first, on the graphics chip
chosen above when there is one. The queue is kept in the database, so it carries on after a
restart, and a conversion that was cut short starts again. It pauses while someone is
watching something the server has to convert live (the list says so) and carries on when
they stop. If the graphics chip fails on a file, that file is converted on the CPU
instead. **Cancel** stops a waiting or running
conversion; **Remove** deletes a finished copy, which only costs the time to make it again.

**Where copies go:** `compat/` in the data folder (`./config/compat`), never a library
folder, so a title still appears once on every shelf. A copy of a file that has since been
changed or replaced is thrown away.

**When a conversion fails** the list shows why, with a code to look up in
[Error codes](error-codes.md), and Admin → Logs has the same line with ffmpeg's own words:

| In the list | Meaning |
| --- | --- |
| Not converted: the size limit was reached (P311) | Raise the limit or delete copies, then **Try the failed ones again** |
| Not converted: the file is missing (P301) | The original has gone from disk. Check the drive, then rescan |
| Failed: … (P304) | ffmpeg couldn't convert this file, even on the CPU. The file may be damaged; the log has the full error |
| Failed: … (P303) | ffmpeg couldn't be started at all (bare-metal installs) |
| Failed: … (P302) | The file couldn't be read as a video |
| Ready, but the original wasn't replaced: … | Only with **Replace the original** on. The copy is still used from the data folder |

**In the log** (Admin → Logs, category `media`): each conversion starting (what it is
converting from and to, and on which encoder) and finishing (with the size of the copy and
of the original), every pause and failure, a fallback from the graphics chip to the CPU,
each original that was replaced (both file names), how many videos a library search queued,
and who switched replacing originals on or off.

## Live TV

The switch for Live TV (off by default), the channel lists (public lists by country, language
or category, or your own M3U playlist and XMLTV guide), each with its status, **Refresh**, an
on/off switch and **Remove**, and the channel manager: search, filter, **Hide**/**Show** and
**Allow for kids**, one at a time or a page at once. See [Live TV](live-tv.md).

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
  plus `files/` (avatars, covers, `ssl/`, `.version` — turn this off with the
  checkbox if you only want the database);
- the server key (`jwt.secret`) is **not** copied unless you tick **Also copy the sign-in
  key** (see below);
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

#### The server key

`config/jwt.secret` signs every sign-in and locks the stored two-factor secrets. Anyone
who has it, together with a database backup, can sign in as any account, admins included.
A backup folder is often readable by more people or services than the server itself (a NAS
share, a synced cloud folder), so the key stays out of it by default.

- **Restoring without the key** (the default): the server makes a new key on its first
  start. Everything in the database is back, but everyone signs in again, API keys keep
  working, and accounts with two-factor have to set it up again: their authenticator codes
  and backup codes no longer match. An admin turns it off for each of them in Admin →
  Users → the account → Two-factor → Reset. If the only admin uses two-factor, keep a copy
  of the key (next point), or that account can't get back in.
- **Keeping the key yourself:** copy `config/jwt.secret` once to somewhere only you can
  read, such as a password manager. It never changes, so one copy is enough; put it back
  into `config/` before starting a restored server and nobody notices the restore.
- **Also copy the sign-in key** in Admin → Backups puts it in `files/` with the rest. Only
  do that for a folder nobody else can read.

Versions up to 1.9 always copied the key. Updating stops that, but doesn't delete the copy
already in your backup folder: Admin → Backups says so when it finds `files/jwt.secret`
there. Delete that file, or move it somewhere private. If the folder was ever readable by
someone you wouldn't give an admin account to, also make a new key: stop the server, delete
`config/jwt.secret`, start it again (everyone signs in again and sets two-factor up again).

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
