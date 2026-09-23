# 📚 Plinthio

> **The all-in-one open-source self-hosted media server and PWA for Audiobooks, Manga, and Books.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker/docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20-green?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)

Plinthio was born out of frustration with fragmented media servers: having to run one server for audiobooks (like Audiobookshelf), another for comics (like Komga), and another for books, while juggling multiple third-party mobile apps with paywalls.

**Plinthio unifies everything into a single Docker container with an installable mobile-first Progressive Web App (PWA).**

---

## ✨ Features

### 🎧 Audiobooks
* **Instant Scrubbing:** HTTP 206 partial-range audio streaming for responsive seeking through massive 20+ hour `.m4b` and `.mp3` files.
* **iOS Lock-Screen Integration:** Full `navigator.mediaSession` support showing book cover art, title, author, play/pause, and ±15s skip controls on your iPhone lock screen and Control Center.
* **Per-User Resume:** Remembers exactly where you paused and syncs progress across devices.
* **Smart Controls:** Variable playback speed (0.8x to 2.0x) and sleep timer (15m to 60m).

### 📖 Manga & Comics
* **High-Speed Archive Streaming:** Streams pages directly out of `.cbz` and `.zip` archives on the fly.
* **Authentic Japanese Reading (RTL):** Tap the left side of your screen to turn to the next page, just like reading a physical manga.
* **Webtoon / Vertical Scroll:** Continuous vertical strip reading mode for Korean webtoons and digital comics.
* **Automatic Progress Tracking:** Remembers your last read page per series.

### 📱 Progressive Web App (PWA)
* **Zero App Store Fees:** No subscription or $20 paywalls.
* **Native Look & Feel:** Open your Plinthio URL in Safari on iOS, tap **Share → Add to Home Screen**, and launch it in fullscreen without browser bars.

### 🔒 Multi-User & Server Management
* **Setup Wizard:** First-run wizard to create your master administrator credentials.
* **Role-Based Access:** Admins manage libraries and users; standard users can listen and read.
* **Embedded SQLite Database:** Zero database setup required. Automatic schema migrations on boot.

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
├── LICENSE                 # MIT License
└── README.md
```

---

## 📄 License
This project is open-source and licensed under the [MIT License](LICENSE).
