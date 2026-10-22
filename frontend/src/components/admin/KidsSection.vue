<template>
  <SectionHeader :title="$t('admin.kids.title')" :description="$t('admin.kids.description')">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <SettingsCard :title="$t('admin.kids.libraries.title')" :description="$t('admin.kids.libraries.desc')">
    <p v-if="!libraries.length" class="text-xs text-muted-foreground">{{ $t('admin.kids.noLibraries') }}</p>
    <div v-else class="divide-y divide-border">
      <ToggleRow
        v-for="lib in libraries"
        :key="lib.id"
        :label="lib.name"
        :description="$t('admin.kids.items', { count: lib.item_count || 0, number: $n(lib.item_count || 0) })"
        :model-value="!!lib.kids_allowed"
        @update:model-value="toggleLibraryKids(lib, $event)"
      />
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.kids.titles.title')" flush>
    <template #description>
      <I18nT keypath="admin.kids.titles.desc">
        <template #button><strong class="text-foreground">{{ $t('admin.kids.titles.button') }}</strong></template>
      </I18nT>
    </template>
    <p v-if="!kidsTitles.length" class="py-8 text-center text-xs text-muted-foreground">{{ loading ? $t('common.loading') : $t('admin.kids.noneYet') }}</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="t in kidsTitles" :key="t.id" class="px-4 sm:px-5 py-2.5 flex items-center gap-3 text-xs">
        <Baby class="w-4 h-4 text-sky-500 flex-shrink-0" />
        <span class="flex-1 min-w-0">
          <span class="block truncate text-foreground font-medium">{{ t.name }}</span>
          <span class="block text-[12px] text-muted-foreground">{{ t.series ? $t('admin.kids.series') : $t('admin.kids.singleTitle') }} · {{ t.library_name }}</span>
        </span>
        <button type="button" @click="removeKidsTitle(t)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.kids.removeAria', { name: t.name })">
          <X class="w-4 h-4" />
        </button>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Baby, X } from '@lucide/vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t } from '../../i18n';

defineProps({
  libraries: { type: Array, default: () => [] }
});
const dialog = useDialogStore();
const save = useSaveStatus();

const kidsTitles = ref([]);
const loading = ref(true);
onMounted(async () => {
  try {
    const res = await api.get('/kids');
    kidsTitles.value = res.data.titles || [];
  } catch (err) {
    kidsTitles.value = [];
  } finally {
    loading.value = false;
  }
});

async function toggleLibraryKids(lib, on) {
  const before = lib.kids_allowed;
  lib.kids_allowed = on ? 1 : 0;
  const { ok } = await save.run(() => api.patch(`/libraries/${lib.id}`, { kidsAllowed: on }));
  if (!ok) lib.kids_allowed = before;
}

async function removeKidsTitle(title) {
  try {
    await api.delete(`/kids/titles/${title.id}`);
    kidsTitles.value = kidsTitles.value.filter((x) => x.id !== title.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.kids.couldNotRemove'));
  }
}
</script>
