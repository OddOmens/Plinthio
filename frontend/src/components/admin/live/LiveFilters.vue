<template>
  <!-- Admin → Live TV → Choose what to show: hide whole sets of channels at once (a category,
       a language, a country, a stream host). They're rules rather than deletions, so they
       still apply after the 12-hourly reloads; a single channel can be kept with "Always show"
       in the channel manager. -->
  <SettingsCard :title="$t('admin.liveTv.filters.title')" :description="$t('admin.liveTv.filters.desc')" flush>
    <template #actions><SaveStatus :status="save.status.value" :message="save.message.value" /></template>

    <div v-if="!data" class="py-10 px-6 text-center text-xs flex flex-col items-center gap-3" :class="loadError ? 'text-destructive' : 'text-muted-foreground'">
      <template v-if="loadError">
        <span>{{ loadError }}</span>
        <button type="button" @click="load" class="btn btn-secondary">{{ $t('common.retry') }}</button>
      </template>
      <span v-else>{{ $t('common.loading') }}</span>
    </div>

    <template v-else>
      <!-- How many get through -->
      <div class="px-4 sm:px-5 py-3.5 border-b border-border">
        <p class="text-xs font-semibold text-foreground tabular-nums" role="status">
          <template v-if="totals.channels">{{ $t('admin.liveTv.filters.summary', { count: totals.channels, number: $n(totals.channels), visible: $n(totals.visible) }) }}</template>
          <template v-else>{{ $t('admin.liveTv.filters.noChannels') }}</template>
        </p>
        <div v-if="totals.channels" class="mt-2 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
          <div class="h-full rounded-full bg-primary transition-[width]" :style="{ width: `${Math.round((totals.visible / totals.channels) * 100)}%` }" />
        </div>
      </div>

      <!-- Region-locked channels -->
      <div class="px-4 sm:px-5 py-3.5 border-b border-border">
        <ToggleRow
          :label="$t('admin.liveTv.filters.geoBlocked.label')"
          :description="$t('admin.liveTv.filters.geoBlocked.desc', { count: data.geoBlocked || 0, number: $n(data.geoBlocked || 0) })"
          :icon="MapPinOff"
          :model-value="hideGeoBlocked"
          @update:model-value="setGeoBlocked"
        />
      </div>

      <!-- Categories / Languages / Countries / Stream hosts -->
      <div class="px-4 sm:px-5 pt-3.5 pb-3 flex flex-col gap-3 border-b border-border">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border" role="tablist" :aria-label="$t('admin.liveTv.filters.hideBy')">
          <button
            v-for="tb in tabs"
            :key="tb.id"
            type="button"
            role="tab"
            :aria-selected="String(tab === tb.id)"
            @click="tab = tb.id"
            :class="['min-h-10 px-2 rounded-md text-xs font-medium transition flex items-center justify-center gap-1.5', tab === tb.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            <component :is="tb.icon" class="w-3.5 h-3.5 flex-shrink-0" />
            <span class="truncate">{{ tb.label }}</span>
            <span v-if="tb.hidden" class="px-1.5 py-px rounded-full text-[10px] font-semibold bg-muted-foreground/15 text-muted-foreground tabular-nums flex-shrink-0" :title="$t('admin.liveTv.filters.hiddenCount', { count: tb.hidden, number: $n(tb.hidden) })">
              {{ $n(tb.hidden) }}
            </span>
          </button>
        </div>

        <p class="text-[12px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
          <Info class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>{{ $t(`admin.liveTv.filters.hints.${tab}`) }}</span>
        </p>

        <div class="relative">
          <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            v-model="query"
            type="search"
            :placeholder="$t(`admin.liveTv.filters.search.${tab}`)"
            :aria-label="$t(`admin.liveTv.filters.search.${tab}`)"
            class="field pl-8 h-10"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-lg border border-border" role="tablist" :aria-label="$t('admin.liveTv.filters.showing.label')">
            <button
              v-for="f in showFilters"
              :key="f.id"
              type="button"
              role="tab"
              :aria-selected="String(show === f.id)"
              @click="show = f.id"
              :class="['px-3 h-8 rounded-md transition text-[12px] whitespace-nowrap', show === f.id ? 'bg-card text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >{{ f.label }} <span class="tabular-nums opacity-70">{{ $n(f.count) }}</span></button>
          </div>
          <div class="flex items-center gap-1.5 ml-auto">
            <button type="button" @click="setMany(true)" :disabled="!matching.some((r) => r.hidden)" class="btn btn-secondary h-9">
              <Eye class="w-3.5 h-3.5" />
              {{ query.trim() ? $t('admin.liveTv.filters.showMatching', { count: matching.length, number: $n(matching.length) }) : $t('admin.liveTv.filters.showAll') }}
            </button>
            <button type="button" @click="setMany(false)" :disabled="!matching.some((r) => !r.hidden)" class="btn btn-secondary h-9">
              <EyeOff class="w-3.5 h-3.5" />
              {{ query.trim() ? $t('admin.liveTv.filters.hideMatching', { count: matching.length, number: $n(matching.length) }) : $t('admin.liveTv.filters.hideAll') }}
            </button>
          </div>
        </div>
        <p v-if="!query.trim() && rows.length > 3" class="text-[12px] text-muted-foreground">{{ $t('admin.liveTv.filters.tip') }}</p>
      </div>

      <!-- One row per set: tap anywhere on it to show or hide -->
      <p v-if="!matching.length" class="py-10 px-6 text-center text-xs text-muted-foreground">
        {{ rows.length ? $t('admin.liveTv.filters.noMatches') : $t(`admin.liveTv.filters.empty.${tab}`) }}
      </p>
      <ul v-else class="divide-y divide-border">
        <li v-for="row in matching.slice(0, limit)" :key="row.value">
          <button
            type="button"
            role="switch"
            :aria-checked="String(!row.hidden)"
            :aria-label="row.label"
            @click="setOne(row, row.hidden)"
            class="w-full min-h-[3.25rem] px-4 sm:px-5 py-2 flex items-center gap-3 text-left transition hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
          >
            <span v-if="tab === 'countries'" class="w-6 text-lg leading-none text-center flex-shrink-0" :class="row.hidden ? 'opacity-40 grayscale' : ''" aria-hidden="true">{{ row.flag || '🏳️' }}</span>
            <span class="min-w-0 flex-1">
              <span :class="['block text-xs font-semibold truncate', tab === 'hosts' ? 'font-mono' : '', row.hidden ? 'text-muted-foreground' : 'text-foreground']">{{ row.label }}</span>
              <span class="block text-[12px] text-muted-foreground tabular-nums truncate">
                {{ $t('admin.liveTv.channelCount', { count: row.count, number: $n(row.count) }) }}<template v-if="row.detail"> · {{ row.detail }}</template>
                <template v-if="row.hidden"> · {{ $t('admin.liveTv.filters.hiddenLabel') }}</template>
              </span>
            </span>
            <span
              :class="['relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors', row.hidden ? 'bg-muted-foreground/30' : 'bg-primary']"
              aria-hidden="true"
            >
              <span class="inline-block h-5 w-5 rounded-full shadow-sm transition-transform" :class="row.hidden ? 'translate-x-0.5 bg-white' : 'translate-x-[18px] bg-primary-foreground'" />
            </span>
          </button>
        </li>
      </ul>

      <div v-if="matching.length > limit" class="px-4 sm:px-5 py-3 border-t border-border">
        <button type="button" @click="limit += PAGE_SIZE" class="btn btn-secondary w-full h-10 justify-center">
          {{ $t('admin.liveTv.filters.more', { count: matching.length - limit, number: $n(matching.length - limit) }) }}
        </button>
      </div>
    </template>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Search, Eye, EyeOff, Info, MapPinOff, Tag, Languages, Flag, Server } from '@lucide/vue';
import api from '../../../api/client';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import SettingsCard from '../../settings/SettingsCard.vue';
import SaveStatus from '../../settings/SaveStatus.vue';
import ToggleRow from '../../settings/ToggleRow.vue';
import { t, locale } from '../../../i18n';
import { countryName, flagEmoji, languageName } from './liveNames';

const props = defineProps({
  // Changes when the channels may have changed elsewhere (a list loaded or removed), so the counts reload.
  version: { type: Number, default: 0 }
});
// After a change has saved, so the channel manager and the menu can look again.
const emit = defineEmits(['changed']);

const PAGE_SIZE = 50;
const save = useSaveStatus();

// Each kind of set: where the server lists it (facets.<id>), the filters key that holds the
// hidden ones, and which field of a facet is its value.
const KINDS = {
  groups: { key: 'hiddenGroups', value: (f) => f.id, icon: Tag },
  languages: { key: 'hiddenLanguages', value: (f) => f.code, icon: Languages },
  countries: { key: 'hiddenCountries', value: (f) => f.code, icon: Flag },
  hosts: { key: 'hiddenHosts', value: (f) => f.host, icon: Server }
};

const data = ref(null);
const loadError = ref('');
const hideGeoBlocked = ref(true);
// kind → Set of hidden values, changed at once on a tap and saved behind it.
const hidden = ref({ groups: new Set(), languages: new Set(), countries: new Set(), hosts: new Set() });

const tab = ref('groups');
const query = ref('');
const show = ref('all');
const limit = ref(PAGE_SIZE);
watch([tab, query, show], () => { limit.value = PAGE_SIZE; });
watch(tab, () => { query.value = ''; show.value = 'all'; });

const totals = computed(() => data.value?.totals || { channels: 0, visible: 0 });

// Take the server's answer as the truth. A facet the server marks hidden counts as hidden
// even when it isn't in the saved lists (a default the server applies itself).
function adopt(body) {
  data.value = body;
  const filters = body?.filters || {};
  hideGeoBlocked.value = filters.hideGeoBlocked !== false;
  const next = {};
  for (const [kind, { key, value }] of Object.entries(KINDS)) {
    next[kind] = new Set([
      ...(Array.isArray(filters[key]) ? filters[key] : []),
      ...(body?.facets?.[kind] || []).filter((f) => f.hidden).map(value)
    ]);
  }
  hidden.value = next;
}

async function load() {
  if (pending) return;
  try {
    const res = await api.get('/live/admin/filters');
    if (pending) return;
    adopt(res.data);
    loadError.value = '';
  } catch (err) {
    if (!data.value) loadError.value = err.response?.data?.error || t('admin.liveTv.filters.couldNotLoad');
  }
}
watch(() => props.version, load);
onMounted(load);

// ─── The rows of the open tab ──────────────────────────────────────────────
const rows = computed(() => {
  locale.value; // names follow the UI language
  const kind = tab.value;
  const { value } = KINDS[kind];
  const set = hidden.value[kind];
  return (data.value?.facets?.[kind] || [])
    .filter((f) => value(f))
    .map((f) => {
      const v = value(f);
      const row = { value: v, count: f.count || 0, hidden: set.has(v), label: v, detail: '', search: [v] };
      if (kind === 'countries') {
        row.label = countryName(v);
        row.flag = flagEmoji(v);
      } else if (kind === 'languages') {
        row.label = languageName(v, f.name);
        // The English name too, when the UI shows another, so it's findable either way.
        if (f.name && f.name !== row.label) row.search.push(f.name);
      }
      row.search.push(row.label);
      row.search = row.search.join('\n').toLowerCase();
      return row;
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

const searched = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? rows.value.filter((r) => r.search.includes(q)) : rows.value;
});
const matching = computed(() => {
  if (show.value === 'shown') return searched.value.filter((r) => !r.hidden);
  if (show.value === 'hidden') return searched.value.filter((r) => r.hidden);
  return searched.value;
});

const showFilters = computed(() => {
  const hiddenCount = searched.value.filter((r) => r.hidden).length;
  return [
    { id: 'all', label: t('admin.liveTv.filters.showing.all'), count: searched.value.length },
    { id: 'shown', label: t('admin.liveTv.filters.showing.shown'), count: searched.value.length - hiddenCount },
    { id: 'hidden', label: t('admin.liveTv.filters.showing.hidden'), count: hiddenCount }
  ];
});

const tabs = computed(() => Object.entries(KINDS).map(([id, { icon, value }]) => {
  const values = new Set((data.value?.facets?.[id] || []).map(value));
  return {
    id,
    icon,
    label: t(`admin.liveTv.filters.tabs.${id}`),
    hidden: [...hidden.value[id]].filter((v) => values.has(v)).length
  };
}));

// ─── Saving ────────────────────────────────────────────────────────────────
// Saves go one after another, each carrying the whole list as it stood when it was made,
// so the last one wins. Once none are waiting, the newest answer from the server is
// shown — which also undoes a change that failed.
let chain = Promise.resolve();
let pending = 0;
let confirmed = null;
let anySaved = false;

function persist(patch) {
  pending++;
  chain = chain.then(async () => {
    const { ok, data: res } = await save.run(() => api.patch('/live/admin/filters', patch));
    if (ok && res?.data) {
      confirmed = res.data;
      anySaved = true;
    }
    if (--pending === 0) {
      if (confirmed) adopt(confirmed);
      if (anySaved) emit('changed');
      confirmed = null;
      anySaved = false;
    }
  });
}

function changeKind(kind, values, makeVisible) {
  const next = new Set(hidden.value[kind]);
  for (const v of values) {
    if (makeVisible) next.delete(v);
    else next.add(v);
  }
  hidden.value = { ...hidden.value, [kind]: next };
  if (!confirmed) confirmed = data.value;
  persist({ [KINDS[kind].key]: [...next] });
}

function setOne(row, makeVisible) {
  changeKind(tab.value, [row.value], makeVisible);
}

// Show all / Hide all: the rows the search and the Showing/Hidden choice leave in view.
function setMany(makeVisible) {
  const values = matching.value.filter((r) => r.hidden === makeVisible).map((r) => r.value);
  if (values.length) changeKind(tab.value, values, makeVisible);
}

function setGeoBlocked(value) {
  hideGeoBlocked.value = value;
  if (!confirmed) confirmed = data.value;
  persist({ hideGeoBlocked: value });
}
</script>
