<template>
  <SectionHeader :title="$t('settings.shelves.title')" :description="$t('settings.shelves.description')">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <SettingsCard :title="$t('settings.shelves.mediaTypes.title')" :description="$t('settings.shelves.mediaTypes.desc')">
    <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2.5">
      <label
        v-for="cat in mediaCategories"
        :key="cat.id"
        :class="[
          'flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none',
          prefs.enabledMediaTypes.includes(cat.id) ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/20'
        ]"
      >
        <input type="checkbox" :value="cat.id" v-model="prefs.enabledMediaTypes" class="rounded border-border accent-primary focus:ring-ring" />
        <component :is="cat.icon" class="w-4.5 h-4.5 text-muted-foreground flex-shrink-0" />
        <span class="flex flex-col min-w-0">
          <span class="text-xs font-semibold text-foreground">{{ cat.label }}</span>
          <span class="text-[12px] text-muted-foreground truncate">{{ cat.desc }}</span>
        </span>
      </label>
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('settings.shelves.startOn.title')" :description="$t('settings.shelves.startOn.desc')">
    <OptionTiles
      :label="$t('settings.shelves.startOn.title')"
      :options="startupOptions"
      v-model="prefs.defaultView"
      grid-class="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-7 gap-2.5"
    />
  </SettingsCard>

  <SettingsCard :title="$t('settings.shelves.homeRows.title')" :description="$t('settings.shelves.homeRows.desc')">
    <ul class="divide-y divide-border">
      <li v-for="(row, index) in homeRowList" :key="row.id" class="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
        <div class="flex flex-col">
          <button
            type="button"
            class="w-7 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition disabled:opacity-30 disabled:pointer-events-none"
            :disabled="index === 0"
            :aria-label="$t('settings.shelves.homeRows.moveUp', { row: row.label })"
            :title="$t('settings.shelves.homeRows.moveUp', { row: row.label })"
            @click="moveHomeRow(index, -1)"
          >
            <ChevronUp class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="w-7 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition disabled:opacity-30 disabled:pointer-events-none"
            :disabled="index === homeRowList.length - 1"
            :aria-label="$t('settings.shelves.homeRows.moveDown', { row: row.label })"
            :title="$t('settings.shelves.homeRows.moveDown', { row: row.label })"
            @click="moveHomeRow(index, 1)"
          >
            <ChevronDown class="w-4 h-4" />
          </button>
        </div>
        <ToggleRow
          class="flex-1 min-w-0 !py-0"
          :icon="row.icon"
          :label="row.label"
          :description="row.desc"
          :model-value="row.id === 'live' ? liveStore.prefs.showOnHome : !prefs.homeRows.hidden.includes(row.id)"
          @update:model-value="showHomeRow(row.id, $event)"
        />
      </li>
    </ul>
  </SettingsCard>

  <SettingsCard :title="$t('settings.shelves.views.title')" :description="$t('settings.shelves.views.desc')">
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="mode in availableFilterModes"
        :key="mode.id"
        :label="mode.label"
        :model-value="mode.allowed && prefs.enabledGroupingModes.includes(mode.id)"
        :disabled="!mode.allowed || mode.always"
        @update:model-value="toggleMode(mode.id, $event)"
      >
        <span v-if="!mode.allowed" class="inline-flex items-center gap-1"><Lock class="w-3 h-3" /> {{ $t('settings.shelves.views.offByAdmin') }}</span>
        <template v-else>{{ mode.desc }}</template>
      </ToggleRow>
    </div>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Lock, LayoutGrid, ChevronUp, ChevronDown, Tv, MonitorPlay, Clock } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useCustomizationStore } from '../../../stores/customization';
import { useLiveStore } from '../../../stores/live';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { ALL_MEDIA_TYPES } from '../../../constants/media';
import { SHELF_MODES, normalizeShelfModes, userShelfModes } from '../../../utils/shelfModes';
import { homeRowOrder, hiddenHomeRows } from '../../../utils/homeRows';
import { MEDIA_TYPE_INFO, MEDIA_TYPE_ORDER } from '../../../utils/settingsFormat';
import { t } from '../../../i18n';
import OptionTiles from '../../OptionTiles.vue';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import ToggleRow from '../ToggleRow.vue';
import SaveStatus from '../SaveStatus.vue';

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const liveStore = useLiveStore();
const save = useSaveStatus();

// Mapped inside a computed: spreading the getters copies the wording of the moment.
const mediaCategories = computed(() => MEDIA_TYPE_ORDER.map((id) => ({ id, ...MEDIA_TYPE_INFO[id] })));

const stored = authStore.user?.preferences || {};
const prefs = ref({
  enabledMediaTypes: stored.enabledMediaTypes || ALL_MEDIA_TYPES,
  enabledGroupingModes: userShelfModes(stored.enabledGroupingModes),
  defaultView: stored.defaultView || 'all',
  homeRows: { order: homeRowOrder(stored.homeRows), hidden: hiddenHomeRows(stored.homeRows) }
});
let savedPrefs = JSON.stringify(prefs.value);

// "All" plus each type that's switched on.
const startupOptions = computed(() => [
  { id: 'all', label: t('settings.shelves.startOn.all'), icon: LayoutGrid },
  ...mediaCategories.value.filter((c) => prefs.value.enabledMediaTypes.includes(c.id)).map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
]);

// The rows above the shelf on Home. Live TV's is only offered where there are channels to watch.
const HOME_ROW_ICONS = { live: Tv, watching: MonitorPlay, reading: Clock };
const homeRowList = computed(() => prefs.value.homeRows.order
  .filter((id) => id !== 'live' || customizationStore.showLiveTv)
  .map((id) => ({
    id,
    icon: HOME_ROW_ICONS[id],
    label: t(`settings.shelves.homeRows.rows.${id}.label`),
    desc: t(`settings.shelves.homeRows.rows.${id}.desc`)
  })));

// Swaps a row with its neighbour in the list as shown, wherever a row not on offer sits.
function moveHomeRow(index, step) {
  const from = homeRowList.value[index];
  const to = homeRowList.value[index + step];
  if (!from || !to) return;
  const order = [...prefs.value.homeRows.order];
  const a = order.indexOf(from.id);
  const b = order.indexOf(to.id);
  [order[a], order[b]] = [order[b], order[a]];
  prefs.value.homeRows.order = order;
}

function showHomeRow(id, on) {
  // Live TV's row has had its own switch since before this card; this is the same one.
  if (id === 'live') {
    save.run(() => liveStore.setShowOnHome(on));
    return;
  }
  const hidden = new Set(prefs.value.homeRows.hidden);
  if (on) hidden.delete(id);
  else hidden.add(id);
  prefs.value.homeRows.hidden = [...hidden];
}

const allowedFilters = ref([...SHELF_MODES]);
const allFilterModes = [
  { id: 'series', key: 'alphabetical', always: true },
  { id: 'creator', key: 'creator' },
  { id: 'disk_folder', key: 'diskFolders' },
  { id: 'custom_folder', key: 'customFolders' }
];
const availableFilterModes = computed(() => {
  const serverModes = normalizeShelfModes(allowedFilters.value);
  return allFilterModes.map((m) => ({
    ...m,
    label: t(`settings.shelves.views.modes.${m.key}.label`),
    desc: t(`settings.shelves.views.modes.${m.key}.desc`),
    allowed: serverModes.includes(m.id)
  }));
});

function toggleMode(id, on) {
  const modes = new Set(prefs.value.enabledGroupingModes);
  if (on) modes.add(id);
  else modes.delete(id);
  prefs.value.enabledGroupingModes = [...modes];
}

onMounted(async () => {
  customizationStore.loadLiveStatus(authStore.user?.id);
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) allowedFilters.value = res.data.allowedGroupingModes;
  } catch (err) {
    console.warn('Could not load the server\'s shelf views:', err);
  }
});

// Saves a moment after each change.
let timer = null;
// Saves can overlap; only the newest one's answer is kept as what the server has.
let saveId = 0;
watch(prefs, (value) => {
  if (!value.enabledMediaTypes?.length) {
    // Keep at least one type: undo the last untick.
    prefs.value.enabledMediaTypes = JSON.parse(savedPrefs).enabledMediaTypes || ALL_MEDIA_TYPES;
    return;
  }
  if (value.defaultView !== 'all' && !value.enabledMediaTypes.includes(value.defaultView)) {
    prefs.value.defaultView = 'all';
    return;
  }
  if (JSON.stringify(value) === savedPrefs) return;
  clearTimeout(timer);
  timer = setTimeout(savePreferences, 400);
}, { deep: true });

async function savePreferences() {
  const id = ++saveId;
  const sent = JSON.stringify(prefs.value);
  // Alphabetical can't be switched off, so there's always a view.
  const body = {
    ...prefs.value,
    enabledGroupingModes: [...new Set(['series', ...(prefs.value.enabledGroupingModes || [])])]
  };
  const { ok, data } = await save.run(() => api.patch('/users/preferences', body));
  if (!ok || id !== saveId) return;
  // Keep what the server stored (these keys merged into the rest), not just this screen's
  // keys: dropping `onboardingComplete` would pop the onboarding flow open on the spot.
  if (authStore.user) {
    authStore.user.preferences = data.data.preferences || { ...authStore.user.preferences, ...body };
    authStore.persistUser();
  }
  savedPrefs = sent;
}
</script>
