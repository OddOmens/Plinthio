<template>
  <SectionHeader :title="$t('admin.features.title')" :description="$t('admin.features.description')">
    <SaveStatus :status="setting.status.value" :message="setting.message.value" />
  </SectionHeader>

  <SettingsCard :title="$t('admin.features.shelfViews.title')" :description="$t('admin.features.shelfViews.desc')">
    <template #actions><SaveStatus :status="filterSave.status.value" :message="filterSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="mode in folderModes"
        :key="mode.id"
        :label="mode.label"
        :description="mode.desc"
        :model-value="allowedFilters.includes(mode.id)"
        @update:model-value="setFolderMode(mode.id, $event)"
      />
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.features.ratings.title')" :description="$t('admin.features.ratings.desc')">
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

  <SettingsCard :title="$t('admin.features.movies.title')">
    <div class="divide-y divide-border">
      <ToggleRow
        :label="$t('admin.features.movies.missingFilms.label')"
        :description="$t('admin.features.movies.missingFilms.desc')"
        :model-value="store.showMissingFilms"
        @update:model-value="setting.set({ showMissingFilms: $event })"
      />
      <ToggleRow
        :label="$t('admin.features.movies.watchParties.label')"
        :description="$t('admin.features.movies.watchParties.desc')"
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
import { t } from '../../i18n';

const store = useCustomizationStore();
const setting = useServerSetting();
const filterSave = useSaveStatus();

const folderModes = computed(() => [
  { id: 'disk_folder', label: t('admin.features.folderModes.diskFolder.label'), desc: t('admin.features.folderModes.diskFolder.desc') },
  { id: 'custom_folder', label: t('admin.features.folderModes.customFolder.label'), desc: t('admin.features.folderModes.customFolder.desc') }
]);
const allowedFilters = ref(['series', 'creator', 'disk_folder', 'custom_folder']);

async function setFolderMode(id, on) {
  const before = allowedFilters.value;
  allowedFilters.value = on ? [...new Set([...before, id])] : before.filter((m) => m !== id);
  const { ok, data } = await filterSave.run(() => api.patch('/settings/filters', { allowedGroupingModes: allowedFilters.value }));
  if (ok) allowedFilters.value = data.data.allowedGroupingModes || allowedFilters.value;
  else allowedFilters.value = before;
}

const ratingOptions = computed(() => [
  { id: 'showPersonal', label: t('admin.features.ratings.personal.label'), desc: t('admin.features.ratings.personal.desc') },
  {
    id: 'showCommunity',
    label: t('admin.features.ratings.community.label', { name: store.serverName || 'Plinthio' }),
    desc: t('admin.features.ratings.community.desc')
  },
  { id: 'showExternal', label: t('admin.features.ratings.external.label'), desc: t('admin.features.ratings.external.desc') }
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
