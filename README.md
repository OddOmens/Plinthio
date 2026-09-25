# 📚 Plinthio

> **The all-in-one self-hosted media server and PWA for Audiobooks, Manga & Comics, Books, Movies, TV Shows, and Anime.**

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker/docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20-green?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)

Plinthio was born out of frustration with fragmented media servers: having to run one server for audiobooks (like Audiobookshelf), another for comics (like Komga), another for video (like Jellyfin), while juggling multiple third-party mobile apps with paywalls.

**Plinthio unifies everything into a single Docker container with an installable mobile-first Progressive Web App (PWA).**

---

## ✨ Features

### 🎧 Audiobooks
* **Instant Scrubbing:** HTTP 206 partial-range audio streaming for responsive seeking through massive 20+ hour `.m4b` and `.mp3` files.
* **iOS Lock-Screen Integration:** Full `navigator.mediaSession` support showing book cover art, title, author, play/pause, and ±15s skip controls on your iPhone lock screen and Control Center.
* **Per-User Resume:** Remembers exactly where you paused and syncs progress across devices.
* **Smart Controls:** Variable playback speed (0.8x to 2.0x) and sleep timer (15m to 60m).
* **Formats:** `.m4b`, `.mp3`, `.m4a`, `.flac`, `.aac`, `.ogg`.

### 📖 Manga & Comics
* **Both Reading Directions:** Full **Right-to-Left (RTL)** support for authentic Japanese manga, and full **Left-to-Right (LTR)** support for Western comics — set per series and remembered server-side, so a title always opens the right way round. Page-turn taps, swipes, and keyboard shortcuts all mirror correctly for whichever direction is active.
* **Webtoon Mode:** Continuous vertical scroll for Korean webtoons and digital comics, as a third reading mode alongside paged RTL/LTR.
* **Single & Double-Page Spreads:** Toggle between single-page and two-page spread layouts, with correct left/right page ordering for both RTL and LTR.
* **High-Speed Archive Streaming:** Pages are streamed directly out of `.cbz`/`.zip`, `.cbr`/`.rar`, and `.cb7`/`.7z` archives on the fly — nothing is pre-extracted to disk (except 7z, which the format requires).
* **Format Sniffing:** Archives are identified by their actual contents, not their file extension — so the very common mislabelled `.cbr`-that-is-really-a-zip opens fine instead of erroring.
* **Per-Series Metadata:** Edit a series' name, reading direction, and age rating in one place; `ComicInfo.xml` tags (including `Manga` and `AgeRating`) are read during scans to set sensible defaults.
* **Read Lists:** Build an ordered reading order that spans multiple series — a Komga-style read list — and reorder it item by item.
* **OPDS & OPDS-PSE:** Browse and read your library in dedicated reader apps (Chunky, Panels, KyBook, Moon+ Reader) via a standard OPDS catalog, with page streaming so readers fetch pages individually instead of downloading whole archives.
* **Automatic Progress Tracking:** Remembers your last read page per series.

### 📚 Books & Documents
* Standard **EPUB** and **PDF** reader with bookmarking, notes, and cross-device reading progress synchronization.
* Formats: `.epub`, `.pdf`.

### 🎬 Movies & TV Shows (and Anime)
* **Direct-Play & Direct-Stream First:** Video is served with HTTP 206 byte-range streaming straight off disk whenever the browser can decode it natively — zero server CPU overhead. When the container (e.g. MKV) or audio (e.g. EAC3 / Dolby Atmos / DTS) is incompatible with browsers, Plinthio uses **Direct Stream**: the video stream is copied untouched (`-c:v copy`) into an fMP4 container at 0% video CPU while only the audio track is converted to AAC in milliseconds.
* **Automatic Browser Capability Detection:** Plinthio probes client capabilities (including native HEVC/H.265 playback on Chromium browsers like Chrome, Edge, and Vivaldi, and Safari) so modern browsers direct-play 4K and 1080p HEVC content without unnecessary transcoding.
* **Smart Playback Modes:**
  * **Direct Play** — codecs and container are already browser-native (H.264/HEVC + AAC in MP4). Zero server overhead.
  * **Direct Stream (Remux)** — video codec is browser-native, but container is MKV or audio is EAC3/DTS/TrueHD. Video is stream-copied untouched at original quality; audio is converted to AAC. Starts in <100ms with negligible CPU.
  * **Transcode** — only used if the video stream itself cannot be decoded by the client (e.g. 10-bit H.264). Uses GPU hardware encoding whenever available.
* **HLS with Real Seeking:** Remuxed and transcoded playback is delivered as HLS CMAF/fMP4 segments with full byte-range seek support — scrubbing jumps instantly without restarting encodes from scratch.
* **Hardware-Accelerated Transcoding:** Intel QuickSync (QSV), VAAPI, and NVIDIA NVENC are auto-detected and used when available, offloading video tasks to the GPU. Admins can verify their driver with the in-app "Test Encoder" feature in Server Settings.
* **Protected Server Workload:** Background thumbnail scrub generation (trickplay) is decoupled from live playback and transcoding is concurrency-capped to prevent CPU overload or thermal throttling on low-power host machines (like Intel NUCs / micro PCs).
* **Adaptive Bitrate + Quality Selection:** Transcodes are offered as a quality ladder (never upscaled past the source). The player adapts to bandwidth automatically, or you can pin a specific quality.
* **Subtitles:** Embedded text subtitle tracks are extracted to WebVTT on demand, and sidecar files (`Movie.en.srt`, `Movie.en.forced.srt`, `.vtt`, `.ass`/`.ssa`) are picked up automatically with language and forced flags parsed from the filename.
* **Multiple Audio Tracks:** Every audio stream is enumerated (language, title, channel count) and switchable during playback — useful for dual-audio anime and commentary tracks.
* **Scrub Previews (Trickplay):** Pre-generated thumbnail sheets show preview snapshots when hovering the timeline scrubber.
* **Skip Intro / Credits:** Admins set intro and credits ranges per episode; viewers get a skip button while playback is inside one.
* **Casting:** Chromecast (including Chromecast-built-in TVs such as Google TV) and AirPlay from the PWA.
* **Formats:** `.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`.
* **Season/Episode Detection:** Filenames matching common patterns (`S01E05`, `1x05`, `Episode 5`, etc.) are automatically parsed and grouped by season so continue-watching always lands on the right episode.
* **Optional Poster Art & Metadata:** If you add a free [TMDB](https://www.themoviedb.org/) API key in **Server Settings**, movies, shows, and anime get automatically matched poster art and metadata during library scans.
* **Per-Episode Progress:** Resume tracking is per episode/file, not just per series.

### 📱 Progressive Web App (PWA)
* **Zero App Store Fees:** No subscription or $20 paywalls.
* **Native Look & Feel:** Open your Plinthio URL in Safari on iOS, tap **Share → Add to Home Screen**, and launch it in fullscreen without browser bars, with iOS-safe-area-aware layout and lock-screen media controls.
* **Works Offline:** A service worker caches the app itself plus the covers and comic pages you've already opened, so an installed Plinthio still launches and lets you re-read recent pages with no connection. Listings, progress and video streams always come from the network, and the cached art is cleared when you sign out.

### 🔒 Multi-User & Server Management
* **Setup Wizard:** First-run wizard to create your master administrator account and bootstrap your first libraries.
* **Three Roles:** `admin` (full server management), `editor` (library/metadata management), and `viewer` (read/watch/listen only) — enforced server-side on every request, not just hidden in the UI.
* **Per-Item & Per-Library Visibility:** Admins can hide specific items or restrict libraries per user.
* **Custom Folders:** Users can organize items into their own in-app collections, independent of the on-disk folder structure, with an automatic "Unorganized" catch-all for anything not yet sorted.
* **Activity & Login History:** Per-user view/listen/read/watch session history and sign-in history, visible to admins.
* **Live Admin Logs:** A real-time, in-app log viewer for the running server (no need to `docker logs` to debug a scan or a failed metadata match).
* **Automatic Scanning:** New media is picked up on its own — a periodic re-scan (interval configurable under Admin → Server Settings) plus a filesystem watcher that reacts within about 30 seconds of a file appearing. The periodic sweep is the dependable floor for network shares and bind mounts that emit no filesystem events; either half can be turned off.
* **Session Control:** Sign out of every device at once from Settings, revoking all issued tokens immediately.
* **Embedded SQLite Database:** Zero database setup required, with scheduled automatic backups and automatic schema migrations on boot.

---

## 🔌 API & Integrations

Plinthio's entire frontend runs on its own documented REST API, which is fully available for your own scripts, automations, or third-party integrations (Home Assistant, custom dashboards, etc.). In-app API documentation with a live curl example lives under **Docs → API & Integrations**.

**Authentication** — two methods, either works on every endpoint:
* **JWT Bearer token**, issued at `/api/auth/login`, sent as `Authorization: Bearer <token>` (or as a `?token=` query parameter, since `<img>`/`<video>` tags can't set headers).
* **API Key**, sent as an `X-API-Key` header — generate and revoke keys yourself under **Settings → API Keys**. Keys are scoped to your own user account and role. An API key also works as the password in HTTP Basic auth, which is how OPDS reader apps sign in (so you never hand a reader app your actual account password).

**Route groups** (all mounted under `/api/`):

| Path | Covers |
|---|---|
| `/auth` | Login, setup wizard, session/token handling |
| `/libraries` | Library CRUD, scanning |
| `/items` | Browsing, searching, and per-item detail |
| `/media`, `/media/video` | Streaming, cover/thumbnail art, transcoding |
| `/progress` | Playback/reading progress |
| `/bookmarks` | Timestamped/paged bookmarks with notes |
| `/collections` | Custom in-app folders and ordered read lists |
| `/series` | Per-series settings (reading direction, age rating, title) |
| `/opds` | OPDS / OPDS-PSE catalog for third-party reader apps |
| `/users` | User management (admin) |
| `/keys` | Personal API key management |
| `/settings` | Server settings, backups |
| `/customization` | Branding, theming, layout |
| `/metadata` | External metadata search (MangaDex, Google Books, Open Library, TMDB) |
| `/stats` | Server and library statistics |
| `/activity` | View/listen/read session & login history |
| `/admin/logs` | Live server log stream (admin) |
| `/health` | Unauthenticated health check |

```bash
curl -H "X-API-Key: plinthio_..." http://localhost:8088/api/items
```

---

## 🎨 Customization

Everything below is configurable from the UI — no config files or redeploys needed.

**Server-wide (Admin → Server Settings):**
* **Server Name** — replaces "Plinthio" throughout the UI and on the login screen.
* **Custom CSS** — inject your own stylesheet, applied live across the entire server for every user.
* **Accent Theme** — 8 built-in color themes: `zinc`, `slate`, `emerald`, `violet`, `rose`, `amber`, `sky`, `indigo`.
* **Layout Mode** — top navigation bar or a persistent sidebar.
* **Login Message** — a custom message shown on the sign-in screen (announcements, house rules, etc.).
* **TMDB API Key** — optional, enables automatic poster art/metadata for video libraries.
* **Video Transcoding** — choose hardware acceleration (auto / VAAPI / NVENC / QuickSync / off) and test it with a real encode. Pass `/dev/dri` through in `docker-compose.yml` for Intel/AMD; NVENC additionally needs the NVIDIA Container Toolkit on the host.

**Per-User (Settings):**
* **Light/Dark Mode** toggle.
* **Enabled Media Types** — show/hide any of audiobooks, manga, books, shows, movies, or anime from your own view.
* **Enabled Grouping Modes** — choose which browsing groupings you see (grid, author, series, disk folder, custom folder).
* **Default View** on login.
* **Custom Folders** — build your own organizational structure on top of the shared library.

---

## 🛡️ Security

A factual rundown of what's actually implemented, so you know what you're deploying:

* **Password hashing:** `bcrypt` with a cost factor of 10. Minimum password length of 8 characters is enforced at signup.
* **Sessions:** Stateless JWTs signed with a per-install secret that's auto-generated on first boot and persisted to `/config/jwt.secret` inside your data volume (never hardcoded, never committed anywhere). Tokens last 7 days by default (`JWT_EXPIRES_IN`) and are refreshed each time you open the app, so regular use never signs you out while a token copied off a lost or shared device stops working within the week. Changing your password — or pressing **Sign out of all devices** in Settings — immediately invalidates every previously-issued token for that account (a server-side `token_version` bump), rather than waiting out the remaining lifetime.
* **API keys:** Only ever shown once, at creation. The database stores a SHA-256 hash, not the raw key — a database leak alone can't be replayed as a working key.
* **Role-based access control:** `admin`/`editor`/`viewer` permissions are enforced in Express middleware on the server, on every request — not just hidden in the frontend.
* **Path traversal protection:** Every file-serving route (streaming, download, cover art) resolves the requested file's canonical path and verifies it's actually inside its library's root directory before serving it.
* **Rate limiting:** Tiered `express-rate-limit` rules — a strict 10-attempts/15-min limiter on login specifically, a broader 60/15-min limiter on the rest of `/api/auth`, 600/min on general API traffic, 1200/min on media streaming (seeking/page-turning needs headroom), and 6/15-min on full database backups.
* **Security headers:** [Helmet](https://helmetjs.github.io/) is applied to every response. Its Content-Security-Policy is intentionally left off (`contentSecurityPolicy: false`) so in-app media playback via blob/object URLs keeps working — this is a deliberate trade-off, not an oversight.
* **Log redaction:** Access logs strip the `?token=` query parameter from any logged URL before writing it, so a live session token never sits in plaintext on disk.
* **CORS:** Configurable origin (`CORS_ORIGIN` env var, wildcard by default for LAN/self-hosted use). Plinthio does not use cookies for authentication, so there's nothing for a browser to attach automatically cross-origin.
* **Reverse proxy aware, opt-in:** `TRUST_PROXY` is off by default. Turning it on (when you actually put Plinthio behind nginx/Caddy/a Cloudflare Tunnel) makes per-IP rate limiting key off the real client IP instead of the proxy's; leaving it on without a real proxy in front would let a client forge its own IP and bypass rate limiting, so it stays opt-in.
* **No built-in TLS:** Plinthio itself serves plain HTTP. For anything beyond your LAN, put it behind a TLS-terminating reverse proxy or tunnel (see the in-app Docs page for a Caddy/Cloudflare Tunnel example).
* **No telemetry:** Plinthio makes no calls to any Odd Omens LLC server, analytics service, or license server. The only outbound network calls it ever makes are metadata/cover-art lookups you trigger yourself, against MangaDex, Google Books, and Open Library (no key required), and TMDB (only if you supply your own free API key).

Plinthio is built for trusted-network self-hosting (home LAN, Tailscale/tunnel access for yourself and people you invite) — it has not been audited for hostile-multi-tenant or public-internet-facing deployment, and there's no 2FA or email verification layer today.

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

## 🛠️ Local Development Setup

### Prerequisites
* Node.js v20+ and npm
* **`ffmpeg` and `ffprobe`** — required for all video playback (direct-play file probing, HLS remux, transcoding, subtitle extraction, and trickplay thumbnail generation). Without `ffmpeg`, video files that need remuxing or transcoding will hang or fail, and some direct-play files won't be probed correctly.

  ```bash
  # Ubuntu / Debian
  sudo apt install ffmpeg

  # macOS (Homebrew)
  brew install ffmpeg

  # Arch / Manjaro
  sudo pacman -S ffmpeg
  ```

  > [!TIP] **Intel GPU hardware acceleration (recommended for Intel NUC / mini PCs)**
  > Install the VAAPI drivers alongside ffmpeg for hardware-accelerated transcoding. On a bare i5-8500T or similar Intel UHD 630 system this cuts CPU load by ~80% and reduces first-segment latency from several seconds to under 1 second.
  >
  > ```bash
  > # Ubuntu / Debian — adds the iHD driver (required for 8th gen Coffee Lake and newer)
  > sudo apt install ffmpeg intel-media-va-driver-non-free vainfo
  > # Confirm the driver is visible:
  > vainfo
  > ```
  >
  > Once `vainfo` shows `VAProfileH264High : VAEntrypointEncSliceLP`, set **Admin → Server Settings → Video Transcoding** to `vaapi` (or leave it on `auto` — the server will detect and use it automatically).

  > [!NOTE] **Docker users** — `ffmpeg` and the Intel VAAPI drivers are already installed inside the Docker image. The only extra step is passing `/dev/dri` through in `docker-compose.yml` (see the commented-out `devices:` block in that file).

### Backend
```bash
cd backend
npm install
npm run dev
# API running on http://localhost:8080
```

### Tests
```bash
cd backend
npm test
```
The suite covers the scanner (discovery, rename re-linking, pruning, per-library locking),
item paging, preference merging, comic archive reading, automatic-scan settings and session
revocation. It needs no fixtures beyond the repo and no running server — each test file boots
its own against a throwaway data directory. Duration tests additionally need `ffmpeg`
installed and skip without it. CI runs the same suite, a frontend build, and a Docker image
build on every push and pull request.

### Frontend
```bash
cd frontend
npm install
npm run dev
# Web app running on http://localhost:5173 (proxies /api to 8080)
```

---

## 📂 Project Structure

```text
plinthio/
├── backend/                # Express API & Streaming Engine
│   ├── src/
│   │   ├── config/         # SQLite schema & environment configuration
│   │   ├── middleware/     # JWT authentication & access control
│   │   ├── routes/         # Auth, libraries, media streaming, progress
│   │   ├── services/       # File scanner, metadata parser, archive reader
│   │   └── index.js        # Main server entry point
├── frontend/               # Vue 3 + Tailwind CSS PWA
│   ├── public/             # PWA manifest, service worker, icons
│   ├── src/
│   │   ├── components/     # AudioPlayer, MangaReader, BookCard, Navbar
│   │   ├── stores/         # Pinia auth & audio player state
│   │   └── views/          # Home, Login/Setup, Admin Settings
├── docker/                 # Production multi-stage Dockerfile & Compose
├── LICENSE                 # PolyForm Noncommercial 1.0.0
└── README.md
```

---

## 📄 License
Plinthio is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You're free to use, fork, modify, and self-host it for any noncommercial purpose. Selling it, hosting it as a paid service, or otherwise using it (or a derivative) for commercial gain is not permitted without a separate license from Odd Omens LLC.
