<template>
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <!-- Primary navigation: sidebar layout keeps global nav present on this page too -->
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0">
    <!-- Top Bar (width matches the page-width content container below, same as Admin/Settings) -->
    <header class="bg-card/60 backdrop-blur-md border-b border-border sticky top-0 z-30 safe-top transition-colors">
      <div class="page-width mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <router-link to="/" class="flex items-center gap-2 hover:opacity-80 transition min-w-0">
            <AppLogo class="w-8 h-8 flex-shrink-0" />
            <span class="font-semibold text-sm tracking-tight truncate">{{ customizationStore.serverName }}</span>
          </router-link>
          <span class="text-xs text-muted-foreground hidden sm:inline flex-shrink-0">/</span>
          <span class="text-xs font-medium text-muted-foreground hidden sm:inline flex-shrink-0">{{ $t('docs.page.title') }}</span>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <router-link
            to="/"
            class="text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition flex items-center gap-1.5"
          >
            <ArrowLeft class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">{{ $t('docs.page.backToLibrary') }}</span>
          </router-link>
        </div>
      </div>
    </header>

    <!-- Main Container with Sidebar + Content -->
    <div class="flex-1 page-width w-full mx-auto flex flex-col md:flex-row">
      <!-- Sidebar Navigation -->
      <aside class="w-full md:w-64 border-b md:border-b-0 md:border-r border-border p-4 sm:p-6 space-y-6 flex-shrink-0">
        <div v-for="group in navGroups" :key="group.id">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{{ $t(`docs.nav.groups.${group.id}`) }}</div>
          <nav class="space-y-1">
            <button
              v-for="item in group.items"
              :key="item.id"
              @click="activeSection = item.id"
              :class="activeSection === item.id ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'"
              class="w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2.5 transition"
            >
              <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
              <span>{{ $t(`docs.nav.items.${item.id}`) }}</span>
            </button>
          </nav>
        </div>

        <div class="p-3.5 rounded-xl bg-muted/40 border border-border text-xs space-y-1.5">
          <div class="font-semibold text-foreground flex items-center gap-1.5">
            <Radio class="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>{{ $t('docs.page.serverStatus') }}</span>
          </div>
          <p class="text-[12px] text-muted-foreground">{{ $t('docs.page.version', { version: appVersion || '…' }) }}</p>
          <div class="text-[12px] font-mono text-muted-foreground truncate">
            API: /api/health
          </div>
        </div>
      </aside>

      <!-- Content Area -->
      <main class="flex-1 min-w-0 p-6 sm:p-10 max-w-4xl space-y-10">

        <!-- SECTION: Overview -->
        <section v-if="activeSection === 'overview'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.overview.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.overview.intro') }}</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div v-for="card in overviewCards" :key="card.id" class="p-4 rounded-xl border border-border bg-card">
              <component :is="card.icon" class="w-5 h-5 text-primary mb-2" />
              <div class="font-semibold text-xs text-foreground">{{ $t(`docs.overview.cards.${card.id}.title`) }}</div>
              <p class="text-[12px] text-muted-foreground mt-1">{{ $t(`docs.overview.cards.${card.id}.text`) }}</p>
            </div>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.overview.libraries.title') }}</h2>
            <DocText keypath="docs.overview.libraries.what" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.overview.libraries.deleting') }}</p>

            <h2 class="text-base font-semibold text-foreground pt-2">{{ $t('docs.overview.storage.title') }}</h2>
            <DocText keypath="docs.overview.storage.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #path><Mono>/app/data</Mono></template>
            </DocText>
            <div class="bg-muted/40 border border-border rounded-xl p-4 font-mono text-xs text-foreground space-y-1 overflow-x-auto">
              <div v-for="[path, key] in storageRows" :key="path" class="whitespace-nowrap"><span class="text-primary">{{ path }}</span> <span class="text-muted-foreground"># {{ $t(`docs.overview.storage.paths.${key}`) }}</span></div>
            </div>

            <h2 class="text-base font-semibold text-foreground pt-2">{{ $t('docs.overview.setup.title') }}</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText keypath="docs.overview.setup.docker" tag="li">
                <template #file><Mono>docker/docker-compose.yml</Mono></template>
              </DocText>
              <DocText keypath="docs.overview.setup.firstLaunch" tag="li" />
              <DocText keypath="docs.overview.setup.afterSetup" tag="li" />
              <li>{{ $t('docs.overview.setup.noDatabase') }}</li>
            </ul>
          </div>
        </section>

        <!-- SECTION: Supported Media & Metadata -->
        <section v-if="activeSection === 'media'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.media.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.media.intro') }}</p>
          </div>

          <div class="space-y-3">
            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Headphones class="w-4 h-4 text-primary" /> {{ $t('docs.overview.cards.audiobooks.title') }}
              </div>
              <DocText keypath="docs.media.audiobooks" tag="p" class="text-xs text-muted-foreground">
                <template #m4b><Mono>.m4b</Mono></template>
                <template #mp3><Mono>.mp3</Mono></template>
                <template #flac><Mono>.flac</Mono></template>
              </DocText>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Layers class="w-4 h-4 text-primary" /> {{ $t('docs.overview.cards.manga.title') }}
              </div>
              <DocText keypath="docs.media.manga" tag="p" class="text-xs text-muted-foreground">
                <template #cbz><Mono>.cbz</Mono></template>
                <template #zip><Mono>.zip</Mono></template>
              </DocText>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <BookOpen class="w-4 h-4 text-primary" /> {{ $t('docs.media.booksTitle') }}
              </div>
              <DocText keypath="docs.media.books" tag="p" class="text-xs text-muted-foreground">
                <template #epub><Mono>.epub</Mono></template>
                <template #pdf><Mono>.pdf</Mono></template>
              </DocText>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <DocText keypath="docs.media.videoTitle" tag="div" class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <template #movieIcon><Film class="w-4 h-4 text-primary" /></template>
                <template #tvIcon><Tv class="w-4 h-4 text-primary" /></template>
                <template #animeIcon><Sparkles class="w-4 h-4 text-primary" /></template>
              </DocText>
              <DocText keypath="docs.media.video" tag="p" class="text-xs text-muted-foreground">
                <template #mp4><Mono>.mp4</Mono></template>
                <template #mkv><Mono>.mkv</Mono></template>
                <template #webm><Mono>.webm</Mono></template>
              </DocText>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <Info class="w-4 h-4 text-primary" />
              <span>{{ $t('docs.media.applying.title') }}</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.media.applying.text') }}</p>
          </div>

          <div class="p-4 rounded-xl bg-card border border-primary/20 space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <Sparkles class="w-4 h-4 text-primary" />
              <span>{{ $t('docs.media.cleanup.title') }}</span>
            </div>
            <DocText keypath="docs.media.cleanup.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #example><code class="text-primary font-mono text-[12px]">Resident.Evil.2002.1080p.BluRay.x264.mkv</code></template>
            </DocText>
            <ul class="text-xs text-muted-foreground list-disc list-inside space-y-1 pt-1">
              <DocText keypath="docs.media.cleanup.titleCleanup" tag="li" />
              <DocText keypath="docs.media.cleanup.batchMatch" tag="li" />
              <DocText keypath="docs.media.cleanup.manual" tag="li" />
            </ul>
          </div>
        </section>

        <!-- SECTION: User Roles & Permissions -->
        <section v-if="activeSection === 'roles'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.roles.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.roles.intro') }}</p>
          </div>

          <div class="space-y-3">
            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <ShieldCheck class="w-4 h-4 text-primary" /> {{ $t('docs.roles.admin.name') }}
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('docs.roles.admin.text') }}</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <PenSquare class="w-4 h-4 text-amber-500" /> {{ $t('docs.roles.editor.name') }}
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('docs.roles.editor.text') }}</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <EyeIcon class="w-4 h-4" /> {{ $t('docs.roles.viewer.name') }}
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('docs.roles.viewer.text') }}</p>
            </div>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.roles.manage.title') }}</h2>
            <DocText keypath="docs.roles.manage.intro" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText v-for="key in ['add', 'role', 'edit', 'delete', 'away', 'resetTwoFactor']" :key="key" :keypath="`docs.roles.manage.${key}`" tag="li" />
            </ul>
            <DocText keypath="docs.roles.manage.ownPassword" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
          </div>

          <div class="space-y-3 pt-3 border-t border-border">
            <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck class="w-4 h-4 text-primary" />
              {{ $t('docs.roles.twoFactor.title') }}
            </h2>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.roles.twoFactor.intro') }}</p>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText v-for="key in ['turnOn', 'backupCodes', 'signingIn', 'turnOff', 'required']" :key="key" :keypath="`docs.roles.twoFactor.${key}`" tag="li" />
            </ul>
          </div>

          <div class="space-y-3 pt-3 border-t border-border">
            <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
              <Hourglass class="w-4 h-4 text-primary" />
              {{ $t('docs.roles.guests.title') }}
            </h2>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.roles.guests.intro') }}</p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="p-3.5 rounded-xl border border-border bg-card space-y-1">
                <div class="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <Clock class="w-3.5 h-3.5 text-primary" /> {{ $t('docs.roles.guests.presetsTitle') }}
                </div>
                <DocText keypath="docs.roles.guests.presets" tag="p" plain class="text-[12px] text-muted-foreground leading-relaxed" />
              </div>

              <div class="p-3.5 rounded-xl border border-border bg-card space-y-1">
                <div class="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <Lock class="w-3.5 h-3.5 text-amber-500" /> {{ $t('docs.roles.guests.lockoutTitle') }}
                </div>
                <p class="text-[12px] text-muted-foreground leading-relaxed">{{ $t('docs.roles.guests.lockout') }}</p>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground space-y-1.5">
              <div class="font-semibold text-foreground">{{ $t('docs.roles.guests.renewTitle') }}</div>
              <DocText keypath="docs.roles.guests.renew" tag="p" class="leading-relaxed">
                <template #active><span class="text-emerald-500 font-medium">{{ $t('docs.roles.guests.status.active') }}</span></template>
                <template #expiring><span class="text-amber-500 font-medium">{{ $t('docs.roles.guests.status.expiring') }}</span></template>
                <template #expired><span class="text-destructive font-medium">{{ $t('docs.roles.guests.status.expired') }}</span></template>
              </DocText>
            </div>
          </div>
        </section>

        <!-- SECTION: PWA Mobile Install -->
        <section v-if="activeSection === 'pwa'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.pwa.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.pwa.intro') }}</p>
          </div>

          <!-- Secure connection: Tailscale first, Plinthio's own certificate as the alternative -->
          <div class="p-5 rounded-2xl border-2 border-primary/30 bg-primary/5 space-y-4">
            <div class="flex items-center gap-2 text-foreground font-semibold text-sm">
              <Lock class="w-4 h-4 text-primary" />
              <span>{{ $t('docs.pwa.https.title') }}</span>
            </div>
            <DocText keypath="docs.pwa.https.why" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #http><Mono>http://</Mono></template>
            </DocText>
            <p v-if="isSecurePage" class="text-sm text-emerald-500 font-medium flex items-center gap-2">
              <ShieldCheck class="w-4 h-4" /> {{ $t('docs.pwa.https.secure') }}
            </p>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="font-semibold text-sm text-foreground">{{ $t('docs.pwa.https.tailscaleTitle') }}</div>
                <span class="text-[11px] bg-primary text-primary-foreground font-semibold px-2 py-0.5 rounded-full uppercase">{{ $t('docs.recommended') }}</span>
              </div>
              <DocText keypath="docs.pwa.https.tailscale" tag="p" class="text-xs text-muted-foreground leading-relaxed">
                <template #address><Mono class="break-all">https://plinthio.your-tailnet.ts.net</Mono></template>
                <template #link><button type="button" class="text-primary font-medium hover:underline" @click="activeSection = 'remote'">{{ $t('docs.nav.items.remote') }}</button></template>
              </DocText>
            </div>

            <template v-if="tls?.enabled && !isSecurePage">
              <div class="font-semibold text-sm text-foreground pt-1">{{ $t('docs.pwa.cert.title') }}</div>
              <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.pwa.cert.intro') }}</p>
              <div class="flex flex-col sm:flex-row gap-2">
                <a
                  v-if="tls.caAvailable"
                  href="/api/tls/ca.crt"
                  download="plinthio-ca.crt"
                  class="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition"
                >
                  <ShieldCheck class="w-4 h-4" />
                  {{ $t('docs.pwa.cert.download') }}
                </a>
                <a
                  :href="httpsUrl"
                  class="h-10 px-4 rounded-xl border border-border bg-card text-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-muted transition min-w-0"
                >
                  <Globe class="w-4 h-4 flex-shrink-0" />
                  <span class="truncate">{{ $t('docs.pwa.cert.open', { url: httpsUrl }) }}</span>
                </a>
              </div>

              <div v-if="tls.caAvailable" class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-muted-foreground">
                <div class="space-y-1.5">
                  <div class="font-semibold text-foreground">{{ $t('docs.pwa.cert.ios.title') }}</div>
                  <ol class="list-decimal list-inside space-y-1 leading-relaxed">
                    <DocText v-for="key in ['download', 'install', 'trust', 'open']" :key="key" :keypath="`docs.pwa.cert.ios.${key}`" tag="li" plain />
                  </ol>
                </div>
                <div class="space-y-1.5">
                  <div class="font-semibold text-foreground">{{ $t('docs.pwa.cert.android.title') }}</div>
                  <ol class="list-decimal list-inside space-y-1 leading-relaxed">
                    <DocText v-for="key in ['download', 'install', 'open']" :key="key" :keypath="`docs.pwa.cert.android.${key}`" tag="li" plain />
                  </ol>
                </div>
                <div class="space-y-1.5 sm:col-span-2">
                  <div class="font-semibold text-foreground">{{ $t('docs.pwa.cert.desktop.title') }}</div>
                  <DocText keypath="docs.pwa.cert.desktop.text" tag="p" plain class="leading-relaxed" />
                </div>
              </div>
              <p class="text-[12px] text-muted-foreground leading-relaxed">{{ $t('docs.pwa.cert.note') }}</p>
            </template>
            <DocText v-else-if="tls && !tls.enabled && !isSecurePage" keypath="docs.pwa.cert.off" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #setting><Mono>HTTPS_PORT=8443</Mono></template>
            </DocText>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <!-- iOS Safari -->
            <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
              <div class="flex items-center gap-2 text-foreground font-semibold text-sm">
                <Smartphone class="w-4 h-4 text-primary" />
                <span>{{ $t('docs.pwa.ios.title') }}</span>
              </div>
              <ol class="text-xs text-muted-foreground space-y-2.5 list-decimal list-inside leading-relaxed">
                <DocText keypath="docs.pwa.ios.open" tag="li" plain>
                  <template #example><code class="text-foreground bg-muted px-1.5 py-0.5 rounded break-all">http://XXX.XXX.XXX.X:8088</code></template>
                </DocText>
                <DocText v-for="key in ['share', 'addToHome', 'add', 'launch']" :key="key" :keypath="`docs.pwa.ios.${key}`" tag="li" plain />
              </ol>
              <p class="text-[12px] text-muted-foreground">{{ $t('docs.pwa.ios.note') }}</p>
            </div>

            <!-- Android Chrome -->
            <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
              <div class="flex items-center gap-2 text-foreground font-semibold text-sm">
                <Smartphone class="w-4 h-4 text-primary" />
                <span>{{ $t('docs.pwa.android.title') }}</span>
              </div>
              <ol class="text-xs text-muted-foreground space-y-2.5 list-decimal list-inside leading-relaxed">
                <DocText v-for="key in ['open', 'menu', 'install', 'confirm']" :key="key" :keypath="`docs.pwa.android.${key}`" tag="li" plain />
              </ol>
              <p class="text-[12px] text-muted-foreground">{{ $t('docs.pwa.android.note') }}</p>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck class="w-4 h-4 text-emerald-500" />
              <span>{{ $t('docs.pwa.safeArea.title') }}</span>
            </div>
            <DocText keypath="docs.pwa.safeArea.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #meta><Mono>&lt;meta name="mobile-web-app-capable" content="yes"&gt;</Mono></template>
              <template #inset><Mono>env(safe-area-inset-top)</Mono></template>
            </DocText>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.pwa.gives.title') }}</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText v-for="key in ['lockscreen', 'offline', 'edgeToEdge']" :key="key" :keypath="`docs.pwa.gives.${key}`" tag="li" />
            </ul>
          </div>
        </section>

        <!-- SECTION: Remote Access (Mobile Data / Outside Wi-Fi) -->
        <section v-if="activeSection === 'remote'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.remote.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.remote.intro') }}</p>
          </div>

          <!-- Method 1: Tailscale (Highlighted) -->
          <div class="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5 space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs flex-shrink-0">
                  VPN
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-foreground">{{ $t('docs.remote.tailscale.title') }}</h3>
                  <p class="text-[12px] text-muted-foreground">{{ $t('docs.remote.tailscale.subtitle') }}</p>
                </div>
              </div>
              <span class="text-[11px] bg-primary text-primary-foreground font-semibold px-2 py-0.5 rounded-full uppercase">
                {{ $t('docs.recommended') }}
              </span>
            </div>

            <div class="text-xs text-muted-foreground space-y-3 leading-relaxed">
              <DocText keypath="docs.remote.tailscale.text" tag="p">
                <template #address><Mono class="break-all">https://plinthio.your-tailnet.ts.net</Mono></template>
              </DocText>

              <div class="space-y-1.5">
                <div class="font-semibold text-foreground">{{ $t('docs.remote.tailscale.serverTitle') }}</div>
                <ol class="list-decimal list-inside space-y-1">
                  <DocText keypath="docs.remote.tailscale.console" tag="li" />
                  <DocText keypath="docs.remote.tailscale.docker" tag="li">
                    <template #file><Mono>docker-compose.tailscale.yml</Mono></template>
                    <template #authKey><Mono class="break-all">TS_AUTHKEY=tskey-auth-…</Mono></template>
                    <template #composeFile><Mono class="break-all">COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml</Mono></template>
                    <template #env><Mono>.env</Mono></template>
                    <template #up><Mono>docker compose up -d</Mono></template>
                  </DocText>
                  <DocText keypath="docs.remote.tailscale.noDocker" tag="li">
                    <template #command><Mono>sudo tailscale serve --bg 8088</Mono></template>
                  </DocText>
                </ol>
              </div>

              <div class="space-y-1.5">
                <div class="font-semibold text-foreground">{{ $t('docs.remote.tailscale.deviceTitle') }}</div>
                <ol class="list-decimal list-inside space-y-1">
                  <DocText keypath="docs.remote.tailscale.installApp" tag="li" />
                  <DocText keypath="docs.remote.tailscale.openAddress" tag="li">
                    <template #address><Mono>https://….ts.net</Mono></template>
                  </DocText>
                  <DocText keypath="docs.remote.tailscale.addToHome" tag="li">
                    <template #http><Mono>http://</Mono></template>
                  </DocText>
                </ol>
              </div>

              <DocText keypath="docs.remote.tailscale.more" tag="p" class="text-[12px]">
                <template #doc><Mono>docs/remote-access.md</Mono></template>
              </DocText>
            </div>
          </div>

          <!-- Method 2: Tailscale Funnel, a public link with no domain -->
          <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
            <h3 class="text-sm font-semibold text-foreground">{{ $t('docs.remote.funnel.title') }}</h3>
            <DocText keypath="docs.remote.funnel.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #address><Mono class="break-all">https://plinthio.your-tailnet.ts.net</Mono></template>
            </DocText>
            <ol class="text-xs text-muted-foreground list-decimal list-inside space-y-1 leading-relaxed">
              <li>{{ $t('docs.remote.funnel.option1') }}</li>
              <DocText keypath="docs.remote.funnel.allow" tag="li" />
              <DocText keypath="docs.remote.funnel.enable" tag="li">
                <template #setting><Mono>TS_FUNNEL=true</Mono></template>
                <template #env><Mono>.env</Mono></template>
                <template #up><Mono>docker compose up -d</Mono></template>
              </DocText>
              <li>{{ $t('docs.remote.funnel.check') }}</li>
            </ol>
          </div>

          <!-- Method 3: a web address for guests (the public-address add-on) -->
          <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
            <h3 class="text-sm font-semibold text-foreground">{{ $t('docs.remote.domain.title') }}</h3>
            <DocText keypath="docs.remote.domain.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #url><Mono>https://media.yourdomain.com</Mono></template>
            </DocText>
            <div class="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
              <div class="font-semibold text-foreground">{{ $t('docs.remote.domain.needsTitle') }}</div>
              <ol class="list-decimal list-inside space-y-1">
                <DocText v-for="key in ['connection', 'dns', 'ports', 'allow']" :key="key" :keypath="`docs.remote.domain.${key}`" tag="li" />
                <DocText keypath="docs.remote.domain.compose" tag="li">
                  <template #file><Mono>docker-compose.public.yml</Mono></template>
                  <template #domain><Mono class="break-all">PLINTHIO_DOMAIN=media.yourdomain.com</Mono></template>
                  <template #composeFile><Mono class="break-all">COMPOSE_FILE=docker-compose.yml:docker-compose.public.yml</Mono></template>
                  <template #env><Mono>.env</Mono></template>
                  <template #up><Mono>docker compose up -d</Mono></template>
                </DocText>
                <li>{{ $t('docs.remote.domain.check') }}</li>
              </ol>
            </div>
          </div>

          <!-- Who can use it from where -->
          <div class="p-5 rounded-2xl border border-border bg-card space-y-3">
            <h3 class="text-sm font-semibold text-foreground">{{ $t('docs.remote.who.title') }}</h3>
            <ul class="text-xs text-muted-foreground space-y-1.5 list-disc list-inside leading-relaxed">
              <DocText v-for="key in ['network', 'users', 'security']" :key="key" :keypath="`docs.remote.who.${key}`" tag="li" />
            </ul>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-500" />
              <span>{{ $t('docs.remote.avoid.title') }}</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.remote.avoid.text') }}</p>
            <DocText keypath="docs.remote.avoid.guide" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #doc><Mono>docs/remote-access.md</Mono></template>
            </DocText>
          </div>
        </section>

        <!-- SECTION: Keyboard Shortcuts & Player Controls -->
        <section v-if="activeSection === 'shortcuts'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.shortcuts.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.shortcuts.intro') }}</p>
          </div>

          <div class="space-y-4">
            <div v-for="reader in shortcutGroups" :key="reader.id" class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <component :is="reader.icon" class="w-4 h-4 text-primary" /> {{ $t(`docs.shortcuts.${reader.id}.title`) }}
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div v-for="[key, action] in reader.keys" :key="key + action" class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[12px]">{{ key.startsWith('docs.') ? $t(key) : key }}</kbd><span class="text-muted-foreground">{{ $t(`docs.shortcuts.actions.${action}`) }}</span></div>
              </div>
              <p v-if="reader.id === 'manga'" class="text-[12px] text-muted-foreground">{{ $t('docs.shortcuts.manga.note') }}</p>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2.5">
              <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Headphones class="w-4 h-4 text-primary" /> {{ $t('docs.shortcuts.audiobook.title') }}
              </div>
              <p class="text-xs text-muted-foreground">{{ $t('docs.shortcuts.audiobook.text') }}</p>
            </div>
          </div>
        </section>

        <!-- SECTION: Live TV -->
        <section v-if="activeSection === 'liveTv'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.liveTv.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.liveTv.intro') }}</p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.turnOn.title') }}</h2>
            <DocText keypath="docs.liveTv.turnOn.text" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.liveTv.turnOn.off') }}</p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.adding.title') }}</h2>
            <DocText keypath="docs.liveTv.adding.intro" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText keypath="docs.liveTv.adding.public" tag="li" />
              <DocText keypath="docs.liveTv.adding.own" tag="li">
                <template #m3u8><Mono>.m3u8</Mono></template>
              </DocText>
              <DocText keypath="docs.liveTv.adding.guide" tag="li">
                <template #gz><Mono>.xml.gz</Mono></template>
              </DocText>
              <DocText keypath="docs.liveTv.adding.refresh" tag="li" />
              <DocText keypath="docs.liveTv.adding.acknowledge" tag="li" />
            </ul>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.filters.title') }}</h2>
            <DocText keypath="docs.liveTv.filters.intro" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText v-for="key in ['region', 'sets', 'languages']" :key="key" :keypath="`docs.liveTv.filters.${key}`" tag="li" />
              <DocText keypath="docs.liveTv.filters.hosts" tag="li">
                <template #host><Mono>jmp2.uk</Mono></template>
              </DocText>
              <DocText keypath="docs.liveTv.filters.exceptions" tag="li" />
            </ul>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.choosing.title') }}</h2>
            <DocText keypath="docs.liveTv.choosing.text" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.liveTv.choosing.kept') }}</p>
          </div>

          <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
            <div class="flex items-center gap-2 font-semibold text-xs text-foreground">
              <Baby class="w-4 h-4 text-sky-500" /> {{ $t('docs.liveTv.kids.title') }}
            </div>
            <DocText keypath="docs.liveTv.kids.text" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.watching.title') }}</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText v-for="key in ['channels', 'guide', 'player']" :key="key" :keypath="`docs.liveTv.watching.${key}`" tag="li" />
            </ul>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.liveTv.watching.throughServer') }}</p>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <Info class="w-4 h-4 text-primary" />
              <span>{{ $t('docs.liveTv.publicSources.title') }}</span>
            </div>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.liveTv.publicSources.text') }}</p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.responsibility.title') }}</h2>
            <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.liveTv.responsibility.text') }}</p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.liveTv.troubleshooting.title') }}</h2>
            <div v-for="item in liveTvProblems" :key="item.id" class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">{{ $t(`docs.liveTv.troubleshooting.${item.id}.title`) }}</div>
              <DocText :keypath="`docs.liveTv.troubleshooting.${item.id}.text`" tag="p" class="text-xs text-muted-foreground leading-relaxed">
                <template v-if="item.code" #code><button type="button" class="font-mono text-primary font-medium hover:underline" @click="openErrorCode(item.code)">{{ item.code }}</button></template>
              </DocText>
            </div>
          </div>
        </section>

        <!-- SECTION: Backups & Data Safety -->
        <section v-if="activeSection === 'backups'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.backups.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.backups.intro') }}</p>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.backups.automatic.title') }}</h2>
            <DocText keypath="docs.backups.automatic.where" tag="p" class="text-xs text-muted-foreground leading-relaxed" />
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText keypath="docs.backups.automatic.frequency" tag="li" />
              <DocText keypath="docs.backups.automatic.keepLast" tag="li">
                <template #path><Mono>/config/backups</Mono></template>
              </DocText>
              <DocText keypath="docs.backups.automatic.upgrade" tag="li" />
            </ul>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.backups.second.title') }}</h2>
            <DocText keypath="docs.backups.second.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #path><Mono>/config/backups</Mono></template>
            </DocText>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText keypath="docs.backups.second.keepThere" tag="li" />
              <li>{{ $t('docs.backups.second.alsoCopied') }}</li>
              <DocText keypath="docs.backups.second.layout" tag="li">
                <template #database><Mono>database/</Mono></template>
                <template #files><Mono>files/</Mono></template>
              </DocText>
            </ul>
            <DocText keypath="docs.backups.second.docker" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #media><Mono>/media</Mono></template>
              <template #backups><Mono>/backups</Mono></template>
              <template #compose><Mono>docker-compose.yml</Mono></template>
              <template #variable><Mono>BACKUP_DIR</Mono></template>
              <template #env><Mono>.env</Mono></template>
            </DocText>
          </div>

          <div class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">{{ $t('docs.backups.manual.title') }}</h2>
            <ul class="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1.5">
              <DocText keypath="docs.backups.manual.now" tag="li" />
              <DocText keypath="docs.backups.manual.download" tag="li" />
              <li>{{ $t('docs.backups.manual.stored') }}</li>
            </ul>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="text-xs font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-500" />
              <span>{{ $t('docs.backups.notIncluded.title') }}</span>
            </div>
            <DocText keypath="docs.backups.notIncluded.text" tag="p" class="text-xs text-muted-foreground leading-relaxed">
              <template #doc><Mono>docs/administration.md</Mono></template>
            </DocText>
          </div>
        </section>

        <!-- SECTION: REST API Reference -->
        <section v-if="activeSection === 'api'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.api.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.api.intro') }}</p>
          </div>

          <div class="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div class="font-semibold text-xs text-foreground">{{ $t('docs.api.auth.title') }}</div>
            <DocText keypath="docs.api.auth.text" tag="p" plain class="text-xs text-muted-foreground">
              <template #header><Mono>X-API-Key</Mono></template>
              <template #authHeader><Mono>Authorization</Mono></template>
              <template #mediaPath><Mono>/api/media/*</Mono></template>
              <template #tokenEndpoint><Mono>POST /api/auth/media-token</Mono></template>
              <template #tokenParam><Mono>?token=</Mono></template>
              <template #img><Mono>&lt;img&gt;</Mono></template>
              <template #video><Mono>&lt;video&gt;</Mono></template>
            </DocText>
            <div class="bg-background border border-border rounded-lg p-2.5 font-mono text-xs overflow-x-auto whitespace-nowrap">
              curl -H "X-API-Key: plinthio_..." http://localhost:8088/api/items
            </div>
            <p class="text-[12px] text-muted-foreground">{{ $t('docs.api.auth.scope') }}</p>
          </div>

          <div class="space-y-5">
            <div v-for="group in apiGroups" :key="group.id">
              <h2 class="text-sm font-semibold text-foreground mb-2.5">{{ $t(`docs.api.groups.${group.id}`) }}</h2>
              <div class="space-y-2.5 text-xs">
                <div v-for="endpoint in group.endpoints" :key="endpoint.method + endpoint.path" class="p-3 rounded-xl border border-border bg-card space-y-1">
                  <div class="flex items-center gap-2 font-mono flex-wrap">
                    <span :class="METHOD_CLASSES[endpoint.method]" class="font-bold px-1.5 py-0.5 rounded">{{ endpoint.method }}</span>
                    <span class="text-foreground break-all">{{ endpoint.path }}</span>
                  </div>
                  <DocText :keypath="`docs.api.endpoints.${endpoint.id}`" tag="p" class="text-muted-foreground">
                    <template v-if="endpoint.id === 'items'" #params><template v-for="(param, i) in ['type', 'search', 'author', 'series', 'limit', 'offset']" :key="param">{{ i ? ', ' : '' }}<code class="text-foreground bg-muted px-1">{{ param }}</code></template></template>
                    <template v-if="endpoint.id === 'hide'" #unhide><code class="text-foreground bg-muted px-1">unhide</code></template>
                    <template v-if="endpoint.id === 'audioStream'" #token><code class="text-foreground bg-muted px-1">?token=...</code></template>
                    <template v-if="endpoint.id === 'progress'" #body><code class="text-foreground bg-muted px-1">&#123; "currentTime": 120.5, "isFinished": false &#125;</code></template>
                  </DocText>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION: Custom CSS -->
        <section v-if="activeSection === 'css'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.css.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.css.intro') }}</p>
          </div>

          <div class="space-y-4">
            <h2 class="text-sm font-semibold text-foreground">{{ $t('docs.css.propertiesTitle') }}</h2>
            <div class="p-4 rounded-xl bg-card border border-border font-mono text-xs space-y-2 overflow-x-auto">
              <div class="text-muted-foreground whitespace-nowrap">/* Shadcn Theme Variables (HSL format) */</div>
              <div class="whitespace-nowrap">--background: 240 10% 3.9%;</div>
              <div class="whitespace-nowrap">--foreground: 0 0% 98%;</div>
              <div class="whitespace-nowrap">--primary: 240 5.9% 10%;</div>
              <div class="whitespace-nowrap">--card: 240 10% 5.5%;</div>
              <div class="whitespace-nowrap">--border: 240 3.7% 15.9%;</div>
              <div class="whitespace-nowrap">--radius: 0.75rem;</div>
            </div>

            <h2 class="text-sm font-semibold text-foreground">{{ $t('docs.css.examplesTitle') }}</h2>

            <div class="space-y-3">
              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">{{ $t('docs.css.examples.rounded') }}</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[12px] overflow-x-auto text-foreground">
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
                <div class="font-semibold text-xs text-foreground">{{ $t('docs.css.examples.compact') }}</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[12px] overflow-x-auto text-foreground">
body {
  font-size: 11px !important;
}
header {
  height: 2.75rem !important;
}
</pre>
              </div>

              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">{{ $t('docs.css.examples.hideSearch') }}</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[12px] overflow-x-auto text-foreground">
header input[type="text"] {
  display: none !important;
}
</pre>
              </div>

              <div class="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                <div class="font-semibold text-xs text-foreground">{{ $t('docs.css.examples.accent') }}</div>
                <pre class="bg-background p-3 rounded-lg border border-border font-mono text-[12px] overflow-x-auto text-foreground">
:root {
  --primary: 280 85% 60% !important;
}
</pre>
              </div>
            </div>

            <DocText keypath="docs.css.apply" :params="{ tryIt: t('admin.appearance.css.tryIt'), save: t('admin.appearance.css.save') }" tag="p" plain class="text-xs text-muted-foreground" />
          </div>
        </section>

        <!-- SECTION: Error codes -->
        <section v-if="activeSection === 'errors'" id="error-codes" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.errors.title') }}</h1>
            <DocText keypath="docs.errors.intro" tag="p" class="text-sm text-muted-foreground mt-1.5">
              <template #example><Mono>(P301)</Mono></template>
              <template #code><Mono>code</Mono></template>
              <template #detail><Mono>detail</Mono></template>
            </DocText>
          </div>

          <input
            v-model="errorFilter"
            type="search"
            :placeholder="$t('docs.errors.searchPlaceholder')"
            class="w-full h-10 px-3 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground"
          />

          <p v-if="errorCodesError" class="text-sm text-destructive">{{ $t('docs.errors.loadFailed', { file: 'docs/error-codes.md' }) }}</p>
          <div v-else-if="!errorCodes.length" class="text-sm text-muted-foreground">{{ $t('common.loading') }}</div>

          <div v-for="group in errorGroups" :key="group.id" class="space-y-3">
            <h2 class="text-sm font-semibold text-foreground">{{ $t(`docs.errors.groups.${group.id}`) }}</h2>
            <div
              v-for="entry in group.codes"
              :key="entry.code"
              :id="entry.code"
              class="p-4 rounded-xl border bg-card space-y-1.5 scroll-mt-24 transition"
              :class="highlightedCode === entry.code ? 'border-primary ring-1 ring-primary' : 'border-border'"
            >
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{{ entry.code }}</span>
                <span class="font-semibold text-xs text-foreground">{{ entry.title }}</span>
                <span class="text-[11px] text-muted-foreground ml-auto">
                  {{ entry.side === 'client' ? $t('docs.errors.raisedByApp') : `HTTP ${entry.status}` }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">{{ entry.meaning }}</p>
              <p class="text-xs text-muted-foreground"><strong class="text-foreground">{{ $t('docs.errors.whatToDo') }}</strong> {{ entry.fix }}</p>
            </div>
          </div>
        </section>

        <!-- SECTION: Troubleshooting -->
        <section v-if="activeSection === 'troubleshooting'" class="space-y-6">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground">{{ $t('docs.troubleshooting.title') }}</h1>
            <p class="text-sm text-muted-foreground mt-1.5">{{ $t('docs.troubleshooting.intro') }}</p>
          </div>

          <a
            :href="reportUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted/40 transition"
          >
            <Bug class="w-5 h-5 text-primary flex-shrink-0" />
            <span class="text-xs text-muted-foreground leading-relaxed">
              <strong class="text-foreground text-sm block">{{ $t('docs.troubleshooting.report.title') }}</strong>
              {{ $t('docs.troubleshooting.report.text') }}
            </span>
          </a>

          <div class="space-y-3">
            <div v-for="key in ['missingItems', 'noPosters', 'forgotPassword']" :key="key" class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">{{ $t(`docs.troubleshooting.${key}.title`) }}</div>
              <DocText :keypath="`docs.troubleshooting.${key}.text`" tag="p" class="text-xs text-muted-foreground" />
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-2">
              <div class="font-semibold text-xs text-foreground">{{ $t('docs.troubleshooting.video.title') }}</div>
              <p class="text-xs text-muted-foreground leading-relaxed">{{ $t('docs.troubleshooting.video.intro') }}</p>
              <ul class="list-disc pl-4 space-y-1 text-xs text-muted-foreground leading-relaxed">
                <DocText keypath="docs.troubleshooting.video.directPlay" tag="li" />
                <DocText keypath="docs.troubleshooting.video.directStream" tag="li">
                  <template #copy><code class="bg-muted px-1 rounded">-c:v copy</code></template>
                </DocText>
                <DocText keypath="docs.troubleshooting.video.browserAcceleration" tag="li">
                  <template #vivaldi><code class="bg-muted px-1 rounded">vivaldi://gpu</code></template>
                  <template #chrome><code class="bg-muted px-1 rounded">chrome://gpu</code></template>
                  <template #status><em>"Video Decode: Hardware accelerated"</em></template>
                </DocText>
                <DocText keypath="docs.troubleshooting.video.serverTranscoding" tag="li">
                  <template #device><code class="bg-muted px-1 rounded">/dev/dri</code></template>
                  <template #group><code class="bg-muted px-1 rounded">render</code></template>
                  <template #compose><code class="bg-muted px-1 rounded">docker-compose.yml</code></template>
                </DocText>
                <DocText keypath="docs.troubleshooting.video.thermal" tag="li" />
              </ul>
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">{{ $t('docs.troubleshooting.deletedLibrary.title') }}</div>
              <DocText keypath="docs.troubleshooting.deletedLibrary.text" tag="p" class="text-xs text-muted-foreground" />
            </div>

            <div class="p-4 rounded-xl border border-border bg-card space-y-1.5">
              <div class="font-semibold text-xs text-foreground">{{ $t('docs.troubleshooting.awayFromHome.title') }}</div>
              <DocText keypath="docs.troubleshooting.awayFromHome.text" tag="p" class="text-xs text-muted-foreground">
                <template #ip><Mono>192.168.x.x</Mono></template>
              </DocText>
            </div>
          </div>
        </section>

      </main>
    </div>
  </div>
  </div>
</template>

<script setup>
import AppLogo from '../components/AppLogo.vue';
import { ref, computed, watch, onMounted, nextTick, h, Fragment } from 'vue';
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
  LifeBuoy,
  Hourglass,
  Lock,
  Clock,
  CircleAlert,
  Bug,
  Baby,
  RadioTower
} from '@lucide/vue';
import { reportProblemUrl, serverVersion } from '../utils/reportProblem';
import { useAuthStore } from '../stores/auth';
import { t } from '../i18n';
import { localizeErrorEntry } from '../i18n/serverErrors';

// A translated docs sentence with markup in it. Works like <I18nT>: each {name} in the
// message is filled by the slot of that name, so commands, paths and code stay here in the
// template and never pass through a translation. On top of that, **words** in the message
// render bold: the bold words are prose, so they belong to the translation. `plain` drops
// the bold's foreground colour where the original text used an unstyled <strong>.
const DocText = (props, { slots }) => {
  const keep = Object.fromEntries(Object.keys(slots).map((name) => [name, `{${name}}`]));
  const text = t(props.keypath, { ...props.params, ...keep });
  const children = text.split(/(\*\*.+?\*\*|\{\w+\})/).filter(Boolean).map((part) => {
    const bold = part.match(/^\*\*(.+)\*\*$/);
    if (bold) return h('strong', props.plain ? null : { class: 'text-foreground' }, bold[1]);
    const name = part.match(/^\{(\w+)\}$/)?.[1];
    return name && slots[name] ? h(Fragment, slots[name]()) : part;
  });
  return h(props.tag, children);
};
DocText.props = {
  keypath: { type: String, required: true },
  params: { type: Object, default: () => ({}) },
  tag: { type: String, default: 'span' },
  plain: Boolean
};

// Inline code, a path or a command, in the docs' usual style.
const Mono = (_, { slots }) => h('code', { class: 'text-foreground bg-muted px-1 rounded' }, slots.default?.());

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const router = useRouter();
// Global nav layout (topnav vs sidebar) respects user preference when allowed, falling back to server default.
const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}

const activeSection = ref('overview');

const appVersion = ref('');
const reportUrl = ref(reportProblemUrl());
serverVersion().then((v) => {
  appVersion.value = v;
  reportUrl.value = reportProblemUrl(v);
});

const overviewCards = [
  { id: 'audiobooks', icon: Headphones },
  { id: 'manga', icon: Layers },
  { id: 'books', icon: BookOpen },
  { id: 'movies', icon: Film },
  { id: 'shows', icon: Tv },
  { id: 'anime', icon: Sparkles }
];

// Live TV's common problems (docs.liveTv.troubleshooting.<id>), with the error code each
// one shows, if any.
const liveTvProblems = [
  { id: 'wontPlay', code: 'P701' },
  { id: 'listFailed', code: 'P702' },
  { id: 'notPlayable' },
  { id: 'missingChannel' },
  { id: 'noGuide' },
  { id: 'notInMenu' }
];

// Path → its comment in docs.overview.storage.paths.
const storageRows = [
  ['/config/plinthio.sqlite', 'database'],
  ['/config/backups/', 'backups'],
  ['/config/covers/', 'covers'],
  ['/config/avatars/', 'avatars'],
  ['/config/cache/', 'cache'],
  ['/config/ssl/', 'ssl'],
  ['/config/jwt.secret', 'jwt'],
  ['/media/...', 'media']
];

// Each reader's keys: [key label (a docs.* key when the name is translated), action].
const shortcutGroups = [
  { id: 'manga', icon: Layers, keys: [['←', 'previousPage'], ['→', 'nextPage'], ['docs.shortcuts.keys.space', 'nextPage'], ['docs.shortcuts.keys.esc', 'closeReader']] },
  { id: 'video', icon: Film, keys: [['docs.shortcuts.keys.space', 'playPause'], ['←', 'seekBack'], ['→', 'seekForward'], ['docs.shortcuts.keys.esc', 'closePlayer']] },
  { id: 'epub', icon: BookOpen, keys: [['←', 'previousPage'], ['→', 'nextPage'], ['docs.shortcuts.keys.space', 'nextPage'], ['docs.shortcuts.keys.esc', 'closeSettingsOrReader'], ['docs.shortcuts.keys.ctrlF', 'searchBook']] }
];

const METHOD_CLASSES = {
  GET: 'bg-emerald-500/10 text-emerald-600',
  POST: 'bg-blue-500/10 text-blue-600',
  PATCH: 'bg-amber-500/10 text-amber-600'
};
// Descriptions are docs.api.endpoints.<id>.
const apiGroups = [
  {
    id: 'catalog',
    endpoints: [
      { id: 'items', method: 'GET', path: '/api/items' },
      { id: 'item', method: 'GET', path: '/api/items/:id' },
      { id: 'series', method: 'GET', path: '/api/items/series/:name' },
      { id: 'hide', method: 'POST', path: '/api/items/:id/hide' }
    ]
  },
  {
    id: 'streaming',
    endpoints: [
      { id: 'audioStream', method: 'GET', path: '/api/media/stream/:id' },
      { id: 'videoStream', method: 'GET', path: '/api/media/video/:id/stream' },
      { id: 'playbackInfo', method: 'GET', path: '/api/media/video/:id/playback-info' },
      { id: 'mangaPages', method: 'GET', path: '/api/media/manga/:id/pages' },
      { id: 'bookFile', method: 'GET', path: '/api/media/book/:id/file' }
    ]
  },
  {
    id: 'progress',
    endpoints: [
      { id: 'progress', method: 'POST', path: '/api/progress/:itemId' },
      { id: 'continue', method: 'GET', path: '/api/progress/continue' },
      { id: 'bookmarks', method: 'POST', path: '/api/bookmarks' }
    ]
  },
  {
    id: 'admin',
    endpoints: [
      { id: 'stats', method: 'GET', path: '/api/stats/admin' },
      { id: 'updateUser', method: 'PATCH', path: '/api/users/:id' },
      { id: 'resetPassword', method: 'PATCH', path: '/api/users/:id/password' },
      { id: 'scan', method: 'POST', path: '/api/libraries/:id/scan' },
      { id: 'backup', method: 'GET', path: '/api/settings/backup' }
    ]
  }
];

// Built-in HTTPS status, for the "Secure connection" card on the app install page.
const tls = ref(null);
const isSecurePage = window.location.protocol === 'https:';
const httpsUrl = computed(() => (tls.value?.port
  ? `https://${window.location.hostname}${tls.value.port === 443 ? '' : `:${tls.value.port}`}`
  : ''));
async function loadTlsStatus() {
  if (tls.value) return;
  try {
    const res = await fetch('/api/tls');
    if (res.ok) tls.value = await res.json();
  } catch (err) {
    // Older server or offline — the card just shows nothing server-specific.
  }
}

// ── Error codes ──────────────────────────────────────────────────────────────────────────
// Served by the backend from its catalog (backend/src/errors.js), so this page can never
// list a code the server doesn't use. /docs#P301 opens this section on that code, which is
// where the video player's "what this means" link points. The entries come from the server
// in English and are shown from serverErrors.codes where translated; the group headings are
// docs.errors.groups.<id>.
const ERROR_SECTIONS = [
  { prefix: 'P0', id: 'general' },
  { prefix: 'P1', id: 'signIn' },
  { prefix: 'P2', id: 'libraries' },
  { prefix: 'P3', id: 'playback' },
  { prefix: 'P4', id: 'metadata' },
  { prefix: 'P5', id: 'lists' },
  { prefix: 'P6', id: 'watchParties' },
  { prefix: 'P7', id: 'liveTv' }
];
const errorCodes = ref([]);
const errorCodesError = ref(false);
const errorFilter = ref('');
const highlightedCode = ref('');

const errorGroups = computed(() => {
  const q = errorFilter.value.trim().toLowerCase();
  const matches = errorCodes.value.map(localizeErrorEntry).filter((e) => !q ||
    [e.code, e.title, e.meaning, e.fix].some((field) => field?.toLowerCase().includes(q)));
  return ERROR_SECTIONS
    .map((section) => ({ id: section.id, codes: matches.filter((e) => e.code.startsWith(section.prefix)) }))
    .filter((group) => group.codes.length);
});

async function loadErrorCodes() {
  if (errorCodes.value.length) return;
  try {
    const res = await fetch('/api/errors');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    errorCodes.value = (await res.json()).codes || [];
  } catch (err) {
    errorCodesError.value = true;
  }
}

// Opens the error reference on one code, from a guide that mentions it.
async function openErrorCode(code) {
  activeSection.value = 'errors';
  errorFilter.value = '';
  highlightedCode.value = code;
  await loadErrorCodes();
  await nextTick();
  document.getElementById(code)?.scrollIntoView({ block: 'center' });
}

watch(activeSection, (section) => {
  if (section === 'errors') loadErrorCodes();
  if (section === 'pwa') loadTlsStatus();
});

onMounted(async () => {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  // /docs#pwa, /docs#remote … open that guide directly (the app links to them).
  if (navGroups.some((g) => g.items.some((i) => i.id === hash))) {
    activeSection.value = hash;
    return;
  }
  if (hash !== 'error-codes' && !/^P\d{3}$/.test(hash)) return;
  activeSection.value = 'errors';
  await loadErrorCodes();
  if (hash.startsWith('P')) {
    highlightedCode.value = hash;
    await nextTick();
    document.getElementById(hash)?.scrollIntoView({ block: 'center' });
  }
});

// Grouped so the nav stays a fixed, predictable width (w-64) no matter how many guides
// get added — new topics join an existing group instead of growing a single flat list.
// Labels are docs.nav.groups.<id> and docs.nav.items.<id>.
const navGroups = [
  {
    id: 'basics',
    items: [
      { id: 'overview', icon: BookOpen },
      { id: 'media', icon: Film },
      { id: 'roles', icon: Users }
    ]
  },
  {
    id: 'using',
    items: [
      { id: 'pwa', icon: Smartphone },
      { id: 'remote', icon: Globe },
      { id: 'liveTv', icon: RadioTower },
      { id: 'shortcuts', icon: Keyboard }
    ]
  },
  {
    id: 'admin',
    items: [
      { id: 'backups', icon: Save },
      { id: 'api', icon: Code },
      { id: 'css', icon: Palette }
    ]
  },
  {
    id: 'help',
    items: [
      { id: 'troubleshooting', icon: LifeBuoy },
      { id: 'errors', icon: CircleAlert }
    ]
  }
];
</script>
