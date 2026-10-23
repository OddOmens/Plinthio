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
        <!-- The viewer's own choices: what they've hidden, and the Home row. -->
        <button
          v-if="!off"
          type="button"
          @click="mineOpen = true"
          class="h-9 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition flex items-center gap-1.5 active:scale-95"
        >
          <EyeOff class="w-3.5 h-3.5 text-muted-foreground" />
          {{ $t('live.mine.button') }}
          <span v-if="liveStore.hiddenCount" class="min-w-[1.25rem] h-5 px-1 rounded-full bg-muted text-[11px] font-semibold tabular-nums flex items-center justify-center">{{ liveStore.hiddenCount }}</span>
        </button>
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
              v-for="v in views"
              :key="v.id"
              type="button"
              role="tab"
              :aria-selected="view === v.id"
              @click="view = v.id"
              class="h-8.5 px-3.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 flex-1 sm:flex-none whitespace-nowrap"
              :class="view === v.id ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'"
            >
              <component :is="v.icon" class="w-4 h-4" />
              {{ v.label }}
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
              @click="clearSearch"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- ─── Search: channels and programmes ─────────────────────────────────────── -->
        <LiveSearchResults
          v-if="searching"
          :q="query"
          :now="now"
          @clear="clearSearch"
          @hide="hideForMe"
          @off="off = true"
        />

        <template v-else>
          <!-- Lists: Favourites · Recent · each line-up · All channels (only the ones with
               something in them). The row scrolls sideways on a phone. -->
          <div
            v-if="shownTabs.length > 1"
            class="-mx-4 px-4 sm:mx-0 sm:px-0 flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-border"
            role="tablist"
            :aria-label="$t('live.lists.label')"
          >
            <button
              v-for="tb in shownTabs"
              :key="tb.id"
              type="button"
              role="tab"
              :aria-selected="activeTab === tb.id"
              @click="setTab(tb.id)"
              class="relative h-10 px-3 text-sm font-medium whitespace-nowrap flex items-center gap-1.5 transition flex-shrink-0"
              :class="activeTab === tb.id ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'"
            >
              <component :is="tb.icon" class="w-4 h-4" :class="tb.id === 'favourites' && activeTab === tb.id ? 'text-amber-500 fill-current' : ''" />
              {{ tb.label }}
              <span class="absolute inset-x-2 -bottom-px h-0.5 rounded-full transition" :class="activeTab === tb.id ? 'bg-foreground' : 'bg-transparent'" aria-hidden="true" />
            </button>
          </div>

          <!-- Group chips (All channels). The row scrolls sideways; its edges fade where more chips hide. -->
          <div
            v-if="activeTab === 'all' && shownGroups.length > 1"
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
              @click="group = g.value"
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

          <!-- ─── Channels ─────────────────────────────────────────────────────────── -->
          <section v-if="view === 'channels'" :aria-busy="String(listLoading)">
            <div v-if="listLoading && !list.length" class="channel-grid">
              <div v-for="i in 9" :key="i" class="h-[92px] rounded-xl bg-muted/40 animate-pulse border border-border" />
            </div>

            <div v-else-if="listError" class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
              <div class="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center mb-3">
                <AlertCircle class="w-5 h-5" />
              </div>
              <h3 class="text-sm font-medium text-foreground">{{ $t('live.errors.loadTitle') }}</h3>
              <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">{{ listError }}</p>
              <button type="button" @click="reloadActive()" class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm">
                {{ $t('common.retry') }}
              </button>
            </div>

            <LiveEmpty v-else-if="!list.length" :filtered="!!group" @clear="clearFilters" />

            <ul v-else class="channel-grid transition-opacity" :class="listLoading ? 'opacity-60' : ''">
              <li v-for="ch in list" :key="ch.id">
                <ChannelCard :channel="ch" :to="channelLink(ch)" :now="now" @hide="hideForMe" />
              </li>
            </ul>
          </section>

          <!-- ─── Guide ────────────────────────────────────────────────────────────── -->
          <LiveGuide
            v-else
            :group="activeTab === 'all' ? group : ''"
            :lineup="guideLineup"
            :link-query="linkQuery"
            @clear-filters="clearFilters"
            @off="off = true"
          />
        </template>
      </template>
    </main>

    <!-- Hidden just now: say so, with a way back. -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="notice"
        class="fixed z-40 bottom-[max(1.25rem,env(safe-area-inset-bottom))] inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-auto sm:max-w-md rounded-xl bg-foreground text-background shadow-2xl pl-4 pr-2 py-2 flex items-center gap-3 text-sm"
        role="status"
      >
        <span class="flex-1 min-w-0 truncate">{{ notice.message }}</span>
        <button
          v-if="notice.undo"
          type="button"
          @click="undoNotice"
          class="h-8 px-3 rounded-lg font-semibold hover:bg-background/15 transition flex items-center gap-1.5 flex-shrink-0"
        >
          <Undo2 class="w-4 h-4" />
          {{ $t('live.undo') }}
        </button>
        <button type="button" :aria-label="$t('common.close')" @click="notice = null" class="w-8 h-8 rounded-lg hover:bg-background/15 flex items-center justify-center flex-shrink-0">
          <X class="w-4 h-4" />
        </button>
      </div>
    </Transition>

    <LiveMyChannelsDialog :open="mineOpen" @close="onMineClosed" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import { useLiveStore } from '../stores/live';
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';
import ChannelCard from '../components/live/ChannelCard.vue';
import LiveEmpty from '../components/live/LiveEmpty.vue';
import LiveGuide from '../components/live/LiveGuide.vue';
import LiveSearchResults from '../components/live/LiveSearchResults.vue';
import LiveMyChannelsDialog from '../components/live/LiveMyChannelsDialog.vue';
import { useNow } from '../components/live/liveFormat';
import { t } from '../i18n';
import {
  RadioTower, Search, X, AlertCircle, LayoutGrid, CalendarClock, Star, History, ListVideo, EyeOff, Undo2
} from '@lucide/vue';

const ADMIN_LINK = { path: '/admin', query: { tab: 'liveTv' } };
// Searches shorter than this would match nearly everything.
const MIN_SEARCH = 2;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const liveStore = useLiveStore();
const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');

// The header's category tabs and search belong to the shelf.
function goToShelf(type) {
  router.push({ path: '/', query: { type } });
}
function searchShelf(query) {
  router.push(query ? { path: '/', query: { search: query } } : { path: '/' });
}

// View, list, group and search live in the address bar, so Back from a channel returns to
// the same place and a link to the guide opens the guide.
const views = computed(() => [
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
const searching = computed(() => query.value.length >= MIN_SEARCH);

function clearSearch() {
  clearTimeout(searchTimer);
  search.value = '';
  query.value = '';
}
function clearFilters() {
  group.value = '';
  clearSearch();
  if (tab.value !== 'all' && view.value === 'guide') setTab('all');
}

const now = useNow(30000);
const off = ref(false);

// ── Every channel (the All tab), plus what the tabs need to know ───────────────────────
const allChannels = ref([]);
const groups = ref([]);
const lineups = ref([]);
const allLoaded = ref(false);
const allLoading = ref(false);
const loadError = ref('');
let allRequest = 0;
let lastLoad = 0;

function failed(err, quiet) {
  if (err.response?.data?.code === 'P700') {
    off.value = true;
    customizationStore.liveChannelCount = 0;
    return '';
  }
  return quiet ? '' : (err.response?.data?.error || t('live.errors.unreachable'));
}

// One request for the whole list: groups are picked here, not by asking again.
async function loadAll({ quiet = false } = {}) {
  const id = ++allRequest;
  if (!quiet) allLoading.value = true;
  try {
    const res = await api.get('/live/channels');
    if (id !== allRequest) return;
    allChannels.value = res.data?.channels || [];
    groups.value = Array.isArray(res.data?.groups) ? res.data.groups : [];
    lineups.value = Array.isArray(res.data?.lineups) ? res.data.lineups : [];
    liveStore.learn(allChannels.value);
    // The real channel count — keeps the nav in step (a kids account allowed its first
    // channel, an admin who just added a source).
    customizationStore.liveChannelCount = allChannels.value.length;
    loadError.value = '';
    allLoaded.value = true;
    lastLoad = Date.now();
  } catch (err) {
    if (id !== allRequest) return;
    const message = failed(err, quiet);
    if (message) loadError.value = message;
  } finally {
    if (id === allRequest) allLoading.value = false;
  }
}

// ── Recently watched (a short list, asked for once) ───────────────────────────────────
const recent = ref([]);
async function loadRecent() {
  try {
    const res = await api.get('/live/recent');
    recent.value = res.data?.channels || [];
    liveStore.learn(recent.value);
  } catch (err) {
    failed(err, true);
  }
}

// ── Favourites and line-ups: fetched when their tab opens, kept for the visit ─────────
const lists = reactive({});
const listState = reactive({});

async function loadList(key, { quiet = false } = {}) {
  const param = key === 'favourites' ? 'favourites' : key.slice('lineup:'.length);
  const state = listState[key] || (listState[key] = { loading: false, error: '', request: 0 });
  const id = ++state.request;
  if (!quiet) state.loading = true;
  try {
    const res = await api.get('/live/channels', { params: { lineup: param } });
    if (id !== state.request) return;
    lists[key] = res.data?.channels || [];
    liveStore.learn(lists[key]);
    state.error = '';
    lastLoad = Date.now();
  } catch (err) {
    if (id !== state.request) return;
    state.error = failed(err, quiet) || state.error;
  } finally {
    if (id === state.request) state.loading = false;
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────────────
const visible = (channelList) => channelList.filter((ch) => !liveStore.isHiddenForMe(ch));
const visibleRecent = computed(() => visible(recent.value));

const tabs = computed(() => {
  const out = [];
  if (liveStore.favouriteCount > 0) out.push({ id: 'favourites', label: t('live.lists.favourites'), icon: Star });
  if (visibleRecent.value.length) out.push({ id: 'recent', label: t('live.lists.recent'), icon: History });
  for (const l of lineups.value) {
    if (l && l.id && (l.channelCount === undefined || l.channelCount > 0)) {
      out.push({ id: `lineup:${l.id}`, label: l.name, icon: ListVideo });
    }
  }
  out.push({ id: 'all', label: t('live.lists.all'), icon: LayoutGrid });
  return out;
});
// The guide pages through the server's list, which has no "recent".
const shownTabs = computed(() => (view.value === 'guide' ? tabs.value.filter((tb) => tb.id !== 'recent') : tabs.value));

// Favourites if there are any, else the first line-up, else every channel.
const defaultTab = computed(() => {
  const ids = shownTabs.value.map((tb) => tb.id);
  if (ids.includes('favourites')) return 'favourites';
  return ids.find((id) => id.startsWith('lineup:')) || 'all';
});

// The tab asked for (address bar, else the one last open on this device). Until the lists
// have loaded it's taken on trust; after that a tab that's gone falls back to the default.
const tab = ref(typeof route.query.tab === 'string' && route.query.tab ? route.query.tab : liveStore.lastTab());
const activeTab = computed(() => {
  if (!allLoaded.value) return tab.value || 'all';
  return shownTabs.value.some((tb) => tb.id === tab.value) ? tab.value : defaultTab.value;
});

function setTab(id) {
  tab.value = id;
  liveStore.rememberTab(id);
}

const guideLineup = computed(() => {
  const id = activeTab.value;
  if (id === 'favourites') return 'favourites';
  return id.startsWith('lineup:') ? id.slice('lineup:'.length) : '';
});

// The list on screen.
const list = computed(() => {
  const id = activeTab.value;
  if (id === 'all') {
    const g = group.value;
    return visible(g ? allChannels.value.filter((ch) => (ch.groups || []).includes(g)) : allChannels.value);
  }
  if (id === 'recent') return visibleRecent.value;
  const channels = visible(lists[id] || []);
  return id === 'favourites' ? channels.filter((ch) => liveStore.isFavourite(ch)) : channels;
});

const listLoading = computed(() => {
  const id = activeTab.value;
  if (id === 'all' || id === 'recent' || !allLoaded.value) return allLoading.value || !allLoaded.value;
  const state = listState[id];
  return !!state?.loading || (!(id in lists) && !state?.error);
});
const listError = computed(() => {
  const id = activeTab.value;
  if (id === 'all' || id === 'recent') return loadError.value;
  return loadError.value || listState[id]?.error || '';
});

function reloadActive(opts = {}) {
  const id = activeTab.value;
  if (id === 'all' || !allLoaded.value) return loadAll(opts);
  if (id === 'recent') return loadRecent();
  return loadList(id, opts);
}

// Opening a favourites or line-up tab fetches it (again, quietly, if we have it already).
watch([activeTab, view], ([id, v]) => {
  if (!allLoaded.value || v !== 'channels' || searching.value) return;
  if (id === 'favourites' || id.startsWith('lineup:')) loadList(id, { quiet: id in lists });
});

// A star toggled or a channel hidden somewhere: what we keep of the favourites goes stale.
watch(() => liveStore.revision, () => {
  if (activeTab.value === 'favourites' && view.value === 'channels') loadList('favourites', { quiet: true });
  else delete lists.favourites;
});

const linkQuery = computed(() => {
  const q = { tab: activeTab.value };
  if (activeTab.value === 'all' && group.value) q.group = group.value;
  return q;
});
function channelLink(ch) {
  return { name: 'live-channel', params: { id: ch.id }, query: linkQuery.value };
}

watch([view, activeTab, group, query], () => {
  if (!allLoaded.value) return;
  const q = {};
  if (view.value === 'guide') q.view = 'guide';
  if (activeTab.value !== defaultTab.value) q.tab = activeTab.value;
  if (activeTab.value === 'all' && group.value) q.group = group.value;
  if (query.value) q.q = query.value;
  router.replace({ query: q });
});

// Once any programme on screen has ended, fetch the list again (quietly, at most once a
// minute) so "now" and "next" stay right on a page left open.
watch(now, (n) => {
  if (view.value !== 'channels' || searching.value || listLoading.value || n - lastLoad < 60000) return;
  if (list.value.some((ch) => (ch.now && ch.now.stop <= n) || (ch.next && ch.next.start <= n))) {
    lastLoad = n;
    reloadActive({ quiet: true });
  }
});

// ── Hide for me ───────────────────────────────────────────────────────────────────────
const mineOpen = ref(false);
const notice = ref(null);
let noticeTimer = null;

function showNotice(message, undo = null) {
  notice.value = { message, undo };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = null; }, 6000);
}

async function hideForMe({ type, value, channel }) {
  try {
    if (type === 'group') {
      await liveStore.hideGroup(value);
      if (group.value === value) group.value = '';
      showNotice(t('live.hidden.group', { group: value }), () => liveStore.showGroup(value));
    } else {
      await liveStore.hideChannel(channel);
      showNotice(t('live.hidden.channel', { channel: channel.name }), () => liveStore.showChannel(channel.id));
    }
  } catch (err) {
    showNotice(t('live.mine.saveFailed'));
  }
}

async function undoNotice() {
  const undo = notice.value?.undo;
  notice.value = null;
  if (!undo) return;
  try {
    await undo();
  } catch (err) {
    showNotice(t('live.mine.saveFailed'));
  }
}

// Brought something back: the server sends it again on a fresh list.
let hiddenWhenOpened = 0;
watch(mineOpen, (open) => { if (open) hiddenWhenOpened = liveStore.hiddenCount; });
function onMineClosed() {
  mineOpen.value = false;
  if (liveStore.hiddenCount < hiddenWhenOpened) {
    loadAll({ quiet: true });
    loadRecent();
    for (const key of Object.keys(lists)) delete lists[key];
    reloadActive({ quiet: true });
  }
}

// ── Group chips (All channels) ────────────────────────────────────────────────────────
const shownGroups = computed(() => groups.value.filter((g) => !liveStore.prefs.hiddenGroups.includes(g)));
const groupChips = computed(() => [
  { value: '', label: t('common.all') },
  ...shownGroups.value.map((g) => ({ value: g, label: g }))
]);

// Edge fade, as the shelf's category pills.
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
watch([shownGroups, activeTab], () => nextTick(revealActiveChip));
watch(group, () => nextTick(updateChipEdges));

onMounted(async () => {
  window.addEventListener('resize', updateChipEdges, { passive: true });
  // A favourites or line-up tab asked for by name starts loading alongside the full list.
  const wanted = tab.value;
  if (view.value === 'channels' && (wanted === 'favourites' || wanted.startsWith('lineup:'))) loadList(wanted);
  // Any other tab it settles on once the list is in loads through the tab watch above.
  await Promise.all([loadAll(), loadRecent()]);
});
onBeforeUnmount(() => window.removeEventListener('resize', updateChipEdges));
onUnmounted(() => {
  clearTimeout(searchTimer);
  clearTimeout(noticeTimer);
});
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
