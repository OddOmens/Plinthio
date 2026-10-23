<template>
  <div class="min-h-screen bg-background transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <Sidebar v-if="isSidebarLayout" active-type="" @filter-type="goToShelf" @update:searchQuery="searchShelf" />
    <Navbar v-else active-type="" @filter-type="goToShelf" @update:searchQuery="searchShelf" />

    <main class="page-width mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 pb-24 flex-1 flex flex-col gap-5 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {{ $t('live.title') }}
            <span v-if="!off && !loadError" class="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
              {{ $t('live.badge') }}
            </span>
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            {{ off ? $t('live.off.intro') : $t('live.intro') }}
          </p>
        </div>
      </div>

      <!-- Switched off by an admin (the API answers P700) -->
      <div v-if="off" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
        <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
          <RadioTower class="w-5 h-5" />
        </div>
        <h3 class="text-sm font-medium text-foreground">{{ $t('live.off.title') }}</h3>
        <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
          {{ authStore.isAdmin ? $t('live.off.admin') : $t('live.off.viewer') }}
        </p>
        <router-link
          :to="authStore.isAdmin ? ADMIN_LINK : '/'"
          class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm"
        >
          {{ authStore.isAdmin ? $t('live.openAdmin') : $t('nav.backToShelves') }}
        </router-link>
      </div>

      <template v-else>
        <!-- View tabs + search. On a phone the tabs share the row and search sits below. -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
          <div class="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border self-stretch sm:self-auto" role="tablist">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="view === tab.id"
              @click="setView(tab.id)"
              class="h-8.5 px-3.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 flex-1 sm:flex-none whitespace-nowrap"
              :class="view === tab.id ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'"
            >
              <component :is="tab.icon" class="w-4 h-4" />
              {{ tab.label }}
            </button>
          </div>
          <div class="relative sm:ml-auto sm:w-64 lg:w-72">
            <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              v-model="search"
              type="search"
              :placeholder="$t('live.searchPlaceholder')"
              :aria-label="$t('live.searchPlaceholder')"
              class="w-full h-10 sm:h-9 bg-muted/50 border border-border rounded-xl pl-9 pr-9 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-background transition"
            />
            <button
              v-if="search"
              type="button"
              :aria-label="$t('nav.clearSearch')"
              @click="search = ''"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Group chips. The row scrolls sideways; its edges fade where more chips hide. -->
        <div
          v-if="groups.length > 1"
          ref="chipsEl"
          @scroll.passive="updateChipEdges"
          class="-mx-4 px-4 sm:mx-0 sm:px-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          :style="chipsMask"
          role="group"
          :aria-label="$t('live.groupsLabel')"
        >
          <button
            v-for="g in groupChips"
            :key="g.value"
            type="button"
            :data-active="group === g.value || undefined"
            :aria-pressed="String(group === g.value)"
            @click="setGroup(g.value)"
            :class="[
              'h-8.5 px-3 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 active:scale-95',
              group === g.value
                ? 'bg-foreground text-background font-semibold shadow-sm'
                : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted border border-border/50'
            ]"
          >
            {{ g.label }}
          </button>
        </div>

        <!-- ─── Channels ───────────────────────────────────────────────────────────── -->
        <section v-if="view === 'channels'" :aria-busy="String(loading)">
          <div v-if="loading && !channels.length" class="channel-grid">
            <div v-for="i in 9" :key="i" class="h-[92px] rounded-xl bg-muted/40 animate-pulse border border-border" />
          </div>

          <div v-else-if="loadError" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
            <div class="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center mb-3">
              <AlertCircle class="w-5 h-5" />
            </div>
            <h3 class="text-sm font-medium text-foreground">{{ $t('live.errors.loadTitle') }}</h3>
            <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">{{ loadError }}</p>
            <button type="button" @click="loadChannels()" class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm">
              {{ $t('common.retry') }}
            </button>
          </div>

          <LiveEmpty v-else-if="!channels.length" :filtered="filtered" @clear="clearFilters" />

          <ul v-else class="channel-grid transition-opacity" :class="loading ? 'opacity-60' : ''">
            <li v-for="ch in channels" :key="ch.id">
              <router-link
                :to="channelLink(ch)"
                class="group h-full flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-foreground/15 transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <ChannelLogo :logo="ch.logo" :name="ch.name" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="text-[11px] font-mono text-muted-foreground tabular-nums flex-shrink-0">{{ ch.number }}</span>
                    <h3 class="text-sm font-semibold text-foreground truncate">{{ ch.name }}</h3>
                    <span
                      v-if="ch.geoBlocked"
                      class="ml-auto flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      :title="$t('live.geoBlockedHint')"
                    >{{ $t('live.geoBlocked') }}</span>
                  </div>
                  <template v-if="airing(ch)">
                    <p class="text-xs text-foreground/90 truncate mt-0.5">{{ airing(ch).title }}</p>
                    <div class="flex items-center gap-2 mt-1.5">
                      <div class="h-1 flex-1 bg-muted rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full transition-[width] duration-500" :style="{ width: `${progressPercent(now, airing(ch).start, airing(ch).stop)}%` }" />
                      </div>
                      <span class="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {{ $t('live.minutesLeft', { count: minutesLeft(now, airing(ch).stop) }) }}
                      </span>
                    </div>
                  </template>
                  <p v-else class="text-xs text-muted-foreground mt-0.5">{{ $t('live.noGuideInfo') }}</p>
                  <p v-if="upNext(ch)" class="text-[11px] text-muted-foreground truncate mt-1">
                    {{ $t('live.nextAt', { time: clock(upNext(ch).start), title: upNext(ch).title }) }}
                  </p>
                </div>
                <span class="hidden sm:flex self-center w-9 h-9 rounded-full bg-primary text-primary-foreground items-center justify-center shadow opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition flex-shrink-0" aria-hidden="true">
                  <Play class="w-4 h-4 fill-current" />
                </span>
              </router-link>
            </li>
          </ul>
        </section>

        <!-- ─── Guide ──────────────────────────────────────────────────────────────── -->
        <LiveGuide v-else :group="group" :q="query" @clear-filters="clearFilters" @off="off = true" />
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';
import ChannelLogo from '../components/live/ChannelLogo.vue';
import LiveEmpty from '../components/live/LiveEmpty.vue';
import LiveGuide from '../components/live/LiveGuide.vue';
import { clock, progressPercent, minutesLeft, useNow } from '../components/live/liveFormat';
import { t } from '../i18n';
import { RadioTower, Search, X, Play, AlertCircle, LayoutGrid, CalendarClock } from '@lucide/vue';

const ADMIN_LINK = { path: '/admin', query: { tab: 'liveTv' } };

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');

// The header's category tabs and search belong to the shelf.
function goToShelf(type) {
  router.push({ path: '/', query: { type } });
}
function searchShelf(query) {
  router.push(query ? { path: '/', query: { search: query } } : { path: '/' });
}

// View, group and search live in the address bar, so Back from a channel returns to the
// same place and a link to the guide opens the guide.
const tabs = computed(() => [
  { id: 'channels', label: t('live.tabs.channels'), icon: LayoutGrid },
  { id: 'guide', label: t('live.tabs.guide'), icon: CalendarClock }
]);
const view = ref(route.query.view === 'guide' ? 'guide' : 'channels');
const group = ref(typeof route.query.group === 'string' ? route.query.group : '');
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
// The search as sent to the server — trails the input slightly while typing.
const query = ref(search.value.trim());
let searchTimer = null;
watch(search, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query.value = value.trim(); }, 250);
});

watch([view, group, query], () => {
  const q = {};
  if (view.value === 'guide') q.view = 'guide';
  if (group.value) q.group = group.value;
  if (query.value) q.q = query.value;
  router.replace({ query: q });
});

function setView(id) { view.value = id; }
function setGroup(value) { group.value = value; }
function clearFilters() {
  group.value = '';
  search.value = '';
  query.value = '';
}
const filtered = computed(() => !!(group.value || query.value));

// ── Channels ──────────────────────────────────────────────────────────────────────────
const now = useNow(30000);
const channels = ref([]);
const groups = ref([]);
const loading = ref(false);
const loadError = ref('');
const off = ref(false);
let requestId = 0;
let lastLoad = 0;

const groupChips = computed(() => [
  { value: '', label: t('common.all') },
  ...groups.value.map((g) => ({ value: g, label: g }))
]);

async function loadChannels({ quiet = false } = {}) {
  const id = ++requestId;
  if (!quiet) loading.value = true;
  try {
    const params = {};
    if (group.value) params.group = group.value;
    if (query.value) params.q = query.value;
    const res = await api.get('/live/channels', { params });
    if (id !== requestId) return;
    channels.value = res.data?.channels || [];
    // The group list is the whole set this account can watch; keep the one we have if a
    // filtered answer comes back without it.
    if (Array.isArray(res.data?.groups) && (res.data.groups.length || !filtered.value)) groups.value = res.data.groups;
    // An unfiltered answer is the real channel count — keeps the nav in step (a kids
    // account allowed its first channel, an admin who just added a source).
    if (!filtered.value) customizationStore.liveChannelCount = channels.value.length;
    loadError.value = '';
    lastLoad = Date.now();
  } catch (err) {
    if (id !== requestId) return;
    if (err.response?.data?.code === 'P700') {
      off.value = true;
      customizationStore.liveChannelCount = 0;
    } else if (!quiet) {
      loadError.value = err.response?.data?.error || t('live.errors.unreachable');
    }
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch([group, query], () => { if (view.value === 'channels') loadChannels(); });
watch(view, (v) => { if (v === 'channels') loadChannels({ quiet: channels.value.length > 0 }); });

// The programme on air now, and the one after. Between refreshes the list's "now" can run
// out; its "next" takes over until the next fetch brings the schedule up to date.
function airing(ch) {
  const n = now.value;
  if (ch.now && ch.now.start <= n && n < ch.now.stop) return ch.now;
  if (ch.next && ch.next.start <= n && n < ch.next.stop) return ch.next;
  return null;
}
function upNext(ch) {
  const n = now.value;
  if (ch.next && ch.next.start > n) return ch.next;
  return null;
}

// Once any programme on screen has ended, fetch the list again (quietly, at most once a
// minute) so "now" and "next" stay right on a page left open.
watch(now, (n) => {
  if (view.value !== 'channels' || loading.value || n - lastLoad < 60000) return;
  if (channels.value.some((ch) => (ch.now && ch.now.stop <= n) || (ch.next && ch.next.start <= n))) {
    loadChannels({ quiet: true });
  }
});

function channelLink(ch) {
  return { name: 'live-channel', params: { id: ch.id }, query: group.value ? { group: group.value } : {} };
}

// ── Group chips edge fade (as the shelf's category pills) ──────────────────────────────
const chipsEl = ref(null);
const chipsAtStart = ref(true);
const chipsAtEnd = ref(true);
function updateChipEdges() {
  const el = chipsEl.value;
  if (!el) return;
  chipsAtStart.value = el.scrollLeft <= 2;
  chipsAtEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
}
const chipsMask = computed(() => {
  if (chipsAtStart.value && chipsAtEnd.value) return {};
  const left = chipsAtStart.value ? 'black 0' : 'transparent 0, black 28px';
  const right = chipsAtEnd.value ? 'black 100%' : 'black calc(100% - 36px), transparent 100%';
  const mask = `linear-gradient(to right, ${left}, ${right})`;
  return { maskImage: mask, WebkitMaskImage: mask };
});
function revealActiveChip() {
  const el = chipsEl.value;
  const chip = el?.querySelector('[data-active]');
  if (el && chip && (chip.offsetLeft < el.scrollLeft || chip.offsetLeft + chip.offsetWidth > el.scrollLeft + el.clientWidth)) {
    el.scrollTo({ left: chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2 });
  }
  updateChipEdges();
}
watch(groups, () => nextTick(revealActiveChip));
watch(group, () => nextTick(updateChipEdges));

onMounted(() => {
  // The guide asks for its own page of channels; the group chips still come from here.
  loadChannels({ quiet: view.value === 'guide' });
  window.addEventListener('resize', updateChipEdges, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('resize', updateChipEdges));
onUnmounted(() => clearTimeout(searchTimer));
</script>

<style scoped>
/* As many columns as fit the space the page has (it's narrower beside the sidebar). */
.channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
  gap: 0.75rem;
}
@media (max-width: 639px) {
  .channel-grid { gap: 0.625rem; }
}
</style>
