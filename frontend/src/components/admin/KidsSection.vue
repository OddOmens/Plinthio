<template>
  <SectionHeader title="Kids Mode" description="Kids accounts see only what's switched on here. Make an account a kids account in Users.">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <SettingsCard title="Whole libraries" description="Everything in these libraries, now and later.">
    <p v-if="!libraries.length" class="text-xs text-muted-foreground">No libraries yet.</p>
    <div v-else class="divide-y divide-border">
      <ToggleRow
        v-for="lib in libraries"
        :key="lib.id"
        :label="lib.name"
        :description="`${(lib.item_count || 0).toLocaleString()} items`"
        :model-value="!!lib.kids_allowed"
        @update:model-value="toggleLibraryKids(lib, $event)"
      />
    </div>
  </SettingsCard>

  <SettingsCard title="Single series and titles" flush>
    <template #description>
      Add more from any series or title page with its <strong class="text-foreground">Kids</strong> button.
    </template>
    <p v-if="!kidsTitles.length" class="py-8 text-center text-xs text-muted-foreground">{{ loading ? 'Loading…' : 'None yet.' }}</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="t in kidsTitles" :key="t.id" class="px-4 sm:px-5 py-2.5 flex items-center gap-3 text-xs">
        <Baby class="w-4 h-4 text-sky-500 flex-shrink-0" />
        <span class="flex-1 min-w-0">
          <span class="block truncate text-foreground font-medium">{{ t.name }}</span>
          <span class="block text-[12px] text-muted-foreground">{{ t.series ? 'Series' : 'Title' }} · {{ t.library_name }}</span>
        </span>
        <button type="button" @click="removeKidsTitle(t)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="`Remove ${t.name} from Kids Mode`">
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

async function removeKidsTitle(t) {
  try {
    await api.delete(`/kids/titles/${t.id}`);
    kidsTitles.value = kidsTitles.value.filter((x) => x.id !== t.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not remove it from Kids Mode');
  }
}
</script>
