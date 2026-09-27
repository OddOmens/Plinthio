# 📚 Plinthio

> **The all-in-one self-hosted media server and PWA for Audiobooks, Manga & Comics, Books, Movies, TV Shows, and Anime.**

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker/docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20-green?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)

Plinthio was born out of frustration with fragmented media servers: having to run one server for audiobooks, another for comics, another for video, while juggling multiple third-party mobile apps with paywalls.

**Plinthio unifies everything into a single Docker container with an installable mobile-first Progressive Web App (PWA).**

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
* **Sessions:** JWTs signed with a per-install secret generated on first boot (`/config/jwt.secret`). 7-day lifetime, renewed on use; a password change or **Sign out of all devices** revokes every token at once.
* **Media URLs** carry a separate 24-hour media-only token, never the session token.
* **API keys:** shown once; stored as SHA-256 (plus an MD5 for KOReader's protocol). Apps sign in with a key, never your password.
* **Roles, content limits and Kids Mode** are enforced on every request, including direct file and page URLs, watch parties and the sync APIs.
* **Path checks:** file-serving routes verify the resolved path is inside its library.
* **Rate limits:** 10 sign-ins / 15 min per address, 600 API requests / min, 1200 media requests / min, 6 backups / 15 min.
* **Headers:** Helmet, with a Content-Security-Policy on by default (`CSP=report-only` or `off` to diagnose).
* **Cookies:** none for the web app. Mihon's Komga tracker uses a session cookie honoured only on `/api/v1` and `/api/v2`, SameSite=Lax, ended by deleting its API key.
* **Logs** strip `?token=` from URLs.
* **Proxies:** `TRUST_PROXY` is opt-in, for use behind a reverse proxy only.
* **TLS:** not built in; use a reverse proxy, Cloudflare Tunnel or Tailscale for access beyond your LAN.
* **Network calls:** only metadata lookups you trigger (MangaDex, Google Books, Open Library, TMDB with your key) and a twice-daily anonymous release check (`UPDATE_CHECK=false` turns it off). No telemetry.

Plinthio is built for trusted-network self-hosting (your home, and people you invite). It has not been audited for hostile multi-tenant or public-internet deployment, and has no 2FA.

---

## 🚀 Install (Docker)

You only need Docker — no need to clone the repo. Images are published for x86-64 and ARM
(Raspberry Pi 4/5, Apple Silicon, most NAS boxes).

```bash
mkdir plinthio && cd plinthio
curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.yml
MEDIA_DIR=/path/to/your/media docker compose up -d
```

Open `http://<your-server-ip>:8088`, run the setup wizard to create your admin account and
add your media folders. On a phone, use **Add to Home Screen** to install the app.

Settings like `MEDIA_DIR`, `TZ` or the port binding can live in a `.env` file next to
`docker-compose.yml` instead of on the command line — see the comments in that file.

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

You need Node.js 20+, **ffmpeg/ffprobe** (video) and **poppler** (`pdfinfo`/`pdftoppm`, PDFs):

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
