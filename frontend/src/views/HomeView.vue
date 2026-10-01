<template>
  <div class="min-h-screen bg-background transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <Sidebar
      v-if="isSidebarLayout"
      :activeType="activeType"
      :searchQuery="searchQuery"
      @filter-type="activeType = $event"
      @update:searchQuery="searchQuery = $event"
    />
    <Navbar
      v-else
      :activeType="activeType"
      :searchQuery="searchQuery"
      @filter-type="activeType = $event"
      @update:searchQuery="searchQuery = $event"
    />

    <div class="flex-1 flex flex-col min-w-0 pb-28">
    <main class="page-width mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 flex-1 flex flex-col gap-8">
      <router-link
        v-if="!isOnline"
        to="/downloads"
        class="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-4 py-3 text-sm flex items-center gap-3 hover:bg-amber-500/15 transition"
      >
        <WifiOff class="w-4 h-4 flex-shrink-0" />
        <span class="flex-1">You're offline. Your downloaded books, comics and audiobooks are still available.</span>
        <span class="font-semibold whitespace-nowrap">Open Downloads →</span>
      </router-link>
      <!-- Continue Watching (video only, shown as its own row on the "All" view) -->
      <section :key="`watching-${activeType}`" v-if="continueWatchingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="shelf-fade-in flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <MonitorPlay class="w-4 h-4 text-muted-foreground" />
            Continue Watching
          </h2>
        </div>

        <div class="poster-grid gap-3 sm:gap-4">
          <BookCard
            v-for="item in continueWatchingItems"
            :key="item.id"
            :item="item"
            @select="handleItemSelect"
            @refresh="refreshShelf"
            @add-to-folder="openAddToFolderModal"
            @open-bookmarks="openBookmarksModal"
            @edit-metadata="openMetadataModal"
          />
        </div>
      </section>

      <!-- Continue Reading / Listening Section (Filtered to All or specific category) -->
      <section :key="`reading-${activeType}`" v-if="continueReadingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="shelf-fade-in flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <Clock class="w-4 h-4 text-muted-foreground" />
            Continue {{ continueCategoryLabel }}
          </h2>
        </div>

        <div class="poster-grid gap-3 sm:gap-4">
          <BookCard
            v-for="item in continueReadingItems"
            :key="item.id"
            :item="item"
            @select="handleItemSelect"
            @refresh="refreshShelf"
            @add-to-folder="openAddToFolderModal"
            @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
          />
        </div>
      </section>

      <!-- Main Shelf Header with Organization Switcher -->
      <section class="flex flex-col gap-4">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap">
              {{ sectionTitle }}
            </h2>
            <span class="text-xs text-muted-foreground font-mono">
              ({{ displayItemCount }})
            </span>
          </div>

          <!-- Grouping selector. On a phone the modes share the row equally under short
               names, so none of them hides off the edge behind a sideways scroll. -->
          <div class="w-full lg:w-auto overflow-x-auto no-scrollbar flex items-center gap-1 sm:gap-1.5 p-1 bg-muted/40 rounded-xl border border-border flex-nowrap">
            <button
              v-for="mode in groupingModes"
              :key="mode.id"
              @click="setGrouping(mode.id)"
              :aria-pressed="String(groupBy === mode.id)"
              :class="[
                'h-9 min-h-[36px] px-2 sm:px-3.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 whitespace-nowrap flex-1 sm:flex-none min-w-0 active:scale-95',
                groupBy === mode.id
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              ]"
            >
              <component :is="mode.icon" class="w-3.5 h-3.5 flex-shrink-0" />
              <span class="sm:hidden truncate">{{ mode.short }}</span>
              <span class="hidden sm:inline">{{ mode.label }}</span>
            </button>
          </div>
        </div>

        <!-- Filters: progress, genre, recency, sort. A phone gets a tidy two-column grid (the
             old wrapping row squeezed every select down to an empty chip), with the movie
             collections switch on its own full-width row below. -->
        <div v-if="groupBy !== 'custom_folder'" class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select v-model="progressFilter" aria-label="Progress" :class="filterSelectClass(progressFilter)">
            <option value="">Status</option>
            <option value="unread">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="finished">Finished</option>
            <option value="skipped">Skipped</option>
          </select>
          <select v-if="genres.length" v-model="genreFilter" aria-label="Genre" :class="filterSelectClass(genreFilter)">
            <option value="">Genre</option>
            <option v-for="g in genres" :key="g.name" :value="g.name">{{ g.name }} ({{ g.count }})</option>
          </select>
          <select v-model="addedWithin" aria-label="Added" :class="filterSelectClass(addedWithin)">
            <option value="">Added</option>
            <option value="7">This week</option>
            <option value="30">This month</option>
            <option value="90">Last 3 months</option>
          </select>
          <!-- Without a genre list there are three selects; sort takes the whole last row. -->
          <select v-model="sortBy" aria-label="Sort order" title="Sort order" :class="[filterSelectClass(sortBy === 'title' ? '' : sortBy), genres.length ? '' : 'col-span-2']">
            <option value="title">A–Z</option>
            <option value="added">Newest</option>
            <option value="recent">Recently opened</option>
            <option value="release">Release date</option>
          </select>
          <!-- Movie collections: one card per collection, or every film -->
          <div
            v-if="hasMovieCollections && (activeType === 'movie' || activeType === 'all')"
            class="col-span-2 flex items-center p-0.5 rounded-lg border border-border bg-muted/40 text-sm sm:text-xs"
            role="group"
            aria-label="Movie collections"
          >
            <button
              type="button"
              @click="expandCollections = false"
              :aria-pressed="String(!expandCollections)"
              :class="['flex-1 sm:flex-none h-9 sm:h-8 px-2.5 rounded-md font-medium transition', !expandCollections ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >Collections</button>
            <button
              type="button"
              @click="expandCollections = true"
              :aria-pressed="String(expandCollections)"
              :class="['flex-1 sm:flex-none h-9 sm:h-8 px-2.5 rounded-md font-medium transition', expandCollections ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >All movies</button>
          </div>
          <button
            v-if="filtersActive || sortBy !== 'title'"
            type="button"
            @click="clearFilters"
            class="col-span-2 h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition flex items-center justify-center gap-1"
          >
            <X class="w-3.5 h-3.5" /> Clear filters
          </button>
        </div>

        <!-- Results. Keyed by the view on screen, so a new category or filter fades in
             instead of blinking through a skeleton; while a slow one loads, the old view
             stays put, dimmed. -->
        <div
          :key="shelfKey"
          class="shelf-fade-in transition-opacity duration-200"
          :class="refreshing ? 'opacity-40 pointer-events-none' : ''"
          :aria-busy="String(loading || refreshing)"
        >
        <!-- Loading Skeleton (first visit only) -->
        <div v-if="loading" class="poster-grid gap-3 sm:gap-4">
          <div v-for="i in 12" :key="i" class="aspect-[2/3] bg-muted/40 animate-pulse rounded-xl border border-border"></div>
        </div>

        <!-- Empty State -->
        <div v-else-if="items.length === 0 && groupBy !== 'custom_folder'" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
          <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
            <BookX class="w-5 h-5" />
          </div>
          <h3 class="text-sm font-medium text-foreground">No media found</h3>
          <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
            {{ searchQuery || filtersActive ? 'Nothing matches — try a different search or clear the filters' : 'Add a library in Server Settings and scan your folders to populate your shelf' }}
          </p>
          <router-link
            v-if="authStore.isAdmin && !searchQuery && !filtersActive"
            to="/admin"
            class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm"
          >
            Go to Settings
          </router-link>
        </div>

        <!-- Mode 1: Series — one card per series (any media type), plus standalone titles.
             Every card opens a detail page; nothing plays straight from the shelf. -->
        <div v-else-if="groupBy === 'series'" class="flex flex-col gap-3">
          <!-- Spacers stand in for the rows unmounted above and below the window, so the
               page keeps the height it would have with every card rendered. They sit outside
               the grid: inside it, auto-rows-fr stretched every row to the spacer's height,
               the next measurement doubled the spacer, and the page grew without end. -->
          <div ref="gridWrapEl">
          <div v-if="padTopHeight > 0" :style="{ height: padTopHeight + 'px' }"></div>
          <div ref="gridEl" class="poster-grid auto-rows-fr gap-3 sm:gap-4">
            <template v-for="entry in displayedEntries" :key="entry.key">
              <SeriesCard
                v-if="entry.kind === 'series'"
                data-grid-card
                class="h-full"
                :series="entry"
                @select="openSeriesView"
              />
              <BookCard
                v-else
                data-grid-card
                class="h-full"
                :item="entry.item"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
              />
            </template>
          </div>
          <div v-if="padBottomHeight > 0" :style="{ height: padBottomHeight + 'px' }"></div>
          </div>

          <div v-if="hasMoreServerItems" class="py-4 text-center text-xs text-muted-foreground">
            Loaded {{ filteredItems.length }} titles · more load as you scroll
          </div>

          <div v-if="shelfEntries.length === 0 && !loading" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
            <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
              <BookX class="w-5 h-5" />
            </div>
            <h3 class="text-sm font-medium text-foreground">No media found</h3>
            <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
              {{ searchQuery || filtersActive ? 'Nothing matches — try a different search or clear the filters' : 'Add a library in Server Settings and scan your folders to populate your shelf' }}
            </p>
          </div>
        </div>

        <!-- Mode 2: Grouped by Creator (author / director / studio) — series cards per creator -->
        <div v-else-if="groupBy === 'creator'" class="flex flex-col gap-6">
          <div v-for="group in entriesByCreator" :key="group.heading" class="flex flex-col gap-3">
            <div class="flex items-center gap-2 border-b border-border pb-1.5">
              <User class="w-4 h-4 text-muted-foreground" />
              <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">{{ group.heading }}</h3>
              <span class="text-xs text-muted-foreground">({{ group.entries.length }})</span>
            </div>
            <ShelfEntryGrid :entries="group.entries"
                @open-series="openSeriesView"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
            />
          </div>
        </div>

        <!-- Mode 4: Grouped by Disk Folders — a series sits once, under its own folder -->
        <div v-else-if="groupBy === 'disk_folder'" class="flex flex-col gap-6">
          <div v-for="group in entriesByFolder" :key="group.heading" class="flex flex-col gap-3">
            <div class="flex items-center gap-2 border-b border-border pb-1.5">
              <HardDrive class="w-4 h-4 text-muted-foreground" />
              <h3 class="text-xs font-mono text-foreground">{{ group.heading }}</h3>
              <span class="text-xs text-muted-foreground">({{ group.entries.length }})</span>
            </div>
            <ShelfEntryGrid :entries="group.entries"
                @open-series="openSeriesView"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
            />
          </div>
        </div>

        <!-- Mode 5: Custom In-App Folders (matches Author/Series layout & includes Unorganized catch-all) -->
        <div v-else-if="groupBy === 'custom_folder'" class="flex flex-col gap-6">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center gap-2">
              <FolderHeart class="w-4 h-4 text-primary" />
              <span class="text-xs font-semibold text-foreground">Custom In-App Folders</span>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <input
                v-model="quickFolderInput"
                @keyup.enter="createQuickFolder"
                placeholder="New folder name..."
                class="flex-1 sm:w-48 h-9 bg-background border border-border rounded-lg px-3 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                @click="createQuickFolder"
                :disabled="!quickFolderInput.trim()"
                class="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm active:scale-95 flex-shrink-0"
              >
                <Plus class="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>

          <div
            v-for="folder in customFoldersGrouped"
            :key="folder.id"
            class="flex flex-col gap-3"
          >
            <div class="flex items-center justify-between border-b border-border pb-1.5">
              <div class="flex items-center gap-2">
                <FolderHeart v-if="!folder.isDefault" class="w-4 h-4 text-primary" />
                <FolderX v-else class="w-4 h-4 text-muted-foreground" />
                <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">
                  {{ folder.name }}
                </h3>
                <span class="text-xs text-muted-foreground">({{ folderEntries(folder).length }})</span>
                <span v-if="folder.isDefault" class="text-[11px] font-mono uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  Catch-all
                </span>
              </div>

              <button aria-label="Delete folder"
                v-if="!folder.isDefault"
                @click="deleteCustomFolder(folder)"
                class="p-1 text-muted-foreground hover:text-destructive hover:bg-muted rounded transition"
                title="Delete folder"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Folder Items Grid -->
            <ShelfEntryGrid
              v-if="folder.items.length > 0"
              :entries="folderEntries(folder)"
              :inCustomFolder="!folder.isDefault"
              @open-series="openSeriesView"
              @select="handleItemSelect"
              @refresh="refreshShelf"
              @add-to-folder="openAddToFolderModal"
              @open-bookmarks="openBookmarksModal"
              @edit-metadata="openMetadataModal"
              @remove-from-folder="removeItemsFromCustomFolder(folder.id, $event)"
            />
            <div v-else class="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl bg-card/30">
              This folder is empty. Click the three dots (<span class="font-bold">...</span>) on any title to add it here.
            </div>
          </div>
        </div>
        </div>
      </section>
    </main>
    </div>

    <!-- Fullscreen Manga Reader Modal -->
    <MangaReader
      v-if="activeMangaItem"
      :item="activeMangaItem"
      @close="closeMangaReader"
    />

    <!-- Add To Custom Folder Modal -->
    <AddToFolderModal
      :isOpen="showAddToFolderModal"
      :item="selectedFolderItem"
      @close="showAddToFolderModal = false"
      @updated="loadCustomFolders"
    />

    <!-- Universal Bookmarks & Notes Modal -->
    <BookmarksModal
      :isOpen="showBookmarksModal"
      :item="selectedBookmarksItem"
      @close="showBookmarksModal = false"
      @select-manga-page="handleMangaJump"
    />

    <!-- External Metadata Search Modal -->
    <MetadataSearchModal
      :isOpen="showMetadataModal"
      :item="selectedMetadataItem"
      @close="showMetadataModal = false"
      @applied="refreshShelf"
    />

  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { usePlayerStore } from '../stores/player';
import { useDialogStore } from '../stores/dialog';
import { useCustomizationStore } from '../stores/customization';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';
import BookCard from '../components/BookCard.vue';
import SeriesCard from '../components/SeriesCard.vue';
import ShelfEntryGrid from '../components/ShelfEntryGrid.vue';
import { buildShelfEntries, entryFolder, groupEntries } from '../utils/shelfEntries';
import { detailRoute, creatorLabel, realCreator } from '../utils/mediaVocab';
import { normalizeShelfModes, userShelfModes } from '../utils/shelfModes';
// Readers, players and editors only mount once something is opened, so they load on demand
// instead of riding in the shelf's first download (hls.js alone is ~500KB).
const MangaReader = defineAsyncComponent(() => import('../components/MangaReader.vue'));
const AddToFolderModal = defineAsyncComponent(() => import('../components/AddToFolderModal.vue'));
const BookmarksModal = defineAsyncComponent(() => import('../components/BookmarksModal.vue'));
const MetadataSearchModal = defineAsyncComponent(() => import('../components/MetadataSearchModal.vue'));
import {
  Clock,
  BookX,
  User,
  ArrowDownAZ,
  HardDrive,
  FolderHeart,
  Folder,
  FolderX,
  Plus,
  Trash2,
  MonitorPlay,
  X,
  WifiOff
} from '@lucide/vue';

const authStore = useAuthStore();
const player = usePlayerStore();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const router = useRouter();

const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');

// ?type= lets other pages (e.g. the sidebar on Admin/Settings/Docs) deep-link straight into
// a filtered shelf instead of always dumping you on "All".
const route = useRoute();
const activeType = ref(
  route.query.type || authStore.user?.preferences?.defaultView || 'all'
);
const searchQuery = ref('');
const groupBy = ref('series');

const isOnline = ref(navigator.onLine);
const updateOnline = () => { isOnline.value = navigator.onLine; };

// Shelf filters, applied server-side (see GET /api/items).
const progressFilter = ref('');
const genreFilter = ref('');
const addedWithin = ref('');
const sortBy = ref('title');
const genres = ref([]);
const filtersActive = computed(() => !!(progressFilter.value || genreFilter.value || addedWithin.value));

function filterSelectClass(value) {
  return [
    // 16px text on a phone: iOS zooms the page into any smaller form control on focus.
    'h-10 sm:h-9 w-full sm:w-auto min-w-0 sm:min-w-[7rem] sm:max-w-[11rem] pl-3 sm:pl-2.5 pr-2 sm:pr-1.5 rounded-lg border text-base sm:text-xs font-medium bg-background transition focus:outline-none focus:ring-2 focus:ring-ring/40',
    value ? 'border-primary/60 text-foreground bg-primary/5' : 'border-border text-muted-foreground'
  ];
}

function clearFilters() {
  progressFilter.value = '';
  genreFilter.value = '';
  addedWithin.value = '';
  sortBy.value = 'title';
}

// Genres per category, so switching back shows the Genre select straight away rather than
// popping it in (and shifting the filter row) after a round trip.
const genresCache = new Map();

async function loadGenres() {
  const type = activeType.value;
  if (genresCache.has(type)) genres.value = genresCache.get(type);
  try {
    const params = type !== 'all' ? { mediaType: type } : {};
    const res = await api.get('/items/genres', { params });
    genresCache.set(type, res.data.genres || []);
    if (type !== activeType.value) return;
    genres.value = res.data.genres || [];
    if (genreFilter.value && !genres.value.some((g) => g.name === genreFilter.value)) genreFilter.value = '';
  } catch (err) {
    genres.value = [];
  }
}

// Items arrive a page at a time rather than in one 5000-row response: the old single fetch
// both stalled first paint and silently truncated any library past 5000 items.
const PAGE_SIZE = 1000;
// Rows of cards kept mounted above and below the viewport, so a fast scroll never exposes
// an empty gap before the next frame renders.
const BUFFER_ROWS = 4;

const items = ref([]);
const hasMoreServerItems = ref(false);
const continueItems = ref([]);
const loading = ref(true);
const activeMangaItem = ref(null);

const customFolders = ref([]);
const customFoldersGrouped = ref([]);
const folderItems = ref({});
const quickFolderInput = ref('');
const allowedFilters = ref(['series', 'creator', 'disk_folder', 'custom_folder']);

const showAddToFolderModal = ref(false);
const selectedFolderItem = ref(null);

const showBookmarksModal = ref(false);
const selectedBookmarksItem = ref(null);

const showMetadataModal = ref(false);
const selectedMetadataItem = ref(null);


function openBookmarksModal(item) {
  selectedBookmarksItem.value = item;
  showBookmarksModal.value = true;
}

function openMetadataModal(item) {
  selectedMetadataItem.value = item;
  showMetadataModal.value = true;
}

function handleMangaJump({ item, page }) {
  activeMangaItem.value = { ...item, initialPage: page };
}

// Shelf views. Series and Creator are always there; Disk Folders and Custom Folders can
// be switched off by an admin for the whole server, or hidden by a user for themselves.
const groupingModes = computed(() => {
  const serverModes = normalizeShelfModes(allowedFilters.value);
  const userModes = userShelfModes(authStore.user?.preferences?.enabledGroupingModes);
  const all = [
    // Internally still "series": every view shows series cards now, and this one is simply
    // all of them A–Z (the stored preference name is kept so saved choices carry over).
    { id: 'series', label: 'Alphabetical', short: 'A–Z', icon: ArrowDownAZ },
    { id: 'creator', label: creatorLabel(activeType.value), short: creatorLabel(activeType.value), icon: User },
    { id: 'disk_folder', label: 'Disk Folders', short: 'Disk', icon: HardDrive },
    { id: 'custom_folder', label: 'Custom Folders', short: 'Custom', icon: FolderHeart }
  ];
  return all.filter((m) => serverModes.includes(m.id) && userModes.includes(m.id));
});

watch(groupingModes, (newModes) => {
  if (newModes.length > 0 && !newModes.some(m => m.id === groupBy.value)) {
    groupBy.value = newModes[0].id;
  }
});

const continueCategoryLabel = computed(() => {
  switch (activeType.value) {
    case 'audiobook': return 'Audiobooks';
    case 'manga': return 'Manga';
    case 'book': return 'Books';
    case 'movie': return 'Movies';
    case 'show': return 'Shows';
    case 'anime': return 'Anime';
    default: return '';
  }
});

// Continue items strictly filtered by the current category (or all)
const displayedContinueItems = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  return continueItems.value.filter(i => {
    if (!enabled.includes(i.media_type)) return false;
    if (activeType.value === 'all') return true;
    return i.media_type === activeType.value;
  });
});

// "Continue Watching" is its own row: resuming a film is a different intent from picking
// the next chapter, and mixing them buries one behind the other. On a filtered view the
// single row above already says which it is, so the split only applies to "All".
const VIDEO_TYPES = ['movie', 'show', 'anime'];
const continueWatchingItems = computed(() =>
  activeType.value === 'all'
    ? displayedContinueItems.value.filter(i => VIDEO_TYPES.includes(i.media_type))
    : []
);
const continueReadingItems = computed(() =>
  activeType.value === 'all'
    ? displayedContinueItems.value.filter(i => !VIDEO_TYPES.includes(i.media_type))
    : displayedContinueItems.value
);

const sectionTitle = computed(() => {
  if (searchQuery.value) return `Results for "${searchQuery.value}"`;
  switch (activeType.value) {
    case 'audiobook': return 'Audiobooks';
    case 'manga': return 'Manga & Comics';
    case 'book': return 'eBooks & Documents';
    case 'movie': return 'Movies';
    case 'show': return 'Shows';
    case 'anime': return 'Anime';
    default: return 'All Media';
  }
});

// Filter items respecting user's enabled media categories
const filteredItems = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  return items.value.filter(item => enabled.includes(item.media_type));
});

const displayItemCount = computed(() => {
  if (groupBy.value === 'custom_folder') {
    return `${customFolders.value.length} folders`;
  }
  if (groupBy.value === 'series') {
    const seriesCount = shelfEntries.value.filter((e) => e.kind === 'series').length;
    const singles = shelfEntries.value.length - seriesCount;
    const parts = [];
    if (seriesCount) parts.push(`${seriesCount} series`);
    if (singles) parts.push(`${singles} ${singles === 1 ? 'title' : 'titles'}`);
    if (parts.length) return parts.join(', ');
  }
  return `${filteredItems.value.length} items`;
});

/**
 * The Series view: one entry per series (keyed by library and media type too, since two
 * libraries — or a manga and its anime — can share a name), and one per title with no
 * series. With title order the entries are alphabetical; with any other sort they keep the
 * server's order (a series sits where its first-listed title would).
 */
// Movie collections (Star Wars…) show as one card, or — with "All movies" — every film on
// its own. Only movies: shows and manga are always one card per series.
const EXPAND_KEY = 'plinthio_expand_collections';
const expandCollections = ref((() => { try { return localStorage.getItem(EXPAND_KEY) === '1'; } catch (e) { return false; } })());
watch(expandCollections, (on) => { try { localStorage.setItem(EXPAND_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } });
const shelfOptions = computed(() => ({
  alphabetical: sortBy.value === 'title',
  ungroup: expandCollections.value ? (item) => item.media_type === 'movie' : null
}));
const hasMovieCollections = computed(() => filteredItems.value.some((i) => i.media_type === 'movie' && i.series));

const shelfEntries = computed(() => buildShelfEntries(filteredItems.value, shelfOptions.value));

// Windowed rendering. The grid only ever mounts the rows near the viewport: rows scrolled
// off the top are unmounted again and replaced by a spacer of exactly their height, so the
// scrollbar and scroll position stay honest while the DOM stays small no matter how far
// down a 50,000-item library you are.
const gridEl = ref(null);
const gridWrapEl = ref(null);
const gridColumns = ref(6);
const rowHeight = ref(300);
const windowStartRow = ref(0);
const windowEndRow = ref(BUFFER_ROWS * 2);

const totalGridRows = computed(() => Math.ceil(shelfEntries.value.length / gridColumns.value));

const displayedEntries = computed(() =>
  shelfEntries.value.slice(
    windowStartRow.value * gridColumns.value,
    windowEndRow.value * gridColumns.value
  )
);

// rowHeight includes one row gap. The spacers sit outside the grid, so a spacer for N rows
// is exactly N*rowHeight: N cards' heights plus the N gaps that would separate them from
// the rendered rows.
const padTopHeight = computed(() =>
  windowStartRow.value > 0 ? windowStartRow.value * rowHeight.value : 0
);
const padBottomHeight = computed(() => {
  const rowsBelow = totalGridRows.value - windowEndRow.value;
  return rowsBelow > 0 ? rowsBelow * rowHeight.value : 0;
});

function resetGridWindow() {
  windowStartRow.value = 0;
  windowEndRow.value = BUFFER_ROWS * 2;
}

// Column count comes from the grid's own resolved template, so the responsive breakpoints
// stay the single source of truth. Row height is measured off a real card (they're a fixed
// aspect ratio, so every row matches) and only falls back to an estimate before first paint.
function measureGrid() {
  const el = gridEl.value;
  if (!el) return;

  const columns = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
  if (columns > 0) gridColumns.value = columns;

  const card = el.querySelector('[data-grid-card]');
  if (card) {
    const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
    const measured = card.getBoundingClientRect().height + gap;
    // Sub-pixel jitter between measurements would re-trigger the render watcher forever;
    // only a real change in card size counts.
    if (measured > 0 && Math.abs(measured - rowHeight.value) > 1) rowHeight.value = measured;
  }
}

function updateGridWindow() {
  const el = gridWrapEl.value;
  if (!el || rowHeight.value <= 0) return;

  // Measured from the wrapper, whose top doesn't move as the top spacer grows.
  const gridTop = el.getBoundingClientRect().top + window.scrollY;
  const scrolledIntoGrid = window.scrollY - gridTop;
  const firstVisibleRow = Math.floor(scrolledIntoGrid / rowHeight.value);
  const rowsOnScreen = Math.ceil(window.innerHeight / rowHeight.value);

  windowStartRow.value = Math.max(0, firstVisibleRow - BUFFER_ROWS);
  windowEndRow.value = Math.min(
    totalGridRows.value,
    Math.max(BUFFER_ROWS * 2, firstVisibleRow + rowsOnScreen + BUFFER_ROWS)
  );

  // Pull the next page in before the window reaches the end of what's loaded, so scrolling
  // never stalls on a round trip.
  const renderedThrough = windowEndRow.value * gridColumns.value;
  if (renderedThrough > shelfEntries.value.length - PAGE_SIZE / 2) {
    loadMoreItems();
  }
}

let scrollFrame = null;
function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    measureGrid();
    updateGridWindow();
  });
}

// Grouped views: series cards (and standalone titles) under each heading, never loose
// volumes or episodes. Creator uses the series' author (author, director or studio).
const entriesByCreator = computed(() => groupEntries(shelfEntries.value, creatorHeading));

// Without online metadata the scanner fills a video's "creator" with its folder name
// ("Quiet Harbor (2021)"), and books default to "Unknown Author". Neither is a real
// creator, so both go under one Unknown group instead of posing as a director.
function creatorHeading(entry) {
  return entry.kind === 'series'
    ? realCreator(entry.author, entry.name) || 'Unknown'
    : realCreator(entry.item.author, entry.item.title) || 'Unknown';
}

// A series goes under the folder all its titles share (see entryFolder).
const entriesByFolder = computed(() => groupEntries(shelfEntries.value, entryFolder));

function folderEntries(folder) {
  return buildShelfEntries(folder.items, { ungroup: shelfOptions.value.ungroup });
}

function setGrouping(id) {
  groupBy.value = id;
  if (id === 'custom_folder') {
    loadCustomFolders();
  }
}

// Monotonic request id: a slower earlier request must never overwrite a newer result.
let fetchSeq = 0;
let searchDebounce = null;
let loadingMore = false;

async function fetchItemPage(offset) {
  const params = { limit: PAGE_SIZE, offset };
  if (activeType.value !== 'all') params.mediaType = activeType.value;
  if (searchQuery.value) params.search = searchQuery.value;
  if (progressFilter.value) params.progress = progressFilter.value;
  if (genreFilter.value) params.genre = genreFilter.value;
  if (addedWithin.value) params.addedWithinDays = addedWithin.value;
  if (sortBy.value !== 'title') params.sort = sortBy.value;

  const res = await api.get('/items', { params });
  return res.data.items || [];
}

// The last few views (category + filters + sort) are kept in memory, so going back to one
// shows it instantly and then quietly refreshes it. Searches aren't kept: they're one-offs.
const SHELF_CACHE_LIMIT = 12;
const shelfCache = new Map();
// What's on screen, and a counter that bumps whenever that changes to a different view —
// it keys the results block, which is what plays the fade-in.
const shelfKey = ref(0);
const refreshing = ref(false);
let shownView = null;
let dimTimer = null;

function currentView() {
  return JSON.stringify([activeType.value, searchQuery.value, progressFilter.value, genreFilter.value, addedWithin.value, sortBy.value]);
}

function rememberShelf(view) {
  if (searchQuery.value) return;
  shelfCache.delete(view);
  shelfCache.set(view, { items: items.value, hasMore: hasMoreServerItems.value });
  if (shelfCache.size > SHELF_CACHE_LIMIT) shelfCache.delete(shelfCache.keys().next().value);
}

function showItems(list, hasMore, view) {
  items.value = list;
  hasMoreServerItems.value = hasMore;
  if (view !== shownView) {
    shownView = view;
    shelfKey.value++;
  }
}

async function fetchLibraryItems() {
  const seq = ++fetchSeq;
  const view = currentView();
  const cached = view !== shownView && shelfCache.get(view);
  clearTimeout(dimTimer);
  if (cached) {
    showItems(cached.items, cached.hasMore, view);
  } else if (shownView === null) {
    // Nothing to show yet (first visit): the skeleton.
    loading.value = true;
  } else if (view !== shownView) {
    // Keep the current view up; only dim it if the answer is slow enough to notice.
    dimTimer = setTimeout(() => { if (seq === fetchSeq) refreshing.value = true; }, 150);
  }
  try {
    const page = await fetchItemPage(0);
    if (seq !== fetchSeq) return; // A newer fetch already started — discard this one.
    showItems(page, page.length === PAGE_SIZE, view);
    rememberShelf(view);
    // Recompute from wherever the page is actually scrolled rather than assuming the top:
    // a refresh after editing an item shouldn't yank the reader back to row 0, and a new
    // search landing on a shorter list shouldn't leave the window pointing past its end.
    resetGridWindow();
    nextTick(() => {
      measureGrid();
      updateGridWindow();
    });

    // Only the grid renders a window; the grouped modes (author / series / disk folder)
    // build their buckets from the whole set, so they need every page up front.
    if (groupBy.value !== 'series') loadAllRemainingItems(seq);
  } catch (err) {
    console.error('Failed to fetch items:', err);
  } finally {
    if (seq === fetchSeq) {
      clearTimeout(dimTimer);
      loading.value = false;
      refreshing.value = false;
    }
  }
}

async function loadMoreItems() {
  if (loadingMore || !hasMoreServerItems.value) return;
  const seq = fetchSeq;
  loadingMore = true;
  try {
    const page = await fetchItemPage(items.value.length);
    if (seq !== fetchSeq) return; // The shelf changed underneath us — this page is stale.
    // The offset walks a stable title ordering, but a concurrent scan can shift rows, so
    // guard against a row arriving twice rather than rendering a duplicate card.
    const known = new Set(items.value.map((i) => i.id));
    items.value = items.value.concat(page.filter((i) => !known.has(i.id)));
    hasMoreServerItems.value = page.length === PAGE_SIZE;
    rememberShelf(shownView);
  } catch (err) {
    console.error('Failed to load more items:', err);
  } finally {
    loadingMore = false;
  }
}

async function loadAllRemainingItems(seq) {
  while (hasMoreServerItems.value && seq === fetchSeq) {
    await loadMoreItems();
  }
}

async function fetchContinueItems() {
  try {
    const res = await api.get('/progress/continue');
    continueItems.value = res.data.items || [];
  } catch (err) {
    console.warn('Failed to fetch continue items:', err);
  }
}

async function loadCustomFolders() {
  try {
    const params = {};
    if (activeType.value !== 'all') params.mediaType = activeType.value;
    const res = await api.get('/collections/all-grouped', { params });
    customFoldersGrouped.value = res.data.collections || res.data.groups || [];
    customFolders.value = customFoldersGrouped.value;
  } catch (err) {
    console.warn('Failed to load custom folders:', err);
  }
}

async function loadFilterSettings() {
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) {
      allowedFilters.value = res.data.allowedGroupingModes;
    }
  } catch (err) {
    console.warn('Failed to load filter settings:', err);
  }
}

async function createQuickFolder() {
  if (!quickFolderInput.value.trim()) return;
  try {
    await api.post('/collections', { name: quickFolderInput.value.trim() });
    quickFolderInput.value = '';
    await loadCustomFolders();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to create folder');
  }
}

async function deleteCustomFolder(folder) {
  const confirmed = await dialog.confirm({
    title: 'Delete Custom Folder',
    message: `Are you sure you want to delete the folder "${folder.name}"? Items inside will not be deleted from your shelf.`,
    confirmText: 'Delete Folder',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete(`/collections/${folder.id}`);
    await loadCustomFolders();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to delete folder');
  }
}

// A series card removes every title of that series that's in the folder.
async function removeItemsFromCustomFolder(folderId, items) {
  try {
    for (const item of items) {
      await api.delete(`/collections/${folderId}/items/${item.id}`);
    }
    await loadCustomFolders();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to remove item');
  }
}

function openAddToFolderModal(item) {
  selectedFolderItem.value = item;
  showAddToFolderModal.value = true;
}

// Every card opens a detail page first — the series page, or the title's own page — and
// reading, listening or watching starts from there.
function handleItemSelect(item) {
  router.push(detailRoute(item));
}

function openSeriesView(series) {
  router.push({
    path: `/series/${encodeURIComponent(series.name)}`,
    query: { library: series.libraryId, type: series.mediaType }
  });
}

function closeMangaReader() {
  activeMangaItem.value = null;
  refreshShelf();
}

function refreshShelf() {
  loadFilterSettings();
  fetchLibraryItems();
  fetchContinueItems();
  if (groupBy.value === 'custom_folder') {
    loadCustomFolders();
  }
}

// Media type changes fetch immediately; typing is debounced. Without the debounce every
// keystroke fired a full library query (5000 rows, megabytes of JSON) — 15 in-flight
// requests for "attack on titan", with the results racing each other into the grid.
watch([progressFilter, genreFilter, addedWithin, sortBy], () => {
  resetGridWindow();
  clearTimeout(searchDebounce);
  fetchLibraryItems();
});

watch([activeType, searchQuery], ([type], [prevType]) => {
  resetGridWindow();
  if (type !== prevType) {
    clearTimeout(searchDebounce);
    loadGenres();
    fetchLibraryItems();
  } else {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(fetchLibraryItems, 250);
  }
});

// Grouping (grid / author / series / folder) is applied client-side over the items we
// already hold, so it doesn't need — and mustn't wait for — another round trip.
watch(groupBy, (mode) => {
  resetGridWindow();
  if (mode === 'custom_folder') {
    loadCustomFolders();
  } else if (mode !== 'series') {
    // Grouped modes bucket the entire library, so make sure the rest of it is here.
    loadAllRemainingItems(fetchSeq);
  }
});

// A resize can change the column count and the card height at once, which moves every row
// boundary — re-measure before recomputing the window.
function onResize() {
  measureGrid();
  updateGridWindow();
}

// Cards only exist to be measured once they've rendered, so re-measure whenever the set of
// rendered items changes (first paint, a new page, a different filter).
watch(displayedEntries, () => {
  nextTick(() => {
    measureGrid();
    updateGridWindow();
  });
});

onMounted(() => {
  // A ?type= link (breadcrumbs, the sidebar on other pages) wins over the startup default;
  // this used to overwrite it, so every deep link landed on the default category.
  if (!route.query.type && authStore.user?.preferences?.defaultView) {
    activeType.value = authStore.user.preferences.defaultView;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  loadGenres();
  window.addEventListener('resize', onResize, { passive: true });
  loadFilterSettings();
  fetchLibraryItems();
  fetchContinueItems();
  // Every card opens a title page, so fetch that code while the shelf sits idle; the first
  // tap then doesn't wait on a download.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => import('./TitleView.vue').catch(() => {}));
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('online', updateOnline);
  window.removeEventListener('offline', updateOnline);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  clearTimeout(searchDebounce);
  clearTimeout(dimTimer);
});
</script>
