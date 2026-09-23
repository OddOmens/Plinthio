<template>
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <!-- Primary navigation: sidebar layout keeps global nav present on this page too -->
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0">
    <!-- Top Bar (width matches the max-w-[1440px] content container below, same as Admin/Settings) -->
    <header class="bg-card/60 backdrop-blur-md border-b border-border sticky top-0 z-30 safe-top transition-colors">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <router-link to="/" class="flex items-center gap-2 hover:opacity-80 transition min-w-0">
            <div class="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm flex-shrink-0">
              S
            </div>
            <span class="font-semibold text-sm tracking-tight truncate">{{ customizationStore.serverName }}</span>
          </router-link>
          <span class="text-xs text-muted-foreground hidden sm:inline flex-shrink-0">/</span>
          <span class="text-xs font-medium text-muted-foreground hidden sm:inline flex-shrink-0">Documentation</span>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <router-link
            to="/"
            class="text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition flex items-center gap-1.5"
          >
            <ArrowLeft class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Back to Library</span>
          </router-link>
        </div>
      </div>
    </header>

    <!-- Main Container with Sidebar + Content -->
    <div class="flex-1 max-w-[1440px] w-full mx-auto flex flex-col md:flex-row">
      <!-- Sidebar Navigation -->
      <aside class="w-full md:w-64 border-b md:border-b-0 md:border-r border-border p-4 sm:p-6 space-y-6 flex-shrink-0">
        <div v-for="group in navGroups" :key="group.id">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{{ group.label }}</div>
          <nav class="space-y-1">
            <button
              v-for="item in group.items"
              :key="item.id"
              @click="activeSection = item.id"
              :class="activeSection === item.id ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'"
              class="w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2.5 transition"
            >
              <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
              <span>{{ item.title }}</span>
            </button>
          </nav>
        </div>

        <div class="p-3.5 rounded-xl bg-muted/40 border border-border text-xs space-y-1.5">
          <div class="font-semibold text-foreground flex items-center gap-1.5">
            <Radio class="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>Server Status</span>
          </div>
          <p class="text-[11px] text-muted-foreground">Version 0.4.0 (PWA Ready)</p>
          <div class="text-[11px] font-mono text-muted-foreground truncate">
            API: /api/health
          </div>
        </div>
      </aside>

      <!-- Content Area -->
      <main class="flex-1 min-w-0 p-6 sm:p-10 max-w-4xl space-y-10">

        <!-- SECTION: Overview -->
        <section v-if="activeSection === 'overview'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Getting Started with Plinthio</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Plinthio is a fast, lightweight, self-hosted media server and modern PWA tailored for audiobooks, manga, comics,
              books, and video (movies, TV shows, and anime). It scans your existing folders directly — nothing gets
              copied, converted, or re-encoded on ingest — and builds a searchable catalog with covers, per-user reading
              and playback progress, bookmarks, and optional metadata enrichment.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="p-4 rounded-xl border border-border bg-card">
              <Headphones class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">Audiobooks</div>
              <p class="text-[11px] text-muted-foreground mt-1">M4B with chapter markers, MP3, FLAC, background playback, and Apple Music style full-screen player.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card">
              <Layers class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">Manga & Comics</div>
              <p class="text-[11px] text-muted-foreground mt-1">Direct CBZ & ZIP in-memory decompression, dual-page mode, right-to-left reading, and instant page caching.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card">
              <BookOpen class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">Books & Documents</div>
              <p class="text-[11px] text-muted-foreground mt-1">Standard EPUB and PDF reader with bookmarking, notes, and cross-device reading progress synchronization.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card">
              <Film class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">Movies</div>
              <p class="text-[11px] text-muted-foreground mt-1">MP4, MKV, and WebM with byte-range streaming, scrubbing, and resume-from-position.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card">
              <Tv class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">TV Shows</div>
              <p class="text-[11px] text-muted-foreground mt-1">Season and episode grouping with per-episode progress, so continue-watching always lands on the right episode.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card">
              <Sparkles class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">Anime</div>
              <p class="text-[11px] text-muted-foreground mt-1">Treated as its own library type so it can be filtered, browsed, and metadata-matched separately from live-action.</p>
            </div>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">How Libraries Work</h2>
            <p class="text-xs text-muted-foreground leading-relaxed">
              A <strong class="text-foreground">Library</strong> is a folder on disk mapped to one media type
              (Audiobooks, Manga & Comics, eBooks, TV Shows, Movies, or Anime). Add libraries from
              <strong class="text-foreground">Admin &rarr; Libraries</strong> — point Plinthio at a folder, pick the type,
              and it scans immediately. Re-running a scan is always safe: it diffs against what's already indexed,
              detects renamed or moved files by content, adds anything new, and removes catalog entries for files
              that no longer exist on disk (without touching the files themselves).
            </p>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Deleting a library from Plinthio only removes its catalog entries (titles, covers, metadata) — it never
              touches files on your filesystem. Reading progress and bookmarks are preserved by file identity, so
              re-adding the same folder and re-scanning re-attaches them automatically.
            </p>

            <h2 class="text-base font-semibold text-foreground pt-2">Docker Storage Layout</h2>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Plinthio organizes data into configuration, metadata database, and read-only media mounts. Only the
              paths under <code class="text-foreground bg-muted px-1 rounded">/app/data</code> need to be backed up
              to preserve your server's state (users, progress, bookmarks, custom folders, settings) — your media
              files live wherever you mount them and are never modified.
            </p>
            <div class="bg-muted/40 border border-border rounded-xl p-4 font-mono text-xs text-foreground space-y-1 overflow-x-auto">
              <div class="whitespace-nowrap"><span class="text-primary">/app/data/plinthio.db</span> <span class="text-muted-foreground"># SQLite database with WAL mode</span></div>
              <div class="whitespace-nowrap"><span class="text-primary">/app/data/covers/</span> <span class="text-muted-foreground"># Extracted album art & book/show covers</span></div>
              <div class="whitespace-nowrap"><span class="text-primary">/app/data/thumbnails/</span> <span class="text-muted-foreground"># Cached video thumbnail previews</span></div>
              <div class="whitespace-nowrap"><span class="text-primary">/app/data/backups/</span> <span class="text-muted-foreground"># Scheduled & manual database snapshots</span></div>
              <div class="whitespace-nowrap"><span class="text-primary">/app/data/jwt.secret</span> <span class="text-muted-foreground"># High-entropy random JWT encryption key</span></div>
              <div class="whitespace-nowrap"><span class="text-primary">/media/...</span> <span class="text-muted-foreground"># Mounted media directories on your host (read-only is fine)</span></div>
            </div>

            <h2 class="text-base font-semibold text-foreground pt-2">Requirements & First-Time Setup</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <li>Docker (or Docker Compose) is the supported way to run Plinthio — see <code class="text-foreground bg-muted px-1 rounded">docker/docker-compose.yml</code> in the repository.</li>
              <li>On first launch, visiting the server with no admin account yet redirects to a one-time <strong class="text-foreground">Setup</strong> screen to create the first admin user.</li>
              <li>After setup, sign in and add your first library from <strong class="text-foreground">Admin &rarr; Libraries</strong> to start scanning.</li>
              <li>No external database is required — everything is stored in a single SQLite file with write-ahead logging enabled for safe concurrent access.</li>
            </ul>
          </div>
        </section>

        <!-- SECTION: Supported Media & Metadata -->
        <section v-if="activeSection === 'media'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Supported Media & Metadata</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Every media type Plinthio indexes, the file formats it recognizes, and where its cover art and
              descriptive metadata come from.
            </p>
          </div>

          <div class="space-y-3">
            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Headphones class="w-4 h-4 text-primary" /> Audiobooks
              </div>
              <p class="text-xs text-muted-foreground">Formats: <code class="text-foreground bg-muted px-1 rounded">.m4b</code>, <code class="text-foreground bg-muted px-1 rounded">.mp3</code>, <code class="text-foreground bg-muted px-1 rounded">.flac</code>. Chapter markers embedded in M4B files are read directly and exposed in the player. Cover art is extracted from embedded album art when present.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Layers class="w-4 h-4 text-primary" /> Manga & Comics
              </div>
              <p class="text-xs text-muted-foreground">Formats: <code class="text-foreground bg-muted px-1 rounded">.cbz</code>, <code class="text-foreground bg-muted px-1 rounded">.zip</code>. Pages are decompressed in-memory on demand — no extraction to disk. Works out of the box with <strong class="text-foreground">MangaDex</strong> as a free metadata source, no API key required.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <BookOpen class="w-4 h-4 text-primary" /> Books & eBooks
              </div>
              <p class="text-xs text-muted-foreground">Formats: <code class="text-foreground bg-muted px-1 rounded">.epub</code>, <code class="text-foreground bg-muted px-1 rounded">.pdf</code>. Works out of the box with <strong class="text-foreground">Google Books</strong> and <strong class="text-foreground">Open Library</strong> for metadata and cover lookups, no API key required.</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Film class="w-4 h-4 text-primary" /> Movies, <Tv class="w-4 h-4 text-primary" /> TV Shows &amp; <Sparkles class="w-4 h-4 text-primary" /> Anime
              </div>
              <p class="text-xs text-muted-foreground">
                Formats: <code class="text-foreground bg-muted px-1 rounded">.mp4</code>, <code class="text-foreground bg-muted px-1 rounded">.mkv</code>, <code class="text-foreground bg-muted px-1 rounded">.webm</code>.
                Streaming uses HTTP range requests for scrubbing; content that a browser can't play natively is transcoded on the fly.
                Metadata and artwork use <strong class="text-foreground">TMDB (The Movie Database)</strong>, which needs a free personal API key
                configured once by an admin under <strong class="text-foreground">Admin &rarr; Server Config &rarr; External Metadata Providers</strong>.
                Without a key configured, these three libraries still scan and stream fine — they simply won't get automatic
                posters, summaries, or cast/season data.
              </p>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <Info class="w-4 h-4 text-primary" />
              <span>Applying & Overriding Metadata</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Admins and Editors can search external providers and apply a match to any item, or upload a custom cover
              directly, from an item's detail view. Manual edits are never overwritten by a re-scan — a scan only fills
              in fields that are still empty.
            </p>
          </div>
        </section>

        <!-- SECTION: User Roles & Permissions -->
        <section v-if="activeSection === 'roles'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">User Roles & Permissions</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Every account on the server has exactly one role, controlling what they can see and change.
            </p>
          </div>

          <div class="space-y-3">
            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <ShieldCheck class="w-4 h-4 text-primary" /> Admin
              </div>
              <p class="text-xs text-muted-foreground">
                Full control: manage libraries and trigger scans, create/edit/delete other users and reset their
                passwords, view live system logs and server-wide statistics, configure global settings (theme,
                navigation layout, custom CSS, TMDB key, database backups), plus everything an Editor and Viewer can do.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <PenSquare class="w-4 h-4 text-amber-500" /> Editor
              </div>
              <p class="text-xs text-muted-foreground">
                Everything a Viewer can do, plus editing shared item metadata that every user sees — title, author,
                series, covers, and applying external metadata matches. Editors cannot manage libraries, users, or
                server settings.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <EyeIcon class="w-4 h-4" /> Viewer
              </div>
              <p class="text-xs text-muted-foreground">
                Can browse, read, listen, and watch. Reading/listening/watching progress, bookmarks, hidden items, and
                custom folders are all private to each account — a Viewer's progress never affects or appears for
                anyone else.
              </p>
            </div>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">Managing Accounts (Admin Only)</h2>
            <p class="text-xs text-muted-foreground leading-relaxed">
              From <strong class="text-foreground">Admin &rarr; Users</strong> you can:
            </p>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <li><strong class="text-foreground">Add User</strong> — create a new account with a username, initial password, and role.</li>
              <li><strong class="text-foreground">Change role</strong> — use the role dropdown next to any user (you cannot change your own role, so the server always keeps at least one admin able to manage roles).</li>
              <li><strong class="text-foreground">Edit</strong> (pencil icon) — rename a user's account and/or reset their password on their behalf, without needing their current password. Resetting a password immediately signs that user out everywhere and requires them to log in again with the new one.</li>
              <li><strong class="text-foreground">Delete</strong> — permanently removes the account (you cannot delete your own account).</li>
            </ul>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Any user can change their own password from <strong class="text-foreground">Settings &rarr; Security</strong>, which
              does require their current password.
            </p>
          </div>
        </section>

        <!-- SECTION: PWA Mobile Install -->
        <section v-if="activeSection === 'pwa'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Mobile App & PWA Installation</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Install Plinthio directly to your iOS or Android home screen for a native app experience with offline shell, edge-to-edge layout, and full media lockscreen controls.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <!-- iOS Safari -->
            <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
              <div class="flex items-center gap-2 text-foreground font-semibold text-sm">
                <Smartphone class="w-4 h-4 text-primary" />
                <span>Apple iOS (iPhone & iPad)</span>
              </div>
              <ol class="text-xs text-muted-foreground space-y-2.5 list-decimal list-inside leading-relaxed">
                <li>Open <strong>Safari</strong> and navigate to your Plinthio address (e.g. <code class="text-foreground bg-muted px-1.5 py-0.5 rounded break-all">http://100.x.x.x:8088</code>).</li>
                <li>Tap the <strong>Share</strong> button (the square with an arrow pointing upward) at the bottom toolbar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top right corner.</li>
                <li>Launch the app from your home screen. It will open without browser address bars in full-screen native mode!</li>
              </ol>
              <p class="text-[11px] text-muted-foreground">Must be added from Safari — Chrome and Firefox on iOS use Safari's engine but do not expose the "Add to Home Screen" install flow.</p>
            </div>

            <!-- Android Chrome -->
            <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
              <div class="flex items-center gap-2 text-foreground font-semibold text-sm">
                <Smartphone class="w-4 h-4 text-primary" />
                <span>Android (Chrome & Firefox)</span>
              </div>
              <ol class="text-xs text-muted-foreground space-y-2.5 list-decimal list-inside leading-relaxed">
                <li>Open <strong>Google Chrome</strong> and navigate to your Plinthio URL.</li>
                <li>Tap the <strong>three dots</strong> menu in the upper-right corner.</li>
                <li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Confirm the prompt. Plinthio will install into your app drawer with offline caching and background audio support.</li>
              </ol>
              <p class="text-[11px] text-muted-foreground">Chrome may also show an automatic "Install Plinthio" banner or address-bar icon the first time you visit, once the manifest and service worker have loaded.</p>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck class="w-4 h-4 text-emerald-500" />
              <span>iOS Safe Area & Deprecation Notices</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Plinthio conforms to Apple's latest Web App guidelines, using modern <code class="text-foreground bg-muted px-1 rounded">&lt;meta name="mobile-web-app-capable" content="yes"&gt;</code> and CSS viewport safe-area insets (<code class="text-foreground bg-muted px-1 rounded">env(safe-area-inset-top)</code>) to prevent notch and home-bar overlap.
            </p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">What the Installed App Gives You</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <li><strong class="text-foreground">Lockscreen & background controls</strong> for audiobook playback (play/pause, skip, chapter title) via the Media Session API.</li>
              <li><strong class="text-foreground">Offline app shell</strong> — the interface itself loads instantly even on a flaky connection; your media still streams live from your server.</li>
              <li><strong class="text-foreground">Edge-to-edge layout</strong> with iOS home indicator and notch-safe spacing, plus mobile category pills and touch targets sized for one-handed use.</li>
            </ul>
          </div>
        </section>

        <!-- SECTION: Remote Access (Mobile Data / Outside Wi-Fi) -->
        <section v-if="activeSection === 'remote'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Accessing Plinthio Outside Your Wi-Fi</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Securely connect to your libraries while on mobile data or traveling without exposing vulnerable open ports to the public internet.
            </p>
          </div>

          <!-- Method 1: Tailscale (Highlighted) -->
          <div class="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5 space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs flex-shrink-0">
                  VPN
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-foreground">Option 1: Tailscale (Recommended & Easiest)</h3>
                  <p class="text-[11px] text-muted-foreground">Zero-config, encrypted WireGuard mesh VPN. No router port forwarding required.</p>
                </div>
              </div>
              <span class="text-[10px] bg-primary text-primary-foreground font-semibold px-2 py-0.5 rounded-full uppercase">
                Recommended
              </span>
            </div>

            <div class="text-xs text-foreground space-y-2">
              <p>Your Plinthio server is already accessible on the host's Tailnet at:</p>
              <div class="p-2.5 rounded-lg bg-background border border-border font-mono text-xs flex items-center justify-between gap-2 overflow-x-auto">
                <span class="whitespace-nowrap">http://100.x.x.x:8088</span>
                <span class="text-emerald-500 font-sans text-[11px] font-medium flex-shrink-0">Ready</span>
              </div>
              <div class="pt-2 text-xs text-muted-foreground space-y-1.5">
                <div>1. Install the free <strong>Tailscale</strong> app on your iPhone or Android phone.</div>
                <div>2. Sign in with the same account used on your host machine.</div>
                <div>3. Open Safari or Chrome on your phone and open <code class="text-foreground bg-muted px-1.5 py-0.5 rounded break-all">http://100.x.x.x:8088</code>. You will connect instantly over 5G/LTE just like local Wi-Fi!</div>
              </div>
            </div>
          </div>

          <!-- Method 2: Cloudflare Tunnels -->
          <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
            <h3 class="text-sm font-semibold text-foreground">Option 2: Cloudflare Tunnels (Public Domain)</h3>
            <p class="text-xs text-muted-foreground">
              Map a custom domain (e.g. <code class="text-foreground bg-muted px-1 rounded">media.yourdomain.com</code>) to your home server without opening router ports.
            </p>
            <div class="bg-muted/40 border border-border rounded-lg p-3 font-mono text-xs space-y-1 overflow-x-auto">
              <div class="text-muted-foreground whitespace-nowrap"># 1. Install cloudflared on the host</div>
              <div class="whitespace-nowrap">curl -L https://pkg.cloudflare.com/cloudflared.deb -o cloudflared.deb && sudo dpkg -i cloudflared.deb</div>
              <div class="text-muted-foreground pt-1 whitespace-nowrap"># 2. Authenticate & create a tunnel</div>
              <div class="whitespace-nowrap">cloudflared tunnel login</div>
              <div class="whitespace-nowrap">cloudflared tunnel create plinthio</div>
              <div class="text-muted-foreground pt-1 whitespace-nowrap"># 3. Route tunnel to localhost:8088</div>
              <div class="whitespace-nowrap">cloudflared tunnel run --url http://localhost:8088 plinthio</div>
            </div>
            <p class="text-[11px] text-muted-foreground">
              Because this exposes Plinthio to the public internet, make sure every account has a strong password —
              anyone with the URL can reach the login screen.
            </p>
          </div>

          <!-- Method 3: Caddy / Nginx -->
          <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
            <h3 class="text-sm font-semibold text-foreground">Option 3: Reverse Proxy with SSL (Caddy)</h3>
            <p class="text-xs text-muted-foreground">
              If you have a static IP or dynamic DNS with ports 80/443 forwarded, Caddy provides automatic HTTPS:
            </p>
            <div class="bg-muted/40 border border-border rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <div class="text-muted-foreground whitespace-nowrap"># /etc/caddy/Caddyfile</div>
              <div class="whitespace-nowrap">plinthio.yourdomain.com {</div>
              <div class="pl-4 whitespace-nowrap">reverse_proxy localhost:8088</div>
              <div class="whitespace-nowrap">}</div>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-500" />
              <span>Avoid: Plain Port Forwarding</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Forwarding port 8088 directly on your router without a VPN or reverse-proxy/TLS in front of it exposes
              an unencrypted login form to the open internet. Prefer Tailscale (private) or a reverse proxy with
              HTTPS (public) instead.
            </p>
          </div>
        </section>

        <!-- SECTION: Keyboard Shortcuts & Player Controls -->
        <section v-if="activeSection === 'shortcuts'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Keyboard Shortcuts & Player Controls</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Every reader and player supports full-keyboard navigation on desktop, alongside the on-screen tap/swipe controls on mobile.
            </p>
          </div>

          <div class="space-y-4">
            <div class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Layers class="w-4 h-4 text-primary" /> Manga & Comic Reader
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&larr;</kbd><span class="text-muted-foreground">Previous page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&rarr;</kbd><span class="text-muted-foreground">Next page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Space</kbd><span class="text-muted-foreground">Next page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Esc</kbd><span class="text-muted-foreground">Close reader</span></div>
              </div>
              <p class="text-[11px] text-muted-foreground">
                Left/right are automatically swapped when Right-to-Left mode is enabled, so the arrow keys always match
                the direction pages visually turn. Swipe left/right works identically on touch devices.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Film class="w-4 h-4 text-primary" /> Video Player (Movies, TV, Anime)
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Space</kbd><span class="text-muted-foreground">Play / pause</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&larr;</kbd><span class="text-muted-foreground">Seek back 10s</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&rarr;</kbd><span class="text-muted-foreground">Seek forward 10s</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Esc</kbd><span class="text-muted-foreground">Close player</span></div>
              </div>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <BookOpen class="w-4 h-4 text-primary" /> EPUB Book Reader
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&larr;</kbd><span class="text-muted-foreground">Previous page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">&rarr;</kbd><span class="text-muted-foreground">Next page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Space</kbd><span class="text-muted-foreground">Next page</span></div>
                <div class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px]">Esc</kbd><span class="text-muted-foreground">Close settings / reader</span></div>
              </div>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Headphones class="w-4 h-4 text-primary" /> Audiobook Player
              </div>
              <p class="text-xs text-muted-foreground">
                Controlled via tap targets in the full-screen player (play/pause, skip forward/back, chapter list,
                playback speed) and via your OS's lockscreen/notification media controls once installed as a PWA —
                no dedicated keyboard shortcuts, since it's designed for background listening.
              </p>
            </div>
          </div>
        </section>

        <!-- SECTION: Backups & Data Safety -->
        <section v-if="activeSection === 'backups'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Backups & Data Safety</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Everything Plinthio knows — users, libraries, reading/watching progress, bookmarks, custom folders, and
              settings — lives in one SQLite database. Back it up regularly.
            </p>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-500" />
              <span>What a Backup Does and Doesn't Cover</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">
              A database backup captures the catalog and every user's data. It does <strong class="text-foreground">not</strong>
              include cover images on disk or your media files themselves — back those up separately from wherever your
              library folders and the server's <code class="text-foreground bg-muted px-1 rounded">/app/data</code> volume live.
              Deleting a library removes its catalog data immediately and permanently; a recent backup is the only way
              to undo that.
            </p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">Automatic Backups (Admin Only)</h2>
            <p class="text-xs text-muted-foreground leading-relaxed">
              From <strong class="text-foreground">Admin &rarr; Server Config &rarr; Database Backup</strong>, enable automatic
              backups and choose:
            </p>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <li><strong class="text-foreground">Frequency</strong> — every 6 or 12 hours, daily, every 3 days, or weekly.</li>
              <li><strong class="text-foreground">Retention</strong> — how many recent backups to keep on disk (older ones are pruned automatically as new ones are created).</li>
            </ul>
            <h2 class="text-base font-semibold text-foreground pt-2">Manual Backups</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <li><strong class="text-foreground">Backup Now</strong> — takes an immediate snapshot and adds it to the stored backups list.</li>
              <li><strong class="text-foreground">Download a Snapshot</strong> — takes a fresh snapshot and downloads it straight to your browser, useful before a risky change (deleting a library, a version upgrade).</li>
              <li>Any stored backup can be downloaded or deleted individually from the list.</li>
            </ul>
          </div>
        </section>

        <!-- SECTION: REST API Reference -->
        <section v-if="activeSection === 'api'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Developer REST API</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Integrate external scripts, widgets, Home Assistant, or third-party players into Plinthio.
            </p>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="font-semibold text-xs text-foreground">Authentication</div>
            <p class="text-xs text-muted-foreground">
              Pass your API key in the <code class="text-foreground bg-muted px-1 rounded">X-API-Key</code> HTTP header. Create and manage keys in <strong>Settings &rarr; API Keys</strong>. Browser requests instead use a JWT Bearer token issued at login, which most media URLs also accept as a <code class="text-foreground bg-muted px-1 rounded">?token=</code> query parameter (needed for plain <code class="text-foreground bg-muted px-1 rounded">&lt;img&gt;</code>/<code class="text-foreground bg-muted px-1 rounded">&lt;video&gt;</code> tags, which can't set headers).
            </p>
            <div class="bg-background border border-border rounded-lg p-2.5 font-mono text-xs overflow-x-auto whitespace-nowrap">
              curl -H "X-API-Key: plinthio_live_..." http://localhost:8088/api/items
            </div>
            <p class="text-[11px] text-muted-foreground">
              All API endpoints are rate-limited, and each request is scoped to the key's owning user — an API key
              inherits that user's role and only sees what they can see.
            </p>
          </div>

          <div class="space-y-5">
            <div>
              <h2 class="text-sm font-semibold text-foreground mb-2.5">Library & Catalog</h2>
              <div class="space-y-2.5 text-xs">
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/items</span>
                  </div>
                  <p class="text-muted-foreground">List media items. Query params: <code class="text-foreground bg-muted px-1">type</code>, <code class="text-foreground bg-muted px-1">search</code>, <code class="text-foreground bg-muted px-1">author</code>, <code class="text-foreground bg-muted px-1">series</code>, <code class="text-foreground bg-muted px-1">limit</code>, <code class="text-foreground bg-muted px-1">offset</code>.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/items/:id</span>
                  </div>
                  <p class="text-muted-foreground">Full detail for a single item, including metadata, series/author links, and progress for the requesting user.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/items/series/:name</span>
                  </div>
                  <p class="text-muted-foreground">All entries belonging to a series, in reading/watch order.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-blue-500/10 text-blue-600 font-bold px-1.5 py-0.5 rounded">POST</span>
                    <span class="text-foreground break-all">/api/items/:id/hide</span>
                  </div>
                  <p class="text-muted-foreground">Hide an item from your own library view (does not affect other users). <code class="text-foreground bg-muted px-1">unhide</code> reverses it.</p>
                </div>
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-foreground mb-2.5">Streaming & Reading</h2>
              <div class="space-y-2.5 text-xs">
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/media/stream/:id</span>
                  </div>
                  <p class="text-muted-foreground">Audio stream endpoint supporting HTTP 206 Partial Content range requests and query token (<code class="text-foreground bg-muted px-1">?token=...</code>).</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/media/video/:id/stream</span>
                  </div>
                  <p class="text-muted-foreground">Video streaming endpoint with range scrubbing for MP4, MKV, and WebM.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/media/video/:id/playback-info</span>
                  </div>
                  <p class="text-muted-foreground">Reports whether a file needs on-the-fly transcoding before the client requests the stream.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/media/manga/:id/pages</span>
                  </div>
                  <p class="text-muted-foreground">Returns total pages and image manifest for CBZ/ZIP archives.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/media/book/:id/file</span>
                  </div>
                  <p class="text-muted-foreground">Serves the raw EPUB/PDF file for the in-browser reader.</p>
                </div>
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-foreground mb-2.5">Progress & Bookmarks</h2>
              <div class="space-y-2.5 text-xs">
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-blue-500/10 text-blue-600 font-bold px-1.5 py-0.5 rounded">POST</span>
                    <span class="text-foreground break-all">/api/progress/:itemId</span>
                  </div>
                  <p class="text-muted-foreground">Update playback/reading progress. JSON body: <code class="text-foreground bg-muted px-1">&#123; "currentTime": 120.5, "isFinished": false &#125;</code>.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/progress/continue</span>
                  </div>
                  <p class="text-muted-foreground">The "Continue" shelf — every in-progress item for the current user, most recent first.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-blue-500/10 text-blue-600 font-bold px-1.5 py-0.5 rounded">POST</span>
                    <span class="text-foreground break-all">/api/bookmarks</span>
                  </div>
                  <p class="text-muted-foreground">Create a timestamped or paginated bookmark with an optional note.</p>
                </div>
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-foreground mb-2.5">Admin</h2>
              <div class="space-y-2.5 text-xs">
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/stats/admin</span>
                  </div>
                  <p class="text-muted-foreground">Server-wide totals and a full per-media-type breakdown (storage, counts, authors, series). Requires the Admin role.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-amber-500/10 text-amber-600 font-bold px-1.5 py-0.5 rounded">PATCH</span>
                    <span class="text-foreground break-all">/api/users/:id</span>
                  </div>
                  <p class="text-muted-foreground">Update a user's username and/or role. Requires the Admin role.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-amber-500/10 text-amber-600 font-bold px-1.5 py-0.5 rounded">PATCH</span>
                    <span class="text-foreground break-all">/api/users/:id/password</span>
                  </div>
                  <p class="text-muted-foreground">Reset another user's password. Requires the Admin role; no current password needed.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-blue-500/10 text-blue-600 font-bold px-1.5 py-0.5 rounded">POST</span>
                    <span class="text-foreground break-all">/api/libraries/:id/scan</span>
                  </div>
                  <p class="text-muted-foreground">Triggers an immediate re-scan of a library. Requires the Admin role.</p>
                </div>
                <div class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span class="bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.5 rounded">GET</span>
                    <span class="text-foreground break-all">/api/settings/backup</span>
                  </div>
                  <p class="text-muted-foreground">Downloads an on-demand database backup file. Requires the Admin role.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION: Jellyfin Custom CSS -->
        <section v-if="activeSection === 'css'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Jellyfin-Style Custom CSS</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Customize the appearance of Plinthio with custom CSS injected live across your server.
            </p>
          </div>

          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-foreground">CSS Custom Properties</h2>
            <div class="p-4 rounded-xl bg-card border border-border font-mono text-xs space-y-2 overflow-x-auto">
              <div class="text-muted-foreground whitespace-nowrap">/* Shadcn Theme Variables (HSL format) */</div>
              <div class="whitespace-nowrap">--background: 240 10% 3.9%;</div>
              <div class="whitespace-nowrap">--foreground: 0 0% 98%;</div>
              <div class="whitespace-nowrap">--primary: 240 5.9% 10%;</div>
              <div class="whitespace-nowrap">--card: 240 10% 5.5%;</div>
              <div class="whitespace-nowrap">--border: 240 3.7% 15.9%;</div>
              <div class="whitespace-nowrap">--radius: 0.75rem;</div>
            </div>

            <h2 class="text-sm font-semibold text-foreground">Example Custom CSS Snippets</h2>

            <div class="space-y-3">
              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">Make Book Covers Extra Rounded & Glowing</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[11px] overflow-x-auto text-foreground">
.group img {
  border-radius: 1rem !important;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
  transition: transform 0.2s ease;
}
.group:hover img {
  transform: translateY(-4px);
}
</pre>
              </div>

              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">Compact Density Mode</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[11px] overflow-x-auto text-foreground">
body {
  font-size: 11px !important;
}
header {
  height: 2.75rem !important;
}
</pre>
              </div>

              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">Hide the Search Bar</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[11px] overflow-x-auto text-foreground">
header input[type="text"] {
  display: none !important;
}
</pre>
              </div>

              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">Custom Accent Color Override</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[11px] overflow-x-auto text-foreground">
:root {
  --primary: 280 85% 60% !important;
}
</pre>
              </div>
            </div>

            <p class="text-xs text-muted-foreground">
              To apply custom CSS, go to <strong>Admin &rarr; Server Config &rarr; Custom CSS Injection</strong> (Admin only), paste your rules into the editor, use <strong>Test Preview</strong> to check it live in your current tab before saving, then <strong>Save Branding & CSS</strong> to push it to every connected client.
            </p>
          </div>
        </section>

        <!-- SECTION: Troubleshooting -->
        <section v-if="activeSection === 'troubleshooting'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Troubleshooting & FAQ</h1>
            <p class="text-sm text-muted-foreground mt-1.5">
              Common issues and where to look first.
            </p>
          </div>

          <div class="space-y-3">
            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">A library scan finished but items are missing</div>
              <p class="text-xs text-muted-foreground">
                Check <strong class="text-foreground">Admin &rarr; Logs</strong> for warnings during that scan — unsupported
                file extensions and unreadable archives are skipped and logged rather than failing the whole scan.
                Confirm the file's extension matches the library's expected formats (see <strong class="text-foreground">Supported Media & Metadata</strong>).
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">Movies/Shows/Anime have no posters or descriptions</div>
              <p class="text-xs text-muted-foreground">
                These three types use TMDB for metadata, which needs a free API key set by an admin under
                <strong class="text-foreground">Admin &rarr; Server Config &rarr; External Metadata Providers</strong>. Without a
                key, content still scans and streams — it just won't be auto-matched.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">A user forgot their password</div>
              <p class="text-xs text-muted-foreground">
                Any admin can reset it for them from <strong class="text-foreground">Admin &rarr; Users</strong> using the edit
                (pencil) button — no need to know their old password. This immediately signs them out everywhere.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">Video won't play / keeps buffering</div>
              <p class="text-xs text-muted-foreground">
                Some codecs and containers aren't supported natively by browsers and are transcoded on the fly, which
                is more CPU-intensive than direct streaming — playback starts more slowly and quality may briefly step
                down under load. This is expected for those files; a wired connection or a lower-bitrate source
                generally helps.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">I deleted a library by mistake</div>
              <p class="text-xs text-muted-foreground">
                Your media files are untouched — re-add a library pointing at the same folder and scan it. Reading
                progress and bookmarks re-attach automatically by file identity. If you also need the exact prior
                metadata edits, restore from a <strong class="text-foreground">database backup</strong> instead.
              </p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">Can't reach the server from my phone away from home</div>
              <p class="text-xs text-muted-foreground">
                See <strong class="text-foreground">Remote Access & Tailscale</strong> — a raw local IP like
                <code class="text-foreground bg-muted px-1 rounded">192.168.x.x</code> only works on the same Wi-Fi network.
              </p>
            </div>
          </div>
        </section>

      </main>
    </div>
  </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useCustomizationStore } from '../stores/customization';
import Sidebar from '../components/Sidebar.vue';
import {
  BookOpen,
  Headphones,
  Layers,
  Smartphone,
  Globe,
  Code,
  Palette,
  ArrowLeft,
  Radio,
  ShieldCheck,
  Film,
  Tv,
  Sparkles,
  Info,
  Users,
  PenSquare,
  Eye as EyeIcon,
  Keyboard,
  Save,
  AlertTriangle,
  LifeBuoy
} from 'lucide-vue-next';

const customizationStore = useCustomizationStore();
const router = useRouter();
// Global nav layout (topnav vs sidebar) is a server-wide admin setting; these pages keep
// their own header either way, so the sidebar just sits alongside it.
const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}

const activeSection = ref('overview');

// Grouped so the nav stays a fixed, predictable width (w-64) no matter how many guides
// get added — new topics join an existing group instead of growing a single flat list.
const navGroups = [
  {
    id: 'basics',
    label: 'Basics',
    items: [
      { id: 'overview', title: 'Overview & Storage', icon: BookOpen },
      { id: 'media', title: 'Supported Media', icon: Film },
      { id: 'roles', title: 'User Roles & Permissions', icon: Users }
    ]
  },
  {
    id: 'using',
    label: 'Using Plinthio',
    items: [
      { id: 'pwa', title: 'PWA Mobile App Setup', icon: Smartphone },
      { id: 'remote', title: 'Remote Access & Tailscale', icon: Globe },
      { id: 'shortcuts', title: 'Keyboard Shortcuts', icon: Keyboard }
    ]
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { id: 'backups', title: 'Backups & Data Safety', icon: Save },
      { id: 'api', title: 'REST API & Webhooks', icon: Code },
      { id: 'css', title: 'Custom CSS Styling', icon: Palette }
    ]
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'troubleshooting', title: 'Troubleshooting & FAQ', icon: LifeBuoy }
    ]
  }
];
</script>
