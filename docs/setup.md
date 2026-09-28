# Setup

## What you need

- A machine that runs Docker: a Linux box, NAS or mini PC, a Mac, or Windows with Docker
  Desktop. Images are published for x86-64 and ARM (Raspberry Pi 4/5, Apple Silicon, most NAS
  boxes).
- Your media in folders Docker can read. Plinthio never writes to your media folders. It
  only reads them.
- Optional: a free [TMDB](https://www.themoviedb.org/settings/api) API key. It gives movies,
  shows and anime their posters, cast, crew, collections and world ratings.
- Optional: an Intel or AMD GPU (`/dev/dri`) or an NVIDIA GPU for hardware transcoding.

## Install with Docker Compose

You don't need to clone the repository. Download the compose file and start it:

```bash
mkdir plinthio && cd plinthio
curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.yml
MEDIA_DIR=/path/to/your/media docker compose up -d
```

Then open `http://<server-ip>:8088`.

Settings can live in a `.env` file next to `docker-compose.yml` instead of on the command
line:

```ini
MEDIA_DIR=/srv/media
TZ=Europe/London
PUID=1000
PGID=1000
PLINTHIO_TAG=1
```

### Without Compose

The same thing as a single `docker run`:

```bash
docker run -d --name plinthio --restart unless-stopped \
  -p 8088:8080 \
  -e TZ=Europe/London \
  -v "$PWD/config:/config" \
  -v /path/to/your/media:/media \
  ghcr.io/oddomens/plinthio:latest
```

To update, `docker pull ghcr.io/oddomens/plinthio:latest`, remove the container
(`docker rm -f plinthio`) and run the command again. Everything that matters is in `./config`.

On NAS systems with a Docker UI (Synology Container Manager, Unraid, TrueNAS, Portainer), create
a container from `ghcr.io/oddomens/plinthio` with the same settings: container port `8080`
published on a host port of your choice, a folder mapped to `/config`, your media mapped to
`/media`, and optionally `TZ`, `PUID` and `PGID`.

### What the compose file sets up

| | Host | In the container |
| --- | --- | --- |
| Web app and API | port `8088` (on `BIND_ADDRESS`, default `0.0.0.0`) | port `8080` |
| Database, settings, covers, caches, backups | `./config` | `/config` |
| Your media (read-only use) | `MEDIA_DIR` (default `/media/library`) | `/media` |

Inside `/config`:

| Path | What it is | Safe to delete? |
| --- | --- | --- |
| `plinthio.sqlite` (+ `-wal`, `-shm`) | The database: users, progress, settings, catalog | **No** |
| `jwt.secret` | The key that signs sign-in tokens, generated on first start | Deleting it signs everyone out |
| `.version` | The last version that ran, used for the pre-upgrade backup | Yes |
| `backups/` | Scheduled, manual and pre-upgrade database backups | Old ones, yes |
| `covers/` | Cover art found in folders, fetched from providers or uploaded | It rebuilds, but uploaded covers are lost |
| `avatars/` | Profile pictures | Pictures are lost |
| `cache/` | Thumbnails, HLS segments, trickplay sheets, episode stills, rendered PDF pages | Yes, it all regenerates |

Files in `/config` are owned by user and group `1000:1000` by default. Set `PUID` and `PGID`
(in `.env`, or the compose `environment:`) to match your host user if needed.

To use several media folders, mount each one and add each as a library in the app:

```yaml
    volumes:
      - ./config:/config
      - /srv/audiobooks:/media/audiobooks
      - /mnt/nas/manga:/media/manga
      - /mnt/nas/video:/media/video
```

## First run: the setup wizard

The first visit opens the setup wizard. It:

1. Creates the admin account. The password must be at least 8 characters.
2. Names the server and picks the theme and the media types you use.
3. Adds your first libraries. You browse the folders under `/media` and give each a type:
   audiobooks, manga, books, shows, movies or anime. See [Libraries](libraries.md).
4. Optionally creates more accounts.
5. Optionally turns on watch parties.

The first scan starts when a library is added. Large libraries take a while, and titles
appear as they're found. Everyone added later goes through a short onboarding on their first
sign-in: theme, and which media types they want to see.

Next steps worth taking:

- **Admin → Server Config → External Metadata Providers:** add the TMDB key.
- **Admin → Server Config → Video Transcoding & Hardware Acceleration:** press **Test** to check hardware
  acceleration.
- **Admin → Server Config → Database Backup:** scheduled backups are **off** until you turn them on.
- **Admin → Users:** add the rest of the household, with content limits or Kids Mode where
  needed. See [Accounts and access](accounts-and-access.md).

## Installing the app on phones and tablets

Plinthio is a Progressive Web App.

- **iPhone and iPad:** open it in Safari, then **Share → Add to Home Screen**.
- **Android:** open it in Chrome, then **Install app**.

It opens full screen, puts audiobook controls on the lock screen, and keeps working offline
for anything you've downloaded. See
[Reading and listening → Offline](reading-and-listening.md#offline-downloads).

Installing as an app needs HTTPS, except on `localhost`. Plain `http://192.168…` works in
the browser but won't install as an app. See Remote access below.

## Hardware transcoding

Most video plays without transcoding (see [Movies and shows](video.md)). When a file does need
it, a GPU makes it far cheaper. Detection is automatic. **Admin → Server Config → Video
Transcoding & Hardware Acceleration** shows what was found, lets you force a method or turn it off, and has a
**Test** button that runs a real encode.

- **Intel QuickSync or AMD (VAAPI):** the drivers are in the image. Uncomment the
  `devices:` and `group_add:` lines in `docker-compose.yml`. The `group_add` value is your
  host's `render` group ID, which you can find with `getent group render`.
- **NVIDIA (NVENC):** install the NVIDIA Container Toolkit on the host, then uncomment the
  `deploy:` block.
- **None:** leave it all commented. Video still plays, and ffmpeg transcodes on the CPU.

With the device lines active, `docker compose up` refuses to start on a machine without that
device.

## Remote access

Plinthio serves plain HTTP on your network. To reach it from outside, and to install it as
an app, put something with HTTPS in front of it. The in-app **Docs → Remote Access & Tailscale** has
step-by-step versions of each option.

- **Tailscale** (easiest and private): install it on the server and on your devices, then
  use the server's Tailscale address. `tailscale serve` adds HTTPS.
- **Cloudflare Tunnel:** gives you a public HTTPS address without opening ports.
- **Reverse proxy with TLS** (Caddy, nginx, Traefik): a Caddy config is just
  `media.example.com { reverse_proxy plinthio:8080 }`.

Behind any proxy or tunnel, set `TRUST_PROXY=1` so rate limits see real client addresses.
Don't set it without a proxy in front: clients could then fake their address. Watch parties
and the reading apps need friends' devices to reach the server the same way.

## Updating

When a new version is out, admins see a banner in the app. To update:

```bash
docker compose pull && docker compose up -d
```

Before a new version first opens the database, Plinthio copies it to
`config/backups/plinthio-backup-before-<new>-from-<old>-<time>.sqlite`. This happens because
migrations only go forward.

`PLINTHIO_TAG` chooses which updates you take:

| `PLINTHIO_TAG` | You get |
| --- | --- |
| `latest` (default) | every release |
| `1` | all 1.x features and fixes, never a breaking 2.0 |
| `1.2` | bug fixes for 1.2 only |
| `1.2.3` | exactly that version |

Watchtower and similar tools can update for you. Pair them with `PLINTHIO_TAG=1` so a major
version never installs unattended.

### Rolling back

1. Set `PLINTHIO_TAG` to the version you were on.
2. If the newer version already started, stop Plinthio (`docker compose down`) and copy the
   matching `plinthio-backup-before-…` file over `config/plinthio.sqlite`. Delete any
   `plinthio.sqlite-wal` and `-shm` files next to it.
3. Run `docker compose up -d`.

Progress made on the newer version after the upgrade is lost by the restore.

## A test server

To try unreleased changes without risking your real server, run a second copy beside it.
`docker/docker-compose.test.yml` builds from your checkout, listens on port **8089**, keeps
its own data in `docker/config-test`, and mounts your media **read-only**:

```bash
docker compose -f docker/docker-compose.test.yml up -d --build
```

Run the same command again after switching branches or pulling. With an empty
`docker/config-test` it starts at the setup wizard. To start from a copy of your real
server's accounts, libraries and settings instead, stop the test server, then copy the
database (safe while the real server is running) and the artwork:

```bash
docker compose -f docker/docker-compose.test.yml down
cd backend && node -e "const s=require('sqlite3');const d=new s.Database('../docker/config/plinthio.sqlite',s.OPEN_READONLY);d.run(\"VACUUM INTO '../docker/config-test/plinthio.sqlite'\",()=>d.close())" && cd ..
cp -a docker/config/covers docker/config/avatars docker/config-test/
```

Anything done on the test server (progress, ratings, settings) stays there.

## Building from source

```bash
git clone https://github.com/OddOmens/Plinthio.git && cd Plinthio
docker compose -f docker/docker-compose.yml -f docker/docker-compose.build.yml up -d --build
```

## Without Docker (bare metal)

Supported for development, and it works for installs too. You need:

- Node.js 24 (20.17 or newer works)
- `ffmpeg` and `ffprobe` for all video: probing, remuxing, transcoding, subtitles, trickplay,
  episode stills and video covers. Without them video that needs converting fails with P303.
- `pdfinfo` and `pdftoppm` (poppler) for PDFs. Without them PDFs fail with P308.
- For Intel hardware transcoding: `intel-media-va-driver-non-free` and `vainfo`.

```bash
# Debian / Ubuntu
sudo apt install ffmpeg poppler-utils
# macOS
brew install ffmpeg poppler

cd frontend && npm ci && npm run build && cd ..
cd backend && npm ci
DATA_DIR=/var/lib/plinthio PORT=8088 node src/index.js
```

The backend serves the built frontend from `frontend/dist`. For development, run
`npm run dev` in both `backend/` (API on `:8080`) and `frontend/` (Vite on `:5173`, proxying
`/api`).
