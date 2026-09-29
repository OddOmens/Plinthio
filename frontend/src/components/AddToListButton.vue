<template>
  <!-- Saves a title the server doesn't have (a film missing from a collection, say) to one
       of your lists, so you can keep track of it without owning it. -->
  <button
    type="button"
    @click.prevent.stop="open"
    class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold transition"
    :class="compact ? 'h-7 px-2' : 'h-8 px-3'"
    :title="savedTo ? `In ${savedTo}` : 'Add to one of your lists'"
  >
    <BookmarkCheck v-if="savedTo" class="w-3.5 h-3.5 text-emerald-500" />
    <BookmarkPlus v-else class="w-3.5 h-3.5" />
    {{ savedTo ? 'In list' : 'List' }}
  </button>

  <Teleport to="body">
    <div v-if="showing" class="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-4" @click.self="showing = false">
      <div class="w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-4 flex flex-col gap-3 safe-bottom" role="dialog" :aria-label="`Add ${payload.title} to a list`">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-foreground">Add to a list</p>
            <p class="text-xs text-muted-foreground truncate">{{ payload.title }}</p>
          </div>
          <button type="button" aria-label="Close" @click="showing = false" class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted">
            <X class="w-4 h-4" />
          </button>
        </div>

        <p v-if="loading" class="text-xs text-muted-foreground py-3 text-center">Loading your lists…</p>
        <div v-else-if="lists.length" class="flex flex-col gap-1 max-h-64 overflow-y-auto">
          <button
            v-for="list in lists"
            :key="list.id"
            type="button"
            @click="addTo(list)"
            :disabled="busy"
            class="h-10 px-3 rounded-xl text-sm text-left flex items-center gap-2.5 hover:bg-muted transition disabled:opacity-50"
          >
            <Check v-if="added.has(list.id)" class="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <ListOrdered v-else class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span class="flex-1 truncate text-foreground">{{ list.name }}</span>
            <span class="text-xs text-muted-foreground">{{ list.item_count }}</span>
          </button>
        </div>

        <form @submit.prevent="createAndAdd" class="flex items-center gap-2">
          <input
            v-model="newName"
            type="text"
            :placeholder="lists.length ? 'New list…' : 'Name your first list, e.g. Watchlist'"
            class="flex-1 h-9 px-3 rounded-xl bg-background border border-border text-sm text-foreground"
          />
          <button type="submit" :disabled="!newName.trim() || busy" class="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
            Create
          </button>
        </form>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';
import { BookmarkPlus, BookmarkCheck, Check, ListOrdered, X } from '@lucide/vue';
import api from '../api/client';

// `payload`: what POST /collections/:id/external takes (see utils/externalTitle.js).
// `category`: which lists it can go in (movies, shows, anime, read, listen).
const props = defineProps({
  payload: { type: Object, required: true },
  category: { type: String, required: true },
  compact: { type: Boolean, default: false }
});

const showing = ref(false);
const loading = ref(false);
const busy = ref(false);
const lists = ref([]);
const added = ref(new Set());
const savedTo = ref('');
const newName = ref('');
const error = ref('');

async function open() {
  showing.value = true;
  error.value = '';
  loading.value = true;
  try {
    const res = await api.get('/collections', { params: { type: 'readlist', category: props.category } });
    lists.value = res.data.collections || [];
  } catch (err) {
    error.value = 'Could not load your lists.';
  } finally {
    loading.value = false;
  }
}

async function addTo(list) {
  busy.value = true;
  error.value = '';
  try {
    await api.post(`/collections/${list.id}/external`, props.payload);
    list.item_count = (list.item_count || 0) + 1;
  } catch (err) {
    // Already in that list (P502) counts as done.
    if (err.response?.data?.code !== 'P502') {
      error.value = err.response?.data?.error || 'Could not add it to that list.';
      busy.value = false;
      return;
    }
  }
  added.value = new Set(added.value).add(list.id);
  savedTo.value = list.name;
  busy.value = false;
  showing.value = false;
}

async function createAndAdd() {
  const name = newName.value.trim();
  if (!name) return;
  busy.value = true;
  error.value = '';
  try {
    const res = await api.post('/collections', { name, type: 'readlist', category: props.category });
    newName.value = '';
    busy.value = false;
    await addTo({ ...res.data.collection, item_count: 0 });
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not create that list.';
    busy.value = false;
  }
}
</script>
