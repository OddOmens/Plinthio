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
      <!-- Continue Watching (video only, shown as its own row on the "All" view) -->
      <section v-if="continueWatchingItems.length > 0 && !searchQuery && groupBy === 'grid'" class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <MonitorPlay class="w-4 h-4 text-muted-foreground" />
            Continue Watching
          </h2>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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
      <section v-if="continueReadingItems.length > 0 && !searchQuery && groupBy === 'grid'" class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <Clock class="w-4 h-4 text-muted-foreground" />
            Continue {{ continueCategoryLabel }}
          </h2>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold tracking-tight text-foreground">
              {{ sectionTitle }}
            </h2>
            <span class="text-xs text-muted-foreground font-mono">
              ({{ displayItemCount }})
            </span>
          </div>

          <!-- Grouping Selector (Horizontal scrollable segmented pills for iOS/mobile) -->
          <div class="w-full sm:w-auto overflow-x-auto no-scrollbar flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border flex-nowrap">
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

        <!-- Loading Skeleton -->
        <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          <div v-for="i in 12" :key="i" class="aspect-[2/3] bg-muted/40 animate-pulse rounded-xl border border-border"></div>
        </div>

        <!-- Empty State -->
        <div v-else-if="items.length === 0 && groupBy !== 'custom_folder'" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
          <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
            <BookX class="w-5 h-5" />
          </div>
          <h3 class="text-sm font-medium text-foreground">No media found</h3>
          <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
            {{ searchQuery ? 'Try adjusting your search query' : 'Add a library in Server Settings and scan your folders to populate your shelf' }}
          </p>
          <router-link
            v-if="authStore.isAdmin && !searchQuery"
            to="/admin"
            class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm"
          >
            Go to Settings
          </router-link>
        </div>

        <!-- Mode 1: Smart Grid (manga shown as series cards) -->
        <div v-else-if="groupBy === 'grid'" class="flex flex-col gap-6">
          <!-- Manga Series Section -->
          <template v-if="mangaSeriesGroups.series.length > 0 && (activeType === 'manga' || activeType === 'all')">
            <div class="flex flex-col gap-3">
              <div v-if="activeType === 'all'" class="flex items-center gap-2 border-b border-border pb-1.5">
                <Layers class="w-4 h-4 text-muted-foreground" />
                <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">Manga Series</h3>
                <span class="text-xs text-muted-foreground">({{ mangaSeriesGroups.series.length }})</span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                <MangaSeriesCard
                  v-for="series in mangaSeriesGroups.series"
                  :key="series.name"
                  :series="series"
                  @select="openSeriesView"
                />
              </div>
            </div>
          </template>

          <!-- Standalone manga (no series) + all non-manga items -->
          <template v-if="nonSeriesGridItems.length > 0">
            <div class="flex flex-col gap-3">
              <div
                v-if="mangaSeriesGroups.series.length > 0 && (activeType === 'manga' || activeType === 'all') && mangaSeriesGroups.standalone.length > 0"
                class="flex items-center gap-2 border-b border-border pb-1.5"
              >
                <BookImage class="w-4 h-4 text-muted-foreground" />
                <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">Singles</h3>
                <span class="text-xs text-muted-foreground">({{ mangaSeriesGroups.standalone.length }})</span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                <BookCard
                  v-for="item in displayedNonSeriesGridItems"
                  :key="item.id"
                  :item="item"
                  @select="handleItemSelect"
                  @refresh="refreshShelf"
                  @add-to-folder="openAddToFolderModal"
                  @open-bookmarks="openBookmarksModal"
                @edit-metadata="openMetadataModal"
                />
              </div>

              <!-- Incremental loading indicator for large libraries -->
              <div
                v-if="visibleGridCount < nonSeriesGridItems.length"
                class="py-4 text-center"
              >
                <button
                  @click="visibleGridCount += 48"
                  class="px-4 py-2 rounded-xl bg-card border border-border hover:bg-muted text-xs font-medium text-foreground transition active:scale-95 shadow-sm"
                >
                  Showing {{ displayedNonSeriesGridItems.length }} of {{ nonSeriesGridItems.length }} items · Load more
                </button>
              </div>
            </div>
          </template>

          <!-- Empty state if nothing at all -->
          <div v-if="mangaSeriesGroups.series.length === 0 && nonSeriesGridItems.length === 0 && !loading" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
            <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
              <BookX class="w-5 h-5" />
            </div>
            <h3 class="text-sm font-medium text-foreground">No media found</h3>
            <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
              {{ searchQuery ? 'Try adjusting your search query' : 'Add a library in Server Settings and scan your folders to populate your shelf' }}
            </p>
          </div>
        </div>

        <!-- Mode 2: Grouped by Author -->
        <div v-else-if="groupBy === 'author'" class="flex flex-col gap-6">
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
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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

        <!-- Mode 3: Grouped by Series -->
        <div v-else-if="groupBy === 'series'" class="flex flex-col gap-6">
          <div
            v-for="(groupItems, seriesName) in itemsBySeries"
            :key="seriesName"
            class="flex flex-col gap-3"
          >
            <div class="flex items-center gap-2 border-b border-border pb-1.5">
              <Layers class="w-4 h-4 text-muted-foreground" />
              <h3 class="text-xs font-semibold text-foreground tracking-wide uppercase font-mono">{{ seriesName }}</h3>
              <span class="text-xs text-muted-foreground">({{ groupItems.length }})</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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

              <button
                v-if="!folder.isDefault"
                @click="deleteCustomFolder(folder)"
                class="p-1 text-muted-foreground hover:text-destructive hover:bg-muted rounded transition"
                title="Delete folder"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Folder Items Grid -->
            <div v-if="folder.items.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
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

    <!-- Manga Series Volume Picker Sheet -->
    <MangaSeriesSheet
      :isOpen="showSeriesSheet"
      :series="activeSeries"
      @close="showSeriesSheet = false"
      @open-volume="openVolumeFromSheet"
    />

    <!-- In-App EPUB Reader -->
    <EpubReader
      v-if="activeEpubItem"
      :item="activeEpubItem"
      @close="activeEpubItem = null; refreshShelf()"
    />

    <!-- In-App Video Player (movies, TV shows, anime) -->
    <VideoPlayer
      v-if="activeVideoItem"
      :key="activeVideoItem.id"
      :item="activeVideoItem"
      @close="activeVideoItem = null; refreshShelf()"
      @play-next="playNextVideo"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
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
import MangaReader from '../components/MangaReader.vue';
import MangaSeriesCard from '../components/MangaSeriesCard.vue';
import MangaSeriesSheet from '../components/MangaSeriesSheet.vue';
import EpubReader from '../components/EpubReader.vue';
import VideoPlayer from '../components/VideoPlayer.vue';
import AddToFolderModal from '../components/AddToFolderModal.vue';
import BookmarksModal from '../components/BookmarksModal.vue';
import MetadataSearchModal from '../components/MetadataSearchModal.vue';
import {
  Clock,
  BookX,
  BookImage,
  LayoutGrid,
  User,
  Layers,
  HardDrive,
  FolderHeart,
  Folder,
  FolderX,
  Plus,
  Trash2,
  MonitorPlay
} from 'lucide-vue-next';

const authStore = useAuthStore();
const player = usePlayerStore();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const router = useRouter();

const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');

// ?type= lets other pages (e.g. the sidebar on Admin/Settings/Docs) deep-link straight into
// a filtered shelf instead of always dumping you on "All".
const activeType = ref(
  useRoute().query.type || authStore.user?.preferences?.defaultView || 'all'
);
const searchQuery = ref('');
const groupBy = ref('grid');

const items = ref([]);
const continueItems = ref([]);
const loading = ref(true);
const activeMangaItem = ref(null);
const activeEpubItem = ref(null);
const activeVideoItem = ref(null);

const customFolders = ref([]);
const customFoldersGrouped = ref([]);
const folderItems = ref({});
const quickFolderInput = ref('');
const allowedFilters = ref(['grid', 'author', 'series', 'disk_folder', 'custom_folder']);

const showAddToFolderModal = ref(false);
const selectedFolderItem = ref(null);

const showBookmarksModal = ref(false);
const selectedBookmarksItem = ref(null);

const showMetadataModal = ref(false);
const selectedMetadataItem = ref(null);

// Manga series drill-down sheet
const showSeriesSheet = ref(false);
const activeSeries = ref({ name: '', author: null, volumes: [] });

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

const allGroupingModes = [
  { id: 'grid', label: 'Grid', icon: LayoutGrid },
  { id: 'author', label: 'By Author', icon: User },
  { id: 'series', label: 'By Series', icon: Layers },
  { id: 'disk_folder', label: 'Disk Folders', icon: HardDrive },
  { id: 'custom_folder', label: 'Custom Folders', icon: FolderHeart }
];

const groupingModes = computed(() => {
  const userEnabled = authStore.user?.preferences?.enabledGroupingModes || ['grid', 'author', 'series', 'disk_folder', 'custom_folder'];
  return allGroupingModes.filter(m => allowedFilters.value.includes(m.id) && userEnabled.includes(m.id));
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
  // For manga grid: show series count + standalone count
  if (groupBy.value === 'grid' && (activeType.value === 'manga' || activeType.value === 'all')) {
    const mg = mangaSeriesGroups.value;
    if (mg.series.length > 0 || mg.standalone.length > 0) {
      const parts = [];
      if (mg.series.length) parts.push(`${mg.series.length} series`);
      if (mg.standalone.length) parts.push(`${mg.standalone.length} items`);
      // Also count non-manga
      const nonManga = filteredItems.value.filter(i => i.media_type !== 'manga').length;
      if (nonManga) parts.push(`${nonManga} other`);
      return parts.join(', ');
    }
  }
  return `${filteredItems.value.length} items`;
});

/**
 * Groups manga items into series (multi-volume) and standalone (single/no-series).
 * Each series object: { name, author, volumes[] }
 * Standalone items are returned as-is for rendering as BookCards.
 */
const mangaSeriesGroups = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  if (!enabled.includes('manga')) return { series: [], standalone: [] };

  const mangaItems = items.value.filter(i => i.media_type === 'manga');

  // Group by series name
  const seriesMap = {};
  const standalone = [];

  for (const item of mangaItems) {
    if (item.series) {
      if (!seriesMap[item.series]) {
        seriesMap[item.series] = { name: item.series, author: item.author, volumes: [] };
      }
      seriesMap[item.series].volumes.push(item);
    } else {
      standalone.push(item);
    }
  }

  // Sort volumes within each series ascending
  const series = Object.values(seriesMap).map(s => {
    s.volumes.sort((a, b) => {
      if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title);
      if (a.volume == null) return 1;
      if (b.volume == null) return -1;
      return a.volume - b.volume;
    });
    return s;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return { series, standalone };
});

// Items shown as regular BookCards in grid mode:
// standalone manga (no series) + all non-manga filtered items
const nonSeriesGridItems = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  const nonManga = filteredItems.value.filter(i => i.media_type !== 'manga');
  const standaloneManga = mangaSeriesGroups.value.standalone;
  return [...nonManga, ...standaloneManga].filter(i => enabled.includes(i.media_type));
});

// Incremental rendering for ultra-fast initial paint (scale to 1000s of items)
const visibleGridCount = ref(48);
const displayedNonSeriesGridItems = computed(() => {
  return nonSeriesGridItems.value.slice(0, visibleGridCount.value);
});

function onScroll() {
  const scrollY = window.scrollY || window.pageYOffset;
  const viewportHeight = window.innerHeight;
  const fullHeight = document.documentElement.scrollHeight;

  // When within 800px of bottom, append 48 more items
  if (scrollY + viewportHeight >= fullHeight - 800) {
    if (visibleGridCount.value < nonSeriesGridItems.value.length) {
      visibleGridCount.value += 48;
    }
  }
}

// Grouped by Author map
const itemsByAuthor = computed(() => {
  const map = {};
  for (const item of filteredItems.value) {
    const author = item.author || 'Unknown Author';
    if (!map[author]) map[author] = [];
    map[author].push(item);
  }
  return map;
});

// Grouped by Series map — volumes sorted ascending within each series
const itemsBySeries = computed(() => {
  const map = {};
  for (const item of filteredItems.value) {
    const series = item.series || 'Standalone Titles';
    if (!map[series]) map[series] = [];
    map[series].push(item);
  }
  // Sort items in each group by volume (nulls last, then ascending)
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => {
      if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title);
      if (a.volume == null) return 1;
      if (b.volume == null) return -1;
      return a.volume - b.volume;
    });
  }
  return map;
});

// Grouped by Disk Folder path map
const itemsByFolder = computed(() => {
  const map = {};
  for (const item of filteredItems.value) {
    const parts = item.path.split('/');
    parts.pop(); // remove file name
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

async function fetchLibraryItems() {
  loading.value = true;
  try {
    const params = { limit: 5000 };
    if (activeType.value !== 'all') params.mediaType = activeType.value;
    if (searchQuery.value) params.search = searchQuery.value;

    const res = await api.get('/items', { params });
    items.value = res.data.items || [];
    visibleGridCount.value = 48;
  } catch (err) {
    console.error('Failed to fetch items:', err);
  } finally {
    loading.value = false;
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

function handleItemSelect(item) {
  if (item.media_type === 'audiobook') {
    player.playItem(item);
  } else if (['movie', 'show', 'anime'].includes(item.media_type)) {
    activeVideoItem.value = item;
  } else if (item.media_type === 'manga') {
    if (item.series) {
      router.push(`/manga/series/${encodeURIComponent(item.series)}`);
    } else {
      router.push(`/manga/${item.id}`);
    }
  } else if (item.media_type === 'book' && item.format === 'epub') {
    activeEpubItem.value = item;
  } else {
    // PDFs and other formats open in browser tab
    const token = localStorage.getItem('plinthio_token');
    window.open(`/api/media/book/${item.id}/file?token=${token}`, '_blank');
  }
}

// The :key on VideoPlayer is the item id, so swapping the item remounts the player and it
// re-runs its playback probe for the new file rather than reusing the previous one's mode.
function playNextVideo(nextItem) {
  activeVideoItem.value = nextItem;
}

function openSeriesView(series) {
  router.push(`/manga/series/${encodeURIComponent(series.name)}`);
}

function openSeriesSheet(series) {
  openSeriesView(series);
}

function openVolumeFromSheet(vol) {
  showSeriesSheet.value = false;
  // Small delay so the sheet closes before the reader opens
  setTimeout(() => {
    activeMangaItem.value = vol;
  }, 50);
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

watch([activeType, searchQuery, groupBy], () => {
  visibleGridCount.value = 48;
  fetchLibraryItems();
  if (groupBy.value === 'custom_folder') {
    loadCustomFolders();
  }
});

onMounted(() => {
  if (authStore.user?.preferences?.defaultView) {
    activeType.value = authStore.user.preferences.defaultView;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  loadFilterSettings();
  fetchLibraryItems();
  fetchContinueItems();
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
});
</script>
