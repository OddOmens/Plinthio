<p align="center"><img src="frontend/public/icons/logo.svg" alt="Plinthio logo" width="120" /></p>

# Plinthio

> **The all-in-one self-hosted media server and PWA for Audiobooks, Manga & Comics, Books, Movies, TV Shows, and Anime.**

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker/docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v24-green?logo=node.js)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/release/OddOmens/Plinthio)](https://github.com/OddOmens/Plinthio/releases/latest)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)

**Plinthio brings everything together in a single Docker container with an installable, mobile-first Progressive Web App (PWA).**

## 💭 Why I wanted this

As a big fan of Jellyfin (I still use it as my main source for video), I struggled to find
something that worked as well for audiobooks, books and manga. Each has its own specialized
self-hosted product, usually paired with a mostly good iOS app made by third-party
developers.

So I decided to build Plinthio: to bring all of that media together in one place, and to
make it highly customizable for the person using it.

Is it perfect? By no means. It's a passion project, one I wanted to exist, and I'm sharing it
in case others want to explore it too.

---

## ✨ Features

**Documentation:** [docs/](docs/README.md) covers setup, every feature, configuration,
troubleshooting and the API in depth.

### 📖 Manga, comics and PDFs
* Right-to-left, left-to-right and webtoon scrolling, set per series; single or double-page spreads; fade or page-flip turns; pinch zoom.
* Pages stream straight out of `.cbz`/`.zip`, `.cbr`/`.rar` and `.cb7`/`.7z`, identified by content (a `.cbr` that's really a zip opens fine). **PDFs** read page by page too, rendered on the server once and cached.
* `ComicInfo.xml` sets series, numbers, reading direction and age rating on scan.
* **Skipped volumes** (you watched the anime) and **mark read up to here**.

### 📚 Books
* EPUB reader: paged or scrolling, fonts, sizes, sepia/dark themes, search inside the book, bookmarks and notes.

### 🎧 Audiobooks
* `.m4b` `.mp3` `.m4a` `.flac` `.aac` `.ogg`, chapters, per-book speed (0.75–2.5×), sleep timer (including end of chapter, with fade-out), lock-screen controls.

### 🎬 Movies, shows and anime
* **Direct play** whenever the browser can (including HEVC on Chrome, Edge and Safari), **direct stream** (video copied, audio converted) for MKV and surround audio, and **transcoding** only when needed — on Intel QuickSync/VAAPI or NVIDIA NVENC when available. HLS with real seeking, adaptive quality, audio track switching, embedded and sidecar subtitles.
* Title pages with cast & crew, seasons with episode stills, movie collections (with the films you don't have, requestable), and extras (trailers, featurettes) kept off the shelf.
* **Skip buttons** with per-person amounts (5 s to 5 min), **pause screens** (Details, Cinematic with TMDB facts, Bedtime clock), scrub previews, skip intro/credits, up-next, Chromecast and AirPlay.
* **Watch parties:** watch together from different places, in sync, with chat.

### 🗂️ Library
* One shelf model for every type: **Alphabetical**, **Creator**, **Disk Folders** and **Custom Folders**, always one card per series; every title opens a detail page first.
* Automatic scanning (schedule + file watcher), moved-file detection, and **missing files kept** (hidden, progress intact) until an admin removes them.
* Metadata from MangaDex, Google Books, Open Library and TMDB, single or in bulk; cover uploads; **Library Health** checks.
* **Lists** mixing library titles and anything found on TMDB/MangaDex/Google Books/Open Library; **requests** with a review queue; **ratings** (yours, the server's, TMDB's).

### 👪 Accounts
* Admin / editor / viewer roles, enforced server-side. Content limits (Everyone/Teen/Mature, unrated on or off), **Kids Mode** (only what's been made kids-safe), expiring guest accounts, activity and sign-in history.

### 📱 Apps and sync
* Installable **PWA** with **offline downloads** for books, comics, PDFs and audiobooks.
* **Mihon** (Komga extension + tracker), **KOReader** progress sync, and **OPDS** readers — all signing in with a per-app API key.

### 🛠️ Running it
* One container, SQLite, no other services. x86-64 and ARM images, semantic versioning, an update banner, and an automatic database backup before every upgrade.
* Error codes (P###) on every error, documented in [docs/error-codes.md](docs/error-codes.md).
* Everything the app does is a REST API you can script against with an API key: [docs/api.md](docs/api.md).
* Customise the server name, accent colour, layout, sign-in notice and CSS from the UI: [docs/configuration.md](docs/configuration.md).

---

## 🛡️ Security

A factual summary; details in [docs/accounts-and-access.md](docs/accounts-and-access.md).

* **Passwords:** bcrypt (cost 10), minimum 8 characters.
* **Two-factor sign-in (optional):** authenticator-app codes (TOTP) with single-use backup codes, per person. Admins can require it for sign-ins from outside the home network.
* **Away from home:** home-only by default for new servers. Admins choose whether the server can be used from outside the home network, and per person who may; checked on every request, including the reading apps.
* **Sessions:** JWTs signed with a per-install secret generated on first boot (`/config/jwt.secret`). 7-day lifetime, renewed on use; a password change or **Sign out of all devices** revokes every token at once.
* **Media URLs** carry a separate 24-hour media-only token, never the session token.
* **API keys:** shown once; stored as SHA-256 (plus an MD5 for KOReader's protocol). Apps sign in with a key, never your password.
* **Roles, content limits and Kids Mode** are enforced on every request, including direct file and page URLs, watch parties and the sync APIs.
* **Path checks:** file-serving routes verify the resolved path is inside its library.
* **Rate limits:** 10 failed sign-ins / 15 min per address, 600 API requests / min, 1200 media requests / min, 6 backups / 15 min.
* **Headers:** Helmet, with a Content-Security-Policy on by default (`CSP=report-only` or `off` to diagnose).
* **Cookies:** none for the web app. Mihon's Komga tracker uses a session cookie honoured only on `/api/v1` and `/api/v2`, SameSite=Lax, ended by deleting its API key.
* **Logs** strip `?token=` from URLs.
* **Proxies:** `TRUST_PROXY` is opt-in, for use behind a reverse proxy only. The Tailscale and public-address add-ons set it to `loopback`, so only a proxy running right next to Plinthio is believed.
* **TLS:** optional add-ons: Tailscale (a trusted `https://….ts.net` address, private) or a public web address with Caddy and Let's Encrypt, for guests. Without either, HTTPS on port 8443 with a local certificate authority you install on your devices (name-constrained to private addresses and local names).
* **Network calls:** only metadata lookups you trigger (MangaDex, Google Books, Open Library, TMDB with your key) and a twice-daily anonymous release check (`UPDATE_CHECK=false` turns it off). No telemetry.

Plinthio is built for trusted-network self-hosting (your home, and people you invite). It has not been audited for hostile multi-tenant or public-internet deployment, and has no 2FA.

---

## 🚀 Install (Docker)

You only need Docker, no need to clone the repo. The image is
`ghcr.io/oddomens/plinthio`, published for x86-64 and ARM (Raspberry Pi 4/5, Apple Silicon,
most NAS boxes).

**1. Install Docker** if you don't have it: [Docker Engine](https://docs.docker.com/engine/install/)
on Linux (it includes `docker compose`), or [Docker Desktop](https://www.docker.com/products/docker-desktop/)
on macOS and Windows. Synology, Unraid, TrueNAS and similar have Docker in their app centres.

**2. Get the compose file and start Plinthio:**

```bash
mkdir plinthio && cd plinthio
curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.yml
MEDIA_DIR=/path/to/your/media docker compose up -d
```

**3. Open `http://<your-server-ip>:8088`** and follow the setup wizard: it creates your admin
account and adds your media folders (they appear under `/media`). On a phone, use
**Add to Home Screen** to install the app.

**4. Optional: away from home.** Two add-ons, each one file next to `docker-compose.yml`:
[`docker-compose.tailscale.yml`](docker/docker-compose.tailscale.yml) for a private, trusted
`https://plinthio.<your-tailnet>.ts.net` address (each device needs the Tailscale app), and
[`docker-compose.public.yml`](docker/docker-compose.public.yml) for a public web address like
`https://media.yourdomain.com`, so guests need nothing but a browser. Plinthio starts
home-only; you choose who can use it from where. Steps, and how to check your internet
connection allows a public address: [docs/remote-access.md](docs/remote-access.md).

Settings can live in a `.env` file next to `docker-compose.yml` instead of on the command line:

```ini
# The folder holding your media, and your time zone
MEDIA_DIR=/srv/media
TZ=Europe/London
# Owner of ./config (run `id` to see yours)
PUID=1000
PGID=1000
# Which updates to take, see Updating below
PLINTHIO_TAG=1
```

The database, covers and caches go in `./config`. Plinthio only reads your media folders; it
never writes to them.

<details>
<summary><b>Without Compose</b> (<code>docker run</code>)</summary>

```bash
docker run -d --name plinthio --restart unless-stopped \
  -p 8088:8080 \
  -e TZ=Europe/London \
  -v "$PWD/config:/config" \
  -v /path/to/your/media:/media \
  ghcr.io/oddomens/plinthio:latest
```

To update: `docker pull ghcr.io/oddomens/plinthio:latest`, then `docker rm -f plinthio` and
run the same command again. Your data stays in `./config`.
</details>

More: hardware transcoding, several media folders, remote access over HTTPS and installing
without Docker are all in [docs/setup.md](docs/setup.md). If something goes wrong,
see [docs/troubleshooting.md](docs/troubleshooting.md).

## ⬆️ Updating

When a new version is out, admins see a banner in the app. To update:

```bash
docker compose pull && docker compose up -d
```

That's it. Before the new version first starts, Plinthio **backs up your database** to
`config/backups/` (named `plinthio-backup-before-<new>-from-<old>-….sqlite`), so every
upgrade can be undone.

**Choosing which updates you get.** Set `PLINTHIO_TAG` in your `.env`:

| `PLINTHIO_TAG` | You get |
| --- | --- |
| `latest` *(default)* | every release |
| `1` | all 1.x features and fixes, never a breaking 2.0 |
| `1.2` | bug fixes for 1.2 only |
| `1.2.3` | exactly that version, nothing changes until you edit it |

Versions follow [semantic versioning](https://semver.org): a **patch** (1.2.**3**) only fixes
bugs, a **minor** (1.**3**.0) adds features, a **major** (**2**.0.0) may ask you to change
something — its release notes will say what. Full history is in [CHANGELOG.md](CHANGELOG.md).

**Rolling back.** Set `PLINTHIO_TAG` to the version you were on, then `docker compose up -d`.
If the newer version had already changed the database, stop Plinthio and copy the matching
`plinthio-backup-before-…` file over `config/plinthio.sqlite` first.

**Automatic updates** (optional): tools like [Watchtower](https://containrrr.dev/watchtower/)
can run the pull for you. Pair them with a `PLINTHIO_TAG` of `1` so a major version never
installs itself unattended.

The update check is one anonymous request to GitHub every 12 hours; set `UPDATE_CHECK=false`
to turn it off.

### Building from source

To run unreleased changes from a checkout instead of a published image:

```bash
git clone https://github.com/OddOmens/Plinthio.git && cd Plinthio
docker compose -f docker/docker-compose.yml -f docker/docker-compose.build.yml up -d --build
```

---

## 🛠️ Development

You need Node.js 24 (20.17 or newer works), **ffmpeg/ffprobe** (video) and **poppler** (`pdfinfo`/`pdftoppm`, PDFs):

```bash
sudo apt install ffmpeg poppler-utils     # Debian/Ubuntu
brew install ffmpeg poppler               # macOS

cd backend && npm install && npm run dev   # API on http://localhost:8080
cd frontend && npm install && npm run dev  # app on http://localhost:5173, proxying /api
cd backend && npm test                     # the test suite (each file boots its own server)
```

How the code is organised, the data model, access control and conventions are in
[docs/architecture.md](docs/architecture.md). Releasing is in [RELEASING.md](RELEASING.md).

---

## 📄 License
Plinthio is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You're free to use, fork, modify, and self-host it for any noncommercial purpose. Selling it, hosting it as a paid service, or otherwise using it (or a derivative) for commercial gain is not permitted without a separate license from Odd Omens LLC.
