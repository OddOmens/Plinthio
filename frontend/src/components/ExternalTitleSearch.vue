<template>
  <div class="flex flex-col gap-3">
    <form @submit.prevent="search" class="flex flex-wrap md:flex-nowrap items-center gap-2">
      <div v-if="searchTypes.length > 1" class="flex rounded-xl bg-secondary p-1 basis-full md:basis-auto md:flex-shrink-0 min-w-0 overflow-x-auto no-scrollbar">
        <button
          v-for="t in searchTypes"
          :key="t.id"
          type="button"
          @click="activeType = t.id"
          class="h-8 px-3 rounded-lg text-xs font-medium transition whitespace-nowrap flex-shrink-0"
          :class="activeType === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="relative flex-1 min-w-0">
        <Search class="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref="inputEl"
          v-model="query"
          type="search"
          :placeholder="placeholder"
          class="w-full h-10 pl-9 pr-3 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <button
        type="submit"
        :disabled="!query.trim() || searching"
        class="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition flex items-center gap-2"
      >
        <Loader2 v-if="searching" class="w-4 h-4 animate-spin" />
        <span>Search</span>
      </button>
    </form>

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

    <div v-if="searched && !searching && results.length === 0 && !error" class="py-6 text-center text-xs text-muted-foreground">
      No results for “{{ lastQuery }}”.
    </div>

    <div v-if="results.length" class="flex flex-col divide-y divide-border/60 border border-border rounded-xl overflow-hidden bg-background/40">
      <div
        v-for="result in results"
        :key="`${result.source}:${result.externalId}`"
        class="flex items-start gap-3 p-3"
      >
        <img
          v-if="result.coverUrl"
          :src="result.coverUrl"
          :alt="result.title"
          loading="lazy"
          referrerpolicy="no-referrer"
          class="w-10 h-[60px] rounded object-cover bg-muted flex-shrink-0 border border-border/60"
        />
        <div v-else class="w-10 h-[60px] rounded bg-muted flex items-center justify-center flex-shrink-0 border border-border/60">
          <ImageOff class="w-3.5 h-3.5 text-muted-foreground" />
        </div>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-foreground truncate">{{ result.title }}</p>
          <p class="text-xs text-muted-foreground truncate">
            <span v-if="year(result.releaseDate)">{{ year(result.releaseDate) }}</span>
            <span v-if="year(result.releaseDate) && result.author"> · </span>
            <span v-if="result.author">{{ result.author }}</span>
          </p>
          <p v-if="result.overview" class="text-xs text-muted-foreground/80 line-clamp-2 mt-0.5">{{ result.overview }}</p>
        </div>

        <div class="flex-shrink-0 self-center">
          <slot name="action" :result="result" :media-type="lastType" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { Search, Loader2, ImageOff } from 'lucide-vue-next';
import api from '../api/client';

// Searches the same external metadata providers used to link metadata to library items
// (TMDB, MangaDex, Google Books, Open Library). What to do with a result is up to the
// parent, through the `action` slot.
const props = defineProps({
  // [{ id: mediaType, label, provider? }] — `provider` overrides the media type sent to the
  // search API when the type has no provider of its own (audiobooks search books).
  searchTypes: { type: Array, required: true }
});

const query = ref('');
const lastQuery = ref('');
const activeType = ref(props.searchTypes[0]?.id);
const lastType = ref(activeType.value);
const results = ref([]);
const searching = ref(false);
const searched = ref(false);
const error = ref('');
const inputEl = ref(null);

const placeholder = computed(() => {
  const t = props.searchTypes.find((s) => s.id === activeType.value);
  return `Search ${t?.label.toLowerCase() || 'titles'}…`;
});

watch(() => props.searchTypes, (types) => {
  activeType.value = types[0]?.id;
  results.value = [];
  searched.value = false;
  error.value = '';
});

watch(activeType, () => {
  if (lastQuery.value) search();
});

function year(date) {
  return date ? String(date).slice(0, 4) : '';
}

async function search() {
  const q = query.value.trim();
  if (!q) return;

  const type = props.searchTypes.find((t) => t.id === activeType.value);
  searching.value = true;
  error.value = '';
  try {
    const res = await api.get('/metadata/search', {
      params: { mediaType: type?.provider || type?.id, query: q }
    });
    results.value = res.data.results || [];
    lastType.value = type?.id;
  } catch (err) {
    results.value = [];
    error.value = err.response?.data?.error || 'Search failed. Try again in a moment.';
  } finally {
    searching.value = false;
    searched.value = true;
    lastQuery.value = q;
  }
}

defineExpose({ focus: () => inputEl.value?.focus() });
</script>
