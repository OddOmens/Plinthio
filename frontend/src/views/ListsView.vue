<template>
  <div class="min-h-screen bg-background transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <Sidebar v-if="isSidebarLayout" active-type="" @filter-type="goToShelf" @update:searchQuery="searchShelf" />
    <Navbar v-else active-type="" @filter-type="goToShelf" @update:searchQuery="searchShelf" />

    <main class="page-width mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 pb-24 flex-1 flex flex-col gap-6 min-w-0">
      <!-- ─── All lists ───────────────────────────────────────────────────────── -->
      <template v-if="!openListId">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Lists</h1>
            <p class="text-sm text-muted-foreground mt-1">
              Things to watch, read and listen to, in your order. They can hold titles the server doesn't have yet.
            </p>
          </div>
          <router-link
            to="/requests"
            class="h-9 px-3 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium flex items-center gap-2 transition flex-shrink-0"
          >
            <Inbox class="w-4 h-4" />
            Requests
          </router-link>
        </div>

        <!-- Category tabs, like the shelf's -->
        <div class="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border overflow-x-auto no-scrollbar self-start max-w-full" role="tablist">
          <button
            v-for="cat in LIST_CATEGORIES"
            :key="cat.id"
            role="tab"
            :aria-selected="category === cat.id"
            @click="setCategory(cat.id)"
            class="h-8.5 px-3 rounded-lg text-sm font-medium transition flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
            :class="category === cat.id ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'"
          >
            <component :is="CATEGORY_ICONS[cat.id]" class="w-4 h-4" />
            {{ cat.label }}
          </button>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <div v-if="loading" class="poster-grid gap-3 sm:gap-4">
          <div v-for="n in 6" :key="n" class="aspect-[2/3] rounded-xl bg-muted/50 animate-pulse" />
        </div>

        <div v-else class="poster-grid gap-x-3 gap-y-6 sm:gap-x-4">
          <!-- Each list as a card: a collage of its first few titles -->
          <button
            v-for="list in lists"
            :key="list.id"
            type="button"
            @click="openList(list.id)"
            class="group flex flex-col min-w-0 text-left"
          >
            <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted border border-border group-hover:border-muted-foreground/40 transition grid grid-cols-2 grid-rows-2 gap-px">
              <template v-if="list.previews?.length">
                <div v-for="n in 4" :key="n" class="bg-muted overflow-hidden">
                  <img
                    v-if="list.previews[n - 1]"
                    :src="previewCover(list.previews[n - 1])"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    class="w-full h-full object-cover"
                    :class="previewClass(list.previews[n - 1])"
                  />
                </div>
              </template>
              <div v-else class="col-span-2 row-span-2 flex items-center justify-center text-muted-foreground">
                <ListOrdered class="w-8 h-8" />
              </div>
            </div>
            <p class="mt-2 text-sm font-semibold text-foreground truncate group-hover:underline">{{ list.name }}</p>
            <p class="text-xs text-muted-foreground">{{ list.item_count }} {{ list.item_count === 1 ? 'title' : 'titles' }}</p>
          </button>

          <!-- New list -->
          <div class="flex flex-col min-w-0">
            <form
              v-if="creatingOpen"
              @submit.prevent="createList"
              class="aspect-[2/3] rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3 flex flex-col justify-center gap-2"
            >
              <input
                ref="newListInput"
                v-model="newListName"
                type="text"
                :placeholder="`${currentCategory.label} list name`"
                class="h-9 px-3 rounded-lg bg-background border border-border text-sm text-foreground w-full"
                @keydown.esc="creatingOpen = false"
              />
              <button type="submit" :disabled="!newListName.trim() || creating" class="h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                Create
              </button>
              <button type="button" @click="creatingOpen = false" class="h-8 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </form>
            <button
              v-else
              type="button"
              @click="startCreating"
              class="aspect-[2/3] rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/50 hover:bg-muted/30 transition flex flex-col items-center justify-center gap-2 text-muted-foreground"
            >
              <Plus class="w-6 h-6" />
              <span class="text-sm font-medium">New list</span>
            </button>
            <p v-if="!lists.length && !creatingOpen" class="mt-2 text-xs text-muted-foreground">
              No {{ currentCategory.label.toLowerCase() }} lists yet.
            </p>
          </div>
        </div>
      </template>

      <!-- ─── One list ────────────────────────────────────────────────────────── -->
      <template v-else>
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0 flex items-start gap-3">
            <button
              type="button"
              @click="closeList"
              class="w-9 h-9 mt-0.5 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
              title="All lists"
              aria-label="All lists"
            >
              <ArrowLeft class="w-4 h-4" />
            </button>
            <div class="min-w-0">
              <h1 class="text-2xl font-bold tracking-tight text-foreground truncate">{{ openListInfo?.name || 'List' }}</h1>
              <p class="text-sm text-muted-foreground mt-0.5">
                {{ entries.length }} {{ entries.length === 1 ? 'title' : 'titles' }}<template v-if="notOwnedCount"> · {{ notOwnedCount }} not in the library</template>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="showSearch = !showSearch"
              class="h-9 px-3 rounded-xl text-sm font-medium flex items-center gap-1.5 transition"
              :class="showSearch ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'"
            >
              <Plus class="w-4 h-4" />
              Add titles
            </button>
            <button
              type="button"
              @click="deleteList"
              class="h-9 px-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-muted flex items-center gap-1.5 transition"
            >
              <Trash2 class="w-4 h-4" />
              <span class="hidden sm:inline">Delete list</span>
            </button>
          </div>
        </div>

        <div v-if="showSearch" class="rounded-2xl border border-border bg-card p-4">
          <ExternalTitleSearch :search-types="openCategory.searchTypes">
            <template #action="{ result, mediaType }">
              <span v-if="inList(result)" class="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Check class="w-3.5 h-3.5" /> In list
              </span>
              <button
                v-else
                @click="addExternal(result, mediaType)"
                :disabled="adding.has(resultKey(result))"
                class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 flex items-center gap-1 transition"
              >
                <Plus class="w-3.5 h-3.5" /> Add
              </button>
            </template>
          </ExternalTitleSearch>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <div v-if="loadingEntries" class="poster-grid gap-3 sm:gap-4">
          <div v-for="n in 6" :key="n" class="aspect-[2/3] rounded-xl bg-muted/50 animate-pulse" />
        </div>
        <div v-else-if="entries.length === 0" class="py-16 text-center border border-dashed border-border rounded-2xl bg-card/50">
          <ListOrdered class="w-7 h-7 mx-auto text-muted-foreground" />
          <p class="text-sm font-medium text-foreground mt-3">Nothing in this list yet</p>
          <p class="text-xs text-muted-foreground mt-1">Use <strong>Add titles</strong> to search for anything, on the server or not.</p>
        </div>

        <div v-else class="poster-grid gap-x-3 gap-y-6 sm:gap-x-4">
          <div v-for="(entry, index) in entries" :key="`${entry.kind}:${entry.id}`" class="group flex flex-col min-w-0">
            <component
              :is="entryLink(entry) ? 'router-link' : 'div'"
              :to="entryLink(entry) || undefined"
              class="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted transition"
              :class="entryState(entry) === 'not-owned' ? 'border-2 border-dashed border-muted-foreground/30' : 'border border-border group-hover:border-muted-foreground/40'"
            >
              <img
                v-if="entryCover(entry)"
                :src="entryCover(entry)"
                :alt="entryTitle(entry)"
                loading="lazy"
                referrerpolicy="no-referrer"
                class="w-full h-full object-cover"
                :class="entryState(entry) === 'offloaded' ? 'art-offloaded' : entryState(entry) === 'not-owned' ? 'art-not-owned' : ''"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-muted-foreground"><ImageOff class="w-6 h-6" /></div>

              <AvailabilityBadge v-if="entryState(entry) === 'offloaded'" kind="offloaded" :since="entry.item.offloaded_at" small class="absolute top-2 left-2" />
              <AvailabilityBadge v-else-if="entryState(entry) === 'not-owned' && !entry.external.request_status" kind="not-owned" small class="absolute top-2 left-2" />
              <span
                v-else-if="entryState(entry) === 'not-owned'"
                class="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-1 rounded-full leading-none backdrop-blur"
                :class="REQUEST_STATUSES[entry.external.request_status]?.tone"
              >{{ REQUEST_STATUSES[entry.external.request_status]?.label }}</span>
              <span v-if="entry.kind === 'item' && entry.item.is_finished" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                <Check class="w-3.5 h-3.5 stroke-[3]" />
              </span>

              <!-- Order and remove: on hover with a mouse, always on a phone -->
              <div class="absolute bottom-0 inset-x-0 p-1.5 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition">
                <div class="flex gap-1">
                  <button type="button" aria-label="Move earlier" title="Move earlier" @click.prevent.stop="move(index, -1)" :disabled="index === 0 || reordering" class="entry-btn"><ChevronLeft class="w-4 h-4" /></button>
                  <button type="button" aria-label="Move later" title="Move later" @click.prevent.stop="move(index, 1)" :disabled="index === entries.length - 1 || reordering" class="entry-btn"><ChevronRight class="w-4 h-4" /></button>
                </div>
                <button type="button" aria-label="Remove from list" title="Remove from list" @click.prevent.stop="removeEntry(entry)" class="entry-btn hover:!bg-destructive"><X class="w-4 h-4" /></button>
              </div>
            </component>

            <p class="mt-2 text-sm font-medium line-clamp-2" :class="entryState(entry) === 'owned' ? 'text-foreground' : 'text-muted-foreground'">
              <span class="text-muted-foreground font-mono text-xs mr-1">{{ index + 1 }}.</span>{{ entryTitle(entry) }}
            </p>
            <p v-if="entrySubtitle(entry)" class="text-xs text-muted-foreground truncate">{{ entrySubtitle(entry) }}</p>
            <button
              v-if="canRequest(entry)"
              type="button"
              @click="requestEntry(entry)"
              :disabled="requesting.has(entry.id)"
              class="mt-1.5 self-start h-7 px-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold flex items-center gap-1 disabled:opacity-50 transition"
              title="Ask an admin to add this to the library"
            >
              <Send class="w-3.5 h-3.5" /> Request
            </button>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ListOrdered, ChevronLeft, ChevronRight, X, ArrowLeft, Plus, Check, Trash2, Send, Inbox, ImageOff,
  Film, Tv, Sparkles, BookOpen, Headphones
} from '@lucide/vue';
import api from '../api/client';
import { coverUrl as buildCoverUrl } from '../utils/cover';
import { externalTitlePayload, SOURCE_LABELS } from '../utils/externalTitle';
import { LIST_CATEGORIES, REQUEST_STATUSES } from '../constants/media';
import { useDialogStore } from '../stores/dialog';
import { useCustomizationStore } from '../stores/customization';
import ExternalTitleSearch from '../components/ExternalTitleSearch.vue';
import AvailabilityBadge from '../components/AvailabilityBadge.vue';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';

const CATEGORY_ICONS = { movies: Film, shows: Tv, anime: Sparkles, read: BookOpen, listen: Headphones };

const route = useRoute();
const router = useRouter();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');

// The header's category tabs and search belong to the shelf.
function goToShelf(type) {
  router.push({ path: '/', query: { type } });
}
function searchShelf(query) {
  router.push(query ? { path: '/', query: { search: query } } : { path: '/' });
}

const validCategory = (c) => LIST_CATEGORIES.some((cat) => cat.id === c);
const category = ref(validCategory(route.query.category) ? route.query.category : 'movies');
const currentCategory = computed(() => LIST_CATEGORIES.find((c) => c.id === category.value));

const lists = ref([]);
const loading = ref(true);
const error = ref('');

// The open list lives in the URL (?list=…), so Back and shared links work.
const openListId = computed(() => (typeof route.query.list === 'string' ? route.query.list : null));
const openListInfo = ref(null);
const openCategory = computed(() => LIST_CATEGORIES.find((c) => c.id === (openListInfo.value?.category || category.value)) || currentCategory.value);
const entries = ref([]);
const loadingEntries = ref(false);
const showSearch = ref(false);
const reordering = ref(false);
const adding = ref(new Set());
const requesting = ref(new Set());

function setCategory(id) {
  if (id === category.value) return;
  category.value = id;
  router.replace({ query: { category: id } });
}

function openList(id) {
  router.push({ query: { category: category.value, list: id } });
}
function closeList() {
  router.push({ query: { category: category.value } });
}

watch(category, () => { if (!openListId.value) loadLists(); });
watch(openListId, (id) => {
  error.value = '';
  showSearch.value = false;
  if (id) loadEntries(id);
  else loadLists();
});

async function loadLists() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/collections', { params: { type: 'readlist', category: category.value } });
    lists.value = res.data.collections || [];
  } catch (err) {
    error.value = 'Could not load lists.';
  } finally {
    loading.value = false;
  }
}

function previewCover(preview) {
  return preview.item ? buildCoverUrl(preview.item, { width: 180 }) : preview.coverUrl;
}
function previewClass(preview) {
  if (preview.external) return 'art-not-owned';
  return preview.item?.offloaded ? 'art-offloaded' : '';
}

// ─── Creating ───────────────────────────────────────────────────────────────
const creatingOpen = ref(false);
const newListName = ref('');
const creating = ref(false);
const newListInput = ref(null);

async function startCreating() {
  creatingOpen.value = true;
  await nextTick();
  newListInput.value?.focus();
}

async function createList() {
  const name = newListName.value.trim();
  if (!name) return;
  creating.value = true;
  error.value = '';
  try {
    const res = await api.post('/collections', { name, type: 'readlist', category: category.value });
    newListName.value = '';
    creatingOpen.value = false;
    openList(res.data.collection.id);
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not create list.';
  } finally {
    creating.value = false;
  }
}

// ─── One list ───────────────────────────────────────────────────────────────
async function loadEntries(id) {
  loadingEntries.value = true;
  entries.value = [];
  try {
    const res = await api.get(`/collections/${id}`);
    openListInfo.value = res.data.collection;
    entries.value = res.data.entries || [];
    if (res.data.collection?.category && validCategory(res.data.collection.category)) category.value = res.data.collection.category;
  } catch (err) {
    error.value = err.response?.status === 404 ? 'That list no longer exists.' : 'Could not load this list.';
  } finally {
    loadingEntries.value = false;
  }
}

async function refreshEntries() {
  const res = await api.get(`/collections/${openListId.value}`);
  entries.value = res.data.entries || [];
}

async function deleteList() {
  const list = openListInfo.value;
  const ok = await dialog.confirm({
    title: 'Delete list?',
    message: `"${list?.name || 'This list'}" will be deleted. Nothing in your library is removed.`,
    confirmText: 'Delete',
    danger: true
  });
  if (!ok) return;
  try {
    await api.delete(`/collections/${openListId.value}`);
    closeList();
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not delete that list.';
  }
}

// owned (on the server), offloaded (was, and isn't now) or not-owned (never was).
function entryState(entry) {
  if (entry.kind === 'item') return entry.item.offloaded_at ? 'offloaded' : 'owned';
  return entry.external.library_item ? 'owned' : 'not-owned';
}
const notOwnedCount = computed(() => entries.value.filter((e) => entryState(e) === 'not-owned').length);

function entryLink(entry) {
  if (entry.kind === 'item') return `/title/${entry.item.id}`;
  return entry.external.library_item ? `/title/${entry.external.library_item.id}` : null;
}
function entryTitle(entry) {
  return entry.kind === 'item' ? (entry.item.series && entry.item.media_type !== 'movie' ? `${entry.item.series}: ${entry.item.title}` : entry.item.title) : entry.external.title;
}
function entryCover(entry) {
  return entry.kind === 'item' ? buildCoverUrl(entry.item, { width: 360 }) : entry.external.cover_url;
}
function entrySubtitle(entry) {
  if (entry.kind === 'item') return entry.item.release_date?.slice(0, 4) || entry.item.author || '';
  const ext = entry.external;
  return [ext.release_date?.slice(0, 4), SOURCE_LABELS[ext.source] || ext.source].filter(Boolean).join(' · ');
}

function resultKey(result) {
  return `${result.source}:${result.externalId}`;
}
function inList(result) {
  return entries.value.some((e) => e.kind === 'external' && e.external.source === result.source && e.external.external_id === result.externalId);
}

async function addExternal(result, mediaType) {
  const key = resultKey(result);
  adding.value = new Set(adding.value).add(key);
  try {
    await api.post(`/collections/${openListId.value}/external`, externalTitlePayload(result, mediaType));
    await refreshEntries();
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not add that title.';
  } finally {
    const next = new Set(adding.value);
    next.delete(key);
    adding.value = next;
  }
}

// Only external titles the library doesn't have can be requested, and only when nobody has
// an open request for it already (a rejected one can be asked for again).
function canRequest(entry) {
  if (entry.kind !== 'external' || entry.external.library_item) return false;
  const status = entry.external.request_status;
  return !status || status === 'rejected';
}

async function requestEntry(entry) {
  const ext = entry.external;
  requesting.value = new Set(requesting.value).add(entry.id);
  try {
    await api.post('/requests', {
      mediaType: ext.media_type,
      source: ext.source,
      externalId: ext.external_id,
      title: ext.title,
      subtitle: ext.subtitle,
      author: ext.author,
      releaseDate: ext.release_date,
      overview: ext.overview,
      coverUrl: ext.cover_url
    });
    ext.request_status = 'pending';
  } catch (err) {
    // Someone else already asked for it — show where that request is at.
    if (err.response?.status === 409 && err.response.data?.status) {
      ext.request_status = err.response.data.status;
    } else {
      error.value = err.response?.data?.error || 'Could not send that request.';
    }
  } finally {
    const next = new Set(requesting.value);
    next.delete(entry.id);
    requesting.value = next;
  }
}

// The new order is applied locally first so the grid doesn't visibly lag a tap, then
// persisted as the full ordering (which is what the reorder endpoint expects).
async function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= entries.value.length) return;
  const reordered = [...entries.value];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  entries.value = reordered;
  reordering.value = true;
  try {
    await api.put(`/collections/${openListId.value}/reorder`, {
      entries: reordered.map((e) => ({ kind: e.kind, id: e.id }))
    });
  } catch (err) {
    error.value = 'Could not save the new order.';
  } finally {
    reordering.value = false;
  }
}

async function removeEntry(entry) {
  try {
    await api.delete(
      entry.kind === 'item'
        ? `/collections/${openListId.value}/items/${entry.id}`
        : `/collections/${openListId.value}/external/${entry.id}`
    );
    entries.value = entries.value.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
  } catch (err) {
    error.value = 'Could not remove that entry.';
  }
}

onMounted(() => {
  if (openListId.value) loadEntries(openListId.value);
  else loadLists();
});
</script>

<style scoped>
.entry-btn {
  @apply w-7 h-7 rounded-lg bg-black/60 text-white flex items-center justify-center transition hover:bg-black/80 disabled:opacity-30;
}
</style>
