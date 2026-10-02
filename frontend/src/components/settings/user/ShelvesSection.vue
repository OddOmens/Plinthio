<template>
  <SectionHeader title="Shelves" description="What's on your shelves and where Plinthio opens. Saves as you go.">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <SettingsCard title="Media types" description="Which kinds of media appear on your shelves. Keep at least one.">
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

  <SettingsCard title="Start on" description="The shelf Plinthio opens to.">
    <OptionTiles
      label="Start on"
      :options="startupOptions"
      v-model="prefs.defaultView"
      grid-class="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-7 gap-2.5"
    />
  </SettingsCard>

  <SettingsCard title="Shelf views" description="The views above your shelf. Each shows one card per series; Alphabetical is always there.">
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="mode in availableFilterModes"
        :key="mode.id"
        :label="mode.label"
        :model-value="mode.allowed && prefs.enabledGroupingModes.includes(mode.id)"
        :disabled="!mode.allowed || mode.always"
        @update:model-value="toggleMode(mode.id, $event)"
      >
        <span v-if="!mode.allowed" class="inline-flex items-center gap-1"><Lock class="w-3 h-3" /> Turned off by your admin</span>
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
import OptionTiles from '../../OptionTiles.vue';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import ToggleRow from '../ToggleRow.vue';
import SaveStatus from '../SaveStatus.vue';

const authStore = useAuthStore();
const save = useSaveStatus();

const mediaCategories = MEDIA_TYPE_ORDER.map((id) => ({ id, ...MEDIA_TYPE_INFO[id] }));

const stored = authStore.user?.preferences || {};
const prefs = ref({
  enabledMediaTypes: stored.enabledMediaTypes || ALL_MEDIA_TYPES,
  enabledGroupingModes: userShelfModes(stored.enabledGroupingModes),
  defaultView: stored.defaultView || 'all'
});
let savedPrefs = JSON.stringify(prefs.value);

// "All" plus each type that's switched on.
const startupOptions = computed(() => [
  { id: 'all', label: 'All media', icon: LayoutGrid },
  ...mediaCategories.filter((c) => prefs.value.enabledMediaTypes.includes(c.id)).map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
]);

const allowedFilters = ref([...SHELF_MODES]);
const allFilterModes = [
  { id: 'series', label: 'Alphabetical', desc: 'Always on. Every series and title A–Z.', always: true },
  { id: 'creator', label: 'Creator', desc: 'Grouped by author, director or studio.' },
  { id: 'disk_folder', label: 'Disk folders', desc: 'The folders on the server.' },
  { id: 'custom_folder', label: 'Custom folders', desc: 'Your own in-app folders, with an Unorganized catch-all.' }
];
const availableFilterModes = computed(() => {
  const serverModes = normalizeShelfModes(allowedFilters.value);
  return allFilterModes.map((m) => ({ ...m, allowed: serverModes.includes(m.id) }));
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
