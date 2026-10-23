<template>
  <!-- Admin → Live TV → Channels: every channel from every list, a page at a time (lists
       can hold thousands), to hide the unwanted ones and choose what kids accounts see. -->
  <SettingsCard :title="$t('admin.liveTv.channels.title')" :description="$t('admin.liveTv.channels.desc')" flush>
    <template #actions><SaveStatus :status="save.status.value" :message="save.message.value" /></template>

    <!-- Search and filters -->
    <div class="px-4 sm:px-5 py-3 border-b border-border flex flex-col gap-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[12rem]">
          <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            v-model="query"
            type="search"
            :placeholder="$t('admin.liveTv.channels.searchPlaceholder')"
            :aria-label="$t('admin.liveTv.channels.searchPlaceholder')"
            class="field pl-8"
          />
        </div>
        <select v-if="sources.length > 1" v-model="sourceId" :aria-label="$t('admin.liveTv.channels.sourceFilter')" class="field w-auto max-w-full sm:max-w-[14rem]">
          <option value="">{{ $t('admin.liveTv.channels.allSources') }}</option>
          <option v-for="src in sources" :key="src.id" :value="src.id">{{ src.name }}</option>
        </select>
      </div>
      <div class="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border overflow-x-auto no-scrollbar self-start max-w-full" role="tablist" :aria-label="$t('admin.liveTv.channels.statusFilter')">
        <button
          v-for="f in statusFilters"
          :key="f.id"
          type="button"
          role="tab"
          :aria-selected="String(status === f.id)"
          @click="status = f.id"
          :class="['px-2.5 h-7 rounded-md transition text-[12px] whitespace-nowrap flex-shrink-0', status === f.id ? 'bg-card text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
        >{{ f.label }}</button>
      </div>
    </div>

    <!-- Bulk actions for the ticked channels -->
    <div v-if="channels.length" class="px-4 sm:px-5 py-2.5 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2">
      <label class="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          :checked="allOnPageSelected"
          :indeterminate="someOnPageSelected && !allOnPageSelected"
          @change="toggleSelectPage"
          class="rounded border-border accent-primary h-4 w-4"
        />
        <span>{{ $t('admin.liveTv.channels.selectPage') }}</span>
      </label>
      <span v-if="selected.size" class="text-[12px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
        {{ $t('admin.liveTv.channels.selected', { count: selected.size, number: $n(selected.size) }) }}
      </span>
      <button v-if="selected.size" type="button" @click="selected = new Set()" class="text-[12px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">{{ $t('common.clear') }}</button>
      <div class="flex flex-wrap items-center gap-1.5 sm:ml-auto">
        <button type="button" @click="bulk({ hidden: true })" :disabled="!selected.size || busy" class="btn btn-secondary h-8">
          <EyeOff class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.channels.hide') }}
        </button>
        <button type="button" @click="bulk({ hidden: false })" :disabled="!selected.size || busy" class="btn btn-secondary h-8">
          <Eye class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.channels.show') }}
        </button>
        <button type="button" @click="bulk({ kidsAllowed: true })" :disabled="!selected.size || busy" class="btn btn-secondary h-8">
          <Baby class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.channels.allowKids') }}
        </button>
        <button type="button" @click="bulk({ kidsAllowed: false })" :disabled="!selected.size || busy" class="btn btn-secondary h-8">
          {{ $t('admin.liveTv.channels.disallowKids') }}
        </button>
        <button type="button" @click="bulk({ pinned: true })" :disabled="!selected.size || busy" class="btn btn-secondary h-8" :title="$t('admin.liveTv.channels.alwaysShowHint')">
          <Pin class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.channels.alwaysShow') }}
        </button>
        <button type="button" @click="bulk({ pinned: false })" :disabled="!selected.size || busy" class="btn btn-secondary h-8" :title="$t('admin.liveTv.channels.followFiltersHint')">
          {{ $t('admin.liveTv.channels.followFilters') }}
        </button>
      </div>
    </div>

    <!-- The channels -->
    <p v-if="!channels.length" class="py-12 px-6 text-center text-xs" :class="loadError ? 'text-destructive' : 'text-muted-foreground'">
      <template v-if="loading">{{ $t('common.loading') }}</template>
      <template v-else-if="loadError">{{ loadError }}</template>
      <template v-else-if="query || status !== 'all' || sourceId">{{ $t('admin.liveTv.channels.noMatches') }}</template>
      <template v-else>{{ $t('admin.liveTv.channels.empty') }}</template>
    </p>
    <ul v-else class="divide-y divide-border" :class="loading ? 'opacity-60 transition-opacity' : ''">
      <li
        v-for="ch in channels"
        :key="ch.id"
        :class="['px-4 sm:px-5 py-2.5 flex items-center gap-3', selected.has(ch.id) ? 'bg-primary/[0.04]' : '']"
      >
        <input
          type="checkbox"
          :checked="selected.has(ch.id)"
          @change="toggleSelect(ch.id)"
          :aria-label="$t('admin.liveTv.channels.selectAria', { name: ch.name })"
          class="rounded border-border accent-primary h-4 w-4 flex-shrink-0"
        />
        <div class="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0 overflow-hidden" :class="ch.hidden ? 'opacity-50' : ''">
          <img v-if="ch.logo && !brokenLogos.has(ch.id)" :src="logoUrl(ch.logo)" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-contain p-1" @error="brokenLogos.add(ch.id)" />
          <Tv v-else class="w-4 h-4 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold truncate" :class="ch.hidden ? 'text-muted-foreground' : 'text-foreground'">{{ ch.name }}</p>
          <p class="text-[12px] text-muted-foreground truncate">
            <span v-if="ch.country" :title="countryName(ch.country)">{{ flagEmoji(ch.country) || ch.country }} </span>
            {{ details(ch) }}
          </p>
          <p v-if="ch.hidden || ch.kidsAllowed || ch.geoBlocked || ch.unsupported || (ch.filteredBy?.length && !ch.pinned)" class="flex flex-wrap items-center gap-1 mt-1">
            <span v-if="ch.unsupported" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400" :title="$t('admin.liveTv.channels.badges.unsupportedHint')">
              <Ban class="w-2.5 h-2.5" /> {{ $t('admin.liveTv.channels.badges.unsupported') }}
            </span>
            <span v-if="ch.hidden" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
              <EyeOff class="w-2.5 h-2.5" /> {{ $t('admin.liveTv.channels.badges.hidden') }}
            </span>
            <span v-if="ch.kidsAllowed" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-500">
              <Baby class="w-2.5 h-2.5" /> {{ $t('admin.liveTv.channels.badges.kids') }}
            </span>
            <span v-if="ch.geoBlocked" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground" :title="$t('admin.liveTv.channels.badges.geoBlockedHint')">
              <MapPinOff class="w-2.5 h-2.5" /> {{ $t('admin.liveTv.channels.badges.geoBlocked') }}
            </span>
            <!-- Hidden by a filter (and which), unless it's always shown -->
            <span
              v-if="ch.filteredBy?.length && !ch.pinned"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 max-w-full"
              :title="$t('admin.liveTv.channels.badges.filteredHint', { reasons: filterReasons(ch) })"
            >
              <Filter class="w-2.5 h-2.5 flex-shrink-0" />
              <span class="truncate">{{ $t('admin.liveTv.channels.badges.filtered', { reasons: filterReasons(ch) }) }}</span>
            </span>
          </p>
          <!-- The way back for one channel a filter hides: on (pressed) keeps it shown -->
          <button
            v-if="ch.filteredBy?.length || ch.pinned"
            type="button"
            @click="setOne(ch, { pinned: !ch.pinned })"
            :aria-pressed="String(!!ch.pinned)"
            :aria-label="$t('admin.liveTv.channels.pinAria', { name: ch.name })"
            :title="pinTitle(ch)"
            :class="['mt-1.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-medium transition', ch.pinned ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border bg-background text-foreground hover:bg-muted']"
          >
            <component :is="ch.pinned ? Check : Pin" class="w-3.5 h-3.5" />
            {{ $t('admin.liveTv.channels.alwaysShow') }}
          </button>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            @click="setOne(ch, { kidsAllowed: !ch.kidsAllowed })"
            :aria-pressed="String(!!ch.kidsAllowed)"
            :aria-label="$t(ch.kidsAllowed ? 'admin.liveTv.channels.disallowKidsAria' : 'admin.liveTv.channels.allowKidsAria', { name: ch.name })"
            :title="ch.kidsAllowed ? $t('admin.liveTv.channels.disallowKids') : $t('admin.liveTv.channels.allowKids')"
            :class="['btn btn-ghost btn-icon', ch.kidsAllowed ? 'text-sky-500 hover:text-sky-500' : '']"
          >
            <Baby class="w-4 h-4" />
          </button>
          <button
            type="button"
            @click="setOne(ch, { hidden: !ch.hidden })"
            :aria-label="$t(ch.hidden ? 'admin.liveTv.channels.showAria' : 'admin.liveTv.channels.hideAria', { name: ch.name })"
            :title="ch.hidden ? $t('admin.liveTv.channels.show') : $t('admin.liveTv.channels.hide')"
            class="btn btn-ghost btn-icon"
          >
            <EyeOff v-if="ch.hidden" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>

    <template v-if="total > PAGE_SIZE" #footer>
      <span class="text-[12px] text-muted-foreground tabular-nums">
        {{ $t('admin.liveTv.channels.range', { from: $n(offset + 1), to: $n(Math.min(offset + PAGE_SIZE, total)), total: $n(total) }) }}
      </span>
      <div class="flex items-center gap-1.5">
        <button type="button" @click="goTo(offset - PAGE_SIZE)" :disabled="offset === 0 || loading" class="btn btn-secondary h-8">
          <ChevronLeft class="w-3.5 h-3.5" /> {{ $t('common.previous') }}
        </button>
        <button type="button" @click="goTo(offset + PAGE_SIZE)" :disabled="offset + PAGE_SIZE >= total || loading" class="btn btn-secondary h-8">
          {{ $t('common.next') }} <ChevronRight class="w-3.5 h-3.5" />
        </button>
      </div>
    </template>
    <template v-else-if="total" #footer>
      <span class="text-[12px] text-muted-foreground">{{ $t('admin.liveTv.channelCount', { count: total, number: $n(total) }) }}</span>
    </template>
  </SettingsCard>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { Search, Eye, EyeOff, Baby, Tv, Ban, MapPinOff, ChevronLeft, ChevronRight, Filter, Pin, Check } from '@lucide/vue';
import api from '../../../api/client';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import SettingsCard from '../../settings/SettingsCard.vue';
import SaveStatus from '../../settings/SaveStatus.vue';
import { t, list, locale } from '../../../i18n';
import { logoUrl } from '../../live/liveFormat';
import { countryName, flagEmoji, languageName } from './liveNames';

const props = defineProps({
  sources: { type: Array, default: () => [] },
  // Changes when the channels may have changed elsewhere (a list loaded or removed).
  version: { type: Number, default: 0 }
});
// After a change has saved, so the "Showing … of …" count can look again.
const emit = defineEmits(['changed']);

const PAGE_SIZE = 100;
const save = useSaveStatus();

const statusFilters = computed(() => ['all', 'visible', 'hidden', 'filtered', 'pinned', 'kids', 'unsupported'].map((id) => ({
  id,
  label: t(`admin.liveTv.channels.status.${id}`)
})));

const query = ref('');
const sourceId = ref('');
const status = ref('all');
const offset = ref(0);

const channels = ref([]);
const total = ref(0);
const loading = ref(true);
const loadError = ref('');
const brokenLogos = reactive(new Set());

const sourceName = (id) => props.sources.find((s) => s.id === id)?.name || '';

// The line under a channel's name: its list (when showing several), languages and groups.
function details(ch) {
  locale.value; // names follow the UI language
  const parts = [];
  if (!sourceId.value && props.sources.length > 1) parts.push(sourceName(ch.sourceId));
  const languages = (ch.languages || []).map((code) => languageName(code));
  if (languages.length) parts.push(languages.join(', '));
  if (ch.groups?.length) parts.push(ch.groups.join(', '));
  return parts.filter(Boolean).join(' · ');
}

// What a filter hides a channel for, by name: "Spanish", "Shopping", "jmp2.uk", "Region-locked".
function filterLabel({ type, value }) {
  if (type === 'geoBlocked') return t('admin.liveTv.channels.badges.regionLocked');
  if (type === 'language') return languageName(value);
  if (type === 'country') return countryName(value);
  return String(value ?? '');
}
function pinTitle(ch) {
  if (!ch.pinned) return t('admin.liveTv.channels.alwaysShowHint');
  return ch.filteredBy?.length
    ? t('admin.liveTv.channels.badges.pinnedOverHint', { reasons: filterReasons(ch) })
    : t('admin.liveTv.channels.badges.pinnedHint');
}
function filterReasons(ch) {
  locale.value;
  const labels = [...new Set((ch.filteredBy || []).map(filterLabel).filter(Boolean))];
  return labels.length ? list(labels, { type: 'unit', style: 'short' }) : '';
}

// Only the newest request's answer is shown, so typing fast can't leave an older page up.
let requestId = 0;
async function load() {
  const mine = ++requestId;
  loading.value = true;
  try {
    const res = await api.get('/live/admin/channels', {
      params: {
        source: sourceId.value || undefined,
        q: query.value.trim() || undefined,
        status: status.value,
        offset: offset.value,
        limit: PAGE_SIZE
      }
    });
    if (mine !== requestId) return;
    channels.value = res.data.channels || [];
    total.value = res.data.total || 0;
    loadError.value = '';
    // Past the end (channels removed since): back to the last page that has any.
    if (!channels.value.length && offset.value > 0 && total.value > 0) {
      offset.value = Math.floor((total.value - 1) / PAGE_SIZE) * PAGE_SIZE;
      load();
    }
  } catch (err) {
    if (mine !== requestId) return;
    channels.value = [];
    total.value = 0;
    loadError.value = err.response?.data?.error || t('admin.liveTv.channels.couldNotLoad');
  } finally {
    if (mine === requestId) loading.value = false;
  }
}

function goTo(next) {
  offset.value = Math.max(0, next);
  load();
}

// A new search or filter starts from the first page with nothing ticked.
function restart() {
  offset.value = 0;
  selected.value = new Set();
  load();
}
let searchTimer = null;
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(restart, 300);
});
watch([sourceId, status], restart);
watch(() => props.version, load);
// A filtered source that's been removed falls back to all of them.
watch(() => props.sources, (list) => {
  if (sourceId.value && !list.some((s) => s.id === sourceId.value)) sourceId.value = '';
});
onMounted(load);
onUnmounted(() => clearTimeout(searchTimer));

// ─── Ticking ───────────────────────────────────────────────────────────────
// Kept across pages, so a selection can span several.
const selected = ref(new Set());
const allOnPageSelected = computed(() => channels.value.length > 0 && channels.value.every((c) => selected.value.has(c.id)));
const someOnPageSelected = computed(() => channels.value.some((c) => selected.value.has(c.id)));

function toggleSelect(id) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function toggleSelectPage() {
  const next = new Set(selected.value);
  const select = !allOnPageSelected.value;
  for (const c of channels.value) {
    if (select) next.add(c.id);
    else next.delete(c.id);
  }
  selected.value = next;
}

// ─── Changing channels (saves straight away) ───────────────────────────────
const busy = ref(false);

// Shown changed at once on this page; put back if the save fails.
async function apply(ids, patch) {
  const idSet = new Set(ids);
  const before = channels.value.filter((c) => idSet.has(c.id)).map((c) => ({ c, hidden: c.hidden, kidsAllowed: c.kidsAllowed, pinned: c.pinned }));
  for (const { c } of before) Object.assign(c, patch);
  const { ok } = await save.run(() => api.patch('/live/admin/channels', { ids, ...patch }));
  if (!ok) for (const { c, hidden, kidsAllowed, pinned } of before) Object.assign(c, { hidden, kidsAllowed, pinned });
  else if ('hidden' in patch || 'pinned' in patch) emit('changed');
  return ok;
}

function setOne(channel, patch) {
  apply([channel.id], patch);
}

async function bulk(patch) {
  busy.value = true;
  try {
    const ok = await apply([...selected.value], patch);
    // Under a filter the changed ones may no longer belong on the page.
    if (ok && status.value !== 'all') load();
  } finally {
    busy.value = false;
  }
}
</script>
