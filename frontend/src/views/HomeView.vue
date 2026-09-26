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
    <main class="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 flex-1 flex flex-col gap-8">
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
      <section v-if="continueWatchingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <MonitorPlay class="w-4 h-4 text-muted-foreground" />
            Continue Watching
          </h2>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
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
      <section v-if="continueReadingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <Clock class="w-4 h-4 text-muted-foreground" />
            Continue {{ continueCategoryLabel }}
          </h2>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
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

          <!-- Grouping Selector (Horizontal scrollable segmented pills for iOS/mobile) -->
          <div class="w-full lg:w-auto overflow-x-auto no-scrollbar flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border flex-nowrap">
            <button
              v-for="mode in groupingModes"
              :key="mode.id"
              @click="setGrouping(mode.id)"
              :class="[
                'h-9 min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 active:scale-95',
                groupBy === mode.id
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              ]"
            >
              <component :is="mode.icon" class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ mode.label }}</span>
            </button>
          </div>
        </div>

        <!-- Filters: progress, genre, recency, sort. Wraps to two lines on a phone. -->
        <div v-if="groupBy !== 'custom_folder'" class="flex flex-wrap items-center gap-2">
          <label class="sr-only" for="filter-progress">Progress</label>
          <select id="filter-progress" v-model="progressFilter" :class="filterSelectClass(progressFilter)">
            <option value="">Status</option>
            <option value="unread">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="finished">Finished</option>
            <option value="skipped">Skipped</option>
          </select>
          <label class="sr-only" for="filter-genre">Genre</label>
          <select v-if="genres.length" id="filter-genre" v-model="genreFilter" :class="filterSelectClass(genreFilter)">
            <option value="">Genre</option>
            <option v-for="g in genres" :key="g.name" :value="g.name">{{ g.name }} ({{ g.count }})</option>
          </select>
          <label class="sr-only" for="filter-added">Added</label>
          <select id="filter-added" v-model="addedWithin" :class="filterSelectClass(addedWithin)">
            <option value="">Added</option>
            <option value="7">Added this week</option>
            <option value="30">Added this month</option>
            <option value="90">Added in 3 months</option>
          </select>
          <label class="sr-only" for="filter-sort">Sort</label>
          <select id="filter-sort" v-model="sortBy" title="Sort order" :class="filterSelectClass(sortBy === 'title' ? '' : sortBy)">
            <option value="title">A–Z</option>
            <option value="added">Newest</option>
            <option value="recent">Recently opened</option>
            <option value="release">Release date</option>
          </select>
          <button
            v-if="filtersActive || sortBy !== 'title'"
            type="button"
            @click="clearFilters"
            class="h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition flex items-center gap-1"
          >
            <X class="w-3.5 h-3.5" /> Clear
          </button>
        </div>

        <!-- Loading Skeleton -->
        <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
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
          <div ref="gridEl" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 auto-rows-fr gap-3 sm:gap-4">
            <!-- Spacers stand in for the rows unmounted above and below the window, so
                 the page keeps the height it would have with every card rendered. -->
            <div v-if="padTopHeight > 0" :style="{ gridColumn: '1 / -1', height: padTopHeight + 'px' }"></div>
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
            <div v-if="padBottomHeight > 0" :style="{ gridColumn: '1 / -1', height: padBottomHeight + 'px' }"></div>
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

        <!-- Mode 2: Grouped by Creator (author / director / studio) -->
        <div v-else-if="groupBy === 'creator'" class="flex flex-col gap-6">
          <div
            v-for="(groupItems, authorName) in itemsByAuthor"
            :key="authorName"
            class="flex flex-col gap-3"
          >
            <div class="flex items-center gap-2 border-b border-border pb-1.5">
              <User class="w-4 h-4 text-muted-foreground" />
              <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">{{ authorName }}</h3>
              <span class="text-xs text-muted-foreground">({{ groupItems.length }})</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              <BookCard
                v-for="item in groupItems"
                :key="item.id"
                :item="item"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
              />
            </div>
          </div>
        </div>

        <!-- Mode 4: Grouped by Disk Folders -->
        <div v-else-if="groupBy === 'disk_folder'" class="flex flex-col gap-6">
          <div
            v-for="(groupItems, folderName) in itemsByFolder"
            :key="folderName"
            class="flex flex-col gap-3"
          >
            <div class="flex items-center gap-2 border-b border-border pb-1.5">
              <HardDrive class="w-4 h-4 text-muted-foreground" />
              <h3 class="text-xs font-mono text-foreground">{{ folderName }}</h3>
              <span class="text-xs text-muted-foreground">({{ groupItems.length }})</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              <BookCard
                v-for="item in groupItems"
                :key="item.id"
                :item="item"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
              />
            </div>
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
                <span class="text-xs text-muted-foreground">({{ folder.items.length }})</span>
                <span v-if="folder.isDefault" class="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
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
            <div v-if="folder.items.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              <BookCard
                v-for="item in folder.items"
                :key="item.id"
                :item="item"
                :inCustomFolder="!folder.isDefault"
                @select="handleItemSelect"
                @refresh="refreshShelf"
                @add-to-folder="openAddToFolderModal"
                @remove-from-folder="removeItemFromCustomFolder(folder.id, item.id)"
                @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
              />
            </div>
            <div v-else class="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl bg-card/30">
              This folder is empty. Click the three dots (<span class="font-bold">...</span>) on any title to add it here.
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
import { detailRoute, creatorLabel } from '../utils/mediaVocab';
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
  Layers,
  HardDrive,
  FolderHeart,
  Folder,
  FolderX,
  Plus,
  Trash2,
  MonitorPlay,
  X,
  WifiOff
} from 'lucide-vue-next';

const authStore = useAuthStore();
const player = usePlayerStore();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const router = useRouter();

const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');

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
    'h-9 pl-2.5 pr-1.5 rounded-lg border text-xs font-medium bg-background transition focus:outline-none focus:ring-2 focus:ring-ring/40 flex-1 sm:flex-none min-w-0 sm:min-w-[7rem] max-w-[11rem]',
    value ? 'border-primary/60 text-foreground bg-primary/5' : 'border-border text-muted-foreground'
  ];
}

function clearFilters() {
  progressFilter.value = '';
  genreFilter.value = '';
  addedWithin.value = '';
  sortBy.value = 'title';
}

async function loadGenres() {
  try {
    const params = activeType.value !== 'all' ? { mediaType: activeType.value } : {};
    const res = await api.get('/items/genres', { params });
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
    { id: 'series', label: 'Series', icon: Layers },
    { id: 'creator', label: creatorLabel(activeType.value), icon: User },
    { id: 'disk_folder', label: 'Disk Folders', icon: HardDrive },
    { id: 'custom_folder', label: 'Custom Folders', icon: FolderHeart }
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
const shelfEntries = computed(() => {
  const entries = [];
  const bySeries = new Map();
  for (const item of filteredItems.value) {
    if (item.series) {
      const key = `s::${item.series}::${item.library_id}::${item.media_type}`;
      let entry = bySeries.get(key);
      if (!entry) {
        entry = {
          kind: 'series',
          key,
          name: item.series,
          author: item.author,
          libraryId: item.library_id,
          mediaType: item.media_type,
          volumes: []
        };
        bySeries.set(key, entry);
        entries.push(entry);
      }
      entry.volumes.push(item);
    } else {
      entries.push({ kind: 'item', key: `i::${item.id}`, name: item.title, item });
    }
  }
  for (const entry of bySeries.values()) {
    entry.volumes.sort((a, b) => {
      if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title, undefined, { numeric: true });
      if (a.volume == null) return 1;
      if (b.volume == null) return -1;
      return a.volume - b.volume;
    });
  }
  if (sortBy.value === 'title') {
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }
  return entries;
});

// Windowed rendering. The grid only ever mounts the rows near the viewport: rows scrolled
// off the top are unmounted again and replaced by a spacer of exactly their height, so the
// scrollbar and scroll position stay honest while the DOM stays small no matter how far
// down a 50,000-item library you are.
const gridEl = ref(null);
const gridColumns = ref(6);
const rowHeight = ref(300);
const rowGap = ref(16);
const windowStartRow = ref(0);
const windowEndRow = ref(BUFFER_ROWS * 2);

const totalGridRows = computed(() => Math.ceil(shelfEntries.value.length / gridColumns.value));

const displayedEntries = computed(() =>
  shelfEntries.value.slice(
    windowStartRow.value * gridColumns.value,
    windowEndRow.value * gridColumns.value
  )
);

// rowHeight already includes one row gap, and the grid adds another gap between a spacer
// and the row after it — so a spacer standing in for N rows is N*rowHeight minus one gap,
// or the page grows slightly taller every time the window moves.
const padTopHeight = computed(() =>
  windowStartRow.value > 0 ? windowStartRow.value * rowHeight.value - rowGap.value : 0
);
const padBottomHeight = computed(() => {
  const rowsBelow = totalGridRows.value - windowEndRow.value;
  return rowsBelow > 0 ? rowsBelow * rowHeight.value - rowGap.value : 0;
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
    rowGap.value = gap;
    const measured = card.getBoundingClientRect().height + gap;
    // Sub-pixel jitter between measurements would re-trigger the render watcher forever;
    // only a real change in card size counts.
    if (measured > 0 && Math.abs(measured - rowHeight.value) > 1) rowHeight.value = measured;
  }
}

function updateGridWindow() {
  const el = gridEl.value;
  if (!el || rowHeight.value <= 0) return;

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

// Grouped by Creator (the `author` field: author, director or studio depending on type)
const itemsByAuthor = computed(() => {
  const map = {};
  for (const item of filteredItems.value) {
    const author = item.author || 'Unknown';
    if (!map[author]) map[author] = [];
    map[author].push(item);
  }
  return map;
});

// Grouped by Disk Folder path map
const itemsByFolder = computed(() => {
  const map = {};
  for (const item of filteredItems.value) {
    // `folder` is the item's directory relative to its library (the server no longer sends
    // absolute paths to non-admins); the last two segments keep group names short.
    const parts = (item.folder || '').split('/').filter(Boolean);
    const folder = parts.slice(-2).join('/') || 'Root';
    if (!map[folder]) map[folder] = [];
    map[folder].push(item);
  }
  return map;
});

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

async function fetchLibraryItems() {
  const seq = ++fetchSeq;
  loading.value = true;
  try {
    const page = await fetchItemPage(0);
    if (seq !== fetchSeq) return; // A newer fetch already started — discard this one.
    items.value = page;
    hasMoreServerItems.value = page.length === PAGE_SIZE;
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
    if (seq === fetchSeq) loading.value = false;
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

async function removeItemFromCustomFolder(folderId, itemId) {
  try {
    await api.delete(`/collections/${folderId}/items/${itemId}`);
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
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('online', updateOnline);
  window.removeEventListener('offline', updateOnline);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  clearTimeout(searchDebounce);
});
</script>
