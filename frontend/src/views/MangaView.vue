<template>
  <div class="min-h-screen lg:h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground relative" :class="isSidebarLayout ? 'flex flex-col md:flex-row lg:overflow-hidden' : 'flex flex-col lg:overflow-hidden'">
    <!-- Standard Plinthio Navbar / Sidebar -->
    <Sidebar
      v-if="isSidebarLayout"
      :activeType="'manga'"
      @filter-type="handleNavFilter"
      @update:searchQuery="handleNavSearch"
    />
    <Navbar
      v-else
      :activeType="'manga'"
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
            <span class="hover:text-foreground transition cursor-pointer" @click="goBackToManga">Manga</span>
            <ChevronRight class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            <span class="font-semibold text-foreground truncate max-w-[200px] sm:max-w-md">
              {{ series?.name || 'Manga Details' }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 text-muted-foreground flex-shrink-0">
          <span class="text-[11px] font-mono">
            {{ series?.volumeCount || 0 }} {{ (series?.volumeCount || 0) === 1 ? 'Volume' : 'Volumes' }}
          </span>
        </div>
      </div>
    </nav>

    <!-- Loading State -->
    <div v-if="loading" class="flex-1 flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
      <Loader2 class="w-8 h-8 animate-spin text-primary" />
      <p class="text-xs font-mono">Loading manga details...</p>
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

    <!-- Main View Content -->
    <main v-else-if="series" class="flex-1 flex flex-col lg:min-h-0 lg:overflow-hidden">
      <!-- Static Top Section: Ambient Glow + Compact Hero + Controls/Filters Bar -->
      <div class="flex-shrink-0 bg-background border-b border-border z-10 shadow-sm">
        <!-- Ambient Glow Backdrop & Compact Hero Header -->
        <div class="relative overflow-hidden bg-muted/15 border-b border-border/60">
          <div
            class="absolute inset-0 opacity-15 dark:opacity-20 blur-3xl scale-125 pointer-events-none bg-center bg-cover transition-opacity"
            :style="{ backgroundImage: `url(${primaryCoverUrl})` }"
          />
          <div class="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background pointer-events-none" />

          <!-- Hero Content -->
          <div class="relative max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4">
            <div class="flex flex-col md:flex-row gap-4 sm:gap-6 items-center md:items-start text-center md:text-left">
              <!-- Cover Artwork (with 3D stack illusion for multi-volume series) -->
              <div class="relative w-36 sm:w-44 md:w-52 lg:w-60 aspect-[2/3] flex-shrink-0">
                <!-- Stack Layer 2 -->
                <div
                  v-if="series.volumes?.length > 2"
                  class="absolute inset-0 rounded-xl bg-muted/60 border border-border/40 shadow-sm"
                  style="transform: translate(6px, -6px) rotate(2.5deg); z-index: 1"
                />
                <!-- Stack Layer 1 -->
                <div
                  v-if="series.volumes?.length > 1"
                  class="absolute inset-0 rounded-xl bg-muted/80 border border-border/60 shadow-md"
                  style="transform: translate(3px, -3px) rotate(1.2deg); z-index: 2"
                />

                <!-- Main Cover — reflects whichever volume is currently up next / being read -->
                <div
                  class="absolute inset-0 rounded-xl overflow-hidden bg-card border border-border/80 shadow-xl"
                  style="z-index: 3"
                >
                  <img
                    :src="primaryCoverUrl"
                    :alt="series.name"
                    class="w-full h-full object-cover transition-opacity duration-200"
                  />

                  <!-- Volume Count Pill -->
                  <div class="absolute bottom-2 right-2 z-10 pointer-events-none">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-mono font-bold backdrop-blur-sm shadow">
                      {{ series.volumeCount }} {{ series.volumeCount === 1 ? 'vol' : 'vols' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Series Details & Metadata -->
              <div class="flex-1 flex flex-col justify-between py-0.5 max-w-3xl min-w-0">
                <div>
                  <div class="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-1">
                    <span class="text-[10px] sm:text-xs font-mono uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                      Manga Series
                    </span>
                    <span v-if="series.status" class="text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                      {{ series.status }}
                    </span>
                  </div>

                  <h1 class="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight text-foreground line-clamp-1">
                    {{ series.name }}
                  </h1>

                  <p v-if="series.author" class="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center justify-center md:justify-start gap-1.5 font-medium">
                    <User class="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
                    <span class="font-medium text-foreground/90">{{ series.author }}</span>
                  </p>

                  <p v-if="series.artists && series.artists !== series.author" class="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center justify-center md:justify-start gap-1.5 font-medium">
                    <Palette class="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
                    <span class="font-medium text-foreground/90">{{ series.artists }}</span>
                  </p>

                  <!-- Ratings: your stars, the server average. On a multi-volume series this rates
                       one volume at a time — the star button on any volume below switches it. -->
                  <div ref="heroRatingEl" class="mt-2">
                    <RatingBar
                      v-if="heroRatingItem"
                      :item="heroRatingItem"
                      :label="heroRatingLabel"
                      align="responsive"
                      @rated="handleRated"
                    />
                  </div>

                  <!-- Genre / Theme Tags -->
                  <div v-if="genreTags.length || themeTags.length" class="flex flex-wrap items-center justify-center md:justify-start gap-1.5 mt-2">
                    <span
                      v-for="g in genreTags"
                      :key="`genre-${g}`"
                      class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                    >{{ g }}</span>
                    <span
                      v-for="t in themeTags"
                      :key="`theme-${t}`"
                      class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                    >{{ t }}</span>
                  </div>

                  <!-- Description -->
                  <p v-if="series.description" class="text-xs text-muted-foreground mt-2 max-w-2xl line-clamp-3">
                    {{ series.description }}
                  </p>

                  <!-- Metadata Badges Grid -->
                  <div class="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-2">
                    <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-card border border-border text-[11px] font-medium text-foreground shadow-sm">
                      <Layers class="w-3 h-3 text-primary" />
                      <span>{{ series.volumeCount }} {{ series.volumeCount === 1 ? 'Volume' : 'Volumes' }}</span>
                    </div>

                    <div v-if="series.totalPages > 0" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-card border border-border text-[11px] font-medium text-foreground shadow-sm">
                      <BookOpen class="w-3 h-3 text-blue-500" />
                      <span>{{ series.totalPages.toLocaleString() }} Pages</span>
                    </div>

                    <div v-if="series.libraryName" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-card border border-border text-[11px] font-medium text-muted-foreground shadow-sm">
                      <Folder class="w-3 h-3" />
                      <span>{{ series.libraryName }}</span>
                    </div>

                    <div
                      v-if="series.readCount === series.volumeCount && series.volumeCount > 0"
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-semibold text-emerald-500 shadow-sm"
                    >
                      <BookCheck class="w-3 h-3" />
                      <span>All {{ series.volumeCount }} Read</span>
                    </div>
                    <div
                      v-else-if="series.readCount > 0 || series.inProgressCount > 0"
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-primary/10 border border-primary/30 text-[11px] font-semibold text-primary shadow-sm"
                    >
                      <BookOpen class="w-3 h-3" />
                      <span>In Progress ({{ series.readCount }}/{{ series.volumeCount }} Read)</span>
                    </div>
                    <div
                      v-else
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-muted border border-border text-[11px] font-medium text-muted-foreground shadow-sm"
                    >
                      <Book class="w-3 h-3" />
                      <span>Unread</span>
                    </div>
                  </div>

                  <!-- Overall Series Progress Bar -->
                  <div class="mt-2.5 w-full max-w-md bg-card/70 border border-border/80 rounded-xl p-2.5 shadow-sm">
                    <div class="flex items-center justify-between text-[11px] mb-1.5">
                      <span class="text-muted-foreground font-medium">Series Read Progress</span>
                      <span class="font-mono font-bold text-foreground">
                        {{ series.readCount }} / {{ series.volumeCount }} volumes ({{ series.overallProgress }}%)
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
                </div>

                <!-- Primary Action Buttons -->
                <div class="mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                  <!-- Smart Continue / Start Button -->
                  <button
                    v-if="series.nextVolume"
                    @click="openVolumeReader(series.nextVolume)"
                    class="h-8 sm:h-9 px-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 font-semibold text-xs transition shadow-md shadow-primary/20 flex items-center gap-2 group"
                  >
                    <Play v-if="smartCtaState.isResume" class="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />
                    <Book v-else-if="!smartCtaState.isFinished" class="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                    <BookOpen v-else class="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                    <span>{{ smartCtaState.label }}</span>
                    <span v-if="smartCtaState.subLabel" class="text-[11px] font-normal opacity-85 font-mono">
                      · {{ smartCtaState.subLabel }}
                    </span>
                  </button>

                  <!-- Mark All Read / Unread Batch Actions -->
                  <div class="flex items-center gap-1.5">
                    <button
                      @click="markAllAsRead"
                      :disabled="series.readCount === series.volumeCount || actionLoading"
                      class="h-8 sm:h-9 px-3 rounded-xl bg-card hover:bg-muted text-foreground border border-border font-medium text-xs transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                      title="Mark all volumes as read"
                    >
                      <Check class="w-3.5 h-3.5 text-emerald-500" />
                      <span class="hidden sm:inline">Mark All Read</span>
                    </button>

                    <button
                      @click="markAllAsUnread"
                      :disabled="series.readCount === 0 && series.inProgressCount === 0 || actionLoading"
                      class="h-8 sm:h-9 px-3 rounded-xl bg-card hover:bg-muted text-foreground border border-border font-medium text-xs transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                      title="Reset reading history for series"
                    >
                      <RotateCcw class="w-3.5 h-3.5 text-muted-foreground" />
                      <span class="hidden sm:inline">Reset History</span>
                    </button>

                    <button
                      v-if="authStore.isEditor"
                      @click="openSeriesMetadataSearch"
                      class="h-8 sm:h-9 px-3 rounded-xl bg-card hover:bg-muted text-foreground border border-border font-medium text-xs transition active:scale-95 flex items-center gap-1.5"
                      title="Search MangaDex and apply author/series to all volumes"
                    >
                      <Search class="w-3.5 h-3.5 text-muted-foreground" />
                      <span class="hidden sm:inline">Edit Metadata</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Controls Bar (Pinned with top section!) -->
        <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-bold tracking-tight text-foreground">
              Volumes & Reading History
            </h2>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
              {{ filteredVolumes.length }}
            </span>
          </div>

          <div class="flex flex-wrap items-center justify-between sm:justify-end gap-2">
            <!-- Filter Tabs -->
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
                <span class="font-mono text-[10px] opacity-75">({{ tab.count }})</span>
              </button>
            </div>

            <div class="flex items-center gap-1.5">
              <!-- Sort Toggle -->
              <button
                @click="sortAscending = !sortAscending"
                class="h-7 px-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-medium transition flex items-center gap-1.5"
                :title="sortAscending ? 'Order: Vol 1 to N' : 'Order: Vol N to 1'"
              >
                <ArrowUpDown class="w-3 h-3 text-muted-foreground" />
                <span class="font-mono text-xs">{{ sortAscending ? '1 → N' : 'N → 1' }}</span>
              </button>

              <!-- View Layout Switcher (Grid vs List) -->
              <div class="flex items-center bg-muted/50 p-0.5 rounded-lg border border-border">
                <button aria-label="Grid view"
                  @click="viewLayout = 'grid'"
                  :class="[
                    'p-1 rounded-md transition',
                    viewLayout === 'grid' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  ]"
                  title="Grid view"
                >
                  <LayoutGrid class="w-3.5 h-3.5" />
                </button>
                <button aria-label="List view"
                  @click="viewLayout = 'list'"
                  :class="[
                    'p-1 rounded-md transition',
                    viewLayout === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  ]"
                  title="List view"
                >
                  <List class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Volumes & Read History Scrollable Container -->
      <div class="flex-1 lg:min-h-0 lg:overflow-y-auto py-5">
        <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">

        <!-- Empty Filtered Results -->
        <div
          v-if="filteredVolumes.length === 0"
          class="py-16 text-center border border-dashed border-border rounded-2xl mt-6 bg-card/30"
        >
          <BookX class="w-10 h-10 text-muted-foreground/60 mx-auto mb-2" />
          <h3 class="text-sm font-semibold text-foreground">No volumes in this filter</h3>
          <p class="text-xs text-muted-foreground mt-1">Try switching to the "All" tab to see every volume in this series.</p>
        </div>

        <!-- Volumes View: Grid Layout -->
        <div
          v-else-if="viewLayout === 'grid'"
          class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-6"
        >
          <div
            v-for="vol in filteredVolumes"
            :key="vol.id"
            class="group relative flex flex-col bg-card border border-border hover:border-muted-foreground/30 rounded-2xl p-3 transition-all hover:shadow-md"
          >
            <!-- Thumbnail with interactive click to read -->
            <div
              @click="openVolumeReader(vol)"
              class="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-muted/50 border border-border/60 cursor-pointer"
            >
              <img
                :src="volumeCoverUrl(vol)"
                :alt="vol.title"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />

              <!-- Volume Pill -->
              <div class="absolute top-2 left-2 z-10 pointer-events-none">
                <span
                  v-if="vol.volume != null"
                  class="inline-flex items-center px-2 py-0.5 rounded-md bg-background/90 text-foreground backdrop-blur-md text-[11px] font-mono font-bold border border-border/80 shadow-sm"
                >
                  Vol {{ vol.volume % 1 === 0 ? Math.trunc(vol.volume) : vol.volume }}
                </span>
              </div>

              <!-- Read Status Overlay Badge (Top Right) -->
              <div class="absolute top-2 right-2 z-10 pointer-events-none">
                <span
                  v-if="vol.is_finished"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[10px] font-bold shadow-md"
                >
                  <Check class="w-3 h-3 stroke-[3]" /> Read
                </span>
                <span
                  v-else-if="vol.progress_percent > 0"
                  class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground text-[10px] font-mono font-bold shadow-md"
                >
                  {{ Math.round(vol.progress_percent) }}%
                </span>
                <span
                  v-else
                  class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-black/60 text-zinc-300 text-[10px] font-medium backdrop-blur-sm"
                >
                  Unread
                </span>
              </div>

              <!-- Hover Read Button overlay -->
              <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
                  <Play v-if="vol.current_page && !vol.is_finished" class="w-5 h-5 fill-current ml-0.5" />
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
                @click="openVolumeReader(vol)"
                class="text-xs font-semibold text-foreground truncate cursor-pointer hover:underline"
                :title="vol.title"
              >
                {{ vol.title }}
              </h3>

              <div class="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span v-if="vol.total_pages" class="font-mono">{{ vol.total_pages }} pages</span>
                <span v-else class="font-mono uppercase">{{ vol.format }}</span>

                <!-- Read history text -->
                <span v-if="vol.is_finished" class="text-emerald-500 font-semibold flex items-center gap-0.5">
                  <Check class="w-3 h-3" /> Done
                </span>
                <span v-else-if="vol.current_page" class="text-primary font-mono font-medium">
                  p. {{ vol.current_page }}
                </span>
                <span v-else class="text-muted-foreground/80">
                  Unread
                </span>
              </div>

              <!-- Bottom Quick Action Row -->
              <div class="mt-auto pt-2.5 flex items-center gap-1.5 border-t border-border/50">
                <button
                  @click="openVolumeReader(vol)"
                  class="flex-1 h-8 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-medium transition flex items-center justify-center gap-1"
                >
                  <Book v-if="!vol.is_finished && !vol.current_page" class="w-3.5 h-3.5" />
                  <BookOpen v-else class="w-3.5 h-3.5" />
                  <span>{{ vol.is_finished ? 'Re-read' : (vol.current_page ? 'Resume' : 'Read') }}</span>
                </button>

                <!-- Mark Read / Unread 1-Click Toggle -->
                <button :aria-label="vol.is_finished ? 'Mark as Unread' : 'Mark as Read'"
                  @click="toggleVolumeReadStatus(vol)"
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                  :title="vol.is_finished ? 'Mark as Unread' : 'Mark as Read'"
                >
                  <BookCheck v-if="vol.is_finished" class="w-4 h-4 text-emerald-500" />
                  <Book v-else class="w-4 h-4" />
                </button>

                <!-- Bookmarks button -->
                <button aria-label="Bookmarks & Notes"
                  @click="openBookmarks(vol)"
                  class="w-8 h-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                  title="Bookmarks & Notes"
                >
                  <Bookmark class="w-3.5 h-3.5" />
                </button>

                <!-- Rating button — shows your stars once you've rated the volume -->
                <button v-if="customizationStore.ratings.showPersonal" aria-label="Rate this volume"
                  @click="openRating(vol)"
                  class="h-8 min-w-8 px-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center gap-0.5 transition active:scale-95 text-[11px] font-semibold"
                  :title="vol.user_rating && customizationStore.ratings.showPersonal ? `You rated this ${vol.user_rating}/5 — rate in header` : 'Rate this volume in the header'"
                >
                  <Star class="w-3.5 h-3.5" :class="vol.user_rating && customizationStore.ratings.showPersonal ? 'text-amber-400 fill-amber-400' : ''" />
                  <span v-if="vol.user_rating && customizationStore.ratings.showPersonal" class="text-foreground">{{ vol.user_rating }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Volumes View: List Layout -->
        <div v-else class="flex flex-col gap-2.5 mt-6">
          <div
            v-for="vol in filteredVolumes"
            :key="vol.id"
            class="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-2xl bg-card hover:bg-muted/40 border border-border hover:border-muted-foreground/30 transition-all shadow-sm"
          >
            <!-- Left: Cover & Info -->
            <div class="flex items-center gap-4 min-w-0">
              <!-- Thumbnail -->
              <div
                @click="openVolumeReader(vol)"
                class="relative w-14 h-20 rounded-xl overflow-hidden bg-muted/50 border border-border/70 flex-shrink-0 cursor-pointer group-hover:shadow-md transition"
              >
                <img
                  :src="volumeCoverUrl(vol)"
                  :alt="vol.title"
                  loading="lazy"
                  class="w-full h-full object-cover"
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
                    Vol {{ vol.volume % 1 === 0 ? Math.trunc(vol.volume) : vol.volume }}
                  </span>
                  <h3
                    @click="openVolumeReader(vol)"
                    class="text-sm font-semibold text-foreground truncate cursor-pointer hover:underline"
                    :title="vol.title"
                  >
                    {{ vol.title }}
                  </h3>
                </div>

                <!-- Reading History Status Details -->
                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span v-if="vol.total_pages" class="font-mono">{{ vol.total_pages }} pages</span>
                  <span v-if="vol.file_size" class="font-mono">{{ formatFileSize(vol.file_size) }}</span>

                  <!-- Status state -->
                  <span v-if="vol.is_finished" class="text-emerald-500 font-semibold flex items-center gap-1">
                    <BookCheck class="w-3.5 h-3.5" />
                    <span>Finished</span>
                    <span v-if="vol.progress_updated_at" class="text-muted-foreground font-normal ml-1">
                      ({{ formatDate(vol.progress_updated_at) }})
                    </span>
                  </span>
                  <span v-else-if="vol.current_page" class="text-primary font-medium flex items-center gap-1">
                    <BookOpen class="w-3.5 h-3.5" />
                    <span>Page {{ vol.current_page }} of {{ vol.total_pages }} ({{ Math.round(vol.progress_percent) }}%)</span>
                    <span v-if="vol.progress_updated_at" class="text-muted-foreground font-normal ml-1">
                      · Last read {{ formatDate(vol.progress_updated_at) }}
                    </span>
                  </span>
                  <span v-else class="text-muted-foreground/80 flex items-center gap-1">
                    <Book class="w-3.5 h-3.5" />
                    <span>Not started yet</span>
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
                <Play v-if="vol.current_page && !vol.is_finished" class="w-3.5 h-3.5 fill-current" />
                <Book v-else-if="!vol.is_finished" class="w-3.5 h-3.5" />
                <BookOpen v-else class="w-3.5 h-3.5" />
                <span>{{ vol.is_finished ? 'Read Again' : (vol.current_page ? 'Resume' : 'Read') }}</span>
              </button>

              <!-- Mark Read / Unread Button -->
              <button
                @click="toggleVolumeReadStatus(vol)"
                class="h-9 px-3 rounded-xl border border-border hover:bg-muted text-foreground text-xs font-medium transition active:scale-95 flex items-center gap-1.5"
                :title="vol.is_finished ? 'Mark as Unread' : 'Mark as Read'"
              >
                <BookCheck v-if="vol.is_finished" class="w-4 h-4 text-emerald-500" />
                <Book v-else class="w-4 h-4 text-muted-foreground" />
                <span class="hidden md:inline">{{ vol.is_finished ? 'Mark Unread' : 'Mark Read' }}</span>
              </button>

              <!-- Bookmarks Button -->
              <button aria-label="Bookmarks & Notes"
                @click="openBookmarks(vol)"
                class="w-9 h-9 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition active:scale-95"
                title="Bookmarks & Notes"
              >
                <Bookmark class="w-4 h-4" />
              </button>

              <!-- Rating Button -->
              <button v-if="customizationStore.ratings.showPersonal" aria-label="Rate this volume"
                @click="openRating(vol)"
                class="h-9 min-w-9 px-2 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition active:scale-95 text-xs font-semibold"
                :title="vol.user_rating && customizationStore.ratings.showPersonal ? `You rated this ${vol.user_rating}/5 — rate in header` : 'Rate this volume in the header'"
              >
                <Star class="w-4 h-4" :class="vol.user_rating && customizationStore.ratings.showPersonal ? 'text-amber-400 fill-amber-400' : ''" />
                <span v-if="vol.user_rating && customizationStore.ratings.showPersonal" class="text-foreground">{{ vol.user_rating }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
    </div>

    <!-- Fullscreen In-App Manga Reader -->
    <MangaReader
      v-if="activeReadingItem"
      :item="activeReadingItem"
      :volumes="series?.volumes || []"
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
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useThemeStore } from '../stores/theme';
import { useDialogStore } from '../stores/dialog';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';
import MangaReader from '../components/MangaReader.vue';
import BookmarksModal from '../components/BookmarksModal.vue';
import MetadataSearchModal from '../components/MetadataSearchModal.vue';
import RatingBar from '../components/RatingBar.vue';
import { coverUrl as buildCoverUrl } from '../utils/cover';
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
  Search
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const themeStore = useThemeStore();
const dialog = useDialogStore();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();

const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');

const token = localStorage.getItem('plinthio_token') || '';

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
    media_type: 'manga',
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
    return 'https://placehold.co/400x600/18181b/52525b?text=Manga';
  }
  // Show the cover for whichever volume is "current" (in progress, or next up to read)
  // rather than always volume 1, so the hero art tracks where you actually are in the series.
  const current = series.value.nextVolume || series.value.volumes[0];
  if (current.cover_path) {
    return buildCoverUrl(current, { width: 720 });
  }
  return 'https://placehold.co/400x600/18181b/52525b?text=Manga';
});

function volumeCoverUrl(vol) {
  if (vol.cover_path) {
    return buildCoverUrl(vol, { width: 360 });
  }
  return `https://placehold.co/200x300/18181b/52525b?text=${encodeURIComponent(vol.title?.charAt(0) || '?')}`;
}

// ─── Filter Tabs & Counts ───────────────────────────────────────────────────
const filterTabs = computed(() => {
  if (!series.value || !series.value.volumes) return [];
  const vols = series.value.volumes;
  const completed = vols.filter(v => v.is_finished).length;
  const inProgress = vols.filter(v => !v.is_finished && v.progress_percent > 0).length;
  const unread = vols.length - completed - inProgress;

  return [
    { id: 'all', label: 'All Volumes', count: vols.length },
    { id: 'unread', label: 'Unread', count: unread },
    { id: 'in_progress', label: 'In Progress', count: inProgress },
    { id: 'completed', label: 'Completed', count: completed },
  ];
});

// ─── Sorted and Filtered Volumes ────────────────────────────────────────────
const filteredVolumes = computed(() => {
  if (!series.value || !series.value.volumes) return [];

  let list = [...series.value.volumes];

  // Apply tab filter
  if (activeFilterTab.value === 'unread') {
    list = list.filter(v => !v.is_finished && (!v.progress_percent || v.progress_percent === 0));
  } else if (activeFilterTab.value === 'in_progress') {
    list = list.filter(v => !v.is_finished && v.progress_percent > 0);
  } else if (activeFilterTab.value === 'completed') {
    list = list.filter(v => v.is_finished);
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
  if (!series.value || !series.value.nextVolume) {
    return { label: 'Start Reading', subLabel: '', isResume: false, isFinished: false };
  }
  const next = series.value.nextVolume;
  const volNumber = next.volume != null ? `Vol ${next.volume % 1 === 0 ? Math.trunc(next.volume) : next.volume}` : next.title;

  if (!next.is_finished && next.current_page > 0) {
    return {
      label: 'Continue Reading',
      subLabel: `${volNumber} · Page ${next.current_page}`,
      isResume: true,
      isFinished: false
    };
  } else if (series.value.readCount === series.value.volumeCount && series.value.volumeCount > 0) {
    return {
      label: 'Read Again',
      subLabel: `${volNumber}`,
      isResume: false,
      isFinished: true
    };
  } else {
    return {
      label: 'Start Reading',
      subLabel: `${volNumber}`,
      isResume: false,
      isFinished: false
    };
  }
});

// ─── Data Fetching ──────────────────────────────────────────────────────────
async function fetchSeriesData() {
  loading.value = true;
  error.value = null;

  try {
    const seriesParam = route.params.seriesName;
    const itemIdParam = route.params.id;

    if (seriesParam) {
      const decodedName = decodeURIComponent(seriesParam);
      const res = await api.get(`/items/series/${encodeURIComponent(decodedName)}`);
      series.value = res.data.series;
    } else if (itemIdParam) {
      // Fetch item first
      const itemRes = await api.get(`/items/${itemIdParam}`);
      const item = itemRes.data.item;

      if (item && item.series) {
        // Redirect or load series
        const res = await api.get(`/items/series/${encodeURIComponent(item.series)}`);
        series.value = res.data.series;
      } else if (item) {
        // Standalone manga (no series)
        series.value = {
          name: item.title,
          author: item.author || 'Unknown Author',
          volumeCount: 1,
          totalPages: item.total_pages || 0,
          readCount: item.is_finished ? 1 : 0,
          inProgressCount: !item.is_finished && item.progress_percent > 0 ? 1 : 0,
          unreadCount: item.is_finished || item.progress_percent > 0 ? 0 : 1,
          overallProgress: item.is_finished ? 100 : (item.progress_percent || 0),
          libraryName: item.library_name || null,
          format: item.format || null,
          nextVolume: item,
          volumes: [item]
        };
      } else {
        error.value = 'Item not found';
      }
    } else {
      error.value = 'No series specified';
    }
  } catch (err) {
    console.error('Failed to load manga series:', err);
    error.value = err.response?.data?.error || 'Failed to load series details';
  } finally {
    loading.value = false;
  }
}

// ─── Batch Actions ──────────────────────────────────────────────────────────
async function markAllAsRead() {
  if (!series.value || !series.value.name) return;
  const confirmed = await dialog.confirm({
    title: 'Mark All As Read',
    message: `Are you sure you want to mark all volumes of "${series.value.name}" as read?`,
    confirmText: 'Mark All Read'
  });
  if (!confirmed) return;

  actionLoading.value = true;
  try {
    await api.post(`/items/series/${encodeURIComponent(series.value.name)}/mark-read`);
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to mark all as read');
  } finally {
    actionLoading.value = false;
  }
}

async function markAllAsUnread() {
  if (!series.value || !series.value.name) return;
  const confirmed = await dialog.confirm({
    title: 'Reset Reading Progress',
    message: `Are you sure you want to reset all reading progress for "${series.value.name}"?`,
    confirmText: 'Reset Progress',
    danger: true
  });
  if (!confirmed) return;

  actionLoading.value = true;
  try {
    await api.post(`/items/series/${encodeURIComponent(series.value.name)}/mark-unread`);
    await fetchSeriesData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to reset reading history');
  } finally {
    actionLoading.value = false;
  }
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
function openVolumeReader(vol) {
  activeReadingItem.value = vol;
}

function handleSwitchVolume(nextVol) {
  activeReadingItem.value = nextVol;
}

async function handleReaderClose() {
  activeReadingItem.value = null;
  await fetchSeriesData();
}

// ─── Ratings ────────────────────────────────────────────────────────────────
// Which volume the header's rating strip is for. Defaults to the volume you're on.
const ratingVolumeId = ref(null);
const heroRatingEl = ref(null);

const heroRatingItem = computed(() => {
  const vols = series.value?.volumes || [];
  return vols.find((v) => v.id === ratingVolumeId.value) || series.value?.nextVolume || vols[0] || null;
});

const heroRatingLabel = computed(() => {
  const vol = heroRatingItem.value;
  if (!vol || (series.value?.volumes?.length || 0) <= 1) return '';
  return vol.volume != null
    ? `Rate Vol ${vol.volume % 1 === 0 ? Math.trunc(vol.volume) : vol.volume}`
    : `Rate ${vol.title}`;
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

function goBackToManga() {
  router.push('/?type=manga');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
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
