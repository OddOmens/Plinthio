<template>
  <div class="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6 safe-top safe-bottom">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <router-link
          to="/"
          class="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
          title="Back to Shelves"
        >
          <ArrowLeft class="w-4 h-4" />
        </router-link>
        <div>
          <h1 class="text-xl font-bold text-foreground">Lists</h1>
          <p class="text-sm text-muted-foreground mt-0.5">
            Ordered lists of things to watch, read and listen to. They can include titles the library doesn't have yet.
          </p>
        </div>
      </div>
      <router-link
        to="/requests"
        class="h-9 px-3 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium flex items-center gap-2 transition flex-shrink-0"
      >
        <Inbox class="w-4 h-4" />
        <span class="hidden sm:inline">Requests</span>
      </router-link>
    </div>

    <!-- Category tabs -->
    <div class="flex gap-1 p-1 rounded-2xl bg-secondary overflow-x-auto no-scrollbar" role="tablist">
      <button
        v-for="cat in LIST_CATEGORIES"
        :key="cat.id"
        role="tab"
        :aria-selected="category === cat.id"
        @click="setCategory(cat.id)"
        class="flex-1 min-w-[4.5rem] h-9 px-3 rounded-xl text-sm font-medium transition flex items-center justify-center gap-1.5"
        :class="category === cat.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      >
        <component :is="CATEGORY_ICONS[cat.id]" class="w-4 h-4" />
        <span>{{ cat.label }}</span>
      </button>
    </div>

    <form @submit.prevent="createList" class="flex items-center gap-2">
      <input
        v-model="newListName"
        type="text"
        :placeholder="`New ${currentCategory.label.toLowerCase()} list name…`"
        class="flex-1 h-10 px-3 rounded-xl bg-card border border-border text-sm text-foreground"
      />
      <button
        type="submit"
        :disabled="!newListName.trim() || creating"
        class="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition"
      >
        Create
      </button>
    </form>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">Loading…</div>

    <div
      v-else-if="lists.length === 0"
      class="py-16 text-center border border-dashed border-border rounded-2xl bg-card/50"
    >
      <ListOrdered class="w-7 h-7 mx-auto text-muted-foreground" />
      <p class="text-sm font-medium text-foreground mt-3">No {{ currentCategory.label.toLowerCase() }} lists yet</p>
      <p class="text-xs text-muted-foreground mt-1">
        Create one above. Then search for titles to add, or add library items from any item's menu.
      </p>
    </div>

    <div v-else class="flex flex-col gap-3">
      <div v-for="list in lists" :key="list.id" class="border border-border rounded-2xl bg-card overflow-hidden">
        <button
          @click="toggleList(list)"
          class="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition text-left"
        >
          <ListOrdered class="w-4 h-4 text-primary flex-shrink-0" />
          <span class="text-sm font-semibold text-foreground flex-1 truncate">{{ list.name }}</span>
          <span class="text-xs text-muted-foreground">{{ list.item_count }}</span>
          <ChevronDown
            class="w-4 h-4 text-muted-foreground transition-transform"
            :class="{ 'rotate-180': expandedId === list.id }"
          />
        </button>

        <div v-if="expandedId === list.id" class="border-t border-border">
          <!-- List toolbar -->
          <div class="px-4 py-2.5 flex items-center gap-2 border-b border-border/60 bg-muted/20">
            <button
              @click="showSearch = !showSearch"
              class="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
              :class="showSearch ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'"
            >
              <Plus class="w-3.5 h-3.5" />
              Add titles
            </button>
            <div class="flex-1"></div>
            <button
              @click="deleteList(list)"
              class="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-muted flex items-center gap-1.5 transition"
            >
              <Trash2 class="w-3.5 h-3.5" />
              Delete list
            </button>
          </div>

          <div v-if="showSearch" class="px-4 py-3 border-b border-border/60">
            <ExternalTitleSearch :search-types="currentCategory.searchTypes">
              <template #action="{ result, mediaType }">
                <span
                  v-if="inList(result)"
                  class="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground flex items-center gap-1"
                >
                  <Check class="w-3.5 h-3.5" /> In list
                </span>
                <button
                  v-else
                  @click="addExternal(list, result, mediaType)"
                  :disabled="adding.has(resultKey(result))"
                  class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 flex items-center gap-1 transition"
                >
                  <Plus class="w-3.5 h-3.5" /> Add
                </button>
              </template>
            </ExternalTitleSearch>
          </div>

          <div v-if="loadingEntries" class="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          <div v-else-if="entries.length === 0" class="px-4 py-6 text-center text-xs text-muted-foreground">
            Nothing in this list yet.
          </div>

          <div
            v-for="(entry, index) in entries"
            :key="`${entry.kind}:${entry.id}`"
            class="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-b-0"
          >
            <span class="text-xs font-mono text-muted-foreground w-6 flex-shrink-0">{{ index + 1 }}</span>

            <img
              v-if="entryCover(entry)"
              :src="entryCover(entry)"
              :alt="entryTitle(entry)"
              loading="lazy"
              referrerpolicy="no-referrer"
              class="w-8 h-12 rounded object-cover bg-muted flex-shrink-0 border border-border/60"
            />
            <div v-else class="w-8 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0 border border-border/60">
              <ImageOff class="w-3 h-3 text-muted-foreground" />
            </div>

            <div class="flex-1 min-w-0">
              <p class="text-sm text-foreground truncate">{{ entryTitle(entry) }}</p>
              <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                <span v-if="entrySubtitle(entry)" class="text-xs text-muted-foreground truncate">{{ entrySubtitle(entry) }}</span>
                <span
                  v-if="entry.kind === 'item' || entry.external.library_item"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500"
                >
                  In library
                </span>
                <span
                  v-else-if="entry.external.request_status"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  :class="REQUEST_STATUSES[entry.external.request_status]?.tone"
                >
                  {{ REQUEST_STATUSES[entry.external.request_status]?.label }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                v-if="canRequest(entry)"
                @click="requestEntry(entry)"
                :disabled="requesting.has(entry.id)"
                class="h-8 px-2.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium flex items-center gap-1 disabled:opacity-50 transition"
                title="Ask an admin to add this to the library"
              >
                <Send class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">Request</span>
              </button>
              <button aria-label="Move up"
                @click="move(index, -1)"
                :disabled="index === 0 || reordering"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition"
                title="Move up"
              >
                <ChevronUp class="w-4 h-4" />
              </button>
              <button aria-label="Move down"
                @click="move(index, 1)"
                :disabled="index === entries.length - 1 || reordering"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition"
                title="Move down"
              >
                <ChevronDown class="w-4 h-4" />
              </button>
              <button aria-label="Remove from list"
                @click="removeEntry(list, entry)"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition"
                title="Remove from list"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ListOrdered, ChevronDown, ChevronUp, X, ArrowLeft, Plus, Check, Trash2, Send, Inbox, ImageOff,
  Film, Tv, Sparkles, BookOpen, Headphones
} from 'lucide-vue-next';
import api from '../api/client';
import { coverUrl as buildCoverUrl } from '../utils/cover';
import { externalTitlePayload, SOURCE_LABELS } from '../utils/externalTitle';
import { LIST_CATEGORIES, REQUEST_STATUSES } from '../constants/media';
import { useDialogStore } from '../stores/dialog';
import ExternalTitleSearch from '../components/ExternalTitleSearch.vue';

const CATEGORY_ICONS = { movies: Film, shows: Tv, anime: Sparkles, read: BookOpen, listen: Headphones };

const route = useRoute();
const router = useRouter();
const dialog = useDialogStore();

const validCategory = (c) => LIST_CATEGORIES.some((cat) => cat.id === c);
const category = ref(validCategory(route.query.category) ? route.query.category : 'movies');
const currentCategory = computed(() => LIST_CATEGORIES.find((c) => c.id === category.value));

const lists = ref([]);
const entries = ref([]);
const expandedId = ref(null);
const newListName = ref('');
const loading = ref(true);
const loadingEntries = ref(false);
const creating = ref(false);
const reordering = ref(false);
const showSearch = ref(false);
const adding = ref(new Set());
const requesting = ref(new Set());
const error = ref('');

function setCategory(id) {
  if (id === category.value) return;
  category.value = id;
  router.replace({ query: { ...route.query, category: id } });
}

watch(category, () => {
  expandedId.value = null;
  entries.value = [];
  showSearch.value = false;
  loadLists();
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

async function createList() {
  const name = newListName.value.trim();
  if (!name) return;

  creating.value = true;
  error.value = '';
  try {
    await api.post('/collections', { name, type: 'readlist', category: category.value });
    newListName.value = '';
    await loadLists();
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not create list.';
  } finally {
    creating.value = false;
  }
}

async function deleteList(list) {
  const ok = await dialog.confirm({
    title: 'Delete list?',
    message: `"${list.name}" will be deleted. Nothing in your library is removed.`,
    confirmText: 'Delete',
    danger: true
  });
  if (!ok) return;

  try {
    await api.delete(`/collections/${list.id}`);
    expandedId.value = null;
    lists.value = lists.value.filter((l) => l.id !== list.id);
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not delete that list.';
  }
}

async function loadEntries(listId) {
  const res = await api.get(`/collections/${listId}`);
  entries.value = res.data.entries || [];
}

async function toggleList(list) {
  if (expandedId.value === list.id) {
    expandedId.value = null;
    return;
  }

  expandedId.value = list.id;
  showSearch.value = false;
  entries.value = [];
  loadingEntries.value = true;
  try {
    await loadEntries(list.id);
  } catch (err) {
    error.value = 'Could not load this list.';
  } finally {
    loadingEntries.value = false;
  }
}

function resultKey(result) {
  return `${result.source}:${result.externalId}`;
}

function inList(result) {
  return entries.value.some(
    (e) => e.kind === 'external' && e.external.source === result.source && e.external.external_id === result.externalId
  );
}

async function addExternal(list, result, mediaType) {
  const key = resultKey(result);
  adding.value = new Set(adding.value).add(key);
  try {
    await api.post(`/collections/${list.id}/external`, externalTitlePayload(result, mediaType));
    await loadEntries(list.id);
    list.item_count = entries.value.length;
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not add that title.';
  } finally {
    const next = new Set(adding.value);
    next.delete(key);
    adding.value = next;
  }
}

function entryTitle(entry) {
  return entry.kind === 'item' ? entry.item.title : entry.external.title;
}

function entryCover(entry) {
  return entry.kind === 'item' ? buildCoverUrl(entry.item, { width: 180 }) : entry.external.cover_url;
}

function entrySubtitle(entry) {
  if (entry.kind === 'item') return entry.item.series || '';
  const ext = entry.external;
  return [ext.release_date?.slice(0, 4), SOURCE_LABELS[ext.source] || ext.source].filter(Boolean).join(' · ');
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

// The new order is applied locally first so the list doesn't visibly lag a tap, then
// persisted as the full ordering (which is what the reorder endpoint expects).
async function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= entries.value.length) return;

  const reordered = [...entries.value];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  entries.value = reordered;

  reordering.value = true;
  try {
    await api.put(`/collections/${expandedId.value}/reorder`, {
      entries: reordered.map((e) => ({ kind: e.kind, id: e.id }))
    });
  } catch (err) {
    error.value = 'Could not save the new order.';
  } finally {
    reordering.value = false;
  }
}

async function removeEntry(list, entry) {
  try {
    await api.delete(
      entry.kind === 'item'
        ? `/collections/${list.id}/items/${entry.id}`
        : `/collections/${list.id}/external/${entry.id}`
    );
    entries.value = entries.value.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
    list.item_count = Math.max(0, (list.item_count || 1) - 1);
  } catch (err) {
    error.value = 'Could not remove that entry.';
  }
}

onMounted(loadLists);
</script>
