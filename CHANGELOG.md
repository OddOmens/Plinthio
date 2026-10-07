# Changelog

All notable changes to Plinthio. Versions follow [Semantic Versioning](https://semver.org):
**major** (2.0.0) may need you to change something when upgrading, **minor** (1.1.0) adds
features, **patch** (1.0.1) only fixes bugs. Every upgrade backs up your database first.

Each release's section here becomes its GitHub Release notes and the "What's new" link in
the admin update banner. Add entries under **Unreleased** as you go.

## [Unreleased]

## [1.4.1] - 2026-10-07

### Fixed
- **Poster metadata syncing and artwork reliability:**
  - Expanded the cover download allowlist to permit Google Books redirects (`lh*.googleusercontent.com`), MangaDex (`uploads.mangadex.org`), and TMDB (`image.tmdb.org`, `tmdb.org`, `themoviedb.org`), preventing cover download failures on external redirects.
  - Normalized all remote cover downloads through `sharp` to produce standardized, high-quality JPEGs while validating image buffers directly in memory.
  - Fixed bulk and series metadata edits so picked poster artwork can be saved and applied across all volumes and episodes in a single optimized request (`POST /metadata/apply-series`).
  - Provisional video frame covers (`cover_source = 'frame'`) are now correctly recognized as missing official artwork in Admin filters and are automatically upgraded to official posters during Auto Match without requiring manual cover overwrites.
- **Granular metadata synchronization across media types:**
  - **TV Shows & Anime:** Auto-matching now syncs at the episode level. It queries TMDB season and episode data to set specific episode names, overviews, air dates, and episode still captures, rather than overwriting episode titles with the show name.
  - **Manga:** Auto-matching preserves volume numbers and volume titles (e.g. `Series, Vol. X`) while fetching authentic per-volume cover artwork from MangaDex.
  - **Movies:** Syncs movie titles, overviews, release dates, cast/crew credits, TMDB ratings, and official posters.
- **Tailscale no longer goes offline when Plinthio restarts.** The Tailscale add-ons now restart along with Plinthio instead of keeping a dead network connection, so your tailnet and Funnel links come back by themselves after an update or rebuild.

## [1.4.0] - 2026-10-02

### Added
- **A new ebook reader that gets out of the way.** Tap the middle of the page to bring up the controls and tap again to hide them; tap the edges or swipe to turn pages. The chapter and your progress sit along the bottom; tap the progress to show percent, pages left in the chapter, location, or nothing.
- **Highlights in five colours, with notes.** Select text in an EPUB to highlight it yellow, green, blue, pink or orange, or to add a note. Tap a highlight to recolour it, edit its note, copy it or remove it. Highlights are kept with downloaded books for reading offline.
- **Copy backups to a second place.** Admin → Backups → *Also copy backups to*: browse to a folder on another drive, a NAS share or a synced cloud folder, test it (it warns if it's on the same disk as the server), and every backup is copied there, along with profile pictures, covers, the sign-in key and the HTTPS certificates. It keeps its own number of backups, shows when it last copied or why it couldn't, and retries until it can. Docker installs can mount another drive at `/backups` (see the comment in `docker-compose.yml`).
- **The Notebook:** a book's contents, bookmarks and highlights in one place (highlights can be filtered by colour), each a tap away from its page.
- **One-tap bookmarks:** the ribbon at the top right bookmarks the page you're on, and shows when a page is already bookmarked.
- **More ways to read:** six page colours (Auto, White, Sepia, Green, Gray, Black), the book's own font or Serif, Sans, Readable and Mono, text from 12 to 34 px, line spacing, margins, alignment, and two columns on wide screens or always one.

### Changed
- **Settings and Admin, rebuilt.** Both are now grouped sections in a sidebar, and on a phone a list you tap into, like a phone's own settings. Admin's long Server Config page is split into **Appearance**, **Features**, **Playback** and **Backups**, alongside **Overview** (version, updates and totals), **Libraries** (now with automatic scanning), **Health**, **Metadata** (now with the TMDB key), **Kids Mode** (its own section, with a switch per library), **Users**, **Activity**, **Network** and **Logs**. Settings has **Profile**, **Security**, **Appearance**, **Shelves**, **Hidden titles**, **Activity** and **Apps & API keys**. Settings now save as you change them, with "Saved" beside them, instead of Save buttons and pop-ups; only backups and custom CSS still have Save. Each person's row in Users opens one editor for everything about the account, including role, quick +1 day/week/month access and delete. Old links (`?tab=settings`, `?tab=account` and so on) still land in the right place.
- **Automatic backups are on by default** (daily, keeping the newest 7) on any server where they were never set. A server where an admin turned them off keeps them off. Backups hold everyone's bookmarks, highlights, notes and reader settings along with everything else in the database.
- **Pre-upgrade backups are no longer deleted by the backup schedule.** They used to count against the same "keep the newest N" limit, so a week of daily backups removed them; the newest five are now always kept.
- **Signing in as someone else on the same browser** clears what the previous account left on the device (downloads, queued offline progress, the manga reader's remembered series), even when that account's session had simply expired.
- **Reader settings follow you, not the book or the device.** Everything you set in the ebook reader applies to every book you read, on all your devices. In the manga reader, single or two-page spreads and the direction you pick for each series are now saved to your account too (they were kept on one device only; settings from before carry over).
- **Switching shelves is smoother.** Picking a category, filter or sort order fades the new shelf in instead of flashing a grid of placeholders first, and an empty category no longer blinks. Categories you've already opened show instantly and refresh quietly behind the scenes.
- **Faster page loads.** The app's files are now cached by the browser between visits (they were rechecked every time), and the title page is fetched in the background while you browse the shelf, so the first tap on a title opens it without waiting.
- **Shelf filters on a phone** sit in a tidy two-column grid instead of being squeezed into blank boxes, the Collections / All movies switch gets its own row, and the shelf views (A–Z, Author, Disk, Custom) share the row evenly instead of scrolling off the edge.
- **No more zooming in when you tap a text box on an iPhone.** The search bar, settings and admin fields, and the bookmark form were all small enough that iOS zoomed the page in on tap and left it there.
- **A title's ⋯ menu on the shelf** opens as a sheet from the bottom on a phone. From a card in the left column it used to open partly off the screen.
- **The category bar on a phone** fades at the edge when more categories are hidden off to the side, and scrolls the one you've picked into view.
- **The reader's top bar on a phone** has a solid background, so its buttons stay readable over a white page, and its buttons are easier to tap. Rating stars everywhere, the title page's back button, and the volume filter tabs are easier to tap too.
- **A series' volumes on a phone:** the All / Not Started / In Progress / Completed tabs are one filter button that opens them in a sheet, and it sits in one row with the order button and the grid/list switch, all the same size.
- **Volume and chapter cards on a phone** show the Read button plus a "⋯" that opens every action (mark as read, skip, bookmarks, download, rate), labelled, in a sheet from the bottom of the screen. The row of small icons used to spill out of the card. On wider screens the icons get their own row under the Read button.

### Fixed
- Reading the backup settings or listing backups in Admin counted against the backup rate limit (6 per 15 minutes), so simply using the page could lock out **Back up now**. Only making, downloading and copying backups count now (12 per 15 minutes).
- The Docs' storage overview listed paths from an old layout (`/app/data/plinthio.db`); it now shows `/config`.
- The ebook reader's font, size and page colour choices didn't reach the book's text, and were forgotten each time a book was closed.
- Progress through a book that hadn't been opened before often showed 0% until it was reopened.
- **The shelf grew endlessly while scrolling** once it had more than 16 cards (most visibly Movies with "All movies" on), so you could never reach the bottom.
- The Movies, Shows and Anime shelves were headed "All Media".
- In the bookmarks window on a phone, the title box ran past the edge of the window.
- While a video was still being prepared, the skip buttons on a phone covered the "Converting for your browser…" message.
- Series cards on a phone no longer break "18/32 watched" across two lines.

## [1.3.1] - 2026-09-30

### Added
- **Twice the accent colours:** red, orange, lime, teal, blue, purple, fuchsia and pink join the original eight, everywhere an accent is picked (setup, onboarding, Settings and Admin).

### Changed
- **Settings → Appearance.** Your own accent colour, navigation layout, page width and pause screen now have their own tab, with the same tiles as the admin's settings and a live preview of your choices. Each shows what's in effect for you; anything the admin has locked shows the server's choice, marked "Set by your admin".
- **Settings → Shelves** (media categories, shelf views, and which shelf to start on) saves as you go, with no Save button. Movies, TV shows and anime can now be the shelf you start on.
- **Admin → Server Config → Look & feel:** each default (accent, layout, page width, pause screen) has its own "Users can change" switch, with one "Let people personalize" switch above them, in place of the separate User Personalization card.
- The live preview shows the accent colour being chosen, even when your own accent is different, and now shows page width too: the shelf is drawn on a big screen, so Contained visibly centres the page while Full width fills it. Hovering an option previews it before you pick.

### Fixed
- **Turning Funnel on or off now takes effect.** Changing `TS_FUNNEL` while the Tailscale add-on is already running needs `docker compose up -d --force-recreate`; the add-on file, the Tailscale guide and docs/remote-access.md now say so, and troubleshooting shows how to check with `tailscale funnel status`.

## [1.3.0] - 2026-09-29

### Added
- **Two-factor sign-in, optional.** Anyone can turn it on in Settings → Security (it's also offered in onboarding and at the end of setup): scan a QR code with an authenticator app, confirm a code, and save ten single-use backup codes. Signing in then asks for the 6-digit code after the password. Admins can reset it for someone who lost their phone.
- **Choose who can use Plinthio away from home.** Admin → Network: allow access from outside the home network or not, count Tailscale devices as home, and optionally require two-factor for sign-ins from outside. Per person, in Admin → Users: whether they can use it away from home. It's checked on every request, including the reading apps, and the page shows where the device you're using is connecting from, so you can check it from a phone on mobile data.
- **Tailscale, guided.** The setup wizard and Admin → Network walk you through Tailscale step by step, with links to the right pages and the exact lines to paste, for private use or a public Funnel link. Admin → Network then shows when Tailscale and Funnel are working, and at which address.
- **Your own look, if the admin allows it.** Everyone can pick their own accent colour, navigation layout, page width and video pause screen in Settings, each with a "Server default" choice. Admins decide what people can change (Admin → Server Config → User Personalization) and set the defaults.
- **A link for friends, with no domain.** With the Tailscale add-on, `TS_FUNNEL=true` opens its `https://….ts.net` address to anyone through Tailscale Funnel: friends just open the link in a browser, with nothing to install and no router changes. Tailscale limits Funnel's bandwidth, so it suits reading and listening best.
- **A web address for guests.** An optional `docker-compose.public.yml` add-on runs Caddy in front of Plinthio for a public address like `https://media.yourdomain.com` with a real, automatically renewed certificate. Guests need only a browser. It can be used together with the Tailscale add-on.
- **Using Plinthio away from home, the guide** (docs/remote-access.md): Tailscale, a web address, how to check your internet connection allows it, who can use it from where, and keeping it safe.
- **Offload titles and keep their history.** Short on space? Delete the files for, say, the five seasons of a show you've finished, and keep them as history: they stay on the title page, greyed, with everyone's progress and ratings, but leave the shelves, search and Continue Watching. In Admin → Health → Missing files choose **Keep as history**, or offload first from the title page's **Keep as History** and then delete the files. If the files come back, even re-downloaded under a different name, the title is restored with its history.
- **Watchlists for things you don't have.** A film missing from a collection has an **Add to list** button next to **Request**, and any list can hold titles found by searching, whether the server has them or not.
- **Tailscale add-on for Docker.** An optional `docker-compose.tailscale.yml` gives Plinthio a trusted `https://plinthio.<your-tailnet>.ts.net` address that works at home and away, with no certificate to install on phones (each device just needs the Tailscale app) and no router changes. It runs Tailscale next to Plinthio, so nothing needs installing on the server either. Plain `http://<server>:8088` keeps working. See docs/setup.md → HTTPS.

### Changed
- **The setup wizard is full screen**, with bigger text and a new step, "Where will you use Plinthio?": at home only, with Tailscale, or also from the internet. New servers start home-only; servers updated from an earlier version keep working from outside as before, and Admin → Network is where to close that off.
- **Only failed sign-ins count toward the sign-in limit**, so a household behind one address never locks itself out, while guessing still stops after ten tries.
- **Easy to tell apart:** titles you had and offloaded keep their colour, dimmed, with an **Offloaded** badge; titles the server never had go grey with a dashed outline and **Not in library**.
- **Lists are in the top bar**, after the media types (and at the end of the sidebar), instead of the account menu.
- **Lists look like the shelf:** each list is a card with its first covers, and a list's titles are a poster grid with the same header and width as the rest of the app.
- **Library Health groups missing files** by film, series or season, each with **Keep as history** or **Remove for good**. "Remove all" never removes offloaded titles.
- **Setting up HTTPS now starts with Tailscale.** Docs → PWA Mobile App Setup, Docs → Remote Access & Tailscale and the setup wizard recommend Tailscale first. Plinthio's own certificate is still there as the alternative for a home network without Tailscale.

### Fixed
- **Mistyping your password or a code in a form no longer signs you out.** Wrong answers used to look like an expired session to the app.
- **The Tailscale guide in Docs** told people to open `http://…:8088` over Tailscale and implied it was already set up. It now has the actual steps for the server and for each device, over HTTPS.

## [1.2.0] - 2026-09-29

### Added
- **Built-in HTTPS.** The Docker image now also serves HTTPS on port 8443, with a certificate from its own local certificate authority. Install that CA once per device (Docs → PWA Mobile App Setup has a download button and steps for iPhone, Android and desktop) and the "not secure" warning goes away, and the installed app gets offline reading, which browsers only allow over HTTPS. The certificate picks up the address your devices use by itself, and the setup wizard points new installs to it. The CA can only sign for private addresses and local names. Plain HTTP on 8088 keeps working. Bring your own certificate by putting `cert.pem` and `key.pem` in `/config/ssl`.
- **Sharper, lighter manga pages on phones.** The reader asks for pages at the size your screen shows them, instead of full-resolution scans of several MB each: much less data and memory, and faster page turns. Zooming in swaps to the full-size original. Downloads keep full size.
- **Reader settings are remembered.** One- or two-page spread, and scroll mode per series, are remembered on each device; the fade or flip page turn follows you to every device.
- **Faster page turns.** The reader loads the next three pages ahead (and the one behind), plus the next volume's first page near the end.
- **Report a problem.** Admins get a link (in the account menu and on Docs → Troubleshooting) that opens a GitHub bug report with the version and browser filled in.
- **Title page actions on phones** sit in a labelled "⋯" menu beside the main button, instead of a row of icons you had to guess at.

### Changed
- **Updated libraries**, including the one that sets the server's security headers. Behind a reverse proxy that serves HTTPS, browsers are now told to stick to HTTPS for a year instead of six months; with Plinthio's own HTTPS (the Docker default) that header isn't sent at all, so the plain-HTTP address keeps working.

### Fixed
- **The setup wizard stopped at step 5.** Continue did nothing on the Household step, so a new server couldn't finish setup from the wizard.
- **Swiping went the wrong way in right-to-left manga.** Swiping right now turns to the next page, as tapping the left side already did.
- **"Read Again" opened a finished volume or book on its last page.** It now starts from the beginning.
- **Downloads silently missing over http://.** The Download button now explains that downloads need HTTPS and how to set it up, instead of not appearing.
- **The manga reader reloading on phones in scroll mode.** Scroll mode loaded every page of a volume at full size at once, which ran phones out of memory until the browser reloaded the page. Now only the pages around the one you're reading are kept in memory. A swipe past the top of the reader also no longer pull-to-refreshes the page behind it.
- **The page slider and buttons in scroll mode.** The slider, previous/next buttons and arrow keys now scroll to that page, the page counter follows what's on screen, reopening resumes at your page, and progress saves as you scroll instead of only when you close the reader.
- **Title page on phones.** The Continue button stays on one line, an unrated title no longer shows an empty server rating, and the series badge and progress line are easier to read.

## [1.1.0] - 2026-09-28

### Added
- **Backdrops on title pages.** Movies and shows open under their TMDB backdrop with the title's logo on it. On a wide screen at full width, the poster sits over the backdrop and the details, episodes and cast line up beside it.
- **Full-width pages.** Pages now use the whole screen, and big displays get more posters in a row (nine across at 1920px) instead of five oversized ones. Anyone who prefers the old centred layout can pick **Contained** in Settings → Preferences → Page Width. It's per person, so a TV and a laptop can differ.
- **Opening sequence.** Admins can switch on a short Plinthio clip that plays full-screen before movies and episodes when someone presses Play, like a streaming service's intro, and the title starts the moment it ends. Replace it with your own 1–10 second MP4, or limit it to movies or shows. Off by default, always skippable, and never when resuming, before autoplayed next episodes, trailers or watch parties. Admin → Server Config → Opening Sequence.
- **Live preview in Admin → Server Config.** Theme, navigation layout, ratings, movie collections, watch parties, pause screen, server name and sign-in notice now sit beside a preview of the shelf, a title page, the sign-in screen and the player. It updates as you change each setting, and hovering a pause screen style previews it before you pick it. It uses your own movies' posters when the server has some.

### Changed
- **A new sign-in page**: the logo, a welcome and the sign-in card in one centred column over soft, slowly shifting colour, with the admin's notice at the top of the card and a show-password button. It uses no online services and shows nothing from your library before someone signs in, and it stays still for anyone who has reduced motion turned on.
- **A new logo**, in the app, on the sign-in and setup screens, and as the icon when you install Plinthio on a phone or desktop. Android gets a properly padded version so the launcher doesn't crop it.
- **Seasons as posters.** A show's or anime's seasons are picked from a row of posters (each season's own art from TMDB, or the show's poster) with a check on finished seasons, instead of plain "Season 1, Season 2" buttons.
- **Movie collections as posters.** A collection's page shows its films as a poster grid, like the shelf, instead of an episode-style list. Hover a poster to play it straight away.
- **A film always opens its own page.** With the shelf on "All movies", in Continue Watching and anywhere else a single film appears, clicking Shrek 2 opens Shrek 2 rather than the Shrek collection. Its page links to the rest of the collection.
- **Pause screens fill the screen.** Details and Cinematic are sized to the player, so the poster, title and details are large on a TV or a big monitor instead of sitting small in one corner. Bedtime's clock scales the same way.
- **Updated libraries** on the server (password hashing, file types, 7z archives, settings loading) and in the app (state management, icons), plus the build and release tooling. Nothing to do when upgrading: existing passwords keep working. `.m4b` audiobooks are now served with the correct audio type.

### Security
- **File uploads** (avatars, cover art, the opening sequence) use an updated upload library that fixes several ways a crafted request could tie up or crash the server.

### Fixed
- **A show no longer splits in two when its files spell its name differently.** Episodes from different release groups ("Farming Life in Another World" and "Farming.Life.In.Another.World") are now one show, named after its folder, with any series settings or Kids Mode entry carried over. Existing splits merge on the next scan.
- **Server name and sign-in notice save as you type**, like the other appearance settings, and the notice has a button to remove it. Before, they only saved with the button under Custom CSS, so clearing the notice could look done without being saved.
- The sign-in notice set in Server Branding now actually appears on the sign-in page, and the sign-in page greets people with the server's name.

## [1.0.0] - 2026-09-27

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
- **New title pages for movies and shows.** One hero with the poster, year · runtime · rating, tagline, full overview and Genres / Director / Writers / Studios / Network rows (no more second "About" block). A **Cast & Crew** row (photos, characters and jobs), and one Media Info panel. Shows and anime list their episodes **by season** (specials last) with a still from each episode, its own synopsis, and mark-season-watched; "Start Watching" begins at S1E1, not a special. Movie collections (Shrek, Star Wars…) list their films in release order the same way, and films are grouped into their collection automatically (with a TMDB key) once the library has two or more of it. A collection also lists the films the server doesn't have — greyed out, with a **Request** button (or "Coming 2027" for one not out yet) — on its page and in each film's "More in…" row, never on the Movies shelf; Admin → Server Config → Movie Collections turns this off. Cast, crew and studios come from TMDB the first time a page opens (with a TMDB key) and are cached; episode stills are small frames grabbed on first view and cached, two at a time at most.
- **Bigger posters and text.** Shelf and series grids show up to five posters a row instead of six (roughly a quarter larger), and the whole type scale is a notch larger (body text 13/15px instead of 12/14px).
- Multi-architecture images (x86-64 and ARM) published to `ghcr.io/oddomens/plinthio`.
- **Watch parties**: watch a movie or show together with people in other places, in sync. Start one with **Watch Together** on any movie or show and share the invite link (or its six-letter code) with anyone who has an account on the server. Play, pause and seeking stay in step for everyone; if someone's connection stalls, the party waits for them; the next episode starts for everyone together. The host decides whether only they or everyone controls playback, and can end the party for all. Includes a member list and chat. Content limits still apply — nobody can join, or be moved to, something their account can't open. Off by default: turn on under Admin → Server Config → Watch Parties, or while setting up a new server. Friends outside your home network need to be able to reach the server.
- Signing in now returns you to the page you were trying to open (an invite link, say) instead of the home page.
- **Pause screens** for movies and shows, chosen by an admin (Admin → Server Config → Pause Screen). After a couple of seconds paused: **Details** (the default — poster, title, tagline, synopsis, director and cast, time left and when it ends), **Cinematic** (a full-screen title card over the dimmed picture with cast photos and TMDB facts: original title and language, budget and box office, studio, music, keywords), **Bedtime** (a dim clock, when it ends and, for a show, when the rest of the season would) or **Simple** (just the controls). Moving the mouse or touching the screen hides it.
- **Skip buttons** in the video player, back and forward, on desktop and touch screens. Each person picks their own jumps — 5s, 10s, 15s, 30s, 1m or 5m — from the player's settings (or right-click a skip button), and they follow them to every device. The arrow keys use the same amounts. Defaults: back 10s, forward 30s.
- **Mihon**: browse and read your comics, manga and PDFs in Mihon (and other Tachiyomi forks) with its **Komga** extension — point it at your Plinthio address and sign in with your username and an API key. Turn on Komga under Mihon's Tracking and chapters you read there are marked read in Plinthio (and Plinthio's read status shows in Mihon). Kids Mode and content limits apply.
- **KOReader progress sync**: set Plinthio as KOReader's custom sync server (`/api/kosync`, username + API key). Your place in PDFs and comics syncs both ways; for EPUBs KOReader devices sync with each other and Plinthio shows how far through you are, and the web reader opens at that point. Settings → API Keys → Reading Apps has the addresses and steps. API keys made before 1.0.0 need re-creating for KOReader.
- **PDFs open in the page reader** instead of a new browser tab: page by page, with double-page spreads, zoom, bookmarks, progress and offline downloads, the same as a comic. The server renders each page once and caches it, so PDFs also work over OPDS and in sync apps. A PDF's first page becomes its cover when its folder has none, and PDFs already in the library get a page count on the next scan. Needs poppler, which the Docker image includes (error P308 if it's missing on a bare-metal install).
- **Mark read up to here**: marking a volume, book or episode finished offers to mark the unfinished ones before it too (one tap, or ignore it). Episodes skip specials unless you're marking a special.
- **Kids Mode**: mark an account as a kids account (Admin → Users → Edit) and it sees only what an admin or editor has made kids-safe — whole libraries (the **Kids** button on each library in Admin → Libraries) or single series and titles (the **Kids** button on their page). Everything else is hidden everywhere: shelves, search, Continue, lists, direct links, files, watch parties and sync apps. Admin → Libraries lists the series and titles in Kids Mode. Admins can't be kids accounts; the content limit still applies on top.

### Changed
- Media links now use a short-lived, media-only token; the session token is never put in a URL.
- A Content-Security-Policy is enabled by default (set `CSP=off` or `CSP=report-only` to diagnose).
- Faster first load: readers, players and admin pages load on demand (main bundle 1.2 MB → 275 KB).
- **Documentation**: a full guide in `docs/` — setup, configuration, every feature, reading apps, troubleshooting, the API and how the code fits together.
- **Missing files are kept until an admin removes them**, for every media type. A title whose file disappears (a drive that didn't mount, a folder being reorganised) is hidden from everyone but keeps its progress, ratings, bookmarks and list entries, and comes back by itself when the file returns. Admin → Health lists them with a **Remove from catalog** button. Previously a rescan deleted them straight away.
- Pinch-zoom is allowed across the app; the paged manga reader keeps its own zoom and pan.
- The Google Cast SDK only loads in Chromium browsers, and only when a video is opened.
- Server errors and absolute file paths are only shown to admins.
- Same-named series in different libraries or media types are kept separate.
- Install is pull-based: `docker/docker-compose.yml` uses the published image; building from source moved to `docker/docker-compose.build.yml`.
- The Docker image runs on **Node.js 24 LTS and Debian 13** (was Node.js 20, which no longer gets security fixes).
- `docker stop` and updates stop Plinthio cleanly in about a second (database closed properly) instead of waiting 10 seconds and force-killing it.
- Starting the container no longer re-owns every cached file in `config/`, which slowed each start on big libraries. The container also runs as a fixed user (`user:` / `--user`) when you set one; otherwise `PUID`/`PGID` apply as before.
- Covers, pages and other media are cached only by your browser, never by a shared proxy in between.
- GPU passthrough (`/dev/dri`) is now opt-in in `docker-compose.yml`, so the default file starts on machines without a GPU. **Intel/AMD hardware transcoding users: uncomment the `devices:`/`group_add:` lines when upgrading.**

### Security
- Updated libraries with published vulnerabilities: a crafted comic archive could exhaust the server's memory, a malformed audio file could hang a library scan, and the EPUB reader's XML parser had injection and denial-of-service bugs.
- The setup wizard can't be completed twice at once: two people submitting it at the same moment could otherwise both create an admin account.

### Fixed
- Setup no longer fails part-way (admin created, the rest missing) when two extra accounts in the wizard share a name; the repeat is skipped.
- A server error that nothing was waiting for could stop the whole server; it's now logged and the server keeps running.
- WebM videos play directly again instead of always being remuxed (the file type check didn't recognise how WebM files report themselves).
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
- Admin → Metadata: **Find Metadata** for a selection failed on anything but a few titles — one request for the whole batch outlasted the app's 15s limit. It now matches title by title with a progress bar and a Stop button, and results show on each row. Single **Auto Match** reports inline instead of in a pop-up, so you can run several back to back. A missing TMDB key (P400) or a type with no metadata source now says so plainly instead of "Something went wrong", and covers are credited to the provider they came from (not always "TMDB").
- Video (HLS) playback was refused by the server because the player also sent the media token as an Authorization header.
- Links to a filtered shelf (`/?type=…`, e.g. from breadcrumbs) were overridden by the startup default category.
- The sign-in rate limiter counted the calls every page load makes, so a household behind one IP could be locked out after a few dozen reloads; only real sign-in attempts count now.
- One viewer closing a video stopped the stream for everyone else watching the same title.
- Login response time revealed which usernames exist; usernames are now validated.
