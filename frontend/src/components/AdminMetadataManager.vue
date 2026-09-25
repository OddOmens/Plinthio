<template>
  <div class="flex flex-col gap-5">
    <!-- Header & Description -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-primary" />
          Title Cleanup & Metadata Matcher
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          Clean release tags from filenames and automatically match official posters, overviews, cast, and release dates via TMDB.
        </p>
      </div>

      <!-- Quick Scan / Refresh Button -->
      <div class="flex items-center gap-2">
        <button
          @click="fetchItems"
          :disabled="loading"
          class="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
        >
          <RefreshCw :class="['w-3.5 h-3.5', loading ? 'animate-spin' : '']" />
          <span>{{ loading ? 'Loading...' : 'Refresh List' }}</span>
        </button>
      </div>
    </div>

    <!-- Overview Stat Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div
        @click="setStatusFilter('all')"
        :class="[
          'p-3.5 rounded-xl border transition cursor-pointer select-none',
          statusFilter === 'all'
            ? 'bg-card border-primary/50 shadow-sm ring-1 ring-primary/20'
            : 'bg-card/60 border-border hover:bg-card hover:border-border/80'
        ]"
      >
        <div class="text-[11px] font-medium text-muted-foreground">Total Media Items</div>
        <div class="text-lg font-bold text-foreground mt-1">{{ totalAll }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">All indexed content</div>
      </div>

      <div
        @click="setStatusFilter('dirty')"
        :class="[
          'p-3.5 rounded-xl border transition cursor-pointer select-none',
          statusFilter === 'dirty'
            ? 'bg-amber-500/10 border-amber-500/50 shadow-sm ring-1 ring-amber-500/20'
            : 'bg-card/60 border-border hover:bg-card hover:border-border/80'
        ]"
      >
        <div class="text-[11px] font-medium text-amber-500 flex items-center gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5" />
          Needs Title Cleanup
        </div>
        <div class="text-lg font-bold text-foreground mt-1">{{ totalDirty }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">Has release tags or year in title</div>
      </div>

      <div
        @click="setStatusFilter('missing_cover')"
        :class="[
          'p-3.5 rounded-xl border transition cursor-pointer select-none',
          statusFilter === 'missing_cover'
            ? 'bg-rose-500/10 border-rose-500/50 shadow-sm ring-1 ring-rose-500/20'
            : 'bg-card/60 border-border hover:bg-card hover:border-border/80'
        ]"
      >
        <div class="text-[11px] font-medium text-rose-500 flex items-center gap-1.5">
          <ImageOff class="w-3.5 h-3.5" />
          Missing Artwork
        </div>
        <div class="text-lg font-bold text-foreground mt-1">{{ totalMissingCover }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">No poster or cover file</div>
      </div>

      <div
        @click="setStatusFilter('missing_meta')"
        :class="[
          'p-3.5 rounded-xl border transition cursor-pointer select-none',
          statusFilter === 'missing_meta'
            ? 'bg-blue-500/10 border-blue-500/50 shadow-sm ring-1 ring-blue-500/20'
            : 'bg-card/60 border-border hover:bg-card hover:border-border/80'
        ]"
      >
        <div class="text-[11px] font-medium text-blue-500 flex items-center gap-1.5">
          <Info class="w-3.5 h-3.5" />
          Missing Overview / Date
        </div>
        <div class="text-lg font-bold text-foreground mt-1">{{ totalMissingMeta }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">Needs TMDB synopsis match</div>
      </div>
    </div>

    <!-- Filters & Search Toolbar -->
    <div class="bg-card border border-border rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <!-- Library Selector -->
        <select
          v-model="selectedLibraryId"
          @change="fetchItems"
          class="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All Libraries</option>
          <option v-for="lib in libraries" :key="lib.id" :value="lib.id">
            {{ lib.name }} ({{ lib.type }})
          </option>
        </select>

        <!-- Media Type Selector -->
        <select
          v-model="selectedMediaType"
          @change="fetchItems"
          class="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All Media Types</option>
          <option value="movie">Movies</option>
          <option value="show">TV Shows</option>
          <option value="anime">Anime</option>
          <option value="manga">Manga</option>
          <option value="book">Books</option>
        </select>

        <!-- Status Filter Pills -->
        <div class="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border text-xs">
          <button
            @click="setStatusFilter('all')"
            :class="['px-2.5 py-1 rounded-md transition text-[11px]', statusFilter === 'all' ? 'bg-card text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            All
          </button>
          <button
            @click="setStatusFilter('dirty')"
            :class="['px-2.5 py-1 rounded-md transition text-[11px]', statusFilter === 'dirty' ? 'bg-card text-amber-500 font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            Needs Cleanup
          </button>
          <button
            @click="setStatusFilter('missing_cover')"
            :class="['px-2.5 py-1 rounded-md transition text-[11px]', statusFilter === 'missing_cover' ? 'bg-card text-rose-500 font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            No Poster
          </button>
          <button
            @click="setStatusFilter('missing_meta')"
            :class="['px-2.5 py-1 rounded-md transition text-[11px]', statusFilter === 'missing_meta' ? 'bg-card text-blue-500 font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            No Synopsis
          </button>
        </div>
      </div>

      <!-- Search Box -->
      <div class="relative w-full md:w-64">
        <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="searchQuery"
          @input="debounceSearch"
          placeholder="Filter by title or path..."
          class="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''; fetchItems()"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Batch Actions Toolbar -->
    <div
      v-if="items.length > 0"
      class="bg-muted/40 border border-border/80 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
    >
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            :checked="isAllSelected"
            :indeterminate="isIndeterminate"
            @change="toggleSelectAll"
            class="rounded border-border text-primary focus:ring-primary h-4 w-4"
          />
          <span>Select All ({{ items.length }})</span>
        </label>
        <span v-if="selectedIds.size > 0" class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
          {{ selectedIds.size }} selected
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <!-- Batch Options Toggle -->
        <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none pr-1">
          <input
            type="checkbox"
            v-model="batchOverwriteCovers"
            class="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
          />
          <span>Overwrite Posters</span>
        </label>

        <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none pr-2">
          <input
            type="checkbox"
            v-model="batchUseCanonicalTitle"
            class="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
          />
          <span>Use Canonical Title</span>
        </label>

        <!-- Clean Titles Button -->
        <button
          @click="batchCleanTitles"
          :disabled="selectedIds.size === 0 || processingBatch"
          class="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-40"
          title="Strip release tags and trailing years from database titles"
        >
          <Wand2 class="w-3.5 h-3.5 text-amber-500" />
          <span>Clean Titles ({{ selectedIds.size }})</span>
        </button>

        <!-- Match TMDB Button -->
        <button
          @click="batchMatchMetadata"
          :disabled="selectedIds.size === 0 || processingBatch"
          class="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition flex items-center gap-1.5 shadow-sm disabled:opacity-40"
          title="Search TMDB using clean title and year, download posters, and populate synopses"
        >
          <Sparkles class="w-3.5 h-3.5" />
          <span>Find & Match TMDB ({{ selectedIds.size }})</span>
        </button>
      </div>
    </div>

    <!-- Active Batch Progress Banner -->
    <div v-if="processingBatch" class="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs font-medium text-foreground">
        <span class="flex items-center gap-2">
          <Loader2 class="w-4 h-4 animate-spin text-primary" />
          {{ batchStatusText }}
        </span>
        <span class="font-mono text-muted-foreground">{{ batchPercent }}%</span>
      </div>
      <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full bg-primary transition-all duration-300 rounded-full"
          :style="{ width: `${batchPercent}%` }"
        />
      </div>
    </div>

    <!-- Items List / Table -->
    <div class="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div v-if="loading && items.length === 0" class="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 class="w-6 h-6 animate-spin text-primary" />
        <span class="text-xs">Analyzing media titles and metadata...</span>
      </div>

      <div v-else-if="items.length === 0" class="py-16 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
        <Sparkles class="w-6 h-6 text-muted-foreground/60" />
        <span>No media items found matching the selected filters.</span>
      </div>

      <div v-else class="divide-y divide-border">
        <div
          v-for="item in items"
          :key="item.id"
          :class="[
            'p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3.5 transition-colors',
            selectedIds.has(item.id) ? 'bg-primary/[0.03]' : 'hover:bg-muted/30'
          ]"
        >
          <!-- Left: Checkbox + Thumbnail + Title details -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleSelectItem(item.id)"
              class="rounded border-border text-primary focus:ring-primary h-4 w-4 flex-shrink-0 cursor-pointer"
            />

            <!-- Thumbnail with hover preview -->
            <div class="relative w-11 h-16 rounded-md overflow-hidden bg-muted/60 border border-border/80 flex-shrink-0 flex items-center justify-center group">
              <img
                v-if="item.cover_path"
                :src="getItemCoverUrl(item)"
                :key="`${item.id}-${cacheBuster}`"
                :alt="item.title"
                class="w-full h-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              <Film v-else-if="item.media_type === 'movie'" class="w-4 h-4 text-muted-foreground" />
              <Tv v-else-if="item.media_type === 'show' || item.media_type === 'anime'" class="w-4 h-4 text-muted-foreground" />
              <Book v-else class="w-4 h-4 text-muted-foreground" />

              <span
                v-if="item.cover_source === 'tmdb'"
                class="absolute bottom-0 inset-x-0 bg-emerald-600/90 text-[8px] font-bold text-white text-center py-0.5 leading-none"
              >
                TMDB
              </span>
            </div>

            <!-- Title & Proposed Clean Title -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-semibold text-foreground truncate">
                  {{ item.title }}
                </span>

                <span v-if="item.detectedYear" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {{ item.detectedYear }}
                </span>

                <span v-if="item.isTv" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-semibold">
                  TV Episode
                </span>
              </div>

              <!-- Proposed Clean Title preview if dirty -->
              <div v-if="item.isDirty" class="flex items-center gap-1.5 text-[11px] text-amber-500 mt-0.5 font-medium">
                <span>Clean:</span>
                <span class="text-foreground bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-semibold truncate max-w-sm">
                  {{ item.cleanTitle }}
                </span>
              </div>

              <!-- Original Filename / Path -->
              <p class="text-[10px] font-mono text-muted-foreground truncate mt-0.5" :title="item.path">
                {{ item.filename }}
              </p>
            </div>
          </div>

          <!-- Middle: Metadata Badges -->
          <div class="flex items-center gap-2 flex-shrink-0 flex-wrap pl-7 md:pl-0">
            <!-- Library Tag -->
            <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {{ item.library_name || item.media_type }}
            </span>

            <!-- Poster badge -->
            <span
              v-if="item.hasCover"
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 font-medium',
                item.cover_source === 'tmdb'
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : 'bg-muted text-muted-foreground'
              ]"
            >
              <Check class="w-3 h-3" />
              Poster
            </span>
            <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium">
              No Poster
            </span>

            <!-- Synopsis badge -->
            <span
              v-if="item.hasDescription"
              class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1 font-medium"
              :title="item.description"
            >
              <Check class="w-3 h-3" />
              Synopsis
            </span>
            <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              No Synopsis
            </span>

            <!-- Release Date badge -->
            <span
              v-if="item.hasReleaseDate"
              class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono font-medium"
            >
              {{ item.release_date }}
            </span>
            <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              No Date
            </span>
          </div>

          <!-- Right: Action Buttons -->
          <div class="flex items-center gap-1.5 flex-shrink-0 pl-7 md:pl-0">
            <!-- 1-Click Auto Match -->
            <button
              @click="matchSingle(item)"
              :disabled="matchingIds.has(item.id)"
              class="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[11px] font-medium transition flex items-center gap-1 disabled:opacity-50"
              title="Automatically match with TMDB and update metadata"
            >
              <Loader2 v-if="matchingIds.has(item.id)" class="w-3 h-3 animate-spin text-primary" />
              <Sparkles v-else class="w-3 h-3 text-primary" />
              <span>Auto Match</span>
            </button>

            <!-- Manual Edit / Identify Modal Trigger -->
            <button
              @click="openIdentifyModal(item)"
              class="px-2.5 py-1 rounded-md border border-border hover:bg-muted text-foreground text-[11px] font-medium transition flex items-center gap-1"
              title="Search TMDB manually, pick artwork, or customize metadata fields"
            >
              <Pencil class="w-3 h-3 text-muted-foreground" />
              <span>Edit / Search</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Manual Metadata Search / Identify Modal -->
    <MetadataSearchModal
      v-if="selectedItemForModal"
      :is-open="isModalOpen"
      :item="selectedItemForModal"
      @close="onModalClose"
      @saved="onItemSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api/client';
import { useAuthStore } from '../stores/auth.js';
import { useDialogStore } from '../stores/dialog.js';
import { coverUrl as buildCoverUrl } from '../utils/cover';
import MetadataSearchModal from './MetadataSearchModal.vue';
import {
  Sparkles,
  Wand2,
  RefreshCw,
  Check,
  AlertTriangle,
  ImageOff,
  Info,
  Search,
  Film,
  Tv,
  Book,
  Pencil,
  Loader2,
  X
} from 'lucide-vue-next';

const props = defineProps({
  libraries: {
    type: Array,
    default: () => []
  }
});

const authStore = useAuthStore();
const dialog = useDialogStore();
const token = computed(() => authStore.token);

const items = ref([]);
const loading = ref(false);
const totalAll = ref(0);
const totalDirty = ref(0);
const totalMissingCover = ref(0);
const totalMissingMeta = ref(0);

const selectedLibraryId = ref('');
const selectedMediaType = ref('');
const statusFilter = ref('all');
const searchQuery = ref('');

const selectedIds = ref(new Set());
const matchingIds = ref(new Set());

const batchOverwriteCovers = ref(false);
const batchUseCanonicalTitle = ref(true);
const processingBatch = ref(false);
const batchStatusText = ref('');
const batchPercent = ref(0);

// Modal state
const isModalOpen = ref(false);
const selectedItemForModal = ref(null);

const cacheBuster = ref(Date.now());

function getItemCoverUrl(item) {
  if (!item?.cover_path) return null;
  const base = buildCoverUrl(item, { width: 180 });
  return `${base}&t=${cacheBuster.value}`;
}

let searchDebounceTimer = null;
function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    fetchItems();
  }, 300);
}

function setStatusFilter(filter) {
  statusFilter.value = filter;
  fetchItems();
}

async function fetchItems() {
  loading.value = true;
  cacheBuster.value = Date.now();
  try {
    const res = await api.get('/metadata/admin/items', {
      params: {
        libraryId: selectedLibraryId.value || undefined,
        mediaType: selectedMediaType.value || undefined,
        filter: statusFilter.value,
        search: searchQuery.value.trim() || undefined,
        limit: 200
      }
    });

    items.value = res.data.items || [];
    totalAll.value = res.data.totalAll || 0;
    totalDirty.value = res.data.totalDirty || 0;
    totalMissingCover.value = res.data.totalMissingCover || 0;
    totalMissingMeta.value = res.data.totalMissingMeta || 0;

    // Prune selections that are no longer in items
    const currentItemIds = new Set(items.value.map((i) => i.id));
    for (const id of selectedIds.value) {
      if (!currentItemIds.has(id)) {
        selectedIds.value.delete(id);
      }
    }
  } catch (err) {
    console.error('Failed to fetch items for metadata manager:', err);
    dialog.alert({
      title: 'Failed to load items',
      message: err.response?.data?.error || err.message,
      variant: 'error'
    });
  } finally {
    loading.value = false;
  }
}

// Selection helpers
const isAllSelected = computed(() => {
  return items.value.length > 0 && items.value.every((i) => selectedIds.value.has(i.id));
});

const isIndeterminate = computed(() => {
  const count = selectedIds.value.size;
  return count > 0 && count < items.value.length;
});

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value.clear();
  } else {
    items.value.forEach((i) => selectedIds.value.add(i.id));
  }
}

function toggleSelectItem(id) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id);
  } else {
    selectedIds.value.add(id);
  }
}

// Single item auto match
async function matchSingle(item) {
  matchingIds.value.add(item.id);
  try {
    const res = await api.post(`/metadata/admin/match-single/${item.id}`, {
      overwriteCover: true,
      useCanonicalTitle: true
    });

    // Update in local list
    const updated = res.data.item;
    const index = items.value.findIndex((i) => i.id === item.id);
    if (index !== -1 && updated) {
      items.value[index] = {
        ...items.value[index],
        ...updated,
        hasCover: !!updated.cover_path,
        hasDescription: !!(updated.description && updated.description.trim()),
        hasReleaseDate: !!updated.release_date,
        isDirty: false
      };
    }
    cacheBuster.value = Date.now();

    dialog.alert({
      title: 'Item Matched',
      message: `Successfully matched "${updated?.title || item.title}" from TMDB!`,
      variant: 'success'
    });
  } catch (err) {
    console.error(`Auto match failed for ${item.id}:`, err);
    dialog.alert({
      title: 'Auto Match Failed',
      message: err.response?.data?.error || 'No metadata found. Try "Edit / Search" to identify manually.',
      variant: 'warning'
    });
  } finally {
    matchingIds.value.delete(item.id);
  }
}

// Batch clean titles
async function batchCleanTitles() {
  const ids = Array.from(selectedIds.value);
  if (ids.length === 0) return;

  const confirmed = await dialog.confirm({
    title: `Clean ${ids.length} Titles?`,
    message: `This will strip scene tags, codecs, resolutions, and trailing release years from ${ids.length} selected titles in the database.`,
    confirmText: 'Clean Titles'
  });
  if (!confirmed) return;

  processingBatch.value = true;
  batchStatusText.value = `Cleaning ${ids.length} titles...`;
  batchPercent.value = 50;

  try {
    const res = await api.post('/metadata/admin/batch-clean-titles', { itemIds: ids });
    batchPercent.value = 100;

    await dialog.alert({
      title: 'Titles Cleaned',
      message: `Successfully cleaned ${res.data.updatedCount} titles!`,
      variant: 'success'
    });

    await fetchItems();
    selectedIds.value.clear();
  } catch (err) {
    console.error('Batch clean titles error:', err);
    dialog.alert({
      title: 'Batch Clean Failed',
      message: err.response?.data?.error || err.message,
      variant: 'error'
    });
  } finally {
    processingBatch.value = false;
  }
}

// Batch match metadata with TMDB
async function batchMatchMetadata() {
  const ids = Array.from(selectedIds.value);
  if (ids.length === 0) return;

  const confirmed = await dialog.confirm({
    title: `Find Metadata for ${ids.length} Items?`,
    message: `Plinthio will clean each item's title, extract the release year, search TMDB, download official posters, and populate synopses and release dates.`,
    confirmText: 'Start Matching'
  });
  if (!confirmed) return;

  processingBatch.value = true;
  batchStatusText.value = `Finding metadata for ${ids.length} items from TMDB...`;
  batchPercent.value = 25;

  try {
    const res = await api.post('/metadata/admin/batch-match', {
      itemIds: ids,
      overwriteCovers: batchOverwriteCovers.value,
      useCanonicalTitle: batchUseCanonicalTitle.value
    });

    batchPercent.value = 100;
    const { matched, skipped, total } = res.data;

    await dialog.alert({
      title: 'Metadata Matching Complete',
      message: `Successfully matched ${matched} of ${total} items (${skipped} skipped or not found).`,
      variant: matched > 0 ? 'success' : 'info'
    });

    await fetchItems();
    selectedIds.value.clear();
  } catch (err) {
    console.error('Batch match metadata error:', err);
    dialog.alert({
      title: 'Batch Match Failed',
      message: err.response?.data?.error || err.message,
      variant: 'error'
    });
  } finally {
    processingBatch.value = false;
  }
}

// Manual identify modal
function openIdentifyModal(item) {
  selectedItemForModal.value = item;
  isModalOpen.value = true;
}

function onModalClose() {
  isModalOpen.value = false;
  selectedItemForModal.value = null;
}

function onItemSaved() {
  isModalOpen.value = false;
  selectedItemForModal.value = null;
  cacheBuster.value = Date.now();
  fetchItems();
}

onMounted(() => {
  fetchItems();
});
</script>
