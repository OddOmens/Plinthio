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
| `BIND_ADDRESS` | `0.0.0.0` | Host address the ports are published on. `127.0.0.1` makes Plinthio reachable only from the host itself |
| `PLINTHIO_TAG` | `latest` | Image tag, which chooses the update channel (see [Setup → Updating](setup.md#updating)) |
| `TZ` | `UTC` | Time zone for logs and scheduled jobs |
| `TS_AUTHKEY`, `TS_HOSTNAME` | none, `plinthio` | Tailscale add-on: an auth key, and the machine's name on your tailnet ([Remote access](remote-access.md#tailscale)) |
| `TS_FUNNEL` | `false` | Tailscale add-on: `true` opens the `.ts.net` address to anyone on the internet, no domain needed ([Funnel](remote-access.md#tailscale-funnel-a-link-for-anyone-no-domain)). Exactly `true` or `false` |
| `PLINTHIO_DOMAIN` | none | Public-address add-on: the name guests use, e.g. `media.yourdomain.com` ([Remote access](remote-access.md#a-web-address-for-guests)) |
| `COMPOSE_FILE` | `docker-compose.yml` | Which files make up the stack, e.g. `docker-compose.yml:docker-compose.tailscale.yml` to keep an add-on across updates |

### Container

| Variable | Default | What it does |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` / `1000` | User and group the server runs as, and that own `/config` |
| `PORT` | `8080` | Port inside the container. Leave it alone and change the published port instead |
| `HOST` | `0.0.0.0` | Interface the server listens on inside the container |
| `DATA_DIR` | `/config` (Docker), `./data` (bare metal) | Where the database, covers, caches and backups live |
| `HTTPS_PORT` | `8443` (Docker), off (bare metal) | Port for the built-in HTTPS server, next to plain HTTP on `PORT`. Empty turns it off. See [Setup → Plinthio's own certificate](setup.md#plinthios-own-certificate) |
| `TLS_HOSTNAMES` | none | Extra IPs and host names for the HTTPS certificate, comma-separated, e.g. `192.168.1.20,nas.local`. Usually unneeded: private addresses and local names are added automatically when a device first visits over http://. A public domain must be set here before the first start |
| `TLS_CERT` / `TLS_KEY` | `/config/ssl/cert.pem` / `key.pem` if present | Your own certificate and key instead of the generated ones |
| `TRUST_PROXY` | off (`loopback` with the add-ons) | Set when Plinthio sits behind a reverse proxy or tunnel, so rate limits, logs and the away-from-home controls see real client addresses. The add-ons set `loopback` (only a proxy in the same container network is believed). For your own proxy, prefer its address or subnet over `1`. Also accepts a hop count, `true`, or an IP/subnet list ([Express's rules](https://expressjs.com/en/guide/behind-proxies.html)). Never set it without a proxy: clients could fake their address and get round rate limits |
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

Admin settings save as you change them, except backups and custom CSS, which have a Save
button. Sections are listed in [Administration](administration.md).

| Where | Setting | Default | What it controls |
| --- | --- | --- | --- |
| Libraries | **Automatic scanning** | on, every 60 min, watcher on | Periodic rescan of every library (15 minutes to a day) and the file watcher, which picks up new files about 30 s after they appear |
| Metadata | **TMDB key** | none | Checked against TMDB when saved. MangaDex, Google Books and Open Library need no key |
| Kids Mode | **Whole libraries** | off | Makes everything in a library visible to Kids Mode accounts |
| Appearance | **Let people personalize** | on, each allowed | Whether people can choose their own accent colour, navigation, page width and pause screen (Settings → Appearance). One switch for all, and **Users can change** on each. Anything not allowed follows the server's choice |
| Appearance | **Accent colour** | `zinc` | Accent colour for anyone who hasn't picked their own |
| Appearance | **Navigation** | top bar | Top navigation bar or sidebar |
| Appearance | **Page width** | full width | Full width, or contained (centred, up to 1440px) |
| Appearance | **Pause screen** | Details | What movies and shows show after a couple of seconds paused: Simple, Details, Cinematic or Bedtime. See [Movies and shows](video.md#pause-screens) |
| Appearance | **Name and sign-in notice** | "Plinthio", no notice | Server name (shown everywhere and in the browser tab) and a message on the sign-in page |
| Appearance | **Custom CSS** | empty | CSS applied for every user. Docs → Custom CSS Styling lists the variables |
| Features | **Shelf views** | all on | Whether **Disk folders** and **Custom folders** are offered to everyone. Alphabetical and Creator are always there |
| Features | **Ratings** | all on | Personal stars, the server average, TMDB's world score. A switched-off rating isn't sent by the API either |
| Features | **Show missing films in collections** | on | A collection also lists the films the server doesn't have, greyed out with a Request button. They never appear on the shelf |
| Features | **Watch parties** | off | Adds "Watch Together" to movies and episodes. Turning it off ends any party in progress |
| Playback | **Hardware acceleration** | auto | Auto-detect, a specific method (VAAPI, QuickSync, NVENC), or the CPU only. **Test** runs a real encode |
| Playback | **Opening sequence** | off, built-in clip | A short clip played before movies and/or episodes when someone presses Play. Replace it with your own 1–10 second MP4 (H.264, under 20 MB). See [Movies and shows](video.md#opening-sequence) |
| Backups | **Automatic backups** | on, daily, keep 7 | Scheduled backups (every 6 h to weekly, keep 1–30), a second place to copy them to, **Back up now**, and download or delete existing backups |

The Appearance section shows a **live preview** of the shelf, a title page, the sign-in screen
and the pause screen beside its settings; hovering a choice shows it before you pick.

### Per series and title (the title page, editors and admins)

- **Edit Metadata:** search providers and apply to one title or a whole series. You can also
  upload a cover.
- **Series settings:** display name, reading direction (manga) and age rating.
- **Kids:** adds the series or title to Kids Mode.
- **Intro/credits markers** for episodes: see [Movies and shows](video.md#skip-intro-and-credits).

### Per user (Settings, everyone)

- **Profile:** your picture and role.
- **Security:** change password, two-factor sign-in, and sign out of every device.
- **Appearance:** when the admin allows it (Admin → Appearance), your own **accent colour**,
  **navigation** (top bar or sidebar), **page width** (full width, or contained at up to
  1440px) and **video pause screen**. Light or dark mode is the sun/moon button in the top bar.
- **Shelves:** which media types you see, the shelf you start on, and which shelf views you use.
- **Hidden titles:** titles you've hidden from your own shelves, with a way to bring them back.
- **Activity:** what you've read, watched and listened to, and your recent sign-ins.
- **Apps & API keys:** the **reading apps** setup guide, and keys for apps and scripts.
- **In the video player:** skip-back and skip-forward amounts (follow you across devices).
- **In the readers:** reading direction, page layout, page turn style; EPUB font, size and
  layout.

### Per user (Admin → Users → Edit, admins)

Name, role, content limit (and whether unrated titles are allowed), Kids account, access
expiry, whether it can be used away from home, resetting two-factor, and password reset. See
[Accounts and access](accounts-and-access.md).

### Admin → Network

| Setting | Default | What it does |
| --- | --- | --- |
| **Allow access from outside the home network** | off for new servers (chosen in the setup wizard); on for servers upgraded from before 1.4.0 | Off: only home and Tailscale addresses can sign in or use anything |
| **Tailscale devices count as home** | on | Off treats Tailscale addresses as outside |
| **Require two-factor away from home** | off | Sign-ins from outside need a two-factor code |

The page also shows where the device you're using connects from, whether Tailscale and
Funnel are reaching Plinthio (with the `.ts.net` address), a step-by-step Tailscale guide
that writes the `.env` lines for you, warns about a proxy that isn't trusted
(`TRUST_PROXY`), and lists recent sign-ins from outside. See
[Using Plinthio away from home](remote-access.md).
