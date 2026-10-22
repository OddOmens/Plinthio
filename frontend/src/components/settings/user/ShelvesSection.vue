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
import { Lock, LayoutGrid } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { ALL_MEDIA_TYPES } from '../../../constants/media';
import { SHELF_MODES, normalizeShelfModes, userShelfModes } from '../../../utils/shelfModes';
import { MEDIA_TYPE_INFO, MEDIA_TYPE_ORDER } from '../../../utils/settingsFormat';
import { t } from '../../../i18n';
import OptionTiles from '../../OptionTiles.vue';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import ToggleRow from '../ToggleRow.vue';
import SaveStatus from '../SaveStatus.vue';

const authStore = useAuthStore();
const save = useSaveStatus();

// Mapped inside a computed: spreading the getters copies the wording of the moment.
const mediaCategories = computed(() => MEDIA_TYPE_ORDER.map((id) => ({ id, ...MEDIA_TYPE_INFO[id] })));

const stored = authStore.user?.preferences || {};
const prefs = ref({
  enabledMediaTypes: stored.enabledMediaTypes || ALL_MEDIA_TYPES,
  enabledGroupingModes: userShelfModes(stored.enabledGroupingModes),
  defaultView: stored.defaultView || 'all'
});
let savedPrefs = JSON.stringify(prefs.value);

// "All" plus each type that's switched on.
const startupOptions = computed(() => [
  { id: 'all', label: t('settings.shelves.startOn.all'), icon: LayoutGrid },
  ...mediaCategories.value.filter((c) => prefs.value.enabledMediaTypes.includes(c.id)).map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
]);

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
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) allowedFilters.value = res.data.allowedGroupingModes;
  } catch (err) {
    console.warn('Could not load the server\'s shelf views:', err);
  }
});

// Saves a moment after each change.
let timer = null;
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
  // Alphabetical can't be switched off, so there's always a view.
  const body = {
    ...prefs.value,
    enabledGroupingModes: [...new Set(['series', ...(prefs.value.enabledGroupingModes || [])])]
  };
  const { ok, data } = await save.run(() => api.patch('/users/preferences', body));
  if (!ok) return;
  // Keep what the server stored (these keys merged into the rest), not just this screen's
  // keys: dropping `onboardingComplete` would pop the onboarding flow open on the spot.
  if (authStore.user) {
    authStore.user.preferences = data.data.preferences || { ...authStore.user.preferences, ...body };
    localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
  }
  savedPrefs = JSON.stringify(prefs.value);
}
</script>
