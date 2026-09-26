<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" @click.self="close">
      <div class="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="px-5 py-4 border-b border-border flex items-center justify-between">
          <div class="min-w-0 pr-2">
            <h3 class="text-sm font-semibold text-foreground truncate">Ratings</h3>
            <p class="text-xs text-muted-foreground truncate mt-0.5">{{ item?.title }}</p>
          </div>
          <button aria-label="Close"
            type="button"
            @click="close"
            class="p-2.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="loading" class="py-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 class="w-4 h-4 animate-spin" />
          Loading ratings...
        </div>

        <div v-else-if="loadError" class="px-5 py-8 text-center text-xs text-destructive">
          {{ loadError }}
        </div>

        <!-- Your stars, then the server-wide average, then the world score — side by side on
             wider screens, stacked on a phone. Each block only exists if the admin has it on. -->
        <div v-else class="p-5 grid gap-3" :class="gridColsClass">
          <div v-if="'userRating' in summary" class="rounded-lg border border-border bg-muted/20 p-3 flex flex-col items-center text-center gap-2">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your rating</span>
            <StarRating
              :modelValue="summary.userRating"
              :disabled="saving"
              size="lg"
              @update:modelValue="rate"
            />
            <span class="text-[11px] text-muted-foreground min-h-[1rem]">
              <template v-if="saveError"><span class="text-destructive">{{ saveError }}</span></template>
              <template v-else-if="summary.userRating">You gave it {{ summary.userRating }}/5</template>
              <template v-else>Tap a star to rate</template>
            </span>
          </div>

          <div v-if="summary.community" class="rounded-lg border border-border bg-muted/20 p-3 flex flex-col items-center text-center gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{ serverName }} users</span>
            <template v-if="summary.community.count > 0">
              <span class="text-2xl font-bold text-foreground leading-none">{{ summary.community.average.toFixed(1) }}</span>
              <StarRating :modelValue="summary.community.average" readonly size="sm" />
              <span class="text-[11px] text-muted-foreground">
                {{ summary.community.count.toLocaleString() }} {{ summary.community.count === 1 ? 'rating' : 'ratings' }}
              </span>
            </template>
            <span v-else class="text-xs text-muted-foreground py-3">No ratings yet</span>
          </div>

          <div v-if="'external' in summary" class="rounded-lg border border-border bg-muted/20 p-3 flex flex-col items-center text-center gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{ externalLabel }}</span>
            <template v-if="summary.external">
              <span class="text-2xl font-bold text-foreground leading-none">
                {{ summary.external.rating.toFixed(1) }}<span class="text-sm font-medium text-muted-foreground">/{{ summary.external.scale }}</span>
              </span>
              <StarRating :modelValue="summary.external.rating / summary.external.scale * 5" readonly size="sm" />
              <span class="text-[11px] text-muted-foreground">
                {{ summary.external.votes.toLocaleString() }} {{ summary.external.votes === 1 ? 'vote' : 'votes' }}
              </span>
            </template>
            <span v-else class="text-xs text-muted-foreground py-3">Not available</span>
          </div>

          <p v-if="blockCount === 0" class="text-xs text-muted-foreground text-center py-4">
            Ratings are turned off on this server.
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../api/client';
import { useCustomizationStore } from '../stores/customization';
import StarRating from './StarRating.vue';
import { X, Loader2 } from 'lucide-vue-next';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  item: { type: Object, default: null }
});

const emit = defineEmits(['close', 'rated']);

const customizationStore = useCustomizationStore();
const serverName = computed(() => customizationStore.serverName || 'Plinthio');

const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');
const summary = ref({});

const blockCount = computed(() =>
  ['userRating', 'community', 'external'].filter((k) => k in summary.value).length
);
const gridColsClass = computed(() => ({
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3'
}[blockCount.value] || 'grid-cols-1'));

// TMDB is the only world-rating source today; label anything else by its raw source name.
const externalLabel = computed(() => {
  const source = summary.value.external?.source;
  return !source || source === 'tmdb' ? 'TMDB' : source;
});

async function load() {
  if (!props.item) return;
  loading.value = true;
  loadError.value = '';
  saveError.value = '';
  summary.value = {};
  try {
    const res = await api.get(`/ratings/${props.item.id}`);
    summary.value = res.data;
  } catch (err) {
    loadError.value = err.response?.data?.error || 'Could not load ratings';
  } finally {
    loading.value = false;
  }
}

async function rate(value) {
  if (!props.item || saving.value) return;
  const previous = summary.value.userRating;
  summary.value = { ...summary.value, userRating: value };
  saving.value = true;
  saveError.value = '';
  try {
    const res = await api.put(`/ratings/${props.item.id}`, { rating: value });
    summary.value = res.data;
    emit('rated', { itemId: props.item.id, rating: res.data.userRating ?? null });
  } catch (err) {
    summary.value = { ...summary.value, userRating: previous };
    saveError.value = err.response?.data?.error || 'Could not save your rating';
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}

watch(
  () => [props.isOpen, props.item?.id],
  ([open]) => {
    if (open) load();
  },
  { immediate: true }
);
</script>
