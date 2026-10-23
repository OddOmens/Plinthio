<template>
  <section class="flex flex-col gap-3" :aria-busy="String(loading)">
    <!-- Time navigation: a few hours at a time, back to two hours ago and up to a day and a
         half ahead (as far as the server keeps the schedule). -->
    <div class="flex items-center gap-2">
      <div class="flex items-center p-0.5 rounded-lg border border-border bg-muted/40">
        <button
          type="button"
          @click="shift(-SHIFT_MS)"
          :disabled="!canGoEarlier || loading"
          :aria-label="$t('live.guide.earlier')"
          :title="$t('live.guide.earlier')"
          class="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft class="w-4 h-4" />
        </button>
        <button
          type="button"
          @click="goToNow"
          :disabled="loading"
          class="h-8 px-3 rounded-md text-xs font-semibold transition"
          :class="showingNow ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background'"
        >
          {{ $t('live.guide.now') }}
        </button>
        <button
          type="button"
          @click="shift(SHIFT_MS)"
          :disabled="!canGoLater || loading"
          :aria-label="$t('live.guide.later')"
          :title="$t('live.guide.later')"
          class="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>
      <p class="text-xs sm:text-sm font-medium text-foreground truncate">{{ dayLabel }}</p>
      <Loader2 v-if="loading || loadingMore" class="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
      <span v-if="total" class="ml-auto text-xs text-muted-foreground whitespace-nowrap">{{ $t('live.channelCount', { count: total }) }}</span>
    </div>

    <div v-if="loadError && !channels.length" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
      <div class="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center mb-3">
        <AlertCircle class="w-5 h-5" />
      </div>
      <h3 class="text-sm font-medium text-foreground">{{ $t('live.errors.guideTitle') }}</h3>
      <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">{{ loadError }}</p>
      <button type="button" @click="reload()" class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm">
        {{ $t('common.retry') }}
      </button>
    </div>

    <LiveEmpty v-else-if="loaded && !channels.length" :filtered="!!(group || q)" @clear="$emit('clear-filters')" />

    <template v-else>
      <!-- Channels but no schedule: the guide hasn't been fetched yet, or the source has none. -->
      <div v-if="noGuide" class="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm flex items-start gap-3">
        <CalendarClock class="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
        <div class="min-w-0">
          <p class="font-medium text-foreground">{{ $t('live.guide.notLoadedTitle') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ $t('live.guide.notLoaded') }}</p>
        </div>
      </div>

      <!-- The grid scrolls both ways inside its own box, so the time row stays on top and
           the channel column stays at the left however far you go. -->
      <div
        ref="scroller"
        class="relative overflow-auto overscroll-x-contain rounded-xl border border-border bg-card h-[70dvh] min-h-[22rem] max-h-[60rem] transition-opacity"
        :class="loading && channels.length ? 'opacity-60' : ''"
        @scroll.passive="onScroll"
      >
        <div class="relative" :style="{ width: `${channelCol + timelineWidth}px` }">
          <!-- Time row -->
          <div class="sticky top-0 z-30 flex border-b border-border bg-card/95 backdrop-blur" :style="{ height: `${HEADER_H}px` }">
            <div class="sticky left-0 z-40 flex-shrink-0 bg-card border-r border-border flex items-center px-3" :style="{ width: `${channelCol}px` }">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                {{ isPhone ? '' : $t('live.guide.channel') }}
              </span>
            </div>
            <div class="relative flex-shrink-0" :style="{ width: `${timelineWidth}px` }">
              <div
                v-for="slot in slots"
                :key="slot.start"
                class="absolute inset-y-0 border-l border-border/60 flex items-center pr-2 overflow-hidden text-xs tabular-nums whitespace-nowrap"
                :class="slot.current ? 'text-foreground font-semibold' : 'text-muted-foreground'"
                :style="{ left: `${slot.left}px`, width: `${SLOT_MIN * ppm}px`, paddingLeft: `max(8px, calc(var(--guide-x, 0px) - ${slot.left}px + 8px))` }"
              >
                <span v-if="slot.day" class="font-semibold text-foreground mr-1">{{ slot.day }}</span>
                {{ slot.label }}
              </div>
            </div>
          </div>

          <!-- Skeleton rows on the first load -->
          <template v-if="loading && !channels.length">
            <div v-for="i in 8" :key="`s${i}`" class="flex border-b border-border/60" :style="{ height: `${rowH}px` }">
              <div class="sticky left-0 z-20 flex-shrink-0 bg-card border-r border-border p-2" :style="{ width: `${channelCol}px` }">
                <div class="w-9 h-9 rounded-lg bg-muted/60 animate-pulse" />
              </div>
              <div class="flex-1 p-1.5"><div class="h-full rounded-md bg-muted/40 animate-pulse" /></div>
            </div>
          </template>

          <!-- Channel rows -->
          <div v-for="ch in channels" :key="ch.id" class="flex border-b border-border/60" :style="{ height: `${rowH}px` }">
            <router-link
              :to="channelLink(ch)"
              class="sticky left-0 z-20 flex-shrink-0 bg-card border-r border-border flex items-center gap-2 px-2 hover:bg-muted transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              :style="{ width: `${channelCol}px` }"
              :title="$t('live.watchChannel', { channel: ch.name })"
            >
              <ChannelLogo :logo="ch.logo" :name="ch.name" size="sm" />
              <div class="min-w-0 flex-1">
                <span class="block text-[11px] font-mono text-muted-foreground tabular-nums leading-tight">{{ ch.number }}</span>
                <span class="block text-xs font-semibold text-foreground truncate leading-tight" :class="isPhone ? 'sr-only' : ''">{{ ch.name }}</span>
              </div>
            </router-link>

            <div class="relative flex-shrink-0" :style="{ width: `${timelineWidth}px` }">
              <div
                v-for="p in placed(ch)"
                :key="p.start"
                role="button"
                tabindex="0"
                @click="openProgramme(ch, p)"
                @keydown.enter.prevent="openProgramme(ch, p)"
                @keydown.space.prevent="openProgramme(ch, p)"
                class="absolute top-1 bottom-1 rounded-md border text-left overflow-hidden cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                :class="blockClass(p)"
                :style="{ left: `${p.left + 1}px`, width: `${Math.max(p.width - 2, 2)}px` }"
                :aria-label="`${p.title}, ${timeRange(p.start, p.stop)}`"
              >
                <!-- A programme that began off to the left still shows its title: the part
                     scrolled out of sight (--guide-x, kept by onScroll) becomes padding. -->
                <div class="pr-2 py-1" :style="{ paddingLeft: `max(8px, calc(var(--guide-x, 0px) - ${p.left}px + 8px))` }">
                  <span class="block text-xs font-medium truncate leading-snug">{{ p.title }}</span>
                  <span v-if="p.width > 70" class="block text-[11px] truncate leading-snug opacity-75 tabular-nums">{{ clock(p.start) }}<template v-if="p.subtitle"> · {{ p.subtitle }}</template></span>
                </div>
              </div>
              <div v-if="!ch.programmes || !ch.programmes.length" class="absolute inset-1 rounded-md border border-dashed border-border/70 overflow-hidden">
                <span class="block truncate pr-2 py-1.5 text-xs text-muted-foreground" :style="{ paddingLeft: 'calc(var(--guide-x, 0px) + 8px)' }">{{ $t('live.noGuideInfo') }}</span>
              </div>
            </div>
          </div>

          <!-- "Now" line: over the programmes, under the channel column and time row -->
          <div
            v-if="nowLeft !== null && channels.length"
            class="absolute bottom-0 z-[15] pointer-events-none"
            :style="{ left: `${channelCol + nowLeft}px`, top: `${HEADER_H}px` }"
            aria-hidden="true"
          >
            <div class="w-2 h-2 -ml-[3px] rounded-full bg-primary" />
            <div class="w-0.5 h-full bg-primary/80 -mt-1" />
          </div>

          <div v-if="loadingMore" class="sticky left-0 py-4 flex justify-center text-muted-foreground" :style="{ width: `${scrollerWidth || channelCol}px` }">
            <Loader2 class="w-4 h-4 animate-spin" />
          </div>
        </div>
      </div>
    </template>

    <!-- A programme's details -->
    <SettingsDialog
      :open="!!selected"
      :title="selected?.programme.title || ''"
      :subtitle="selected ? selected.channel.name : ''"
      @close="selected = null"
    >
      <template v-if="selected">
        <div class="flex items-center gap-3">
          <ChannelLogo :logo="selected.channel.logo" :name="selected.channel.name" size="lg" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground tabular-nums">{{ longRange(selected.programme) }}</p>
            <p class="text-xs mt-0.5" :class="statusOf(selected.programme) === 'live' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'">
              {{ statusLabel(selected.programme) }}
            </p>
          </div>
        </div>
        <div v-if="statusOf(selected.programme) === 'live'" class="h-1.5 bg-muted rounded-full overflow-hidden">
          <div class="h-full bg-primary rounded-full" :style="{ width: `${progressPercent(now, selected.programme.start, selected.programme.stop)}%` }" />
        </div>
        <div v-if="selected.programme.subtitle || selected.programme.category" class="flex flex-wrap items-center gap-2">
          <p v-if="selected.programme.subtitle" class="text-sm text-foreground">{{ selected.programme.subtitle }}</p>
          <span v-if="selected.programme.category" class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{{ selected.programme.category }}</span>
        </div>
        <p v-if="description" class="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{{ description }}</p>
        <p v-else-if="descriptionLoading" class="text-xs text-muted-foreground flex items-center gap-2"><Loader2 class="w-3.5 h-3.5 animate-spin" />{{ $t('common.loading') }}</p>
      </template>
      <template #footer>
        <button
          v-if="selected"
          type="button"
          @click="watchChannel(selected.channel)"
          class="h-10 px-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition active:scale-95 flex items-center gap-2"
        >
          <Play class="w-4 h-4 fill-current" />
          {{ statusOf(selected.programme) === 'live' ? $t('live.guide.watchNow') : $t('live.guide.watchChannel') }}
        </button>
        <button type="button" @click="selected = null" class="h-10 px-4 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition">
          {{ $t('common.close') }}
        </button>
      </template>
    </SettingsDialog>
  </section>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api/client';
import { useIsPhone } from '../../composables/useIsPhone';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ChannelLogo from './ChannelLogo.vue';
import LiveEmpty from './LiveEmpty.vue';
import { clock, timeRange, progressPercent, minutesLeft, useNow } from './liveFormat';
import { t, d } from '../../i18n';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, CalendarClock, Play } from '@lucide/vue';

const props = defineProps({
  group: { type: String, default: '' },
  q: { type: String, default: '' }
});
const emit = defineEmits(['clear-filters', 'off']);

const router = useRouter();
const isPhone = useIsPhone();
const now = useNow(30000);

const MIN = 60000;
const SLOT_MIN = 30;
const HOURS = 6;
const WINDOW_MS = HOURS * 60 * MIN;
const SHIFT_MS = 3 * 60 * MIN;
const PAGE = 50;
const HEADER_H = 40;
// The server keeps the schedule from two hours ago to 36 hours ahead.
const KEEP_BEFORE = 2 * 60 * MIN;
const KEEP_AFTER = 36 * 60 * MIN;

// Pixels per minute, the channel column and row height: tighter on a phone.
const ppm = computed(() => (isPhone.value ? 4 : 6.4));
const channelCol = computed(() => (isPhone.value ? 64 : 216));
const rowH = computed(() => (isPhone.value ? 60 : 64));

const floorToSlot = (ms) => ms - (ms % (SLOT_MIN * MIN));
// Starts half an hour back, so what's on now has a little context to its left.
const defaultFrom = () => floorToSlot(Date.now()) - SLOT_MIN * MIN;

const from = ref(defaultFrom());
const to = computed(() => from.value + WINDOW_MS);
const timelineWidth = computed(() => (WINDOW_MS / MIN) * ppm.value);

const canGoEarlier = computed(() => from.value - SHIFT_MS >= floorToSlot(now.value) - KEEP_BEFORE);
const canGoLater = computed(() => from.value + SHIFT_MS + WINDOW_MS <= now.value + KEEP_AFTER);
const showingNow = computed(() => now.value >= from.value && now.value < to.value);

const channels = ref([]);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const loaded = ref(false);
const loadError = ref('');
let requestId = 0;

const noGuide = computed(() => loaded.value && channels.value.length > 0 &&
  channels.value.every((ch) => !ch.programmes || !ch.programmes.length));

async function fetchPage(offset) {
  const params = { from: from.value, hours: HOURS, offset, limit: PAGE };
  if (props.group) params.group = props.group;
  if (props.q) params.q = props.q;
  const res = await api.get('/live/guide', { params });
  return res.data || {};
}

// `scrollTo`: where to put the time axis once loaded — 'now', 'start' or 'end'.
async function reload(scrollTo = 'now') {
  const id = ++requestId;
  loading.value = true;
  try {
    const data = await fetchPage(0);
    if (id !== requestId) return;
    channels.value = data.channels || [];
    total.value = Number(data.total) || channels.value.length;
    loadError.value = '';
    loaded.value = true;
    await nextTick();
    measure();
    if (scroller.value) {
      scroller.value.scrollTop = 0;
      if (scrollTo === 'end') scroller.value.scrollLeft = scroller.value.scrollWidth;
      else if (scrollTo === 'start') scroller.value.scrollLeft = 0;
      else scrollToNow();
    }
  } catch (err) {
    if (id !== requestId) return;
    if (err.response?.data?.code === 'P700') emit('off');
    loadError.value = err.response?.data?.error || t('live.errors.unreachable');
  } finally {
    if (id === requestId) loading.value = false;
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || channels.value.length >= total.value) return;
  const id = requestId;
  loadingMore.value = true;
  try {
    const data = await fetchPage(channels.value.length);
    if (id !== requestId) return;
    const known = new Set(channels.value.map((ch) => ch.id));
    channels.value = channels.value.concat((data.channels || []).filter((ch) => !known.has(ch.id)));
    total.value = Number(data.total) || total.value;
    // An empty page means the list ended early (channels hidden meanwhile): stop asking.
    if (!data.channels?.length) total.value = channels.value.length;
  } catch (err) {
    // The next scroll tries again.
  } finally {
    loadingMore.value = false;
  }
}

function shift(ms) {
  from.value += ms;
  reload(ms < 0 ? 'end' : 'start');
}

function goToNow() {
  const target = defaultFrom();
  if (target === from.value && channels.value.length) return scrollToNow(true);
  from.value = target;
  reload('now');
}

// New filters start again from the top, with the time axis on now.
watch(() => [props.group, props.q], () => reload('now'));

// ── Layout ────────────────────────────────────────────────────────────────────────────
const scroller = ref(null);
const scrollerWidth = ref(0);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  // A CSS variable rather than reactive state: no re-render of every block per frame.
  el.style.setProperty('--guide-x', `${el.scrollLeft}px`);
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - rowH.value * 6) loadMore();
}

function scrollToNow(smooth) {
  const el = scroller.value;
  if (!el || nowLeft.value === null) return;
  el.scrollTo({ left: Math.max(0, nowLeft.value - 48), behavior: smooth ? 'smooth' : 'auto' });
}

const nowLeft = computed(() => {
  if (now.value < from.value || now.value >= to.value) return null;
  return ((now.value - from.value) / MIN) * ppm.value;
});

const slots = computed(() => {
  const out = [];
  let previousDay = new Date(from.value).toDateString();
  for (let s = from.value; s < to.value; s += SLOT_MIN * MIN) {
    const day = new Date(s).toDateString();
    out.push({
      start: s,
      left: ((s - from.value) / MIN) * ppm.value,
      label: clock(s),
      // A new day starting partway through the window gets its weekday.
      day: day !== previousDay ? d(s, { weekday: 'short' }) : '',
      current: now.value >= s && now.value < s + SLOT_MIN * MIN
    });
    previousDay = day;
  }
  return out;
});

const dayLabel = computed(() => d(from.value, { weekday: 'long', month: 'long', day: 'numeric' }));

// A row's programmes positioned on the time axis, clipped to the window.
function placed(ch) {
  const out = [];
  for (const p of ch.programmes || []) {
    const s = Math.max(p.start, from.value);
    const e = Math.min(p.stop, to.value);
    if (e <= s) continue;
    out.push({ ...p, left: ((s - from.value) / MIN) * ppm.value, width: ((e - s) / MIN) * ppm.value });
  }
  return out;
}

function statusOf(p) {
  if (now.value >= p.stop) return 'ended';
  if (now.value >= p.start) return 'live';
  return 'upcoming';
}

function blockClass(p) {
  const status = statusOf(p);
  if (status === 'live') return 'bg-primary/10 border-primary/40 text-foreground hover:bg-primary/15';
  if (status === 'ended') return 'bg-muted/30 border-border/60 text-muted-foreground hover:bg-muted/60';
  return 'bg-muted/60 border-border text-foreground hover:bg-muted';
}

function channelLink(ch) {
  return { name: 'live-channel', params: { id: ch.id }, query: props.group ? { group: props.group } : {} };
}

// ── Programme details ─────────────────────────────────────────────────────────────────
const selected = ref(null);
const description = ref('');
const descriptionLoading = ref(false);
// The guide carries no descriptions (they'd make every page heavy); a channel's own
// schedule does, so the one tapped is looked up there.
const scheduleCache = new Map();

async function openProgramme(channel, programme) {
  selected.value = { channel, programme };
  description.value = programme.description || '';
  if (description.value) return;
  descriptionLoading.value = true;
  try {
    if (!scheduleCache.has(channel.id)) {
      const res = await api.get(`/live/channels/${channel.id}`);
      scheduleCache.set(channel.id, res.data?.programmes || []);
    }
    const match = scheduleCache.get(channel.id).find((p) => p.start === programme.start);
    if (selected.value?.programme === programme) description.value = match?.description || '';
  } catch (err) {
    // The details we have are enough.
  } finally {
    descriptionLoading.value = false;
  }
}

function longRange(p) {
  const day = d(p.start, { weekday: 'short' });
  return `${day} ${timeRange(p.start, p.stop)}`;
}

function statusLabel(p) {
  const status = statusOf(p);
  if (status === 'live') return t('live.guide.onNow', { count: minutesLeft(now.value, p.stop) });
  if (status === 'ended') return t('live.guide.ended');
  const minutes = Math.ceil((p.start - now.value) / MIN);
  return minutes < 60 ? t('live.guide.startsIn', { count: minutes }) : t('live.guide.startsAt', { time: clock(p.start) });
}

function watchChannel(channel) {
  selected.value = null;
  router.push(channelLink(channel));
}

function measure() {
  scrollerWidth.value = scroller.value?.clientWidth || 0;
}

onMounted(() => {
  reload('now');
  measure();
  window.addEventListener('resize', measure, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));
</script>
