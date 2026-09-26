# Changelog

All notable changes to Plinthio. Versions follow [Semantic Versioning](https://semver.org):
**major** (2.0.0) may need you to change something when upgrading, **minor** (1.1.0) adds
features, **patch** (1.0.1) only fixes bugs. Every upgrade backs up your database first.

Each release's section here becomes its GitHub Release notes and the "What's new" link in
the admin update banner. Add entries under **Unreleased** as you go.

## [Unreleased]

## [1.0.0] - 2026-09-25

### Added
- **Offline downloads** for books, comics/manga and audiobooks, with a Downloads page that works with no connection. Progress made offline syncs when you're back online.
- **Library Health** (Admin → Health): unreachable libraries, missing files, likely duplicates, clashing volume numbers, titles missing art or metadata, unrated titles and recent transcode failures.
- **Parental controls**: a per-user content limit (Everyone / Teen / Mature) with an option to hide unrated titles, enforced everywhere including direct links. Titles can now be rated individually as well as per series.
- **Search and filters**: search covers descriptions, genres, cast and publishers; filter by progress, genre and date added; sort by title, newest, recently opened or release date. Search inside EPUBs (Ctrl+F).
- **Audiobook chapters**: chapter list, previous/next chapter (including lock-screen and headphone buttons), per-book playback speed that follows you across devices, "end of chapter" sleep timer with a countdown and fade-out.
- **One shelf for every media type.** Four views everywhere, and every one of them shows one card per series — a show, a manga, a book or audiobook series, a movie collection — plus standalone titles, never loose volumes or episodes: **Alphabetical**, **Creator** (labelled Author, Director or Studio to suit what you're browsing), **Disk Folders** and **Custom Folders**. Admins can turn off Disk Folders and Custom Folders for everyone; Alphabetical and Creator are always there. In Disk Folders a show split into season folders appears once, under the show's folder.
- **Every title opens a detail page first** — the series page with its volumes, episodes or books, or the title's own page — and you read, listen or watch from there. Series (shows, manga, collections like Star Wars) list their episodes or volumes; a single title — a movie, a standalone book or audiobook — gets a simple page with its details and one play/read button instead of a one-row list. The page speaks the right language for each type (Episodes and "Start Watching · S1 · E1", Books and "Start Listening", Volumes and "Continue Reading · Page 42") and opens the right reader or player. Old `/manga/…` links redirect.
- **Ratings**: give anything 1–5 stars from its page (a series page rates one volume or episode at a time). Next to your stars: the server-wide average and, for movies, shows and anime, TMDB's score (with a TMDB key). Your rating shows as a badge on cards. Admin → Server Config → Ratings turns personal, community and world ratings on or off; a switched-off rating isn't sent at all.
- **Extras** — trailers, featurettes, behind-the-scenes, deleted scenes — are recognised by the usual folder names (`Extras/`, `Featurettes/`, `Behind The Scenes/`…) and suffixes (`-trailer`), and for movies by sitting in a film's own folder (subfolders, or loose clips much smaller than the film). They're kept off the shelf and out of search and Continue, and listed in an **Extras** row on the film's (or show's) page. A folder that really holds several full-length films isn't collapsed.
- **Movie collections, both ways**: the Movies shelf has a **Collections / All movies** switch (Star Wars as one card, or every film). Clicking a film in a collection opens the film's own page, with a "More in Star Wars" row and a link back to the whole collection.
- **Error codes**: every error now shows a Plinthio code (P###) documented in Docs → Error Codes and `docs/error-codes.md`. Video playback no longer fails with a misleading "Conversion failed": the player reports the real cause and renews expired media links automatically.
- **Skipped volumes** for manga: skip volumes you've already covered — say you watched the anime — one at a time or "everything through Vol N". Skipped volumes count toward series progress, "Continue" and the reader's next-volume jump step over them, and they're left out of "Download unread". Your read history isn't changed, and opening a skipped volume un-skips it. The shelf's Status filter has a Skipped option.
- **Lists** (replacing Read Lists), grouped into Movies, Shows, Anime, Read and Listen. A list can mix library items with titles found through TMDB, MangaDex, Google Books and Open Library, in one reorderable order; searched titles show "In library" when you already have them. Existing read lists move to the Read tab, and `/read-lists` redirects there.
- **Media requests**: anyone can request a title from search or a list (one open request per title across users). Admins and editors get a review queue (accept as pending/added, reject, add a note), requesters can withdraw pending requests, and the user menu shows a pending count.
- **Update notifications**: admins see a dismissible banner when a new version is released.
- Automatic database backup before a new version's first start.
- Multi-architecture images (x86-64 and ARM) published to `ghcr.io/oddomens/plinthio`.

### Changed
- Media links now use a short-lived, media-only token; the session token is never put in a URL.
- A Content-Security-Policy is enabled by default (set `CSP=off` or `CSP=report-only` to diagnose).
- Faster first load: readers, players and admin pages load on demand (main bundle 1.2 MB → 275 KB).
- Pinch-zoom is allowed across the app; the paged manga reader keeps its own zoom and pan.
- The Google Cast SDK only loads in Chromium browsers, and only when a video is opened.
- Server errors and absolute file paths are only shown to admins.
- Same-named series in different libraries or media types are kept separate.
- Install is pull-based: `docker/docker-compose.yml` uses the published image; building from source moved to `docker/docker-compose.build.yml`.
- GPU passthrough (`/dev/dri`) is now opt-in in `docker-compose.yml`, so the default file starts on machines without a GPU. **Intel/AMD hardware transcoding users: uncomment the `devices:`/`group_add:` lines when upgrading.**

### Fixed
- EPUB books failed to open.
- Saving metadata from the shelf erased description, themes, publisher and status.
- Closing the audio player left audio playing with no controls.
- Scanning a library whose drive was unmounted deleted its whole catalog.
- A book file removed from disk could crash the server when opened.
- Seeking audio/video past the end of the file, or with a suffix range, hung or errored.
- Hidden items showed up in "Continue" and could be opened by id.
- Zero-padding on players, readers and several screens on devices without a notch; controls on iPhone overlapped the notch in the EPUB reader.
- Several Tailwind size classes silently produced no CSS (tiny search box and tabs on phones).
- The tablet header hid the Movies and Anime tabs; filters and Library Health rows were cramped on phones.
- PWA install icons were missing.
- Very short video clips got no frame cover (the grab was sought past their end).
- Video (HLS) playback was refused by the server because the player also sent the media token as an Authorization header.
- Links to a filtered shelf (`/?type=…`, e.g. from breadcrumbs) were overridden by the startup default category.
- The sign-in rate limiter counted the calls every page load makes, so a household behind one IP could be locked out after a few dozen reloads; only real sign-in attempts count now.
- One viewer closing a video stopped the stream for everyone else watching the same title.
- Login response time revealed which usernames exist; usernames are now validated.
