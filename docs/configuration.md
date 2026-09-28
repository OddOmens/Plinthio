# Configuration

Almost everything is set in the app. Environment variables are for how the container runs:
ports, folders, security switches. You never need to edit a config file.

## Environment variables

Set these in `docker-compose.yml` under `environment:`, or in a `.env` file next to it for
the compose-level ones.

### Compose-level (read by `docker-compose.yml`)

| Variable | Default | What it does |
| --- | --- | --- |
| `MEDIA_DIR` | `/media/library` | Host folder mounted at `/media` in the container |
| `BIND_ADDRESS` | `0.0.0.0` | Host address the port is published on. `127.0.0.1` makes Plinthio reachable only from the host itself |
| `PLINTHIO_TAG` | `latest` | Image tag, which chooses the update channel (see [Setup → Updating](setup.md#updating)) |
| `TZ` | `UTC` | Time zone for logs and scheduled jobs |

### Container

| Variable | Default | What it does |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` / `1000` | User and group the server runs as, and that own `/config` |
| `PORT` | `8080` | Port inside the container. Leave it alone and change the published port instead |
| `HOST` | `0.0.0.0` | Interface the server listens on inside the container |
| `DATA_DIR` | `/config` (Docker), `./data` (bare metal) | Where the database, covers, caches and backups live |
| `TRUST_PROXY` | off | Set to `1` behind **one** reverse proxy or tunnel, so rate limits and logs see real client addresses. Also accepts a hop count, `true`, or an IP/subnet list ([Express's rules](https://expressjs.com/en/guide/behind-proxies.html)). Never set it without a proxy: clients could fake their address and get round rate limits |
| `JWT_SECRET` | generated | Secret that signs sign-in tokens. By default a random one is made on first start and kept in `/config/jwt.secret`. Don't put a literal secret in the compose file |
| `JWT_EXPIRES_IN` | `7d` | How long a sign-in lasts without the app being opened. The app refreshes it on every load, so regular users stay signed in |
| `MEDIA_TOKEN_EXPIRES_IN` | `24h` | Lifetime of the short-lived media-only token used in image, audio and video URLs. The player renews it when it expires |
| `CORS_ORIGIN` | `*` | Allowed browser origins for the API |
| `CSP` | `on` | Content-Security-Policy. `report-only` logs violations without blocking, `off` disables it. Only change this to diagnose a blocked resource |
| `HLS_CACHE_MAX_AGE_HOURS` | `24` | How long converted video segments stay on disk after their last use |
| `TMDB_API_KEY` | none | TMDB key used when none is set in the app. A key saved in the app wins |
| `UPDATE_CHECK` | on | `false` stops the twice-daily check for new releases, and with it the admin update banner |
| `UPDATE_CHECK_URL` | GitHub releases API | Where the update check looks. For testing |
| `APP_VERSION` | from `package.json` | Overrides the reported version. For development builds |

## Settings in the app

### Admin → Server Config

The look-and-feel cards (theme through custom CSS) sit next to a **live preview** of the
shelf, a title page, the sign-in screen and the pause screen. It follows whichever card you
are using, and hovering a pause screen style shows it before you choose.

| Card | Default | What it controls |
| --- | --- | --- |
| **Shelf Views** | all on | Whether **Disk Folders** and **Custom Folders** views are offered to everyone. Alphabetical and Creator are always there |
| **Accent Theme Preset** | `zinc` | Accent colour for everyone: zinc, slate, emerald, violet, rose, amber, sky, indigo |
| **Navigation Layout** | top bar | Top navigation bar or sidebar |
| **Ratings** | all on | Which ratings are shown: personal stars, the server average, TMDB's world score. A switched-off rating isn't sent by the API either |
| **Movie Collections** | on | Whether a collection also lists the films the server doesn't have, greyed out with a Request button. They never appear on the shelf |
| **Watch Parties** | off | Adds "Watch Together" to movies and episodes. Turning it off ends any party in progress |
| **Pause Screen** | Details | What movies and shows show after a couple of seconds paused: Simple, Details, Cinematic or Bedtime. See [Movies and shows](video.md#pause-screens) |
| **Opening Sequence** | off, built-in clip | A short clip played before movies and/or episodes when someone presses Play. Replace it with your own 1–10 second MP4 (H.264, under 20 MB). See [Movies and shows](video.md#opening-sequence) |
| **Server Branding & Notices** | "Plinthio", no notice | Server name (shown everywhere and in the browser tab) and a message on the sign-in page |
| **Custom CSS Injection** | empty | CSS applied for every user, live. Docs → Custom CSS Styling lists the variables |
| **External Metadata Providers** | no TMDB key | The TMDB key, checked against TMDB when saved. MangaDex, Google Books and Open Library need no key |
| **Video Transcoding & Hardware Acceleration** | auto | Auto-detect, a specific method (VAAPI, QuickSync, NVENC), or software only. **Test** runs a real encode |
| **Automatic Scanning** | on, every 60 min, watcher on | Periodic rescan of every library (5 minutes to 7 days) and the file watcher, which picks up new files about 30 s after they appear |
| **Database Backup** | **off**, every 24 h, keep 7 | Scheduled backups (every 1–168 h, keep 1–30), plus **Back up now** and download or delete existing backups |

### Per library (Admin → Libraries)

- **Kids:** makes everything in the library visible to Kids Mode accounts.
- **Scan Now:** a full scan.
- **Delete:** removes the library from Plinthio. Files on disk are untouched.

### Per series and title (the title page, editors and admins)

- **Edit Metadata:** search providers and apply to one title or a whole series. You can also
  upload a cover.
- **Series settings:** display name, reading direction (manga) and age rating.
- **Kids:** adds the series or title to Kids Mode.
- **Intro/credits markers** for episodes: see [Movies and shows](video.md#skip-intro-and-credits).

### Per user (Settings, everyone)

- **Preferences:** which media categories you see, which shelf views you use, and the view
  you land on. Light or dark mode is the sun/moon button in the top bar.
- **My Activity:** what you've read, watched and listened to.
- **Hidden:** titles you've hidden from your own shelves, with a way to bring them back.
- **API Keys:** keys for scripts and reading apps, and the **Reading Apps** setup guide.
- **Security:** profile picture, change password, and sign out of every device.
- **In the video player:** skip-back and skip-forward amounts (follow you across devices).
- **In the readers:** reading direction, page layout, page turn style; EPUB font, size and
  layout.

### Per user (Admin → Users → Edit, admins)

Name, role, content limit (and whether unrated titles are allowed), Kids account, access
expiry, password reset. See [Accounts and access](accounts-and-access.md).
