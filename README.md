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
* **Both Reading Directions:** Full **Right-to-Left (RTL)** support for authentic Japanese manga, and full **Left-to-Right (LTR)** support for Western comics — pick per series, and page-turn taps, swipes, and keyboard shortcuts all mirror correctly for whichever direction is active.
* **Webtoon Mode:** Continuous vertical scroll for Korean webtoons and digital comics, as a third reading mode alongside paged RTL/LTR.
* **Single & Double-Page Spreads:** Toggle between single-page and two-page spread layouts, with correct left/right page ordering for both RTL and LTR.
* **High-Speed Archive Streaming:** Pages are streamed directly out of `.cbz`/`.zip` archives on the fly — nothing is pre-extracted to disk.
* **Automatic Progress Tracking:** Remembers your last read page per series.

### 📚 Books & Documents
* Standard **EPUB** and **PDF** reader with bookmarking, notes, and cross-device reading progress synchronization.
* Formats: `.epub`, `.pdf`.

### 🎬 Movies & TV Shows (and Anime)
* **Direct-Play First:** Video is served with HTTP 206 byte-range streaming straight off disk whenever the browser can decode it natively — no server-side CPU cost.
* **Automatic Compatibility Detection:** Every file is probed with `ffprobe` on first playback to check its video codec, audio codec, and container against what browsers actually support, then routed automatically to one of three playback modes:
  * **Direct** — codecs and container are already browser-native.
  * **Remux** — the codecs are fine but the container (e.g. MKV) isn't; streams are copied into a fragmented MP4 wrapper with no re-encoding and no quality loss.
  * **Transcode** — the codec itself isn't browser-playable (HEVC/H.265, 10-bit H.264 High Profile, etc.); the file is transcoded on the fly with `ffmpeg` (software `libx264` + `aac`) into a seekable fragmented MP4 stream.
* **Formats:** `.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`.
* **Season/Episode Detection:** Filenames matching common patterns (`S01E05`, `1x05`, `Episode 5`, etc.) are automatically parsed and grouped by season so continue-watching always lands on the right episode.
* **Optional Poster Art & Metadata:** If you add a free [TMDB](https://www.themoviedb.org/) API key in **Server Settings**, movies, shows, and anime get automatically matched poster art and metadata during library scans.
* **Per-Episode Progress:** Resume tracking is per episode/file, not just per series.

### 📱 Progressive Web App (PWA)
* **Zero App Store Fees:** No subscription or $20 paywalls.
* **Native Look & Feel:** Open your Plinthio URL in Safari on iOS, tap **Share → Add to Home Screen**, and launch it in fullscreen without browser bars, with iOS-safe-area-aware layout and lock-screen media controls.

### 🔒 Multi-User & Server Management
* **Setup Wizard:** First-run wizard to create your master administrator account and bootstrap your first libraries.
* **Three Roles:** `admin` (full server management), `editor` (library/metadata management), and `viewer` (read/watch/listen only) — enforced server-side on every request, not just hidden in the UI.
* **Per-Item & Per-Library Visibility:** Admins can hide specific items or restrict libraries per user.
* **Custom Folders:** Users can organize items into their own in-app collections, independent of the on-disk folder structure, with an automatic "Unorganized" catch-all for anything not yet sorted.
* **Activity & Login History:** Per-user view/listen/read/watch session history and sign-in history, visible to admins.
* **Live Admin Logs:** A real-time, in-app log viewer for the running server (no need to `docker logs` to debug a scan or a failed metadata match).
* **Embedded SQLite Database:** Zero database setup required, with scheduled automatic backups and automatic schema migrations on boot.

---

## 🔌 API & Integrations

Plinthio's entire frontend runs on its own documented REST API, which is fully available for your own scripts, automations, or third-party integrations (Home Assistant, custom dashboards, etc.). In-app API documentation with a live curl example lives under **Docs → API & Integrations**.

**Authentication** — two methods, either works on every endpoint:
* **JWT Bearer token**, issued at `/api/auth/login`, sent as `Authorization: Bearer <token>` (or as a `?token=` query parameter, since `<img>`/`<video>` tags can't set headers).
* **API Key**, sent as an `X-API-Key` header — generate and revoke keys yourself under **Settings → API Keys**. Keys are scoped to your own user account and role.

**Route groups** (all mounted under `/api/`):

| Path | Covers |
|---|---|
| `/auth` | Login, setup wizard, session/token handling |
| `/libraries` | Library CRUD, scanning |
| `/items` | Browsing, searching, and per-item detail |
| `/media`, `/media/video` | Streaming, cover/thumbnail art, transcoding |
| `/progress` | Playback/reading progress |
| `/bookmarks` | Timestamped/paged bookmarks with notes |
| `/collections` | Custom in-app folders |
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
* **Sessions:** Stateless JWTs signed with a per-install secret that's auto-generated on first boot and persisted to `/config/jwt.secret` inside your data volume (never hardcoded, never committed anywhere). Changing your password immediately invalidates every previously-issued token for that account (a server-side `token_version` bump), rather than waiting out the token's remaining lifetime.
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

## 🚀 Quick Start (Docker)

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/plinthio.git
cd plinthio
```

### 2. Run with Docker Compose
```bash
docker compose -f docker/docker-compose.yml up -d
```

### 3. Open Plinthio
Navigate to `http://<your-server-ip>:8088` in your browser.
* Complete the quick setup wizard to create your Admin account.
* Add your media folders in **Server Settings**.
* On your iPhone or Android, tap **Add to Home Screen** to install the PWA.

---

## 🛠️ Local Development Setup

### Prerequisites
* Node.js v20+ and npm

### Backend
```bash
cd backend
npm install
npm run dev
# API running on http://localhost:8080
```

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
