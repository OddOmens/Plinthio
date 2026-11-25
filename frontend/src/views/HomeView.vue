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
        <span class="flex-1">{{ $t('shelf.offline.message') }}</span>
        <span class="font-semibold whitespace-nowrap">{{ $t('shelf.offline.openDownloads') }}</span>
      </router-link>
      <!-- The rows above the shelf, in the person's own order (Settings → Shelves). -->
      <template v-for="row in homeRowIds" :key="row">
      <!-- Favourite live channels; hides itself when empty. -->
      <LiveNowRow v-if="row === 'live' && activeType === 'all' && !searchQuery && !filtersActive && groupBy === 'series'" />

      <!-- Continue Watching: video only, its own row on the "All" view -->
      <section :key="`watching-${activeType}`" v-else-if="row === 'watching' && continueWatchingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="shelf-fade-in flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <MonitorPlay class="w-4 h-4 text-muted-foreground" />
            {{ $t('shelf.continue.watching') }}
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

      <!-- Continue Reading / Listening -->
      <section :key="`reading-${activeType}`" v-else-if="row === 'reading' && continueReadingItems.length > 0 && !searchQuery && !filtersActive && groupBy === 'series'" class="shelf-fade-in flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <Clock class="w-4 h-4 text-muted-foreground" />
            {{ continueTitle }}
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
      </template>

      <!-- Main shelf -->
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

          <!-- View selector. On a phone the modes share the row under short names. -->
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
              <!-- On a phone only the chosen view keeps its icon, to leave room for labels. -->
              <component :is="mode.icon" class="w-3.5 h-3.5 flex-shrink-0" :class="groupBy === mode.id ? '' : 'hidden sm:block'" />
              <span class="sm:hidden truncate">{{ mode.short }}</span>
              <span class="hidden sm:inline">{{ mode.label }}</span>
            </button>
          </div>
        </div>

        <!-- Filters and sort: a two-column grid on a phone, a wrapping row above that. -->
        <div v-if="groupBy !== 'custom_folder'" class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select v-model="progressFilter" :aria-label="$t('shelf.filters.progress')" :class="filterSelectClass(progressFilter)">
            <option value="">{{ $t('shelf.filters.status') }}</option>
            <option value="unread">{{ $t('shelf.filters.notStarted') }}</option>
            <option value="in_progress">{{ $t('shelf.filters.inProgress') }}</option>
            <option value="finished">{{ $t('shelf.filters.finished') }}</option>
            <option value="skipped">{{ $t('shelf.filters.skipped') }}</option>
          </select>
          <select v-if="genres.length" v-model="genreFilter" :aria-label="$t('shelf.filters.genre')" :class="filterSelectClass(genreFilter)">
            <option value="">{{ $t('shelf.filters.genre') }}</option>
            <option v-for="g in genres" :key="g.name" :value="g.name">{{ g.name }} ({{ g.count }})</option>
          </select>
          <select v-model="addedWithin" :aria-label="$t('shelf.filters.added')" :class="filterSelectClass(addedWithin)">
            <option value="">{{ $t('shelf.filters.added') }}</option>
            <option value="7">{{ $t('shelf.filters.thisWeek') }}</option>
            <option value="30">{{ $t('shelf.filters.thisMonth') }}</option>
            <option value="90">{{ $t('shelf.filters.last3Months') }}</option>
          </select>
          <!-- Without a genre list there are three selects; sort takes the whole last row. -->
          <select v-model="sortBy" :aria-label="$t('shelf.sort.label')" :title="$t('shelf.sort.label')" :class="[filterSelectClass(sortBy === 'title' ? '' : sortBy), genres.length ? '' : 'col-span-2']">
            <option value="title">{{ $t('shelf.sort.title') }}</option>
            <option value="added">{{ $t('shelf.sort.added') }}</option>
            <option value="recent">{{ $t('shelf.sort.recent') }}</option>
            <option value="release">{{ $t('shelf.sort.release') }}</option>
          </select>
          <!-- Movie collections: one card per collection, or every film -->
          <div
            v-if="hasMovieCollections && (activeType === 'movie' || activeType === 'all')"
            class="col-span-2 flex items-center p-0.5 rounded-lg border border-border bg-muted/40 text-sm sm:text-xs"
            role="group"
            :aria-label="$t('shelf.collections.label')"
          >
            <button
              type="button"
              @click="expandCollections = false"
              :aria-pressed="String(!expandCollections)"
              :class="['flex-1 sm:flex-none h-9 sm:h-8 px-2.5 rounded-md font-medium transition', !expandCollections ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >{{ $t('shelf.collections.grouped') }}</button>
            <button
              type="button"
              @click="expandCollections = true"
              :aria-pressed="String(expandCollections)"
              :class="['flex-1 sm:flex-none h-9 sm:h-8 px-2.5 rounded-md font-medium transition', expandCollections ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >{{ $t('shelf.collections.all') }}</button>
          </div>
          <button
            v-if="filtersActive || sortBy !== 'title'"
            type="button"
            @click="clearFilters"
            class="col-span-2 h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition flex items-center justify-center gap-1"
          >
            <X class="w-3.5 h-3.5" /> {{ $t('shelf.filters.clear') }}
          </button>
        </div>

        <!-- Keyed by the view on screen so a new category or filter fades in; while a slow
             one loads the old view stays, dimmed. -->
        <div
          :key="shelfKey"
          class="shelf-fade-in transition-opacity duration-200"
          :class="refreshing ? 'opacity-40 pointer-events-none' : ''"
          :aria-busy="String(loading || refreshing)"
        >
        <!-- Skeleton (first visit only) -->
        <div v-if="loading" class="poster-grid gap-3 sm:gap-4">
          <div v-for="i in 12" :key="i" class="aspect-[2/3] bg-muted/40 animate-pulse rounded-xl border border-border"></div>
        </div>

        <!-- Load failed: not "no media", and not the last shelf's cards under this one -->
        <div v-else-if="loadError" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
          <div class="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center mb-3">
            <AlertCircle class="w-5 h-5" />
          </div>
          <h3 class="text-sm font-medium text-foreground mb-4">{{ loadError }}</h3>
          <button type="button" @click="fetchLibraryItems()" class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm">
            {{ $t('common.retry') }}
          </button>
        </div>

        <div v-else-if="items.length === 0 && groupBy !== 'custom_folder'" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
          <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
            <BookX class="w-5 h-5" />
          </div>
          <h3 class="text-sm font-medium text-foreground">{{ $t('shelf.empty.title') }}</h3>
          <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
            {{ searchQuery || filtersActive ? $t('shelf.empty.noMatches') : $t('shelf.empty.noLibrary') }}
          </p>
          <router-link
            v-if="authStore.isAdmin && !searchQuery && !filtersActive"
            to="/admin"
            class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm"
          >
            {{ $t('shelf.empty.goToSettings') }}
          </router-link>
        </div>

        <!-- Series: one card per series plus standalone titles -->
        <div v-else-if="groupBy === 'series'" class="flex flex-col gap-3">
          <!-- Spacers stand in for unmounted rows. They must stay outside the grid: inside,
               auto-rows-fr stretches every row to the spacer's height and the page grows forever. -->
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
            {{ $t('shelf.loadedMore', { count: filteredItems.length }) }}
          </div>

          <div v-if="shelfEntries.length === 0 && !loading" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
            <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
              <BookX class="w-5 h-5" />
            </div>
            <h3 class="text-sm font-medium text-foreground">{{ $t('shelf.empty.title') }}</h3>
            <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
              {{ searchQuery || filtersActive ? $t('shelf.empty.noMatches') : $t('shelf.empty.noLibrary') }}
            </p>
          </div>
        </div>

        <!-- By creator (author / director / studio) -->
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

        <!-- By disk folder: a series sits once, under its own folder -->
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

        <!-- Custom folders, plus an Unorganized catch-all -->
        <div v-else-if="groupBy === 'custom_folder'" class="flex flex-col gap-6">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center gap-2">
              <FolderHeart class="w-4 h-4 text-primary" />
              <span class="text-xs font-semibold text-foreground">{{ $t('shelf.customFolders.heading') }}</span>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <input
                v-model="quickFolderInput"
                @keyup.enter="createQuickFolder"
                :placeholder="$t('shelf.customFolders.newPlaceholder')"
                class="flex-1 sm:w-48 h-9 bg-background border border-border rounded-lg px-3 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                @click="createQuickFolder"
                :disabled="!quickFolderInput.trim() || creatingFolder"
                class="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm active:scale-95 flex-shrink-0"
              >
                <Plus class="w-3.5 h-3.5" />
                {{ $t('common.add') }}
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
                  {{ $t('shelf.customFolders.catchAll') }}
                </span>
              </div>

              <button :aria-label="$t('shelf.customFolders.delete')"
                v-if="!folder.isDefault"
                @click="deleteCustomFolder(folder)"
                class="p-1 text-muted-foreground hover:text-destructive hover:bg-muted rounded transition"
                :title="$t('shelf.customFolders.delete')"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>

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
            <I18nT v-else keypath="shelf.customFolders.empty" tag="div" class="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl bg-card/30">
              <template #dots><span class="font-bold">...</span></template>
            </I18nT>
          </div>
        </div>
        </div>
      </section>
    </main>
    </div>

    <MangaReader
      v-if="activeMangaItem"
      :item="activeMangaItem"
      @close="closeMangaReader"
    />

    <AddToFolderModal
      :isOpen="showAddToFolderModal"
      :item="selectedFolderItem"
      @close="showAddToFolderModal = false"
      @updated="loadCustomFolders"
    />

    <BookmarksModal
      :isOpen="showBookmarksModal"
      :item="selectedBookmarksItem"
      @close="showBookmarksModal = false"
      @select-manga-page="handleMangaJump"
    />

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
import LiveNowRow from '../components/live/LiveNowRow.vue';
import { homeRowOrder, hiddenHomeRows } from '../utils/homeRows';
import { buildShelfEntries, entryFolder, groupEntries } from '../utils/shelfEntries';
import { detailRoute, creatorLabel, realCreator, VIDEO_TYPES } from '../utils/mediaVocab';
import { normalizeShelfModes, userShelfModes } from '../utils/shelfModes';
import { t } from '../i18n';
import I18nT from '../i18n/I18nT.vue';
// Loaded on demand to keep the shelf's first download small.
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
  WifiOff,
  AlertCircle
} from '@lucide/vue';

const authStore = useAuthStore();
const player = usePlayerStore();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const router = useRouter();

const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');

// ?type= deep-links into a filtered shelf.
const route = useRoute();
const defaultType = () => authStore.user?.preferences?.defaultView || 'all';
const activeType = ref(route.query.type || defaultType());

// The category is kept in the URL (replaced, not pushed) so Back from a title returns to
// the same shelf. The default category leaves the URL bare.
watch(activeType, (type) => {
  const wanted = type === defaultType() ? undefined : type;
  if (route.path !== '/' || route.query.type === wanted) return;
  const query = { ...route.query };
  if (wanted) query.type = wanted;
  else delete query.type;
  router.replace({ query });
});
watch(() => route.query.type, (type) => {
  if (route.path === '/') activeType.value = type || defaultType();
});
const searchQuery = ref('');
const groupBy = ref('series');

const isOnline = ref(navigator.onLine);
const updateOnline = () => { isOnline.value = navigator.onLine; };

// Applied server-side (GET /api/items).
const progressFilter = ref('');
const genreFilter = ref('');
const addedWithin = ref('');
const sortBy = ref('title');
const genres = ref([]);
const filtersActive = computed(() => !!(progressFilter.value || genreFilter.value || addedWithin.value));

function filterSelectClass(value) {
  return [
    // 16px on a phone: iOS zooms into smaller form controls on focus.
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

// Per category, so switching back doesn't pop the Genre select in after a round trip.
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
    if (type === activeType.value) genres.value = [];
  }
}

// Items are fetched a page at a time so large libraries don't stall first paint.
const PAGE_SIZE = 1000;
// Rows kept mounted beyond the viewport so a fast scroll doesn't expose a gap.
const BUFFER_ROWS = 4;

const items = ref([]);
const hasMoreServerItems = ref(false);
const continueItems = ref([]);
const loading = ref(true);
const loadError = ref('');
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

// Allowed by the server and not hidden by the user (see utils/shelfModes).
const groupingModes = computed(() => {
  const serverModes = normalizeShelfModes(allowedFilters.value);
  const userModes = userShelfModes(authStore.user?.preferences?.enabledGroupingModes);
  const all = [
    // Id "series" kept for saved preferences; this is the A–Z view.
    { id: 'series', label: t('shelf.modes.alphabetical'), short: t('shelf.modes.alphabeticalShort'), icon: ArrowDownAZ },
    { id: 'creator', label: creatorLabel(activeType.value), short: creatorLabel(activeType.value), icon: User },
    { id: 'disk_folder', label: t('shelf.modes.diskFolders'), short: t('shelf.modes.diskFoldersShort'), icon: HardDrive },
    { id: 'custom_folder', label: t('shelf.modes.customFolders'), short: t('shelf.modes.customFoldersShort'), icon: FolderHeart }
  ];
  return all.filter((m) => serverModes.includes(m.id) && userModes.includes(m.id));
});

watch(groupingModes, (newModes) => {
  if (newModes.length > 0 && !newModes.some(m => m.id === groupBy.value)) {
    groupBy.value = newModes[0].id;
  }
});

// One whole message per category, so each language can say "continue reading" its own way.
const CONTINUE_TYPES = ['audiobook', 'manga', 'book', 'movie', 'show', 'anime'];
const continueTitle = computed(() =>
  t(`shelf.continue.${CONTINUE_TYPES.includes(activeType.value) ? activeType.value : 'all'}`)
);

const displayedContinueItems = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  return continueItems.value.filter(i => {
    if (!enabled.includes(i.media_type)) return false;
    if (activeType.value === 'all') return true;
    return i.media_type === activeType.value;
  });
});

// The rows above the shelf: the person's order, and which they've hidden (Settings → Shelves).
const homeRowIds = computed(() => homeRowOrder(authStore.user?.preferences?.homeRows));
// (The Live TV row has its own switch, preferences.liveTv.showOnHome, which it reads itself.)
const hiddenRows = computed(() => hiddenHomeRows(authStore.user?.preferences?.homeRows));
// A hidden row's titles stay off Home on every tab: "watching" is video, "reading" the rest.
const shownContinueItems = computed(() => displayedContinueItems.value.filter(
  (i) => !hiddenRows.value.includes(VIDEO_TYPES.includes(i.media_type) ? 'watching' : 'reading')
));

// On "All", video gets its own Continue Watching row; a filtered view has just one row.
const continueWatchingItems = computed(() =>
  activeType.value === 'all'
    ? shownContinueItems.value.filter(i => VIDEO_TYPES.includes(i.media_type))
    : []
);
const continueReadingItems = computed(() =>
  activeType.value === 'all'
    ? shownContinueItems.value.filter(i => !VIDEO_TYPES.includes(i.media_type))
    : shownContinueItems.value
);

const sectionTitle = computed(() => {
  if (searchQuery.value) return t('shelf.sectionTitle.results', { query: searchQuery.value });
  switch (activeType.value) {
    case 'audiobook': return t('shelf.sectionTitle.audiobook');
    case 'manga': return t('shelf.sectionTitle.manga');
    case 'book': return t('shelf.sectionTitle.book');
    case 'movie': return t('shelf.sectionTitle.movie');
    case 'show': return t('shelf.sectionTitle.show');
    case 'anime': return t('shelf.sectionTitle.anime');
    default: return t('shelf.sectionTitle.all');
  }
});

const filteredItems = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  return items.value.filter(item => enabled.includes(item.media_type));
});

const displayItemCount = computed(() => {
  if (groupBy.value === 'custom_folder') {
    return t('shelf.counts.folders', { count: customFolders.value.length });
  }
  if (groupBy.value === 'series') {
    const seriesCount = shelfEntries.value.filter((e) => e.kind === 'series').length;
    const singles = shelfEntries.value.length - seriesCount;
    const series = t('shelf.counts.series', { count: seriesCount });
    const titles = t('shelf.counts.titles', { count: singles });
    if (seriesCount && singles) return t('shelf.counts.seriesAndTitles', { series, titles });
    if (seriesCount) return series;
    if (singles) return titles;
  }
  return t('shelf.counts.items', { count: filteredItems.value.length });
});

// Movie collections show as one card, or with "All movies" every film on its own.
const EXPAND_KEY = 'plinthio_expand_collections';
const expandCollections = ref((() => { try { return localStorage.getItem(EXPAND_KEY) === '1'; } catch (e) { return false; } })());
watch(expandCollections, (on) => { try { localStorage.setItem(EXPAND_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } });
const shelfOptions = computed(() => ({
  alphabetical: sortBy.value === 'title',
  ungroup: expandCollections.value ? (item) => item.media_type === 'movie' : null
}));
const hasMovieCollections = computed(() => filteredItems.value.some((i) => i.media_type === 'movie' && i.series));

const shelfEntries = computed(() => buildShelfEntries(filteredItems.value, shelfOptions.value));

// Windowed rendering: only rows near the viewport are mounted; spacers of exact height stand
// in for the rest so the scrollbar stays honest.
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

// rowHeight includes one gap, so a spacer for N rows is exactly N*rowHeight.
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

// Columns come from the grid's resolved template so CSS breakpoints stay the source of
// truth; row height is measured off a real card.
function measureGrid() {
  const el = gridEl.value;
  if (!el) return;

  const columns = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
  if (columns > 0) gridColumns.value = columns;

  const card = el.querySelector('[data-grid-card]');
  if (card) {
    const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
    const measured = card.getBoundingClientRect().height + gap;
    // Ignore sub-pixel jitter, which would re-trigger the render watcher forever.
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

  // Prefetch the next page before the window reaches the end of what's loaded.
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

const entriesByCreator = computed(() => groupEntries(shelfEntries.value, creatorHeading));

// Placeholder creators (folder names, "Unknown Author") go under one Unknown group; see realCreator.
function creatorHeading(entry) {
  return entry.kind === 'series'
    ? realCreator(entry.author, entry.name) || t('common.unknown')
    : realCreator(entry.item.author, entry.item.title) || t('common.unknown');
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
// In-flight page fetch; a second request waits on it.
let loadingMore = null;

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

// Recent views (not searches) are cached so going back shows them instantly, then refreshes.
const SHELF_CACHE_LIMIT = 12;
const shelfCache = new Map();
// Bumped when a different view is shown; keys the results block to play the fade-in.
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
  loadError.value = '';
  if (cached) {
    showItems(cached.items, cached.hasMore, view);
  } else if (shownView === null) {
    // First visit: skeleton.
    loading.value = true;
  } else if (view !== shownView) {
    // Keep the current view up; only dim it if the answer is slow enough to notice.
    dimTimer = setTimeout(() => { if (seq === fetchSeq) refreshing.value = true; }, 150);
  }
  try {
    const page = await fetchItemPage(0);
    if (seq !== fetchSeq) return;
    showItems(page, page.length === PAGE_SIZE, view);
    rememberShelf(view);
    // Recompute from the actual scroll position rather than assuming the top.
    resetGridWindow();
    nextTick(() => {
      measureGrid();
      updateGridWindow();
    });

    // Grouped modes bucket the whole set, so they need every page.
    if (groupBy.value !== 'series') loadAllRemainingItems(seq);
  } catch (err) {
    console.error('Failed to fetch items:', err);
    if (seq === fetchSeq && view !== shownView) loadError.value = err.response?.data?.error || t('shelf.errors.load');
  } finally {
    if (seq === fetchSeq) {
      clearTimeout(dimTimer);
      loading.value = false;
      refreshing.value = false;
    }
  }
}

function loadMoreItems() {
  if (!loadingMore && hasMoreServerItems.value) {
    loadingMore = loadNextPage().finally(() => { loadingMore = null; });
  }
  return loadingMore;
}

// Resolves to false when the shelf on screen couldn't get its next page.
async function loadNextPage() {
  const seq = fetchSeq;
  try {
    const page = await fetchItemPage(items.value.length);
    if (seq !== fetchSeq) return; // Stale: the shelf changed.
    // A concurrent scan can shift offsets, so drop rows already loaded.
    const known = new Set(items.value.map((i) => i.id));
    items.value = items.value.concat(page.filter((i) => !known.has(i.id)));
    hasMoreServerItems.value = page.length === PAGE_SIZE;
    rememberShelf(shownView);
  } catch (err) {
    console.error('Failed to load more items:', err);
    if (seq === fetchSeq) return false;
  }
}

async function loadAllRemainingItems(seq) {
  while (hasMoreServerItems.value && seq === fetchSeq) {
    // A failed page stops here rather than asking again in a tight loop.
    if (await loadMoreItems() === false) return;
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

let foldersRequest = 0;
async function loadCustomFolders() {
  const id = ++foldersRequest;
  try {
    const params = {};
    if (activeType.value !== 'all') params.mediaType = activeType.value;
    const res = await api.get('/collections/all-grouped', { params });
    if (id !== foldersRequest) return;
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

const creatingFolder = ref(false);
async function createQuickFolder() {
  if (!quickFolderInput.value.trim() || creatingFolder.value) return;
  creatingFolder.value = true;
  try {
    await api.post('/collections', { name: quickFolderInput.value.trim() });
    quickFolderInput.value = '';
    await loadCustomFolders();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('shelf.errors.createFolder'));
  } finally {
    creatingFolder.value = false;
  }
}

async function deleteCustomFolder(folder) {
  const confirmed = await dialog.confirm({
    title: t('shelf.deleteFolder.title'),
    message: t('shelf.deleteFolder.message', { name: folder.name }),
    confirmText: t('shelf.deleteFolder.confirm'),
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete(`/collections/${folder.id}`);
    await loadCustomFolders();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('shelf.errors.deleteFolder'));
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
    dialog.alert(err.response?.data?.error || t('shelf.errors.removeItem'));
  }
}

function openAddToFolderModal(item) {
  selectedFolderItem.value = item;
  showAddToFolderModal.value = true;
}

// Cards open a detail page; playback starts from there.
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

// Filter and category changes fetch immediately; search typing is debounced.
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
    // Folders are filtered by category too.
    if (groupBy.value === 'custom_folder') loadCustomFolders();
  } else {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(fetchLibraryItems, 250);
  }
});

// Grouping is client-side over the items already loaded.
watch(groupBy, (mode) => {
  resetGridWindow();
  if (mode === 'custom_folder') {
    loadCustomFolders();
  } else if (mode !== 'series') {
    loadAllRemainingItems(fetchSeq);
  }
});

// Re-measure first: a resize can change both column count and card height.
function onResize() {
  measureGrid();
  updateGridWindow();
}

// Cards can only be measured once rendered.
watch(displayedEntries, () => {
  nextTick(() => {
    measureGrid();
    updateGridWindow();
  });
});

onMounted(() => {
  // A ?type= link wins over the default view.
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
  // Prefetch the title page chunk while idle so the first tap doesn't wait.
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
