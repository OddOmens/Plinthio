<template>
  <!-- Inline rating strip for header areas: your stars, then the server-wide average, then
       the world (TMDB) score. Each part only renders when the admin has it switched on. -->
  <div
    v-if="item && customizationStore.ratingsEnabled"
    class="flex flex-wrap items-center gap-x-3 gap-y-1"
    :class="[justifyClass, compact ? 'text-[11px]' : 'text-xs']"
  >
    <div v-if="ratings.showPersonal" class="inline-flex items-center gap-1.5">
      <span v-if="!compact" :class="mutedClass" class="font-medium">{{ label || 'Your rating' }}</span>
      <StarRating
        :modelValue="userRating"
        :disabled="saving"
        :size="compact ? 'sm' : 'md'"
        @update:modelValue="rate"
      />
      <span v-if="saveError" class="text-destructive">{{ saveError }}</span>
    </div>

    <template v-if="summary">
      <span v-if="ratings.showPersonal && (summary.community || summary.external)" :class="dividerClass" class="h-3.5 w-px" />

      <div
        v-if="summary.community"
        class="inline-flex items-center gap-1"
        :title="summary.community.count > 0
          ? `${summary.community.average.toFixed(1)} average from ${summary.community.count} ${serverName} ${summary.community.count === 1 ? 'user' : 'users'}`
          : `No ${serverName} ratings yet`"
      >
        <Users class="w-3.5 h-3.5" :class="mutedClass" />
        <span :class="mutedClass">{{ serverName }}</span>
        <template v-if="summary.community.count > 0">
          <Star class="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          <span :class="strongClass" class="font-semibold">{{ summary.community.average.toFixed(1) }}</span>
          <span :class="mutedClass">({{ summary.community.count.toLocaleString() }})</span>
        </template>
        <span v-else :class="mutedClass">—</span>
      </div>

      <div
        v-if="summary.external"
        class="inline-flex items-center gap-1"
        :title="`${summary.external.rating.toFixed(1)}/${summary.external.scale} on TMDB from ${summary.external.votes.toLocaleString()} votes`"
      >
        <Globe class="w-3.5 h-3.5" :class="mutedClass" />
        <span :class="mutedClass">TMDB</span>
        <span :class="strongClass" class="font-semibold">{{ summary.external.rating.toFixed(1) }}</span>
        <span :class="mutedClass">/{{ summary.external.scale }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../api/client';
import { useCustomizationStore } from '../stores/customization';
import StarRating from './StarRating.vue';
import { Star, Users, Globe } from 'lucide-vue-next';

const props = defineProps({
  item: { type: Object, default: null },
  // 'default' follows the app theme; 'dark' is for the players' black overlay headers.
  tone: { type: String, default: 'default' },
  compact: { type: Boolean, default: false },
  align: { type: String, default: 'start' }, // 'start' | 'center' | 'responsive' (centered on phones)
  // Replaces "Your rating", e.g. to say which volume of a series is being rated.
  label: { type: String, default: '' }
});

const emit = defineEmits(['rated']);

const customizationStore = useCustomizationStore();
const ratings = computed(() => customizationStore.ratings);
const serverName = computed(() => customizationStore.serverName || 'Plinthio');

const summary = ref(null);
const userRating = ref(null);
const saving = ref(false);
const saveError = ref('');

const justifyClass = computed(() => ({
  center: 'justify-center',
  responsive: 'justify-center md:justify-start'
}[props.align] || 'justify-start'));
const mutedClass = computed(() => (props.tone === 'dark' ? 'text-white/65' : 'text-muted-foreground'));
const strongClass = computed(() => (props.tone === 'dark' ? 'text-white' : 'text-foreground'));
const dividerClass = computed(() => (props.tone === 'dark' ? 'bg-white/25' : 'bg-border'));

let loadToken = 0;
async function load() {
  const itemId = props.item?.id;
  summary.value = null;
  saveError.value = '';
  userRating.value = props.item?.user_rating ?? null;
  if (!itemId || !customizationStore.ratingsEnabled) return;

  // Guards against a slow response for the previous item landing after a switch
  // (next episode, next volume).
  const token = ++loadToken;
  try {
    const res = await api.get(`/ratings/${itemId}`);
    if (token !== loadToken) return;
    summary.value = res.data;
    if ('userRating' in res.data) userRating.value = res.data.userRating;
  } catch (err) {
    console.warn('Failed to load ratings:', err);
  }
}

async function rate(value) {
  if (!props.item || saving.value) return;
  const previous = userRating.value;
  userRating.value = value;
  saving.value = true;
  saveError.value = '';
  try {
    const res = await api.put(`/ratings/${props.item.id}`, { rating: value });
    summary.value = res.data;
    userRating.value = res.data.userRating ?? null;
    emit('rated', { itemId: props.item.id, rating: userRating.value });
  } catch (err) {
    userRating.value = previous;
    saveError.value = err.response?.data?.error || 'Could not save';
  } finally {
    saving.value = false;
  }
}

watch(() => [props.item?.id, customizationStore.ratingsEnabled], load, { immediate: true });
</script>
