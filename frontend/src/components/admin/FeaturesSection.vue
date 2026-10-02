<template>
  <SectionHeader title="Features" description="What's switched on for everyone on this server. Changes save as you make them.">
    <SaveStatus :status="setting.status.value" :message="setting.message.value" />
  </SectionHeader>

  <SettingsCard title="Shelf views" description="Alphabetical and Creator are always there. Turning a folder view off hides it for everyone.">
    <template #actions><SaveStatus :status="filterSave.status.value" :message="filterSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="mode in FOLDER_MODES"
        :key="mode.id"
        :label="mode.label"
        :description="mode.desc"
        :model-value="allowedFilters.includes(mode.id)"
        @update:model-value="setFolderMode(mode.id, $event)"
      />
    </div>
  </SettingsCard>

  <SettingsCard title="Ratings" description="Which ratings appear. One turned off is hidden everywhere, and the server stops sending it.">
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="opt in ratingOptions"
        :key="opt.id"
        :label="opt.label"
        :description="opt.desc"
        :model-value="store.ratings?.[opt.id] !== false"
        @update:model-value="setting.set({ ratings: { [opt.id]: $event } })"
      />
    </div>
  </SettingsCard>

  <SettingsCard title="Movies and watching together">
    <div class="divide-y divide-border">
      <ToggleRow
        label="Show missing films in collections"
        description="A collection like Shrek or Star Wars also lists the films you don't have, greyed out with a Request button. They never appear on the Movies shelf. Needs a TMDB key."
        :model-value="store.showMissingFilms"
        @update:model-value="setting.set({ showMissingFilms: $event })"
      />
      <ToggleRow
        label="Watch parties"
        description="A Watch Together button on movies and episodes: watch in sync from different places, with chat. Content limits still apply to everyone in a party. Friends away from home need to be able to reach this server (see Network). Turning it off ends any party in progress."
        :model-value="store.partyModeEnabled"
        @update:model-value="setting.set({ partyModeEnabled: $event })"
      />
    </div>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client';
import { useCustomizationStore } from '../../stores/customization';
import { useServerSetting } from '../../composables/useServerSetting';
import { useSaveStatus } from '../../composables/useSaveStatus';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';

const store = useCustomizationStore();
const setting = useServerSetting();
const filterSave = useSaveStatus();

const FOLDER_MODES = [
  { id: 'disk_folder', label: 'Disk folders', desc: 'Browse by the folders on the server.' },
  { id: 'custom_folder', label: 'Custom folders', desc: 'People\'s own in-app folders, with an Unorganized catch-all.' }
];
const allowedFilters = ref(['series', 'creator', 'disk_folder', 'custom_folder']);

async function setFolderMode(id, on) {
  const before = allowedFilters.value;
  allowedFilters.value = on ? [...new Set([...before, id])] : before.filter((m) => m !== id);
  const { ok, data } = await filterSave.run(() => api.patch('/settings/filters', { allowedGroupingModes: allowedFilters.value }));
  if (ok) allowedFilters.value = data.data.allowedGroupingModes || allowedFilters.value;
  else allowedFilters.value = before;
}

const ratingOptions = computed(() => [
  { id: 'showPersonal', label: 'Personal ratings', desc: 'Each person can give 1–5 stars, and sees their own.' },
  { id: 'showCommunity', label: `${store.serverName || 'Plinthio'} ratings`, desc: 'The average from everyone on this server.' },
  { id: 'showExternal', label: 'World ratings (TMDB)', desc: 'TMDB\'s score for movies, shows and anime. Needs a TMDB key.' }
]);

onMounted(async () => {
  store.fetchCustomization();
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) allowedFilters.value = res.data.allowedGroupingModes;
  } catch (err) {
    console.warn('Could not load shelf views:', err);
  }
});
</script>
