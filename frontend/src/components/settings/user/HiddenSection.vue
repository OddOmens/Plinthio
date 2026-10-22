<template>
  <SectionHeader :title="$t('settings.hidden.title')" :description="$t('settings.hidden.description')" />

  <SettingsCard flush>
    <p v-if="loading" class="py-10 text-center text-xs text-muted-foreground">{{ $t('common.loading') }}</p>
    <div v-else-if="hiddenItems.length === 0" class="py-12 px-6 text-center flex flex-col items-center gap-2">
      <EyeOff class="w-6 h-6 text-muted-foreground/60" />
      <p class="text-xs text-muted-foreground">{{ $t('settings.hidden.empty') }}</p>
    </div>
    <ul v-else class="divide-y divide-border">
      <li v-for="item in hiddenItems" :key="item.id" class="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-foreground truncate">{{ item.title }}</p>
          <p class="text-[12px] text-muted-foreground truncate">{{ item.author || $t('common.unknown') }}</p>
        </div>
        <button @click="unhideItem(item)" class="btn btn-secondary flex-shrink-0">
          <Eye class="w-3.5 h-3.5" /> {{ $t('settings.hidden.unhide') }}
        </button>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Eye, EyeOff } from '@lucide/vue';
import api from '../../../api/client';
import { useDialogStore } from '../../../stores/dialog';
import { t } from '../../../i18n';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';

const dialog = useDialogStore();
const hiddenItems = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await api.get('/items/hidden');
    hiddenItems.value = res.data.hiddenItems || [];
  } catch (err) {
    console.warn('Could not load hidden titles:', err);
  } finally {
    loading.value = false;
  }
});

async function unhideItem(item) {
  try {
    await api.post(`/items/${item.id}/unhide`);
    hiddenItems.value = hiddenItems.value.filter((i) => i.id !== item.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.hidden.unhideFailed'));
  }
}
</script>
