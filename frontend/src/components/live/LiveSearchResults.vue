<template>
  <!-- Search across channel names and what's on (now to a day and a half ahead). -->
  <section class="flex flex-col gap-6" :aria-busy="String(loading)">
    <div v-if="loading && !loaded" class="channel-grid">
      <div v-for="i in 6" :key="i" class="h-[92px] rounded-xl bg-muted/40 animate-pulse border border-border" />
    </div>

    <div v-else-if="loadError" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
      <div class="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center mb-3">
        <AlertCircle class="w-5 h-5" />
      </div>
      <h3 class="text-sm font-medium text-foreground">{{ $t('live.search.errorTitle') }}</h3>
      <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">{{ loadError }}</p>
      <button type="button" @click="load()" class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm">
        {{ $t('common.retry') }}
      </button>
    </div>

    <div v-else-if="loaded && !channels.length && !programmes.length" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
      <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
        <SearchX class="w-5 h-5" />
      </div>
      <h3 class="text-sm font-medium text-foreground">{{ $t('live.search.noResultsTitle') }}</h3>
      <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">{{ $t('live.search.noResults', { query: q }) }}</p>
      <button type="button" @click="$emit('clear')" class="px-3.5 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition">
        {{ $t('live.search.clear') }}
      </button>
    </div>

    <template v-else>
      <div v-if="channels.length" class="flex flex-col gap-3 transition-opacity" :class="loading ? 'opacity-60' : ''">
        <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
          <Tv class="w-4 h-4 text-muted-foreground" />
          {{ $t('live.search.channels') }}
        </h2>
        <ul class="channel-grid">
          <li v-for="ch in channels" :key="ch.id">
            <ChannelCard :channel="ch" :to="channelLink(ch.id)" :now="now" @hide="$emit('hide', $event)" />
          </li>
        </ul>
      </div>

      <div v-if="programmes.length" class="flex flex-col gap-3 transition-opacity" :class="loading ? 'opacity-60' : ''">
        <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
          <CalendarClock class="w-4 h-4 text-muted-foreground" />
          {{ $t('live.search.programmes') }}
        </h2>
        <ul class="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
          <li v-for="p in programmes" :key="`${p.channelId}-${p.start}`">
            <router-link
              :to="channelLink(p.channelId)"
              class="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <ChannelLogo :logo="p.logo" :name="p.channelName" size="sm" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-foreground truncate">
                  {{ p.title }}<span v-if="p.subtitle" class="text-muted-foreground font-normal"> · {{ p.subtitle }}</span>
                </p>
                <p class="text-xs text-muted-foreground truncate">
                  <span v-if="p.number" class="font-mono tabular-nums">{{ p.number }}</span>
                  {{ p.channelName }}
                </p>
              </div>
              <div class="flex-shrink-0 text-right">
                <span
                  v-if="isOn(p)"
                  class="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400"
                >{{ $t('live.badge') }}</span>
                <p v-else class="text-xs text-foreground tabular-nums whitespace-nowrap">{{ when(p) }}</p>
                <p v-if="isOn(p)" class="text-[11px] text-muted-foreground tabular-nums mt-1 whitespace-nowrap">
                  {{ $t('live.minutesLeft', { count: minutesLeft(now, p.stop) }) }}
                </p>
              </div>
            </router-link>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import api from '../../api/client';
import { useLiveStore } from '../../stores/live';
import ChannelCard from './ChannelCard.vue';
import ChannelLogo from './ChannelLogo.vue';
import { clock, minutesLeft } from './liveFormat';
import { t, d } from '../../i18n';
import { AlertCircle, SearchX, Tv, CalendarClock } from '@lucide/vue';

const props = defineProps({
  q: { type: String, required: true },
  now: { type: Number, required: true }
});
const emit = defineEmits(['clear', 'hide', 'off']);

const liveStore = useLiveStore();
const channels = ref([]);
const programmes = ref([]);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref('');
let requestId = 0;

async function load() {
  const id = ++requestId;
  loading.value = true;
  try {
    const res = await api.get('/live/search', { params: { q: props.q, limit: 30 } });
    if (id !== requestId) return;
    channels.value = res.data?.channels || [];
    programmes.value = res.data?.programmes || [];
    liveStore.learn(channels.value);
    loadError.value = '';
    loaded.value = true;
  } catch (err) {
    if (id !== requestId) return;
    if (err.response?.data?.code === 'P700') emit('off');
    loadError.value = err.response?.data?.error || t('live.errors.unreachable');
  } finally {
    if (id === requestId) loading.value = false;
  }
}

// What was hidden from here goes at once.
const visible = (list) => list.filter((ch) => !liveStore.isHiddenForMe(ch));
watch(() => liveStore.prefs, () => {
  channels.value = visible(channels.value);
  const hidden = new Set(liveStore.prefs.hiddenChannels);
  programmes.value = programmes.value.filter((p) => !hidden.has(p.channelId));
});

watch(() => props.q, load);
onMounted(load);

function isOn(p) {
  return p.start <= props.now && props.now < p.stop;
}

// "20:00", or "Tomorrow 08:00"-ish: the weekday when it isn't today.
function when(p) {
  const sameDay = new Date(p.start).toDateString() === new Date(props.now).toDateString();
  return sameDay ? clock(p.start) : `${d(p.start, { weekday: 'short' })} ${clock(p.start)}`;
}

// From a search, channel up/down walks every channel.
function channelLink(id) {
  return { name: 'live-channel', params: { id }, query: { tab: 'all' } };
}
</script>

<style scoped>
.channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
  gap: 0.75rem;
}
@media (max-width: 639px) {
  .channel-grid { gap: 0.625rem; }
}
</style>
