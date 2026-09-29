# Plinthio documentation

Plinthio is a self-hosted media server for audiobooks, manga and comics, books and PDFs,
movies, TV shows and anime, in one Docker container, with an installable web app.

These pages are the reference for running it, using it and working on it. The in-app
**Docs** page covers the everyday how-to for users; this folder goes further.

| Page | Covers |
| --- | --- |
| [Setup](setup.md) | Installing with Docker, first-run wizard, folder layout, HTTPS, hardware transcoding, updating, rolling back, bare-metal installs |
| [Configuration](configuration.md) | Every environment variable, and every admin setting in the app, with defaults |
| [Libraries](libraries.md) | Library types and file formats, how to lay out folders, scanning, extras, missing files, metadata and artwork, Library Health |
| [Reading and listening](reading-and-listening.md) | Comics and manga, PDFs, EPUBs, audiobooks, skipped volumes, mark-read-up-to-here, bookmarks, offline downloads |
| [Movies and shows](video.md) | Playback modes, transcoding, subtitles and audio tracks, skip buttons, pause screens, intro/credits markers, casting, title pages |
| [Accounts and access](accounts-and-access.md) | Roles, content limits, Kids Mode, hiding titles, expiring accounts, two-factor sign-in, away from home, API keys, sessions |
| [Away from home](remote-access.md) | Tailscale, a web address for guests (Caddy add-on), who can use Plinthio from where, keeping it safe |
| [Reading apps](sync-apps.md) | Mihon (Komga API), KOReader progress sync and OPDS readers — setup and what syncs |
| [Together](together.md) | Watch parties, lists, requests and ratings |
| [Administration](administration.md) | The admin panel tab by tab: Libraries, Health, Metadata, Users, Network, Logs, Stats, Activity, Server Config; backups; update notices |
| [Troubleshooting](troubleshooting.md) | Symptoms and fixes, organised by what you see |
| [Error codes](error-codes.md) | Every P### code, what it means and what to do (generated from the server) |
| [API](api.md) | Authentication and the route reference for scripts and integrations |
| [Architecture](architecture.md) | For contributors: how the code is organised, the data model, access control, conventions, tests |
| [Releasing](../RELEASING.md) | Versioning and cutting a release |
| [Release records](release-records/) | What went into each release and why |

Plinthio follows [semantic versioning](https://semver.org). What changed in each version is in
[CHANGELOG.md](../CHANGELOG.md).
