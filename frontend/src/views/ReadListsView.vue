<template>
  <div class="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-foreground">Read Lists</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Ordered reading orders that can span several series.
        </p>
      </div>
    </div>

    <form @submit.prevent="createList" class="flex items-center gap-2">
      <input
        v-model="newListName"
        type="text"
        placeholder="New read list name…"
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
      <p class="text-sm font-medium text-foreground mt-3">No read lists yet</p>
      <p class="text-xs text-muted-foreground mt-1">
        Create one above, then add issues to it from any item's menu.
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
          <div v-if="listItems.length === 0" class="px-4 py-6 text-center text-xs text-muted-foreground">
            Nothing in this list yet.
          </div>

          <div
            v-for="(item, index) in listItems"
            :key="item.id"
            class="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-b-0"
          >
            <span class="text-xs font-mono text-muted-foreground w-6 flex-shrink-0">{{ index + 1 }}</span>

            <img
              :src="buildCoverUrl(item, { width: 180 })"
              :alt="item.title"
              loading="lazy"
              class="w-8 h-12 rounded object-cover bg-muted flex-shrink-0 border border-border/60"
            />

            <div class="flex-1 min-w-0">
              <p class="text-sm text-foreground truncate">{{ item.title }}</p>
              <p v-if="item.series" class="text-xs text-muted-foreground truncate">{{ item.series }}</p>
            </div>

            <div class="flex items-center gap-1 flex-shrink-0">
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
                :disabled="index === listItems.length - 1 || reordering"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition"
                title="Move down"
              >
                <ChevronDown class="w-4 h-4" />
              </button>
              <button aria-label="Remove from list"
                @click="removeItem(list, item)"
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
import { ref, onMounted } from 'vue';
import { ListOrdered, ChevronDown, ChevronUp, X } from 'lucide-vue-next';
import api from '../api/client';
import { coverUrl as buildCoverUrl } from '../utils/cover';

const lists = ref([]);
const listItems = ref([]);
const expandedId = ref(null);
const newListName = ref('');
const loading = ref(true);
const creating = ref(false);
const reordering = ref(false);
const error = ref('');

async function loadLists() {
  loading.value = true;
  try {
    const res = await api.get('/collections', { params: { type: 'readlist' } });
    lists.value = res.data.collections || [];
  } catch (err) {
    error.value = 'Could not load read lists.';
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
    await api.post('/collections', { name, type: 'readlist' });
    newListName.value = '';
    await loadLists();
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not create read list.';
  } finally {
    creating.value = false;
  }
}

async function toggleList(list) {
  if (expandedId.value === list.id) {
    expandedId.value = null;
    return;
  }

  expandedId.value = list.id;
  listItems.value = [];
  try {
    const res = await api.get(`/collections/${list.id}`);
    listItems.value = res.data.items || [];
  } catch (err) {
    error.value = 'Could not load this read list.';
  }
}

// The new order is applied locally first so the list doesn't visibly lag a tap, then
// persisted as the full ordering (which is what the reorder endpoint expects).
async function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= listItems.value.length) return;

  const reordered = [...listItems.value];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  listItems.value = reordered;

  reordering.value = true;
  try {
    await api.put(`/collections/${expandedId.value}/reorder`, {
      itemIds: reordered.map((item) => item.id)
    });
  } catch (err) {
    error.value = 'Could not save the new order.';
  } finally {
    reordering.value = false;
  }
}

async function removeItem(list, item) {
  try {
    await api.delete(`/collections/${list.id}/items/${item.id}`);
    listItems.value = listItems.value.filter((i) => i.id !== item.id);
    list.item_count = Math.max(0, (list.item_count || 1) - 1);
  } catch (err) {
    error.value = 'Could not remove that item.';
  }
}

onMounted(loadLists);
</script>
