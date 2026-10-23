<template>
  <!-- One line-up: its name, whether kids may watch it, and its channels in order. Channels
       are added from a search or a whole category at once, and moved with up/down buttons
       (easier than dragging on a phone, and with a keyboard). Everything saves as it changes. -->
  <SettingsDialog :open="!!lineup" :title="lineup?.name || ''" :subtitle="$t('admin.liveTv.lineups.editor.subtitle')" width="sm:max-w-xl" @close="$emit('close')">
    <template v-if="lineup">
      <!-- Name and kids -->
      <div class="flex flex-col gap-3">
        <div>
          <label for="live-lineup-name" class="field-label">{{ $t('admin.liveTv.lineups.name') }}</label>
          <div class="flex items-center gap-2">
            <input
              id="live-lineup-name"
              v-model="name"
              maxlength="60"
              required
              class="field flex-1 min-w-0"
              @keydown.enter.prevent="rename"
              @blur="rename"
            />
          </div>
        </div>
        <ToggleRow
          :label="$t('admin.liveTv.lineups.kids.label')"
          :description="$t('admin.liveTv.lineups.kids.desc')"
          :icon="Baby"
          :model-value="!!lineup.kidsAllowed"
          @update:model-value="setKids"
        />
      </div>

      <!-- Its channels / adding more -->
      <div class="flex flex-col gap-3 min-h-0">
        <div class="grid grid-cols-2 p-0.5 rounded-lg bg-muted/60 border border-border text-xs" role="tablist">
          <button
            v-for="tb in modes"
            :key="tb.id"
            type="button"
            role="tab"
            :aria-selected="String(mode === tb.id)"
            @click="mode = tb.id"
            :class="['min-h-10 rounded-md font-medium transition flex items-center justify-center gap-1.5', mode === tb.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
          >
            <component :is="tb.icon" class="w-3.5 h-3.5" /> {{ tb.label }}
          </button>
        </div>

        <!-- ── The channels, in order ── -->
        <template v-if="mode === 'channels'">
          <p v-if="loading && !channels.length" class="py-8 text-center text-xs text-muted-foreground">{{ $t('common.loading') }}</p>
          <div v-else-if="loadError" class="py-6 text-center text-xs text-destructive flex flex-col items-center gap-2">
            <span>{{ loadError }}</span>
            <button type="button" @click="loadChannels" class="btn btn-secondary">{{ $t('common.retry') }}</button>
          </div>
          <div v-else-if="!channels.length" class="py-8 px-4 text-center text-xs text-muted-foreground flex flex-col items-center gap-3">
            <span>{{ $t('admin.liveTv.lineups.editor.empty') }}</span>
            <button type="button" @click="mode = 'add'" class="btn btn-primary">
              <Plus class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.editor.addChannels') }}
            </button>
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[12px] text-muted-foreground">{{ $t('admin.liveTv.channelCount', { count: channels.length, number: $n(channels.length) }) }}</span>
              <div class="flex items-center gap-1.5 ml-auto">
                <button type="button" @click="sortBy('name')" class="btn btn-secondary h-8">
                  <ArrowDownAZ class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.editor.sortName') }}
                </button>
                <button v-if="channels.some((c) => c.number)" type="button" @click="sortBy('number')" class="btn btn-secondary h-8">
                  <ArrowDown01 class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.editor.sortNumber') }}
                </button>
              </div>
            </div>
            <ol class="border border-border rounded-lg divide-y divide-border">
              <li v-for="(ch, i) in channels.slice(0, limit)" :key="ch.id" class="pl-3 pr-1.5 py-1.5 flex items-center gap-2.5">
                <span class="w-6 text-[11px] text-muted-foreground tabular-nums text-right flex-shrink-0" aria-hidden="true">{{ i + 1 }}</span>
                <div class="w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <img v-if="ch.logo && !brokenLogos.has(ch.id)" :src="logoUrl(ch.logo)" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-contain p-0.5" @error="brokenLogos.add(ch.id)" />
                  <Tv v-else class="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium truncate" :class="ch.hidden ? 'text-muted-foreground' : 'text-foreground'">
                    <span v-if="ch.number" class="font-mono text-muted-foreground mr-1">{{ ch.number }}</span>{{ displayName(ch) }}
                  </p>
                  <p v-if="unavailableReason(ch)" class="text-[11px] text-amber-600 dark:text-amber-400 truncate">{{ unavailableReason(ch) }}</p>
                </div>
                <div class="flex items-center flex-shrink-0">
                  <button type="button" @click="move(i, -1)" :disabled="i === 0" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.lineups.editor.moveUpAria', { name: displayName(ch) })" :title="$t('admin.liveTv.lineups.moveUp')">
                    <ChevronUp class="w-4 h-4" />
                  </button>
                  <button type="button" @click="move(i, 1)" :disabled="i === channels.length - 1" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.lineups.editor.moveDownAria', { name: displayName(ch) })" :title="$t('admin.liveTv.lineups.moveDown')">
                    <ChevronDown class="w-4 h-4" />
                  </button>
                  <button type="button" @click="remove(ch)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.liveTv.lineups.editor.removeAria', { name: displayName(ch) })" :title="$t('admin.liveTv.lineups.editor.remove')">
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </li>
            </ol>
            <button v-if="channels.length > limit" type="button" @click="limit += PAGE_SIZE" class="btn btn-secondary w-full h-10 justify-center">
              {{ $t('admin.liveTv.filters.more', { count: channels.length - limit, number: $n(channels.length - limit) }) }}
            </button>
          </template>
        </template>

        <!-- ── Adding channels ── -->
        <template v-else>
          <div class="flex items-center gap-1" role="tablist" :aria-label="$t('admin.liveTv.lineups.editor.addBy')">
            <button
              v-for="kind in addKinds"
              :key="kind.id"
              type="button"
              role="tab"
              :aria-selected="String(addKind === kind.id)"
              @click="addKind = kind.id"
              :class="['h-9 px-3 rounded-lg text-xs font-medium transition flex items-center gap-1.5', addKind === kind.id ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground']"
            >
              <component :is="kind.icon" class="w-3.5 h-3.5" /> {{ kind.label }}
            </button>
          </div>

          <div class="relative">
            <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              v-model="addQuery"
              type="search"
              :placeholder="$t(`admin.liveTv.lineups.editor.search.${addKind}`)"
              :aria-label="$t(`admin.liveTv.lineups.editor.search.${addKind}`)"
              class="field pl-8 h-10"
            />
          </div>

          <p v-if="addMessage" class="text-[12px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5" role="status">
            <Check class="w-3.5 h-3.5 flex-shrink-0" /> {{ addMessage }}
          </p>

          <!-- Channels by name -->
          <template v-if="addKind === 'search'">
            <p v-if="!addQuery.trim()" class="py-6 text-center text-xs text-muted-foreground">{{ $t('admin.liveTv.lineups.editor.searchHint') }}</p>
            <p v-else-if="searching && !results.length" class="py-6 text-center text-xs text-muted-foreground">{{ $t('common.loading') }}</p>
            <p v-else-if="!results.length" class="py-6 text-center text-xs text-muted-foreground">{{ $t('admin.liveTv.channels.noMatches') }}</p>
            <template v-else>
              <button v-if="addableResults.length > 1" type="button" @click="addIds(addableResults.map((c) => c.id))" :disabled="adding" class="btn btn-secondary h-9 self-start">
                <Plus class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.editor.addFound', { count: addableResults.length, number: $n(addableResults.length) }) }}
              </button>
              <ul class="border border-border rounded-lg divide-y divide-border" :class="searching ? 'opacity-60' : ''">
                <li v-for="ch in results" :key="ch.id" class="pl-3 pr-1.5 py-1.5 flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img v-if="ch.logo && !brokenLogos.has(ch.id)" :src="logoUrl(ch.logo)" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-contain p-0.5" @error="brokenLogos.add(ch.id)" />
                    <Tv v-else class="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-foreground truncate">{{ displayName(ch) }}</p>
                    <p class="text-[11px] truncate" :class="unavailableReason(ch) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">{{ unavailableReason(ch) || (ch.groups || []).join(', ') }}</p>
                  </div>
                  <span v-if="inLineup.has(ch.id)" class="h-9 px-3 text-[12px] text-muted-foreground flex items-center gap-1 flex-shrink-0">
                    <Check class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.editor.inLineup') }}
                  </span>
                  <button v-else type="button" @click="addIds([ch.id])" :disabled="adding || ch.unsupported" class="btn btn-secondary h-9 flex-shrink-0" :aria-label="$t('admin.liveTv.lineups.editor.addAria', { name: displayName(ch) })">
                    <Plus class="w-3.5 h-3.5" /> {{ $t('common.add') }}
                  </button>
                </li>
              </ul>
              <p v-if="resultsTotal > results.length" class="text-[12px] text-muted-foreground">{{ $t('admin.liveTv.lineups.editor.moreResults', { count: resultsTotal - results.length, number: $n(resultsTotal - results.length) }) }}</p>
            </template>
          </template>

          <!-- A whole category at once -->
          <template v-else>
            <p v-if="!categories && !categoriesError" class="py-6 text-center text-xs text-muted-foreground">{{ $t('common.loading') }}</p>
            <div v-else-if="categoriesError" class="py-6 text-center text-xs text-destructive flex flex-col items-center gap-2">
              <span>{{ categoriesError }}</span>
              <button type="button" @click="loadCategories" class="btn btn-secondary">{{ $t('common.retry') }}</button>
            </div>
            <p v-else-if="!matchingCategories.length" class="py-6 text-center text-xs text-muted-foreground">{{ $t('admin.liveTv.filters.noMatches') }}</p>
            <ul v-else class="border border-border rounded-lg divide-y divide-border">
              <li v-for="cat in matchingCategories.slice(0, 100)" :key="cat.id" class="pl-3 pr-1.5 py-1.5 flex items-center gap-2.5 min-h-[3rem]">
                <Tag class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium text-foreground truncate">{{ cat.id }}</p>
                  <p class="text-[11px] text-muted-foreground truncate">
                    {{ $t('admin.liveTv.channelCount', { count: cat.count || 0, number: $n(cat.count || 0) }) }}<template v-if="cat.hidden"> · {{ $t('admin.liveTv.lineups.editor.categoryHidden') }}</template>
                  </p>
                </div>
                <button type="button" @click="addCategory(cat.id)" :disabled="adding" class="btn btn-secondary h-9 flex-shrink-0" :aria-label="$t('admin.liveTv.lineups.editor.addCategoryAria', { name: cat.id })">
                  <Loader2 v-if="adding === cat.id" class="w-3.5 h-3.5 animate-spin" />
                  <Plus v-else class="w-3.5 h-3.5" />
                  {{ $t('admin.liveTv.lineups.editor.addAll') }}
                </button>
              </li>
            </ul>
          </template>
        </template>
      </div>
    </template>

    <template #footer>
      <button type="button" @click="removeLineup" class="btn btn-danger">
        <Trash2 class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.delete') }}
      </button>
      <span class="ml-auto"><SaveStatus :status="save.status.value" :message="save.message.value" /></span>
      <button type="button" @click="$emit('close')" class="btn btn-primary">{{ $t('common.done') }}</button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { Plus, Search, Tv, X, ChevronUp, ChevronDown, Check, Tag, Loader2, Trash2, Baby, ListOrdered, ArrowDownAZ, ArrowDown01 } from '@lucide/vue';
import api from '../../../api/client';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { useDialogStore } from '../../../stores/dialog';
import SettingsDialog from '../../settings/SettingsDialog.vue';
import SaveStatus from '../../settings/SaveStatus.vue';
import ToggleRow from '../../settings/ToggleRow.vue';
import { logoUrl } from '../../live/liveFormat';
import { t, n } from '../../../i18n';

const props = defineProps({
  // The line-up being edited ({ id, name, kidsAllowed, channelCount }); null when closed.
  lineup: { type: Object, default: null }
});
// changed: its name, kids choice or channels changed (patch for the list, if known).
// deleted: it was deleted.
const emit = defineEmits(['close', 'changed', 'deleted']);
const dialog = useDialogStore();
const save = useSaveStatus();

const PAGE_SIZE = 100;
const SEARCH_LIMIT = 50;
// Sent in batches the server takes comfortably.
const CHUNK = 500;

const modes = computed(() => [
  { id: 'channels', icon: ListOrdered, label: t('admin.liveTv.lineups.editor.tabs.channels') },
  { id: 'add', icon: Plus, label: t('admin.liveTv.lineups.editor.tabs.add') }
]);
const addKinds = computed(() => [
  { id: 'search', icon: Search, label: t('admin.liveTv.lineups.editor.kinds.search') },
  { id: 'categories', icon: Tag, label: t('admin.liveTv.lineups.editor.kinds.categories') }
]);

const name = ref('');
const mode = ref('channels');
const addKind = ref('search');
const addQuery = ref('');
const addMessage = ref('');
const limit = ref(PAGE_SIZE);

const channels = ref([]);
const loading = ref(false);
// The order waiting to be saved (see scheduleOrderSave).
let orderTimer = null;
let pendingOrder = null;
let orderChain = Promise.resolve();
const loadError = ref('');
const brokenLogos = reactive(new Set());
const inLineup = computed(() => new Set(channels.value.map((c) => c.id)));
// Search results for adding (see search()).
const results = ref([]);
const resultsTotal = ref(0);
const searching = ref(false);

const displayName = (ch) => ch.customName || ch.name;

// Why a channel in the line-up won't reach viewers, if it won't.
function unavailableReason(ch) {
  if (ch.unsupported) return t('admin.liveTv.channels.badges.unsupported');
  if (ch.hidden) return t('admin.liveTv.channels.badges.hidden');
  if (ch.health === 'offline') return t('admin.liveTv.channels.badges.offline');
  if (ch.filteredBy?.length && !ch.pinned) return t('admin.liveTv.lineups.editor.hiddenByFilter');
  return '';
}

watch(() => props.lineup?.id, (id) => {
  // A move waiting to save still saves, for the line-up it was made in.
  flushOrder();
  if (!id) return;
  name.value = props.lineup.name;
  mode.value = 'channels';
  addKind.value = 'search';
  addQuery.value = '';
  addMessage.value = '';
  limit.value = PAGE_SIZE;
  channels.value = [];
  results.value = [];
  loadChannels();
}, { immediate: true });

async function loadChannels() {
  const id = props.lineup?.id;
  if (!id) return;
  loading.value = true;
  try {
    const res = await api.get(`/live/admin/lineups/${id}/channels`);
    if (props.lineup?.id !== id) return;
    channels.value = res.data.channels || [];
    loadError.value = '';
  } catch (err) {
    loadError.value = err.response?.data?.error || t('admin.liveTv.lineups.couldNotLoadChannels');
  } finally {
    loading.value = false;
  }
}

// ─── Name and kids ─────────────────────────────────────────────────────────
async function rename() {
  const next = name.value.trim();
  const lineup = props.lineup;
  if (!lineup) return;
  if (!next) {
    name.value = lineup.name;
    return;
  }
  if (next === lineup.name) return;
  const { ok } = await save.run(() => api.patch(`/live/admin/lineups/${lineup.id}`, { name: next }));
  if (ok) emit('changed', { id: lineup.id, name: next });
  else name.value = lineup.name;
}

async function setKids(value) {
  const lineup = props.lineup;
  const { ok } = await save.run(() => api.patch(`/live/admin/lineups/${lineup.id}`, { kidsAllowed: value }));
  if (ok) emit('changed', { id: lineup.id, kidsAllowed: value });
}

// ─── Order ─────────────────────────────────────────────────────────────────
// Moves show at once; the new order is saved shortly after the last one, so pressing
// a button several times in a row is one save.
function scheduleOrderSave() {
  clearTimeout(orderTimer);
  const id = props.lineup.id;
  const run = () => {
    orderTimer = null;
    pendingOrder = null;
    const ids = channels.value.map((c) => c.id);
    orderChain = orderChain.then(async () => {
      const { ok } = await save.run(() => api.put(`/live/admin/lineups/${id}/channels`, { ids }));
      // The server's order is the truth when a save fails.
      if (!ok && props.lineup?.id === id) loadChannels();
    });
  };
  pendingOrder = run;
  orderTimer = setTimeout(run, 600);
}
// Saves a waiting order now; resolves once every order save has finished, so an add or
// a remove never races one (a replace sent after an add would drop what was added).
function flushOrder() {
  if (pendingOrder) {
    clearTimeout(orderTimer);
    pendingOrder();
  }
  return orderChain;
}
onUnmounted(() => flushOrder());

function move(index, by) {
  const to = index + by;
  if (to < 0 || to >= channels.value.length) return;
  const next = [...channels.value];
  [next[index], next[to]] = [next[to], next[index]];
  channels.value = next;
  scheduleOrderSave();
}

function sortBy(key) {
  const next = [...channels.value];
  if (key === 'number') {
    // Numbered channels first, by number; the rest keep their order after them.
    next.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
  } else {
    next.sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true, sensitivity: 'base' }));
  }
  channels.value = next;
  scheduleOrderSave();
}

async function remove(ch) {
  const id = props.lineup.id;
  await flushOrder();
  const before = channels.value;
  channels.value = channels.value.filter((c) => c.id !== ch.id);
  const { ok } = await save.run(() => api.delete(`/live/admin/lineups/${id}/channels`, { data: { ids: [ch.id] } }));
  if (!ok) channels.value = before;
  else emit('changed', { id, channelCount: channels.value.length });
}

// ─── Adding by search ──────────────────────────────────────────────────────
const addableResults = computed(() => results.value.filter((c) => !inLineup.value.has(c.id) && !c.unsupported));

let searchTimer = null;
let searchId = 0;
watch(addQuery, () => {
  addMessage.value = '';
  clearTimeout(searchTimer);
  if (addKind.value === 'search') searchTimer = setTimeout(search, 300);
});
watch(addKind, (kind) => {
  addQuery.value = '';
  addMessage.value = '';
  if (kind === 'categories' && !categories.value) loadCategories();
});
onUnmounted(() => clearTimeout(searchTimer));

async function search() {
  const q = addQuery.value.trim();
  const mine = ++searchId;
  if (!q) {
    results.value = [];
    resultsTotal.value = 0;
    return;
  }
  searching.value = true;
  try {
    const res = await api.get('/live/admin/channels', { params: { q, status: 'all', offset: 0, limit: SEARCH_LIMIT } });
    if (mine !== searchId) return;
    results.value = res.data.channels || [];
    resultsTotal.value = res.data.total || 0;
  } catch (err) {
    if (mine === searchId) results.value = [];
  } finally {
    if (mine === searchId) searching.value = false;
  }
}

// ─── Adding a whole category ───────────────────────────────────────────────
const categories = ref(null);
const categoriesError = ref('');
const matchingCategories = computed(() => {
  const q = addQuery.value.trim().toLowerCase();
  const list = (categories.value || []).filter((c) => c.id);
  return q ? list.filter((c) => c.id.toLowerCase().includes(q)) : list;
});

async function loadCategories() {
  categoriesError.value = '';
  try {
    const res = await api.get('/live/admin/filters');
    categories.value = res.data?.facets?.groups || [];
  } catch (err) {
    categoriesError.value = err.response?.data?.error || t('admin.liveTv.filters.couldNotLoad');
  }
}

// Every playable channel in the category that isn't hidden by hand, a page at a time.
async function categoryChannelIds(group) {
  const ids = [];
  const pageSize = 500;
  for (let offset = 0, total = Infinity; offset < total && offset < 20000; offset += pageSize) {
    const res = await api.get('/live/admin/channels', { params: { group, status: 'all', offset, limit: pageSize } });
    total = res.data.total || 0;
    const page = res.data.channels || [];
    for (const ch of page) {
      // Checked here too, so only that category's channels are ever added.
      if ((ch.groups || []).includes(group) && !ch.unsupported && !ch.hidden) ids.push(ch.id);
    }
    if (page.length < pageSize) break;
  }
  return ids;
}

async function addCategory(group) {
  adding.value = group;
  addMessage.value = '';
  try {
    const ids = (await categoryChannelIds(group)).filter((id) => !inLineup.value.has(id));
    if (!ids.length) {
      addMessage.value = t('admin.liveTv.lineups.editor.nothingNew');
      return;
    }
    await addIds(ids, { busy: false });
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.lineups.couldNotAdd'));
  } finally {
    adding.value = false;
  }
}

// ─── Adding ────────────────────────────────────────────────────────────────
// false, true, or the category being added (for its spinner).
const adding = ref(false);

async function addIds(ids, { busy = true } = {}) {
  const id = props.lineup.id;
  const fresh = ids.filter((x) => !inLineup.value.has(x));
  if (!fresh.length) return;
  await flushOrder();
  if (busy) adding.value = true;
  addMessage.value = '';
  let added = 0;
  try {
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const { ok } = await save.run(() => api.post(`/live/admin/lineups/${id}/channels`, { ids: chunk }));
      if (!ok) break;
      added += chunk.length;
    }
  } finally {
    if (busy) adding.value = false;
  }
  if (!added) return;
  addMessage.value = t('admin.liveTv.lineups.editor.added', { count: added, number: n(added) });
  await loadChannels();
  emit('changed', { id, channelCount: channels.value.length });
}

// ─── Deleting ──────────────────────────────────────────────────────────────
async function removeLineup() {
  const lineup = props.lineup;
  const confirmed = await dialog.confirm({
    title: t('admin.liveTv.lineups.deleteTitle'),
    message: t('admin.liveTv.lineups.deleteMessage', { name: lineup.name }),
    confirmText: t('common.delete'),
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/live/admin/lineups/${lineup.id}`);
    emit('deleted', lineup.id);
    emit('close');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.lineups.couldNotDelete'));
  }
}
</script>
