<template>
  <div class="min-h-screen lg:h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground relative" :class="isSidebarLayout ? 'flex flex-col md:flex-row lg:overflow-hidden' : 'flex flex-col lg:overflow-hidden'">
    <!-- Standard Plinthio Navbar / Sidebar -->
    <Sidebar
      v-if="isSidebarLayout"
      :activeType="navType"
      @filter-type="handleNavFilter"
      @update:searchQuery="handleNavSearch"
    />
    <Navbar
      v-else
      :activeType="navType"
      @filter-type="handleNavFilter"
      @update:searchQuery="handleNavSearch"
    />

    <div class="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
    <!-- Sub-Navigation Header: Dedicated Breadcrumbs & Back Bar -->
    <nav class="bg-muted/40 border-b border-border/80 flex-shrink-0 z-20">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-10 flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2.5 min-w-0">
          <button
            @click="goBack"
            class="h-7 px-2.5 rounded-lg bg-background hover:bg-muted text-foreground transition active:scale-95 flex items-center gap-1.5 text-xs font-medium border border-border flex-shrink-0 shadow-sm"
            title="Back to shelf"
          >
            <ArrowLeft class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Back</span>
          </button>

          <div class="h-3.5 w-[1px] bg-border flex-shrink-0" />

          <div class="flex items-center gap-1.5 text-muted-foreground truncate">
            <router-link to="/" class="hover:text-foreground transition">Shelf</router-link>
            <ChevronRight class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            <span class="hover:text-foreground transition cursor-pointer" @click="goBackToType">{{ vocab.type }}</span>
            <ChevronRight class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            <span class="font-semibold text-foreground truncate max-w-[200px] sm:max-w-md">
              {{ series?.name || 'Details' }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 text-muted-foreground flex-shrink-0">
          <span v-if="!isSingle" class="text-[11px] font-mono">
            {{ unitsLabel(series?.volumeCount || 0) }}
          </span>
        </div>
      </div>
    </nav>

    <!-- Loading State -->
    <div v-if="loading" class="flex-1 flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
      <Loader2 class="w-8 h-8 animate-spin text-primary" />
      <p class="text-xs font-mono">Loading…</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex-1 max-w-lg mx-auto px-4 py-20 text-center flex flex-col items-center justify-center">
      <div class="w-12 h-12 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mb-4">
        <AlertCircle class="w-6 h-6" />
      </div>
      <h2 class="text-lg font-bold text-foreground">{{ error }}</h2>
      <p class="text-xs text-muted-foreground mt-1 mb-6">Could not load this series or it may have been removed.</p>
      <button
        @click="goBack"
        class="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition shadow-sm"
      >
        Return to Shelf
      </button>
    </div>

    <!-- Main View Content: one scrolling page — hero, then the sections below it. -->
    <main v-else-if="series" class="flex-1 lg:min-h-0 lg:overflow-y-auto">
      <!-- ─── Hero: artwork, what it is, what to do, and the key facts ─────────────── -->
      <section class="relative overflow-hidden border-b border-border/60">
        <div
          class="absolute inset-0 opacity-20 dark:opacity-25 blur-3xl scale-125 pointer-events-none bg-center bg-cover"
          :style="{ backgroundImage: `url(${primaryCoverUrl})` }"
        />
        <div class="absolute inset-0 bg-gradient-to-b from-background/30 via-background/70 to-background pointer-events-none" />

        <div class="relative max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div class="flex flex-col sm:flex-row gap-6 lg:gap-10 items-center sm:items-start">
            <!-- Poster (a 3D stack for a multi-volume book/comic series) -->
            <div class="relative w-44 sm:w-52 md:w-64 lg:w-72 aspect-[2/3] flex-shrink-0">
              <template v-if="!isVideoType">
                <div
                  v-if="series.volumes?.length > 2"
                  class="absolute inset-0 rounded-xl bg-muted/60 border border-border/40 shadow-sm"
                  style="transform: translate(6px, -6px) rotate(2.5deg); z-index: 1"
                />
                <div
                  v-if="series.volumes?.length > 1"
                  class="absolute inset-0 rounded-xl bg-muted/80 border border-border/60 shadow-md"
                  style="transform: translate(3px, -3px) rotate(1.2deg); z-index: 2"
                />
              </template>
              <div class="absolute inset-0 rounded-xl overflow-hidden bg-card border border-border/80 shadow-2xl" style="z-index: 3">
                <img :src="primaryCoverUrl" :alt="series.name" class="w-full h-full object-cover" />
                <div v-if="isSingle && (single.progress_percent > 0 || single.is_finished)" class="absolute bottom-0 inset-x-0 h-1.5 bg-black/50">
                  <div
                    class="h-full"
                    :class="single.is_finished ? 'bg-emerald-500' : 'bg-primary'"
                    :style="{ width: `${single.is_finished ? 100 : single.progress_percent}%` }"
                  />
                </div>
              </div>
            </div>

            <!-- Title, facts, actions -->
            <div class="flex-1 min-w-0 max-w-4xl flex flex-col gap-3.5 text-center sm:text-left">
              <div>
                <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                  <span class="text-xs font-mono uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                    {{ series.standalone ? vocab.type.replace(/s$/, '') : vocab.series }}
                  </span>
                  <span v-if="shownStatus" class="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                    {{ shownStatus }}
                  </span>
                </div>
                <h1 class="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground">
                  {{ series.name }}
                </h1>
                <!-- Year · runtime · seasons/episodes · age rating -->
                <p v-if="metaLine.length" class="mt-2 text-sm text-muted-foreground flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1">
                  <template v-for="(part, i) in metaLine" :key="part">
                    <span v-if="i > 0" class="text-muted-foreground/50" aria-hidden="true">·</span>
                    <span :class="part === ageRating ? 'px-1.5 rounded border border-muted-foreground/40 text-xs font-semibold' : ''">{{ part }}</span>
                  </template>
                </p>
              </div>

              <!-- Ratings: your stars, the server average, TMDB. On a series this rates one
                   entry at a time — the star button on any volume/episode below switches it. -->
              <div ref="heroRatingEl">
                <RatingBar
                  v-if="heroRatingItem"
                  :item="heroRatingItem"
                  :label="heroRatingLabel"
                  align="responsive"
                  @rated="handleRated"
                />
              </div>

              <!-- Actions -->
              <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <button
                  v-if="series.nextVolume"
                  @click="openVolumeReader(series.nextVolume)"
                  class="h-10 px-5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 font-semibold text-sm transition shadow-md shadow-primary/20 flex items-center gap-2 group"
                >
                  <Play v-if="smartCtaState.isResume || isTimeBasedType" class="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
                  <Book v-else-if="!smartCtaState.isFinished" class="w-4 h-4 group-hover:scale-110 transition-transform" />
                  <BookOpen v-else class="w-4 h-4 group-hover:scale-110 transition-transform" />
                  <span>{{ smartCtaState.label }}</span>
                  <span v-if="smartCtaState.subLabel" class="text-xs font-normal opacity-85 font-mono">
                    · {{ smartCtaState.subLabel }}
                  </span>
                </button>

                <button
                  @click="markAllAsRead"
                  :disabled="series.readCount === series.volumeCount || actionLoading"
                  class="hero-btn"
                  :title="`Mark everything as ${vocab.done.toLowerCase()}`"
                >
                  <Check class="w-4 h-4 text-emerald-500" />
                  <span class="hidden sm:inline">Mark {{ series.volumeCount > 1 ? 'All ' : '' }}{{ vocab.done }}</span>
                </button>
                <button
                  @click="markAllAsUnread"
                  :disabled="series.readCount === 0 && series.inProgressCount === 0 || actionLoading"
                  class="hero-btn"
                  title="Reset your history for this"
                >
                  <RotateCcw class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">Reset History</span>
                </button>
                <button
                  v-if="series.volumeCount > 1"
                  @click="openSkipDialog"
                  :disabled="actionLoading"
                  class="hero-btn"
                  :title="`Skip ${vocab.units.toLowerCase()} you've already covered`"
                >
                  <FastForward class="w-4 h-4 text-sky-500" />
                  <span class="hidden sm:inline">Skip {{ vocab.units }}…</span>
                </button>
                <button
                  v-if="isSingle && downloads.canDownload(single)"
                  @click="toggleVolumeDownload(single)"
                  class="hero-btn"
                  :title="downloadLabel(single)"
                  :aria-label="downloadLabel(single)"
                >
                  <CheckCircle2 v-if="downloads.isDownloaded(single.id)" class="w-4 h-4 text-emerald-500" />
                  <Loader2 v-else-if="downloads.isDownloading(single.id)" class="w-4 h-4 animate-spin" />
                  <Download v-else class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">{{ downloads.isDownloaded(single.id) ? 'Downloaded' : (downloads.isDownloading(single.id) ? 'Downloading…' : 'Download') }}</span>
                </button>
                <button
                  v-if="isSingle"
                  @click="openBookmarks(single)"
                  class="hero-btn"
                  title="Bookmarks & Notes"
                  aria-label="Bookmarks & Notes"
                >
                  <Bookmark class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">Bookmarks</span>
                </button>
                <button
                  v-if="!isSingle && downloads.supported && undownloadedUnread.length"
                  @click="downloadUnread"
                  class="hero-btn"
                  :title="`Download ${undownloadedUnread.length} ${vocab.units.toLowerCase()} you haven't finished, for offline use`"
                >
                  <Download class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">Download Remaining ({{ undownloadedUnread.length }})</span>
                </button>
                <button
                  v-if="authStore.isEditor"
                  @click="openSeriesMetadataSearch"
                  class="hero-btn"
                  :title="`Search metadata providers and apply to ${series.volumeCount > 1 ? `all ${vocab.units.toLowerCase()}` : 'this title'}`"
                >
                  <Search class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">Edit Metadata</span>
                </button>
              </div>

              <!-- Progress through a series (a single title shows it on the poster) -->
              <div v-if="!isSingle" class="w-full max-w-md mx-auto sm:mx-0">
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="text-muted-foreground font-medium">Progress</span>
                  <span class="font-mono font-semibold text-foreground">
                    {{ series.readCount }}<template v-if="series.skippedCount"> + {{ series.skippedCount }} skipped</template> / {{ unitsLabel(series.volumeCount).toLowerCase() }} ({{ series.overallProgress }}%)
                  </span>
                </div>
                <div class="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    class="h-full transition-all duration-500 rounded-full"
                    :class="series.overallProgress >= 100 ? 'bg-emerald-500' : 'bg-primary'"
                    :style="{ width: `${series.overallProgress}%` }"
                  />
                </div>
              </div>
              <p v-else-if="hasStarted(single) && !single.is_finished" class="text-xs text-muted-foreground font-mono">
                {{ singleProgressLabel }}
              </p>

              <!-- Tagline + overview -->
              <p v-if="credits?.tagline" class="text-base italic text-foreground/80">{{ credits.tagline }}</p>
              <!-- A collection's "description" is just its first film's plot; each film lists its own below. -->
              <div v-if="series.description && !isMovieCollection">
                <p
                  class="text-sm text-foreground/85 leading-relaxed whitespace-pre-line text-left"
                  :class="overviewExpanded ? '' : 'line-clamp-4'"
                >{{ series.description }}</p>
                <button
                  v-if="series.description.length > 320"
                  @click="overviewExpanded = !overviewExpanded"
                  class="mt-1 text-xs font-semibold text-primary hover:underline"
                >
                  {{ overviewExpanded ? 'Show less' : 'Read more' }}
                </button>
              </div>

              <!-- Key facts: Genres, Director, Writers, Studios… -->
              <dl v-if="infoRows.length" class="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm text-left">
                <template v-for="row in infoRows" :key="row.label">
                  <dt class="text-muted-foreground">{{ row.label }}</dt>
                  <dd class="text-foreground font-medium min-w-0 break-words">{{ row.value }}</dd>
                </template>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-10">
        <!-- ─── Seasons & episodes (shows, anime) ───────────────────────────────────── -->
        <section v-if="isEpisodic" class="flex flex-col gap-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 class="section-title">
              {{ seasons.length > 1 ? 'Seasons' : 'Episodes' }}
              <span class="count-pill">{{ seasons.length > 1 ? seasons.length : series.volumeCount }}</span>
            </h2>
            <div class="flex items-center gap-2">
              <button
                v-if="activeSeason"
                @click="toggleSeasonWatched(activeSeason)"
                :disabled="actionLoading"
                class="h-8 px-3 rounded-lg bg-card hover:bg-muted border border-border text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Check class="w-3.5 h-3.5" :class="activeSeason.watched === activeSeason.episodes.length ? 'text-muted-foreground' : 'text-emerald-500'" />
                {{ activeSeason.watched === activeSeason.episodes.length ? 'Mark Unwatched' : `Mark ${activeSeason.label} Watched` }}
              </button>
              <button
                @click="sortAscending = !sortAscending"
                class="h-8 px-2.5 rounded-lg bg-card hover:bg-muted border border-border text-xs font-medium transition flex items-center gap-1.5"
                :title="sortAscending ? 'Order: first to last' : 'Order: last to first'"
              >
                <ArrowUpDown class="w-3.5 h-3.5 text-muted-foreground" />
                {{ sortAscending ? 'Oldest first' : 'Newest first' }}
              </button>
            </div>
          </div>

          <!-- Season picker -->
          <div v-if="seasons.length > 1" class="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            <button
              v-for="s in seasons"
              :key="s.key"
              @click="activeSeasonKey = s.key"
              class="flex-shrink-0 px-4 py-2 rounded-xl border text-sm font-medium transition flex items-center gap-2"
              :class="activeSeason?.key === s.key
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card border-border text-foreground hover:bg-muted'"
            >
              <span>{{ s.label }}</span>
              <CheckCircle2 v-if="s.watched === s.episodes.length" class="w-4 h-4" :class="activeSeason?.key === s.key ? '' : 'text-emerald-500'" />
              <span v-else class="text-xs font-mono opacity-75">{{ s.watched ? `${s.watched}/` : '' }}{{ s.episodes.length }}</span>
            </button>
          </div>

          <!-- Episodes of the chosen season -->
          <div v-if="activeSeason" class="flex flex-col divide-y divide-border/60 rounded-2xl border border-border bg-card/40 overflow-hidden">
            <div
              v-for="ep in seasonEpisodes"
              :key="ep.id"
              class="group flex gap-3 sm:gap-5 p-3 sm:p-4 hover:bg-muted/30 transition"
              :class="ep.id === series.nextVolume?.id ? 'bg-primary/5' : ''"
            >
              <!-- Still -->
              <button
                type="button"
                @click="openVolumeReader(ep)"
                class="relative w-32 sm:w-56 lg:w-64 aspect-video self-start rounded-lg overflow-hidden bg-muted flex-shrink-0"
                :aria-label="`Play ${ep.title}`"
              >
                <img
                  :src="stillFailed[ep.id] ? volumeCoverUrl(ep, 720) : stillUrl(ep)"
                  :alt="''"
                  loading="lazy"
                  decoding="async"
                  @error="stillFailed[ep.id] = true"
                  class="w-full h-full object-cover"
                  :class="isSkipped(ep) ? 'opacity-45 grayscale' : ''"
                />
                <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                  <div class="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl">
                    <Play class="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>
                <span v-if="ep.is_finished" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                  <Check class="w-3.5 h-3.5 stroke-[3]" />
                </span>
                <div v-if="ep.progress_percent > 0 && !ep.is_finished" class="absolute bottom-0 inset-x-0 h-1.5 bg-black/50">
                  <div class="h-full bg-primary" :style="{ width: `${ep.progress_percent}%` }" />
                </div>
              </button>

              <!-- Episode info -->
              <div class="flex-1 min-w-0 flex flex-col gap-1.5">
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-sm sm:text-base font-semibold text-foreground">
                    <span v-if="episodeNumber(ep)" class="text-muted-foreground font-mono mr-1">{{ episodeNumber(ep) }}.</span>
                    <button type="button" @click="openVolumeReader(ep)" class="hover:underline text-left">{{ ep.title }}</button>
                  </h3>
                  <span v-if="ep.duration" class="text-xs text-muted-foreground font-mono flex-shrink-0 mt-0.5">{{ formatLength(ep.duration) }}</span>
                </div>

                <p class="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span v-if="ep.id === series.nextVolume?.id && !ep.is_finished" class="px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-semibold">Up next</span>
                  <span v-if="ep.is_finished" class="text-emerald-500 font-semibold">Watched<template v-if="ep.progress_updated_at"> · {{ formatDate(ep.progress_updated_at) }}</template></span>
                  <span v-else-if="isSkipped(ep)" class="text-sky-500 font-semibold">Skipped</span>
                  <span v-else-if="hasStarted(ep)" class="text-primary font-medium font-mono">{{ positionLabel(ep, true) }}</span>
                </p>

                <p v-if="episodeOverview(ep)" class="text-sm text-muted-foreground leading-relaxed line-clamp-3">{{ episodeOverview(ep) }}</p>

                <div class="mt-auto pt-1 flex items-center gap-1.5">
                  <button
                    @click="toggleVolumeReadStatus(ep)"
                    class="ep-btn"
                    :title="ep.is_finished ? 'Mark as not watched' : 'Mark as watched'"
                    :aria-label="ep.is_finished ? 'Mark as not watched' : 'Mark as watched'"
                  >
                    <CheckCircle2 v-if="ep.is_finished" class="w-4 h-4 text-emerald-500" />
                    <Check v-else class="w-4 h-4" />
                  </button>
                  <button
                    v-if="!ep.is_finished"
                    @click="toggleVolumeSkipped(ep)"
                    class="ep-btn"
                    :class="isSkipped(ep) ? '!border-sky-500/50 !text-sky-500' : ''"
                    :title="isSkipped(ep) ? 'Skipped — tap to unskip' : 'Skip this episode'"
                    :aria-label="isSkipped(ep) ? 'Unskip episode' : 'Skip episode'"
                  >
                    <FastForward class="w-4 h-4" />
                  </button>
                  <button
                    v-if="downloads.canDownload(ep)"
                    @click="toggleVolumeDownload(ep)"
                    class="ep-btn"
                    :title="downloadLabel(ep)"
                    :aria-label="downloadLabel(ep)"
                  >
                    <CheckCircle2 v-if="downloads.isDownloaded(ep.id)" class="w-4 h-4 text-emerald-500" />
                    <Loader2 v-else-if="downloads.isDownloading(ep.id)" class="w-4 h-4 animate-spin" />
                    <Download v-else class="w-4 h-4" />
                  </button>
                  <button
                    v-if="customizationStore.ratings.showPersonal"
                    @click="openRating(ep)"
                    class="ep-btn gap-1 !w-auto px-2"
                    :title="ep.user_rating ? `You rated this ${ep.user_rating}/5 — change it in the header` : 'Rate this episode in the header'"
                    aria-label="Rate this episode"
                  >
                    <Star class="w-4 h-4" :class="ep.user_rating ? 'text-amber-400 fill-amber-400' : ''" />
                    <span v-if="ep.user_rating" class="text-xs font-semibold text-foreground">{{ ep.user_rating }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ─── A movie collection (Shrek, Star Wars…): its films in order ──────────── -->
        <section v-else-if="isMovieCollection" class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="section-title">
              Movies
              <span class="count-pill">{{ series.volumeCount }}</span>
            </h2>
            <button
              @click="sortAscending = !sortAscending"
              class="h-8 px-2.5 rounded-lg bg-card hover:bg-muted border border-border text-xs font-medium transition flex items-center gap-1.5"
              :title="sortAscending ? 'Order: first to last' : 'Order: last to first'"
            >
              <ArrowUpDown class="w-3.5 h-3.5 text-muted-foreground" />
              {{ sortAscending ? 'Oldest first' : 'Newest first' }}
            </button>
          </div>

          <div class="flex flex-col divide-y divide-border/60 rounded-2xl border border-border bg-card/40 overflow-hidden">
            <div
              v-for="(film, i) in collectionFilms"
              :key="film.id"
              class="group flex gap-3 sm:gap-5 p-3 sm:p-4 hover:bg-muted/30 transition"
              :class="film.id === series.nextVolume?.id ? 'bg-primary/5' : ''"
            >
              <router-link
                :to="`/title/${film.id}`"
                class="relative w-20 sm:w-28 aspect-[2/3] self-start rounded-lg overflow-hidden bg-muted border border-border flex-shrink-0"
              >
                <img :src="volumeCoverUrl(film)" :alt="film.title" loading="lazy" class="w-full h-full object-cover" />
                <span v-if="film.is_finished" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                  <Check class="w-3.5 h-3.5 stroke-[3]" />
                </span>
                <div v-if="film.progress_percent > 0 && !film.is_finished" class="absolute bottom-0 inset-x-0 h-1.5 bg-black/50">
                  <div class="h-full bg-primary" :style="{ width: `${film.progress_percent}%` }" />
                </div>
              </router-link>

              <div class="flex-1 min-w-0 flex flex-col gap-1.5">
                <h3 class="text-sm sm:text-base font-semibold text-foreground">
                  <span class="text-muted-foreground font-mono mr-1">{{ sortAscending ? i + 1 : collectionFilms.length - i }}.</span>
                  <router-link :to="`/title/${film.id}`" class="hover:underline">{{ film.title }}</router-link>
                </h3>
                <p class="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span v-if="yearOf(film)">{{ yearOf(film) }}</span>
                  <span v-if="film.duration">{{ formatLength(film.duration) }}</span>
                  <span v-if="film.id === series.nextVolume?.id && !film.is_finished" class="px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-semibold">Up next</span>
                  <span v-if="film.is_finished" class="text-emerald-500 font-semibold">Watched<template v-if="film.progress_updated_at"> · {{ formatDate(film.progress_updated_at) }}</template></span>
                  <span v-else-if="hasStarted(film)" class="text-primary font-medium font-mono">{{ positionLabel(film, true) }}</span>
                  <span v-if="film.user_rating" class="inline-flex items-center gap-0.5 text-foreground font-semibold">
                    <Star class="w-3.5 h-3.5 text-amber-400 fill-amber-400" />{{ film.user_rating }}
                  </span>
                </p>
                <p v-if="film.description" class="text-sm text-muted-foreground leading-relaxed line-clamp-2 sm:line-clamp-3">{{ film.description }}</p>

                <div class="mt-auto pt-1 flex items-center gap-1.5">
                  <button
                    @click="openVolumeReader(film)"
                    class="h-8 px-3 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <Play class="w-3.5 h-3.5 fill-current" />
                    {{ film.is_finished ? 'Watch Again' : (hasStarted(film) ? 'Resume' : 'Play') }}
                  </button>
                  <button
                    @click="toggleVolumeReadStatus(film)"
                    class="ep-btn"
                    :title="film.is_finished ? 'Mark as not watched' : 'Mark as watched'"
                    :aria-label="film.is_finished ? 'Mark as not watched' : 'Mark as watched'"
                  >
                    <CheckCircle2 v-if="film.is_finished" class="w-4 h-4 text-emerald-500" />
                    <Check v-else class="w-4 h-4" />
                  </button>
                  <button
                    v-if="downloads.canDownload(film)"
                    @click="toggleVolumeDownload(film)"
                    class="ep-btn"
                    :title="downloadLabel(film)"
                    :aria-label="downloadLabel(film)"
                  >
                    <CheckCircle2 v-if="downloads.isDownloaded(film.id)" class="w-4 h-4 text-emerald-500" />
                    <Loader2 v-else-if="downloads.isDownloading(film.id)" class="w-4 h-4 animate-spin" />
                    <Download v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ─── Volumes / books / films in a collection ─────────────────────────────── -->
        <section v-else-if="!isSingle" class="flex flex-col gap-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 class="section-title">
              {{ vocab.units }}
              <span class="count-pill">{{ filteredVolumes.length }}</span>
            </h2>

            <div class="flex flex-wrap items-center justify-between sm:justify-end gap-2">
              <div class="flex items-center bg-muted/50 p-0.5 rounded-lg border border-border overflow-x-auto no-scrollbar max-w-full">
                <button
                  v-for="tab in filterTabs"
                  :key="tab.id"
                  @click="activeFilterTab = tab.id"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 flex-shrink-0',
                    activeFilterTab === tab.id
                      ? 'bg-background text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  ]"
                >
                  <span>{{ tab.label }}</span>
                  <span class="font-mono text-[11px] opacity-75">({{ tab.count }})</span>
                </button>
              </div>

              <div class="flex items-center gap-1.5">
                <button
                  @click="sortAscending = !sortAscending"
                  class="h-7 px-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-medium transition flex items-center gap-1.5"
                  :title="sortAscending ? 'Order: first to last' : 'Order: last to first'"
                >
                  <ArrowUpDown class="w-3 h-3 text-muted-foreground" />
                  <span class="font-mono text-xs">{{ sortAscending ? '1 → N' : 'N → 1' }}</span>
                </button>
                <div class="flex items-center bg-muted/50 p-0.5 rounded-lg border border-border">
                  <button
                    aria-label="Grid view"
                    @click="viewLayout = 'grid'"
                    :class="['p-1 rounded-md transition', viewLayout === 'grid' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
                    title="Grid view"
                  >
                    <LayoutGrid class="w-3.5 h-3.5" />
                  </button>
                  <button
                    aria-label="List view"
                    @click="viewLayout = 'list'"
                    :class="['p-1 rounded-md transition', viewLayout === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
                    title="List view"
                  >
                    <List class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

        <!-- Empty Filtered Results -->
        <div
          v-if="filteredVolumes.length === 0"
          class="py-16 text-center border border-dashed border-border rounded-2xl bg-card/30"
        >
          <BookX class="w-10 h-10 text-muted-foreground/60 mx-auto mb-2" />
          <h3 class="text-sm font-semibold text-foreground">Nothing in this filter</h3>
          <p class="text-xs text-muted-foreground mt-1">Switch to the "All" tab to see every {{ vocab.unit.toLowerCase() }}.</p>
        </div>

        <!-- Volumes View: Grid Layout -->
        <div
          v-else-if="viewLayout === 'grid'"
          class="poster-grid gap-4"
        >
          <div
            v-for="vol in filteredVolumes"
            :key="vol.id"
            class="group relative flex flex-col bg-card border border-border hover:border-muted-foreground/30 rounded-2xl p-3 transition-all hover:shadow-md"
          >
            <!-- Thumbnail with interactive click to read -->
            <div
              @click="openEntry(vol)"
              class="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-muted/50 border border-border/60 cursor-pointer"
            >
              <img
                :src="volumeCoverUrl(vol)"
                :alt="vol.title"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                :class="isSkipped(vol) ? 'opacity-45 grayscale' : ''"
              />

              <!-- Volume Pill -->
              <div class="absolute top-2 left-2 z-10 pointer-events-none">
                <span
                  v-if="vol.volume != null"
                  class="inline-flex items-center px-2 py-0.5 rounded-md bg-background/90 text-foreground backdrop-blur-md text-[12px] font-mono font-bold border border-border/80 shadow-sm"
                >
                  {{ entryLabel(vol) }}
                </span>
              </div>

              <!-- Read Status Overlay Badge (Top Right) -->
              <div class="absolute top-2 right-2 z-10 pointer-events-none">
                <span
                  v-if="vol.is_finished"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[11px] font-bold shadow-md"
                >
                  <Check class="w-3 h-3 stroke-[3]" /> {{ vocab.done }}
                </span>
                <span
                  v-else-if="isSkipped(vol)"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500 text-white text-[11px] font-bold shadow-md"
                >
                  <FastForward class="w-3 h-3" /> Skipped
                </span>
                <span
                  v-else-if="vol.progress_percent > 0"
                  class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground text-[11px] font-mono font-bold shadow-md"
                >
                  {{ Math.round(vol.progress_percent) }}%
                </span>
                <span
                  v-else
                  class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-black/60 text-zinc-300 text-[11px] font-medium backdrop-blur-sm"
                >
                  New
                </span>
              </div>

              <!-- Hover Read Button overlay -->
              <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
                  <Play v-if="(isTimeBasedType || hasStarted(vol)) && !vol.is_finished" class="w-5 h-5 fill-current ml-0.5" />
                  <Book v-else-if="!vol.is_finished" class="w-5 h-5" />
                  <BookOpen v-else class="w-5 h-5" />
                </div>
              </div>

              <!-- Progress bar at bottom of thumbnail -->
              <div v-if="vol.progress_percent > 0 || vol.is_finished" class="absolute bottom-0 inset-x-0 h-1.5 bg-background/80">
                <div
                  class="h-full transition-all"
                  :class="vol.is_finished ? 'bg-emerald-500' : 'bg-primary'"
                  :style="{ width: `${vol.is_finished ? 100 : vol.progress_percent}%` }"
                />
              </div>
            </div>

            <!-- Volume Info & History Status -->
            <div class="mt-3 flex flex-col flex-1">
              <h3
                @click="openEntry(vol)"
                class="text-xs font-semibold text-foreground truncate cursor-pointer hover:underline"
                :title="vol.title"
              >
                {{ vol.title }}
              </h3>

              <div class="mt-1 flex items-center justify-between text-[12px] text-muted-foreground">
                <span class="font-mono" :class="lengthLabel(vol) === vol.format ? 'uppercase' : ''">{{ lengthLabel(vol) }}</span>

                <!-- Read history text -->
                <span v-if="vol.is_finished" class="text-emerald-500 font-semibold flex items-center gap-0.5">
                  <Check class="w-3 h-3" /> Done
                </span>
                <span v-else-if="isSkipped(vol)" class="text-sky-500 font-semibold flex items-center gap-0.5">
                  <FastForward class="w-3 h-3" /> Skipped
                </span>
                <span v-else-if="hasStarted(vol)" class="text-primary font-mono font-medium">
                  {{ positionLabel(vol) }}
                </span>
                <span v-else class="text-muted-foreground/80">
                  New
                </span>
              </div>

              <!-- Bottom Quick Action Row -->
              <div class="mt-auto pt-2.5 flex items-center gap-1.5 border-t border-border/50">
                <button
                  @click="openVolumeReader(vol)"
                  class="flex-1 h-8 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-medium transition flex items-center justify-center gap-1"
                >
                  <Book v-if="!vol.is_finished && !hasStarted(vol)" class="w-3.5 h-3.5" />
                  <BookOpen v-else class="w-3.5 h-3.5" />
                  <span>{{ vol.is_finished ? 'Again' : (hasStarted(vol) ? 'Resume' : vocab.verb) }}</span>
                </button>

                <!-- Mark Read / Unread 1-Click Toggle -->
                <button :aria-label="vol.is_finished ? 'Mark as not started' : `Mark as ${vocab.done.toLowerCase()}`"
                  @click="toggleVolumeReadStatus(vol)"
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                  :title="vol.is_finished ? 'Mark as not started' : `Mark as ${vocab.done.toLowerCase()}`"
                >
                  <BookCheck v-if="vol.is_finished" class="w-4 h-4 text-emerald-500" />
                  <Book v-else class="w-4 h-4" />
                </button>

                <button v-if="!vol.is_finished" :aria-label="isSkipped(vol) ? `Unskip ${vocab.unit.toLowerCase()}` : `Skip ${vocab.unit.toLowerCase()}`"
                  @click="toggleVolumeSkipped(vol)"
                  class="w-8 h-8 rounded-lg border hover:bg-muted flex items-center justify-center transition active:scale-95"
                  :class="isSkipped(vol) ? 'border-sky-500/50 text-sky-500' : 'border-border text-muted-foreground hover:text-foreground'"
                  :title="isSkipped(vol) ? 'Skipped — tap to unskip' : `Skip this ${vocab.unit.toLowerCase()}`"
                >
                  <FastForward class="w-3.5 h-3.5" />
                </button>

                <!-- Bookmarks button -->
                <button aria-label="Bookmarks & Notes"
                  @click="openBookmarks(vol)"
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                  title="Bookmarks & Notes"
                >
                  <Bookmark class="w-3.5 h-3.5" />
                </button>

                <button v-if="downloads.canDownload(vol)" :aria-label="downloadLabel(vol)"
                  @click="toggleVolumeDownload(vol)"
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                  :title="downloadLabel(vol)"
                >
                  <CheckCircle2 v-if="downloads.isDownloaded(vol.id)" class="w-3.5 h-3.5 text-emerald-500" />
                  <Loader2 v-else-if="downloads.isDownloading(vol.id)" class="w-3.5 h-3.5 animate-spin" />
                  <Download v-else class="w-3.5 h-3.5" />
                </button>

                <!-- Rate — shows your stars once you've rated it; the stars themselves are in the header -->
                <button v-if="customizationStore.ratings.showPersonal" :aria-label="`Rate this ${vocab.unit.toLowerCase()}`"
                  @click="openRating(vol)"
                  class="h-8 min-w-8 px-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center gap-0.5 transition active:scale-95 text-[12px] font-semibold"
                  :title="vol.user_rating ? `You rated this ${vol.user_rating}/5 — change it in the header` : `Rate this ${vocab.unit.toLowerCase()} in the header`"
                >
                  <Star class="w-3.5 h-3.5" :class="vol.user_rating ? 'text-amber-400 fill-amber-400' : ''" />
                  <span v-if="vol.user_rating" class="text-foreground">{{ vol.user_rating }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Volumes View: List Layout -->
        <div v-else class="flex flex-col gap-2.5">
          <div
            v-for="vol in filteredVolumes"
            :key="vol.id"
            class="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-2xl bg-card hover:bg-muted/40 border border-border hover:border-muted-foreground/30 transition-all shadow-sm"
          >
            <!-- Left: Cover & Info -->
            <div class="flex items-center gap-4 min-w-0">
              <!-- Thumbnail -->
              <div
                @click="openEntry(vol)"
                class="relative w-14 h-20 rounded-xl overflow-hidden bg-muted/50 border border-border/70 flex-shrink-0 cursor-pointer group-hover:shadow-md transition"
              >
                <img
                  :src="volumeCoverUrl(vol)"
                  :alt="vol.title"
                  loading="lazy"
                  class="w-full h-full object-cover"
                  :class="isSkipped(vol) ? 'opacity-45 grayscale' : ''"
                />
                <div
                  v-if="vol.is_finished"
                  class="absolute inset-0 bg-black/40 flex items-center justify-center"
                >
                  <BookCheck class="w-5 h-5 text-emerald-400" />
                </div>
              </div>

              <!-- Details & History -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span
                    v-if="vol.volume != null"
                    class="text-xs font-mono font-bold bg-primary/10 text-primary border border-primary/20 rounded-md px-2 py-0.5 flex-shrink-0"
                  >
                    {{ entryLabel(vol) }}
                  </span>
                  <h3
                    @click="openEntry(vol)"
                    class="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline"
                    :title="vol.title"
                  >
                    {{ vol.title }}
                  </h3>
                </div>

                <!-- Reading History Status Details -->
                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span class="font-mono" :class="lengthLabel(vol) === vol.format ? 'uppercase' : ''">{{ lengthLabel(vol) }}</span>
                  <span v-if="vol.file_size" class="font-mono">{{ formatFileSize(vol.file_size) }}</span>

                  <!-- Status state -->
                  <span v-if="vol.is_finished" class="text-emerald-500 font-semibold flex items-center gap-1">
                    <BookCheck class="w-3.5 h-3.5" />
                    <span>Finished</span>
                    <span v-if="vol.progress_updated_at" class="text-muted-foreground font-normal ml-1">
                      ({{ formatDate(vol.progress_updated_at) }})
                    </span>
                  </span>
                  <span v-else-if="isSkipped(vol)" class="text-sky-500 font-medium flex items-center gap-1">
                    <FastForward class="w-3.5 h-3.5" />
                    <span>Skipped</span>
                  </span>
                  <span v-else-if="hasStarted(vol)" class="text-primary font-medium flex items-center gap-1">
                    <BookOpen class="w-3.5 h-3.5" />
                    <span>{{ positionLabel(vol, true) }} ({{ Math.round(vol.progress_percent || 0) }}%)</span>
                    <span v-if="vol.progress_updated_at" class="text-muted-foreground font-normal ml-1">
                      · {{ formatDate(vol.progress_updated_at) }}
                    </span>
                  </span>
                  <span v-else class="text-muted-foreground/80 flex items-center gap-1">
                    <Book class="w-3.5 h-3.5" />
                    <span>Not started</span>
                  </span>
                </div>

                <!-- Progress bar -->
                <div v-if="vol.progress_percent > 0 || vol.is_finished" class="mt-2 max-w-md h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="vol.is_finished ? 'bg-emerald-500' : 'bg-primary'"
                    :style="{ width: `${vol.is_finished ? 100 : vol.progress_percent}%` }"
                  />
                </div>
              </div>
            </div>

            <!-- Right: Actions -->
            <div class="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
              <!-- Read / Resume Button -->
              <button
                @click="openVolumeReader(vol)"
                class="h-9 px-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition active:scale-95 flex items-center gap-1.5 shadow-sm"
              >
                <Play v-if="(isTimeBasedType || hasStarted(vol)) && !vol.is_finished" class="w-3.5 h-3.5 fill-current" />
                <Book v-else-if="!vol.is_finished" class="w-3.5 h-3.5" />
                <BookOpen v-else class="w-3.5 h-3.5" />
                <span>{{ vol.is_finished ? `${vocab.verb} Again` : (hasStarted(vol) ? 'Resume' : vocab.verb) }}</span>
              </button>

              <!-- Mark Read / Unread Button -->
              <button
                @click="toggleVolumeReadStatus(vol)"
                class="h-9 px-3 rounded-xl border border-border hover:bg-muted text-foreground text-xs font-medium transition active:scale-95 flex items-center gap-1.5"
                :title="vol.is_finished ? 'Mark as not started' : `Mark as ${vocab.done.toLowerCase()}`"
              >
                <BookCheck v-if="vol.is_finished" class="w-4 h-4 text-emerald-500" />
                <Book v-else class="w-4 h-4 text-muted-foreground" />
                <span class="hidden md:inline">{{ vol.is_finished ? 'Mark Not Started' : `Mark ${vocab.done}` }}</span>
              </button>

              <button v-if="!vol.is_finished" :aria-label="isSkipped(vol) ? `Unskip ${vocab.unit.toLowerCase()}` : `Skip ${vocab.unit.toLowerCase()}`"
                @click="toggleVolumeSkipped(vol)"
                class="h-9 px-3 rounded-xl border hover:bg-muted text-xs font-medium transition active:scale-95 flex items-center gap-1.5"
                :class="isSkipped(vol) ? 'border-sky-500/50 text-sky-500' : 'border-border text-foreground'"
                :title="isSkipped(vol) ? 'Skipped — tap to unskip' : `Skip this ${vocab.unit.toLowerCase()}`"
              >
                <FastForward class="w-4 h-4" :class="isSkipped(vol) ? '' : 'text-muted-foreground'" />
                <span class="hidden md:inline">{{ isSkipped(vol) ? 'Unskip' : 'Skip' }}</span>
              </button>

              <!-- Bookmarks Button -->
              <button aria-label="Bookmarks & Notes"
                @click="openBookmarks(vol)"
                class="w-9 h-9 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                title="Bookmarks & Notes"
              >
                <Bookmark class="w-4 h-4" />
              </button>

              <button v-if="downloads.canDownload(vol)" :aria-label="downloadLabel(vol)"
                @click="toggleVolumeDownload(vol)"
                class="w-9 h-9 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                :title="downloadLabel(vol)"
              >
                <CheckCircle2 v-if="downloads.isDownloaded(vol.id)" class="w-4 h-4 text-emerald-500" />
                <Loader2 v-else-if="downloads.isDownloading(vol.id)" class="w-4 h-4 animate-spin" />
                <Download v-else class="w-4 h-4" />
              </button>

              <!-- Rate — shows your stars once you've rated it; the stars themselves are in the header -->
              <button v-if="customizationStore.ratings.showPersonal" :aria-label="`Rate this ${vocab.unit.toLowerCase()}`"
                @click="openRating(vol)"
                class="h-9 min-w-9 px-2 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition active:scale-95 text-xs font-semibold"
                :title="vol.user_rating ? `You rated this ${vol.user_rating}/5 — change it in the header` : `Rate this ${vocab.unit.toLowerCase()} in the header`"
              >
                <Star class="w-4 h-4" :class="vol.user_rating ? 'text-amber-400 fill-amber-400' : ''" />
                <span v-if="vol.user_rating" class="text-foreground">{{ vol.user_rating }}</span>
              </button>
            </div>
          </div>
        </div>
        </section>

        <!-- ─── Cast & crew ─────────────────────────────────────────────────────────── -->
        <section v-if="people.length" class="flex flex-col gap-4">
          <h2 class="section-title">
            <Users class="w-5 h-5 text-muted-foreground" />
            Cast &amp; Crew
          </h2>
          <div class="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 pb-2">
            <div v-for="person in people" :key="person.key" class="w-28 sm:w-32 flex-shrink-0">
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-muted border border-border flex items-center justify-center">
                <img v-if="person.photo" :src="person.photo" :alt="person.name" loading="lazy" class="w-full h-full object-cover" />
                <span v-else class="text-2xl font-semibold text-muted-foreground/70">{{ initials(person.name) }}</span>
              </div>
              <p class="mt-2 text-sm font-semibold text-foreground leading-tight line-clamp-2">{{ person.name }}</p>
              <p v-if="person.role" class="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2">{{ person.role }}</p>
            </div>
          </div>
        </section>

        <!-- ─── Extras: trailers, featurettes, behind the scenes (never on the shelf) ─── -->
        <section v-if="extrasList.length" class="flex flex-col gap-4">
          <h2 class="section-title">
            <Clapperboard class="w-5 h-5 text-muted-foreground" />
            Extras
            <span class="count-pill">{{ extrasList.length }}</span>
          </h2>
          <div class="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 pb-2">
            <button
              v-for="extra in extrasList"
              :key="extra.id"
              type="button"
              @click="openVolumeReader(extra)"
              class="group w-60 sm:w-72 flex-shrink-0 text-left"
            >
              <div class="relative aspect-video rounded-xl overflow-hidden bg-muted border border-border">
                <img :src="volumeCoverUrl(extra, 720)" :alt="''" loading="lazy" class="w-full h-full object-cover" />
                <div class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-80 group-hover:opacity-100 transition">
                  <Play class="w-7 h-7 text-white fill-current" />
                </div>
              </div>
              <p class="mt-2 text-sm font-semibold text-foreground line-clamp-2">{{ extra.title }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ extra.extra_type }}<template v-if="extra.duration"> · {{ formatLength(extra.duration) }}</template></p>
            </button>
          </div>
        </section>

        <!-- ─── The rest of a movie's collection (Star Wars…) ───────────────────────── -->
        <section v-if="collection && collectionSiblings.length" class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="section-title">More in {{ collection.name }}</h2>
            <router-link
              :to="{ path: `/series/${encodeURIComponent(collection.name)}`, query: { library: collection.libraryId, type: collection.mediaType } }"
              class="text-sm font-medium text-primary hover:underline flex items-center gap-1 flex-shrink-0"
            >
              View all {{ collection.volumeCount }}
              <ChevronRight class="w-4 h-4" />
            </router-link>
          </div>
          <div class="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 pb-2">
            <router-link
              v-for="sib in collectionSiblings"
              :key="sib.id"
              :to="`/title/${sib.id}`"
              class="w-36 sm:w-44 flex-shrink-0 group"
            >
              <div class="aspect-[2/3] rounded-xl overflow-hidden bg-muted border border-border group-hover:border-muted-foreground/40 transition">
                <img :src="volumeCoverUrl(sib)" :alt="sib.title" loading="lazy" class="w-full h-full object-cover" />
              </div>
              <p class="mt-2 text-sm font-medium text-foreground line-clamp-2">{{ sib.title }}</p>
              <p v-if="sib.is_finished" class="text-xs text-emerald-500 font-semibold">{{ vocab.done }}</p>
            </router-link>
          </div>
        </section>

        <!-- ─── The file itself ─────────────────────────────────────────────────────── -->
        <section v-if="mediaFacts.length" class="flex flex-col gap-4">
          <h2 class="section-title">
            <Info class="w-5 h-5 text-muted-foreground" />
            {{ isSingle ? 'Media Info' : 'Details' }}
          </h2>
          <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 rounded-2xl border border-border bg-card/40 p-4 sm:p-5">
            <div v-for="fact in mediaFacts" :key="fact.label" class="min-w-0">
              <dt class="text-xs text-muted-foreground">{{ fact.label }}</dt>
              <dd class="text-sm text-foreground font-medium mt-0.5 break-words">{{ fact.value }}</dd>
            </div>
          </dl>
        </section>
      </div>
  </main>

    </div>

    <!-- Skip volumes dialog -->
    <div
      v-if="showSkipDialog && series"
      class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="showSkipDialog = false"
    >
      <div class="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5 flex flex-col gap-4" role="dialog" aria-labelledby="skip-dialog-title">
        <div>
          <h3 id="skip-dialog-title" class="text-sm font-semibold text-foreground flex items-center gap-2">
            <FastForward class="w-4 h-4 text-sky-500" />
            Skip {{ vocab.units.toLowerCase() }}
          </h3>
          <p class="text-xs text-muted-foreground mt-1">
            {{ skipHint }} Skipped {{ vocab.units.toLowerCase() }} count toward your progress and
            "Continue" picks up after them. Your history isn't changed, and opening a skipped
            {{ vocab.unit.toLowerCase() }} un-skips it.
          </p>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-foreground">I've covered everything through</span>
          <select
            v-model="skipThroughId"
            class="h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option v-for="v in orderedVolumes" :key="v.id" :value="v.id">{{ volumeLabel(v) }}{{ v.title && v.volume != null ? ` — ${v.title}` : '' }}</option>
          </select>
        </label>

        <p class="text-xs" :class="volumesToSkip.length ? 'text-foreground' : 'text-muted-foreground'">
          <template v-if="volumesToSkip.length">
            Skips <strong>{{ volumesToSkip.length }}</strong> {{ (volumesToSkip.length === 1 ? vocab.unit : vocab.units).toLowerCase() }} you haven't finished
            ({{ volumeLabel(volumesToSkip[0]) }}{{ volumesToSkip.length > 1 ? ` – ${volumeLabel(volumesToSkip[volumesToSkip.length - 1])}` : '' }}).
          </template>
          <template v-else>Nothing to skip — those are already {{ vocab.done.toLowerCase() }} or skipped.</template>
        </p>

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            v-if="series.skippedCount"
            type="button"
            @click="clearAllSkips"
            class="h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            Unskip all ({{ series.skippedCount }})
          </button>
          <span v-else />
          <div class="flex items-center gap-2">
            <button type="button" @click="showSkipDialog = false" class="h-9 px-3 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition">
              Cancel
            </button>
            <button
              type="button"
              @click="confirmSkipThrough"
              :disabled="!volumesToSkip.length"
              class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50"
            >
              Skip {{ volumesToSkip.length || '' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- EPUB reader and video player: every title opens here first, then plays from here -->
    <EpubReader
      v-if="activeEpubItem"
      :item="activeEpubItem"
      @close="activeEpubItem = null; fetchSeriesData()"
    />
    <VideoPlayer
      v-if="activeVideoItem"
      :key="activeVideoItem.id"
      :item="activeVideoItem"
      @close="activeVideoItem = null; fetchSeriesData()"
      @play-next="activeVideoItem = $event"
    />

    <!-- Fullscreen In-App Manga Reader -->
    <MangaReader
      v-if="activeReadingItem"
      :item="activeReadingItem"
      :volumes="readerVolumes"
      @switch-volume="handleSwitchVolume"
      @close="handleReaderClose"
    />

    <!-- Universal Bookmarks & Notes Modal -->
    <BookmarksModal
      :isOpen="showBookmarksModal"
      :item="selectedBookmarksItem"
      @close="showBookmarksModal = false"
      @select-manga-page="handleMangaJump"
    />


    <!-- External Metadata Search Modal (series-wide or single volume) -->
    <MetadataSearchModal
      :isOpen="showMetadataModal"
      :item="metadataTargetItem"
      :applyToIds="metadataApplyIds"
      @close="showMetadataModal = false"
      @applied="handleMetadataApplied"
    />
  </div>
</template>

<script setup>
import { placeholderCover } from '../utils/placeholder';
import { getMediaToken } from '../utils/mediaToken';
import { ref, reactive, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useThemeStore } from '../stores/theme';
import { useDialogStore } from '../stores/dialog';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';
const MangaReader = defineAsyncComponent(() => import('../components/MangaReader.vue'));
const EpubReader = defineAsyncComponent(() => import('../components/EpubReader.vue'));
const VideoPlayer = defineAsyncComponent(() => import('../components/VideoPlayer.vue'));
import { usePlayerStore } from '../stores/player';
import { vocabFor, entryLabel, isTimeBased, isVideo, realCreator } from '../utils/mediaVocab';
import { downloadKind } from '../stores/downloads';
const BookmarksModal = defineAsyncComponent(() => import('../components/BookmarksModal.vue'));
const MetadataSearchModal = defineAsyncComponent(() => import('../components/MetadataSearchModal.vue'));
import RatingBar from '../components/RatingBar.vue';
import { coverUrl as buildCoverUrl, stillUrl } from '../utils/cover';
import {
  ArrowLeft,
  ChevronRight,
  Sun,
  Moon,
  User,
  Palette,
  Home,
  Layers,
  Book,
  BookOpen,
  BookCheck,
  Folder,
  Play,
  Check,
  RotateCcw,
  ArrowUpDown,
  LayoutGrid,
  List,
  BookX,
  Bookmark,
  Star,
  AlertCircle,
  Loader2,
  Search,
  Download,
  CheckCircle2,
  FastForward,
  Clock,
  Clapperboard,
  Users,
  Info
} from 'lucide-vue-next';
import { useDownloadsStore } from '../stores/downloads';

const route = useRoute();
const router = useRouter();
const themeStore = useThemeStore();
const dialog = useDialogStore();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();

const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');

const token = getMediaToken() || '';

function handleNavFilter(type) {
  router.push({ path: '/', query: { type } });
}
function handleNavSearch(query) {
  if (query) {
    router.push({ path: '/', query: { search: query } });
  } else {
    router.push({ path: '/' });
  }
}

const loading = ref(true);
const actionLoading = ref(false);
const player = usePlayerStore();
// A title's extras, and (for a title in a collection) the collection it belongs to.
const overviewExpanded = ref(false);
const credits = ref(null);
const extrasList = ref([]);
const collection = ref(null);
// In release order, like the collection's own page.
const collectionSiblings = computed(() =>
  (collection.value?.volumes || [])
    .filter((v) => v.id !== series.value?.id)
    .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
);
const activeEpubItem = ref(null);
const activeVideoItem = ref(null);
const error = ref(null);
const series = ref(null);

// Filter & Sort State
const activeFilterTab = ref('all'); // 'all', 'unread', 'in_progress', 'completed'
const sortAscending = ref(true);
const viewLayout = ref('grid'); // 'grid' or 'list'

// Reader & Bookmarks Modal State
const activeReadingItem = ref(null);
const showBookmarksModal = ref(false);
const selectedBookmarksItem = ref(null);

// Metadata search/apply modal — used both for series-wide (author/series) and per-volume edits
const showMetadataModal = ref(false);
const metadataTargetItem = ref(null);
const metadataApplyIds = ref([]);

function openSeriesMetadataSearch() {
  if (!series.value) return;
  metadataTargetItem.value = {
    media_type: mediaType.value,
    title: series.value.name,
    series: series.value.name,
    author: series.value.author && series.value.author !== 'Unknown Author' ? series.value.author : null,
    artists: series.value.artists,
    description: series.value.description,
    genres: series.value.genres,
    themes: series.value.themes,
    publisher: series.value.publisher,
    status: series.value.status,
    release_date: series.value.release_date
  };
  metadataApplyIds.value = series.value.volumes.map((v) => v.id);
  showMetadataModal.value = true;
}

async function handleMetadataApplied() {
  showMetadataModal.value = false;
  await fetchSeriesData();
}

function splitTags(str) {
  return str ? str.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
const genreTags = computed(() => splitTags(series.value?.genres));
const themeTags = computed(() => splitTags(series.value?.themes));

// ─── Cover URLs ─────────────────────────────────────────────────────────────
const primaryCoverUrl = computed(() => {
  if (!series.value || !series.value.volumes || series.value.volumes.length === 0) {
    return placeholderCover(vocab.value.type, { width: 400, height: 600 });
  }
  // Show the cover for whichever volume is "current" (in progress, or next up to read)
  // rather than always volume 1, so the hero art tracks where you actually are in the series.
  let current = series.value.nextVolume || series.value.volumes[0];
  if (isVideo(current.media_type) && current.cover_source === 'frame') {
    current = series.value.volumes.find((v) => v.cover_path && v.cover_source !== 'frame') || current;
  }
  if (current.cover_path) {
    return buildCoverUrl(current, { width: 720 });
  }
  return placeholderCover(vocab.value.type, { width: 400, height: 600 });
});

function volumeCoverUrl(vol, width = 360) {
  if (vol.cover_path) {
    return buildCoverUrl(vol, { width });
  }
  return placeholderCover(vol.title?.charAt(0));
}

// ─── Filter Tabs & Counts ───────────────────────────────────────────────────
const filterTabs = computed(() => {
  if (!series.value || !series.value.volumes) return [];
  const vols = series.value.volumes;
  const completed = vols.filter(v => v.is_finished).length;
  const skipped = vols.filter(isSkipped).length;
  const inProgress = vols.filter(v => !v.is_finished && !isSkipped(v) && v.progress_percent > 0).length;
  const unread = vols.length - completed - skipped - inProgress;

  const tabs = [
    { id: 'all', label: `All ${vocab.value.units}`, count: vols.length },
    { id: 'unread', label: 'Not Started', count: unread },
    { id: 'in_progress', label: 'In Progress', count: inProgress },
    { id: 'completed', label: 'Completed', count: completed },
  ];
  if (skipped) tabs.push({ id: 'skipped', label: 'Skipped', count: skipped });
  return tabs;
});

// ─── Sorted and Filtered Volumes ────────────────────────────────────────────
const filteredVolumes = computed(() => {
  if (!series.value || !series.value.volumes) return [];

  let list = [...series.value.volumes];

  // Apply tab filter
  if (activeFilterTab.value === 'unread') {
    list = list.filter(v => !v.is_finished && !isSkipped(v) && (!v.progress_percent || v.progress_percent === 0));
  } else if (activeFilterTab.value === 'in_progress') {
    list = list.filter(v => !v.is_finished && !isSkipped(v) && v.progress_percent > 0);
  } else if (activeFilterTab.value === 'completed') {
    list = list.filter(v => v.is_finished);
  } else if (activeFilterTab.value === 'skipped') {
    list = list.filter(isSkipped);
  }

  // Apply sort order
  list.sort((a, b) => {
    let diff = 0;
    if (a.volume == null && b.volume == null) {
      diff = a.title.localeCompare(b.title, undefined, { numeric: true });
    } else if (a.volume == null) {
      diff = 1;
    } else if (b.volume == null) {
      diff = -1;
    } else {
      diff = a.volume - b.volume;
    }
    return sortAscending.value ? diff : -diff;
  });

  return list;
});

// ─── Smart CTA State ────────────────────────────────────────────────────────
const smartCtaState = computed(() => {
  const v = vocab.value;
  if (!series.value || !series.value.nextVolume) {
    return { label: `Start ${v.verbing}`, subLabel: '', isResume: false, isFinished: false };
  }
  const next = series.value.nextVolume;
  // A single title needs no "Vol 1" — the page is already about it.
  const which = series.value.volumeCount > 1 ? entryLabel(next) : '';

  if (!next.is_finished && hasStarted(next)) {
    return {
      label: `Continue ${v.verbing}`,
      subLabel: [which, positionLabel(next, true)].filter(Boolean).join(' · '),
      isResume: true,
      isFinished: false
    };
  } else if (coveredCount.value === series.value.volumeCount && series.value.volumeCount > 0) {
    return { label: `${v.verb} Again`, subLabel: which, isResume: false, isFinished: true };
  }
  return { label: `Start ${v.verbing}`, subLabel: which, isResume: false, isFinished: false };
});

// ─── Offline downloads ──────────────────────────────────────────────────────────
const downloads = useDownloadsStore();

function downloadLabel(vol) {
  if (downloads.isDownloaded(vol.id)) return 'Downloaded — tap to remove';
  if (downloads.isDownloading(vol.id)) return 'Downloading — tap to cancel';
  return 'Download for offline';
}

function toggleVolumeDownload(vol) {
  if (downloads.isDownloaded(vol.id)) downloads.remove(vol.id);
  else if (downloads.isDownloading(vol.id)) downloads.cancel(vol.id);
  else downloads.download(vol);
}

const undownloadedUnread = computed(() => (series.value?.volumes || []).filter(
  (v) => !v.is_finished && !isSkipped(v) && downloads.canDownload(v) && !downloads.isDownloaded(v.id) && !downloads.isDownloading(v.id)
));

// One at a time, in reading order, so the next volume is usable as soon as possible.
async function downloadUnread() {
  for (const vol of [...undownloadedUnread.value]) {
    await downloads.download(vol);
  }
}

// ─── Single titles ──────────────────────────────────────────────────────────
// A movie, a standalone book or audiobook — or a "series" the library only holds one of —
// gets a title page rather than a one-row list with tabs and sorting. A collection with
// more than one title (Star Wars, say) keeps the list.

const isSingle = computed(() => (series.value?.volumes?.length || 0) === 1);
const shownCreator = computed(() => realCreator(series.value?.author, series.value?.name));
const single = computed(() => (isSingle.value ? series.value.volumes[0] : null));

const singleProgressLabel = computed(() => {
  const it = single.value;
  if (!it) return '';
  if (it.is_finished) return vocab.value.done;
  if (isSkipped(it)) return 'Skipped';
  if (!hasStarted(it)) return 'Not started';
  return `${positionLabel(it, true)} (${Math.round(it.progress_percent || 0)}%)`;
});

const singleFacts = computed(() => {
  const it = single.value;
  if (!it) return [];
  const facts = [];
  const year = it.release_date || null;
  if (year) facts.push({ label: 'Released', value: year });
  if (isTimeBased(it.media_type) && it.duration) facts.push({ label: 'Length', value: formatLength(it.duration) });
  if (it.total_pages) facts.push({ label: 'Pages', value: it.total_pages.toLocaleString() });
  if (shownCreator.value) facts.push({ label: vocab.value.creator, value: shownCreator.value });
  if (it.artists && it.artists !== it.author) facts.push({ label: isVideo(it.media_type) ? 'Cast' : 'Artists', value: it.artists });
  if (it.genres) facts.push({ label: 'Genres', value: it.genres });
  if (it.publisher) facts.push({ label: 'Publisher', value: it.publisher });
  if (it.status) facts.push({ label: 'Status', value: it.status });
  if (it.format) facts.push({ label: 'Format', value: it.format.toUpperCase() });
  if (it.file_size) facts.push({ label: 'File size', value: formatFileSize(it.file_size) });
  if (series.value?.libraryName) facts.push({ label: 'Library', value: series.value.libraryName });
  if (it.progress_updated_at) facts.push({ label: 'Last opened', value: formatDate(it.progress_updated_at) });
  return facts;
});

// ─── Media-type vocabulary & helpers ────────────────────────────────────────
// This page serves every media type; the words (Volume/Episode, Read/Watch…) and how
// progress is shown (pages vs. time) follow the series being viewed.
const mediaType = computed(() =>
  series.value?.mediaType || series.value?.volumes?.[0]?.media_type || route.query.type || 'manga'
);
const vocab = computed(() => vocabFor(mediaType.value));
const isTimeBasedType = computed(() => isTimeBased(mediaType.value));
const navType = computed(() => mediaType.value);
const totalDuration = computed(() =>
  isTimeBasedType.value ? (series.value?.volumes || []).reduce((sum, v) => sum + (v.duration || 0), 0) : 0
);
const skipHint = computed(() => (mediaType.value === 'manga' || mediaType.value === 'book'
  ? 'Already know the story up to a point — say you watched the anime?'
  : 'Already seen or heard some of these elsewhere?'));

function unitsLabel(n) {
  return `${n} ${n === 1 ? vocab.value.unit : vocab.value.units}`;
}

function hasStarted(vol) {
  return isTimeBased(vol.media_type) ? (vol.current_time || 0) > 1 : (vol.current_page || 0) > 0;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatLength(seconds) {
  const mins = Math.round((seconds || 0) / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Where you are in it: "p. 42" / "Page 42 of 180" for pages, "12:05" / "12:05 of 45:00" for time.
function positionLabel(vol, long = false) {
  if (isTimeBased(vol.media_type)) {
    const at = formatClock(vol.current_time);
    return long && vol.duration ? `${at} of ${formatClock(vol.duration)}` : at;
  }
  if (!long) return `p. ${vol.current_page}`;
  return vol.total_pages ? `Page ${vol.current_page} of ${vol.total_pages}` : `Page ${vol.current_page}`;
}

// How long it is: pages for books/comics, running time for audio/video, else the format.
function lengthLabel(vol) {
  if (isTimeBased(vol.media_type) && vol.duration) return formatLength(vol.duration);
  if (vol.total_pages) return `${vol.total_pages} pages`;
  return vol.format || '';
}

// Same-named series can exist in several libraries / media types; bulk actions stay on
// the one being viewed.
function seriesScopeParams() {
  return { library: series.value?.libraryId || undefined, type: series.value?.mediaType || undefined };
}

// ─── Title page: facts, seasons, cast & crew ───────────────────────────────
// Declared after the media-type helpers above: the season watcher reads them at setup.
const isVideoType = computed(() => isVideo(mediaType.value));
// A movie collection (Shrek, Star Wars…) lists its films like a show lists episodes.
const isMovieCollection = computed(() => mediaType.value === 'movie' && !isSingle.value);
// Episodes whose still couldn't be grabbed (unreadable file): show the cover instead.
const stillFailed = reactive({});

function yearOf(item) {
  return item?.release_date ? String(item.release_date).slice(0, 4) : null;
}

// Release order — films in a collection rarely carry a number, and alphabetical puts
// "Shrek the Third" after "Shrek Forever After".
const collectionFilms = computed(() => {
  if (!isMovieCollection.value) return [];
  const list = [...(series.value?.volumes || [])].sort((a, b) =>
    (a.release_date || '9999').localeCompare(b.release_date || '9999') ||
    (a.volume ?? Infinity) - (b.volume ?? Infinity) ||
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
  return sortAscending.value ? list : list.reverse();
});
// A show's page lists its episodes by season; a lone episode opened on its own doesn't.
const isEpisodic = computed(() => (mediaType.value === 'show' || mediaType.value === 'anime') && !series.value?.standalone && (series.value?.volumes?.length || 0) > 0);

const ageRating = computed(() => single.value?.age_rating || series.value?.age_rating || series.value?.volumes?.[0]?.age_rating || null);
const shownStatus = computed(() => credits.value?.status || series.value?.status || single.value?.status || null);

const metaLine = computed(() => {
  const parts = [];
  const it = single.value || series.value?.volumes?.[0] || series.value;
  const year = series.value?.release_date ? String(series.value.release_date).slice(0, 4) : (it?.release_date ? String(it.release_date).slice(0, 4) : null);
  if (isMovieCollection.value) {
    // "2001–2010" for a collection, not just its first film's year.
    const years = (series.value?.volumes || []).map(yearOf).filter(Boolean).sort();
    if (years.length) parts.push(years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`);
  } else if (year) parts.push(year);
  if (isTimeBasedType.value) {
    if (isSingle.value && it?.duration) {
      parts.push(formatLength(it.duration));
    } else if (totalDuration.value > 0) {
      parts.push(formatLength(totalDuration.value));
    }
  } else if (series.value?.totalPages) {
    parts.push(`${series.value.totalPages.toLocaleString()} pages`);
  }
  if (isEpisodic.value) {
    if (seasons.value.length > 1) {
      parts.push(`${seasons.value.length} Seasons`);
    }
    const count = series.value?.volumeCount || series.value?.volumes?.length || 0;
    if (count > 0) {
      parts.push(`${count} Episodes`);
    }
  } else if (!isSingle.value && series.value?.volumeCount) {
    parts.push(unitsLabel(series.value.volumeCount));
  }
  const ar = ageRating.value;
  if (ar) parts.push(ar);
  return parts;
});

const infoRows = computed(() => {
  const rows = [];
  const c = credits.value;
  const s = series.value;
  const it = single.value || s?.volumes?.[0];

  const genres = s?.genres || it?.genres;
  if (genres) rows.push({ label: 'Genres', value: genres });

  if (isMovieCollection.value) {
    // Each film's own page carries its director, writers, studios and cast.
  } else if (isVideoType.value) {
    if (isEpisodic.value) {
      const creators = c?.creators?.length ? c.creators.join(', ') : shownCreator.value;
      if (creators) rows.push({ label: 'Created by', value: creators });
    } else {
      const directors = c?.crew?.filter(cr => cr.job === 'Director').map(cr => cr.name) || [];
      const dirStr = directors.length ? directors.join(', ') : shownCreator.value;
      if (dirStr) rows.push({ label: 'Director', value: dirStr });
    }
    const writers = c?.crew?.filter(cr => ['Screenplay', 'Writer', 'Story', 'Novel'].includes(cr.job)).map(cr => cr.name) || [];
    if (writers.length) rows.push({ label: 'Writers', value: Array.from(new Set(writers)).join(', ') });
    const studios = c?.studios?.length ? c.studios.join(', ') : (s?.publisher || it?.publisher);
    if (studios) rows.push({ label: 'Studios', value: studios });
    if (c?.networks?.length) rows.push({ label: 'Network', value: c.networks.join(', ') });
  } else {
    if (shownCreator.value) rows.push({ label: vocab.value.creator, value: shownCreator.value });
    if (s?.artists && s.artists !== s.author) rows.push({ label: 'Artists', value: s.artists });
    const publisher = s?.publisher || it?.publisher;
    if (publisher) rows.push({ label: 'Publisher', value: publisher });
  }

  return rows;
});

// Episodes store season + episode/1000 in `volume` (see the scanner), so S02E05 is 2.005.
// Season 0 is specials. An episode with no number goes under "Other".
function getSeasonEpisode(item) {
  if (item?.volume == null) return { season: null, episode: null };
  const v = Number(item.volume);
  const season = Math.floor(v);
  const episode = Math.round((v - season) * 1000);
  return { season, episode: episode > 0 ? episode : null };
}

function seasonKey(season) {
  return season == null ? 'other' : `s${season}`;
}

const seasons = computed(() => {
  if (!isEpisodic.value || !series.value?.volumes) return [];
  const map = new Map();
  for (const ep of series.value.volumes) {
    const { season } = getSeasonEpisode(ep);
    if (!map.has(season)) map.set(season, []);
    map.get(season).push(ep);
  }
  // Numbered seasons in order, then specials (season 0), then anything unnumbered.
  const rank = (n) => (n == null ? Infinity : n === 0 ? Number.MAX_SAFE_INTEGER : n);
  const keys = [...map.keys()].sort((a, b) => rank(a) - rank(b));
  return keys.map((n) => {
    const eps = map.get(n);
    return {
      key: seasonKey(n),
      seasonNumber: n,
      label: n == null ? 'Other' : n === 0 ? 'Specials' : `Season ${n}`,
      episodes: eps,
      watched: eps.filter((e) => e.is_finished).length
    };
  });
});

const activeSeasonKey = ref(null);
const activeSeason = computed(() => seasons.value.find(s => s.key === activeSeasonKey.value) || seasons.value[0] || null);

// Opening a show lands on the season you're up to. Later refreshes (marking an episode
// watched…) keep whichever season you've picked.
watch(seasons, (list) => {
  if (!list.length) return;
  if (activeSeasonKey.value && list.some((x) => x.key === activeSeasonKey.value)) return;
  const next = series.value?.nextVolume;
  const target = next && list.find((x) => x.key === seasonKey(getSeasonEpisode(next).season));
  activeSeasonKey.value = (target || list[0]).key;
});
watch(() => [route.params.seriesName, route.params.id], () => { activeSeasonKey.value = null; });

const seasonEpisodes = computed(() => {
  if (!activeSeason.value) return [];
  const list = [...activeSeason.value.episodes];
  list.sort((a, b) => {
    const diff = (a.volume ?? Infinity) - (b.volume ?? Infinity) || a.title.localeCompare(b.title, undefined, { numeric: true });
    return sortAscending.value ? diff : -diff;
  });
  return list;
});

function episodeNumber(ep) {
  return getSeasonEpisode(ep).episode;
}

// A series-wide metadata edit copies the show's overview onto every episode; repeating it
// under each one says nothing, so only an episode's own synopsis is shown.
function episodeOverview(ep) {
  return ep.description && ep.description !== series.value?.description ? ep.description : '';
}

async function toggleSeasonWatched(season) {
  if (!season || !season.episodes.length) return;
  actionLoading.value = true;
  const markAsDone = season.watched < season.episodes.length;
  try {
    await Promise.all(season.episodes.map(ep =>
      api.post(`/progress/${ep.id}`, {
        isFinished: markAsDone ? 1 : 0,
        progressPercent: markAsDone ? 100 : 0,
        currentPage: markAsDone ? (ep.total_pages || 1) : 0,
        currentTime: markAsDone ? (ep.duration || 1) : 0,
        totalPages: ep.total_pages || 1
      })
    ));
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to update season status');
  } finally {
    actionLoading.value = false;
  }
}

// Cast & crew: director and writers first, then the cast in billing
// order, then the rest of the crew. Someone with several jobs gets one card. Without TMDB
// credits it falls back to the names in the metadata (director, cast).
const LEAD_JOBS = ['Director', 'Screenplay', 'Writer', 'Story', 'Novel', 'Characters'];
const people = computed(() => {
  if (!isVideoType.value || isMovieCollection.value) return [];
  const c = credits.value;
  const crewByName = new Map();
  for (const m of c?.crew || []) {
    const entry = crewByName.get(m.name) || { name: m.name, photo: m.photo, jobs: [] };
    if (!entry.jobs.includes(m.job)) entry.jobs.push(m.job);
    crewByName.set(m.name, entry);
  }
  const crew = [...crewByName.values()].map((m) => ({
    key: `crew-${m.name}`,
    name: m.name,
    role: m.jobs.join(', '),
    photo: m.photo,
    lead: m.jobs.some((j) => LEAD_JOBS.includes(j))
  }));

  let cast;
  if (c?.cast?.length) {
    cast = c.cast.map((m) => ({ key: `cast-${m.name}`, name: m.name, role: m.character, photo: m.photo }));
  } else {
    cast = splitTags(series.value?.artists).map((name) => ({ key: `cast-${name}`, name, role: null, photo: null }));
  }

  const lead = crew.filter((m) => m.lead);
  if (!lead.length && !c?.crew?.length && shownCreator.value) {
    lead.push({ key: `crew-${shownCreator.value}`, name: shownCreator.value, role: isEpisodic.value ? vocab.value.creator : 'Director', photo: null });
  }
  return [...lead, ...cast, ...crew.filter((m) => !m.lead)];
});

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const mediaFacts = computed(() => {
  const it = single.value || series.value?.volumes?.[0];
  if (!it && !series.value) return [];
  const facts = [];
  if (isSingle.value && it) {
    if (it.release_date) facts.push({ label: 'Released', value: it.release_date });
    if (isTimeBased(it.media_type) && it.duration) facts.push({ label: 'Runtime', value: formatLength(it.duration) });
    if (it.total_pages) facts.push({ label: 'Pages', value: it.total_pages.toLocaleString() });
    if (it.format) facts.push({ label: 'Format', value: it.format.toUpperCase() });
    if (it.file_size) facts.push({ label: 'File size', value: formatFileSize(it.file_size) });
    if (series.value?.libraryName) facts.push({ label: 'Library', value: series.value.libraryName });
    if (it.progress_updated_at) facts.push({ label: 'Last opened', value: formatDate(it.progress_updated_at) });
  } else if (series.value) {
    if (series.value.libraryName) facts.push({ label: 'Library', value: series.value.libraryName });
    facts.push({ label: `Total ${vocab.value.units}`, value: series.value.volumeCount });
    if (totalDuration.value > 0) facts.push({ label: 'Total Length', value: formatLength(totalDuration.value) });
    if (series.value.totalPages > 0) facts.push({ label: 'Total Pages', value: series.value.totalPages.toLocaleString() });
    if (it?.format) facts.push({ label: 'Format', value: it.format.toUpperCase() });
  }
  return facts;
});

async function loadCredits(itemId) {
  credits.value = null;
  if (!itemId) return;
  try {
    const res = await api.get(`/items/${itemId}/credits`);
    if (series.value?.volumes?.some((v) => v.id === itemId)) credits.value = res.data?.credits || null;
  } catch (e) {
    // No credits is fine: the page falls back to the names in the metadata.
  }
}

// ─── Data Fetching ──────────────────────────────────────────────────────────
async function fetchSeriesData() {
  loading.value = true;
  error.value = null;
  extrasList.value = [];
  collection.value = null;
  credits.value = null;
  overviewExpanded.value = false;

  try {
    const seriesParam = route.params.seriesName;
    const itemIdParam = route.params.id;

    if (seriesParam) {
      const decodedName = decodeURIComponent(seriesParam);
      const res = await api.get(`/items/series/${encodeURIComponent(decodedName)}`, {
        params: { library: route.query.library || undefined, type: route.query.type || undefined }
      });
      series.value = res.data.series;
      extrasList.value = res.data.series?.extras || [];
      // A show's episodes share the show's credits. A movie collection has none of its
      // own (each film has its page), unless the library only holds one of its films.
      const vols = res.data.series?.volumes || [];
      const type = res.data.series?.mediaType;
      if (vols.length && (type === 'show' || type === 'anime' || (type === 'movie' && vols.length === 1))) {
        loadCredits(vols[0].id);
      }
    } else if (itemIdParam) {
      // Fetch item first
      const itemRes = await api.get(`/items/${itemIdParam}`);
      const item = itemRes.data.item;

      if (item) {
        // A title with no series gets the same page, as a series of one.
        series.value = {
          standalone: true,
          id: item.id,
          mediaType: item.media_type,
          libraryId: item.library_id,
          description: item.description || null,
          genres: item.genres || null,
          themes: item.themes || null,
          artists: item.artists || null,
          publisher: item.publisher || null,
          status: item.status || null,
          release_date: item.release_date || null,
          name: item.title,
          author: item.author || 'Unknown Author',
          volumeCount: 1,
          totalPages: item.total_pages || 0,
          readCount: item.is_finished ? 1 : 0,
          skippedCount: 0,
          inProgressCount: !item.is_finished && item.progress_percent > 0 ? 1 : 0,
          unreadCount: item.is_finished || item.progress_percent > 0 ? 0 : 1,
          overallProgress: item.is_finished ? 100 : (item.progress_percent || 0),
          libraryName: item.library_name || null,
          format: item.format || null,
          nextVolume: item,
          volumes: [item]
        };
        // Its extras, and the collection it's part of (if any), load alongside.
        if (['movie', 'show', 'anime'].includes(item.media_type)) loadCredits(item.id);
        api.get(`/items/${item.id}/extras`)
          .then((r) => { if (series.value?.id === item.id) extrasList.value = r.data.extras || []; })
          .catch(() => {});
        if (item.series) {
          api.get(`/items/series/${encodeURIComponent(item.series)}`, { params: { library: item.library_id, type: item.media_type } })
            .then((r) => {
              if (series.value?.id === item.id && (r.data.series?.volumeCount || 0) > 1) collection.value = r.data.series;
            })
            .catch(() => {});
        }
      } else {
        error.value = 'Item not found';
      }
    } else {
      error.value = 'No series specified';
    }
  } catch (err) {
    console.error('Failed to load series:', err);
    error.value = err.response?.data?.error || 'Failed to load series details';
  } finally {
    loading.value = false;
  }
}

// ─── Batch Actions ──────────────────────────────────────────────────────────
async function markAllAsRead() {
  if (!series.value || !series.value.name) return;
  if (series.value.standalone) return toggleVolumeReadStatus(series.value.volumes[0]);
  const confirmed = await dialog.confirm({
    title: `Mark All As ${vocab.value.done}`,
    message: `Mark every ${vocab.value.unit.toLowerCase()} of "${series.value.name}" as ${vocab.value.done.toLowerCase()}?`,
    confirmText: `Mark All ${vocab.value.done}`
  });
  if (!confirmed) return;

  actionLoading.value = true;
  try {
    await api.post(`/items/series/${encodeURIComponent(series.value.name)}/mark-read`, null, { params: seriesScopeParams() });
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to mark all as read');
  } finally {
    actionLoading.value = false;
  }
}

async function markAllAsUnread() {
  if (!series.value || !series.value.name) return;
  if (series.value.standalone) {
    const only = series.value.volumes[0];
    if (only.is_finished) return toggleVolumeReadStatus(only);
    await api.post(`/progress/${only.id}`, { isFinished: 0, progressPercent: 0, currentPage: 0, currentTime: 0, totalPages: only.total_pages || 0 });
    return fetchSeriesData();
  }
  const confirmed = await dialog.confirm({
    title: 'Reset Progress',
    message: `Reset all your progress for "${series.value.name}"?`,
    confirmText: 'Reset Progress',
    danger: true
  });
  if (!confirmed) return;

  actionLoading.value = true;
  try {
    await api.post(`/items/series/${encodeURIComponent(series.value.name)}/mark-unread`, null, { params: seriesScopeParams() });
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to reset reading history');
  } finally {
    actionLoading.value = false;
  }
}

// ─── Skipped volumes ────────────────────────────────────────────────────────
// "Skipped" = the reader chose to pass over a volume (usually: watched the anime for it).
// It only applies to volumes not read; reading one clears the skip server-side.
function isSkipped(vol) {
  return !vol.is_finished && !!vol.is_skipped;
}

// Read + skipped: how much of the series is behind the reader.
const coveredCount = computed(() => (series.value?.readCount || 0) + (series.value?.skippedCount || 0));

// The reader's previous/next volume jumps step over skipped volumes (the one open stays).
const readerVolumes = computed(() => (series.value?.volumes || []).filter(
  (v) => !isSkipped(v) || v.id === activeReadingItem.value?.id
));

async function setSkipped(vols, skipped) {
  const ids = vols.map((v) => v.id);
  if (!ids.length) return;
  actionLoading.value = true;
  try {
    for (const v of vols) v.is_skipped = skipped ? 1 : 0; // optimistic
    await api.post('/progress/skip', { itemIds: ids, skipped });
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not update what\'s skipped');
    await fetchSeriesData();
  } finally {
    actionLoading.value = false;
  }
}

function toggleVolumeSkipped(vol) {
  return setSkipped([vol], !isSkipped(vol));
}

// "Skip through volume N": every unread volume up to and including N, in reading order.
const showSkipDialog = ref(false);
const skipThroughId = ref('');
const orderedVolumes = computed(() => [...(series.value?.volumes || [])].sort((a, b) => {
  if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title, undefined, { numeric: true });
  if (a.volume == null) return 1;
  if (b.volume == null) return -1;
  return a.volume - b.volume;
}));
const volumesToSkip = computed(() => {
  const idx = orderedVolumes.value.findIndex((v) => v.id === skipThroughId.value);
  if (idx < 0) return [];
  return orderedVolumes.value.slice(0, idx + 1).filter((v) => !v.is_finished && !isSkipped(v));
});

function volumeLabel(v) {
  return entryLabel(v);
}

function openSkipDialog() {
  // Default to the volume just before where they are now.
  const next = series.value?.nextVolume;
  const idx = next ? orderedVolumes.value.findIndex((v) => v.id === next.id) : -1;
  skipThroughId.value = orderedVolumes.value[Math.max(0, idx)]?.id || '';
  showSkipDialog.value = true;
}

async function confirmSkipThrough() {
  const vols = volumesToSkip.value;
  showSkipDialog.value = false;
  await setSkipped(vols, true);
}

async function clearAllSkips() {
  const vols = (series.value?.volumes || []).filter(isSkipped);
  showSkipDialog.value = false;
  await setSkipped(vols, false);
}

// ─── Single Volume Read/Unread Toggle ───────────────────────────────────────
async function toggleVolumeReadStatus(vol) {
  try {
    const newFinished = vol.is_finished ? 0 : 1;
    // Optimistic UI update
    vol.is_finished = newFinished;
    if (newFinished) {
      vol.progress_percent = 100;
      vol.current_page = vol.total_pages || 1;
    } else {
      vol.progress_percent = 0;
      vol.current_page = 0;
    }

    await api.post(`/progress/${vol.id}`, {
      isFinished: newFinished,
      progressPercent: newFinished ? 100 : 0,
      currentPage: newFinished ? (vol.total_pages || 1) : 0,
      totalPages: vol.total_pages || 1
    });

    // Re-sync metadata and progress
    await fetchSeriesData();
  } catch (err) {
    console.error('Failed to toggle volume read status:', err);
    await fetchSeriesData();
  }
}

// ─── Reader Actions ─────────────────────────────────────────────────────────
// Clicking an entry's cover or title. In a movie collection that opens the film's own page
// (details, extras, the rest of the collection); everywhere else it opens the reader/player
// straight away, as the dedicated Watch/Read button always does.
function openEntry(vol) {
  if (vol.media_type === 'movie' && !isSingle.value) {
    router.push(`/title/${vol.id}`);
  } else {
    openVolumeReader(vol);
  }
}

// One entry point for every type: comics page-by-page, EPUBs in the book reader, audio in
// the global player, video in the player here, and anything else (PDF) in a new tab.
function openVolumeReader(vol) {
  const kind = downloadKind(vol);
  if (vol.media_type === 'audiobook') {
    player.playItem(vol);
  } else if (isVideo(vol.media_type)) {
    activeVideoItem.value = vol;
  } else if (kind === 'pages') {
    activeReadingItem.value = vol;
  } else if ((vol.format || '').toLowerCase() === 'epub') {
    activeEpubItem.value = vol;
  } else {
    window.open(`/api/media/book/${vol.id}/file?token=${getMediaToken()}`, '_blank');
  }
}

function handleSwitchVolume(nextVol) {
  activeReadingItem.value = nextVol;
}

async function handleReaderClose() {
  activeReadingItem.value = null;
  await fetchSeriesData();
}

// ─── Ratings ────────────────────────────────────────────────────────────────
// Which volume/episode the header's rating strip is for. Defaults to the one you're on;
// on a single title it's simply that title.
const ratingVolumeId = ref(null);
const heroRatingEl = ref(null);

const heroRatingItem = computed(() => {
  const vols = series.value?.volumes || [];
  return vols.find((v) => v.id === ratingVolumeId.value) || series.value?.nextVolume || vols[0] || null;
});

const heroRatingLabel = computed(() => {
  const vol = heroRatingItem.value;
  if (!vol || (series.value?.volumes?.length || 0) <= 1) return '';
  // "Rate Vol 3", "Rate S1 · E2", "Rate The Empire Strikes Back".
  return `Rate ${entryLabel(vol)}`;
});

function openRating(vol) {
  ratingVolumeId.value = vol.id;
  heroRatingEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleRated({ itemId, rating }) {
  const vol = series.value?.volumes?.find((v) => v.id === itemId);
  if (vol) vol.user_rating = rating;
  if (series.value?.nextVolume?.id === itemId) series.value.nextVolume.user_rating = rating;
}

// ─── Bookmarks ──────────────────────────────────────────────────────────────
function openBookmarks(vol) {
  selectedBookmarksItem.value = vol;
  showBookmarksModal.value = true;
}

function handleMangaJump({ item, page }) {
  showBookmarksModal.value = false;
  activeReadingItem.value = { ...item, initialPage: page };
}

// ─── Navigation Helpers ─────────────────────────────────────────────────────
function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/');
  }
}

function goBackToType() {
  router.push({ path: '/', query: { type: mediaType.value } });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    // SQLite's CURRENT_TIMESTAMP is UTC with no zone marker ("2026-09-26 21:10:00"), which
    // Date would read as local time — putting it hours in the future ("-1 days ago").
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr) ? `${dateStr.replace(' ', 'T')}Z` : dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

watch(() => [route.params.seriesName, route.params.id], () => {
  fetchSeriesData();
});

onMounted(() => {
  fetchSeriesData();
});
</script>

<style scoped>
.safe-top {
  padding-top: max(0rem, env(safe-area-inset-top));
}
</style>
