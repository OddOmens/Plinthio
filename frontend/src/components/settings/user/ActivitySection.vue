<template>
  <SectionHeader :title="$t('settings.activity.title')" :description="$t('settings.activity.description')" />

  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <div v-for="tile in tiles" :key="tile.label" class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <span class="text-xs text-muted-foreground flex items-center gap-1.5">
        <component :is="tile.icon" class="w-3.5 h-3.5" :class="tile.tone" /> {{ tile.label }}
      </span>
      <span class="text-xl font-bold font-mono text-foreground">{{ tile.value }}</span>
    </div>
  </div>

  <SettingsCard :title="$t('settings.activity.recent')" flush>
    <ActivityList :entries="activity" :loading="loading" />
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Headphones, BookOpen, CheckCircle, Clock } from '@lucide/vue';
import api from '../../../api/client';
import { formatHours } from '../../../utils/settingsFormat';
import { t, n } from '../../../i18n';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import ActivityList from '../ActivityList.vue';

const stats = ref({});
const activity = ref([]);
const loading = ref(true);

const tiles = computed(() => [
  { label: t('settings.activity.tiles.listened'), icon: Headphones, value: formatHours(stats.value.totalSecondsListened) },
  { label: t('settings.activity.tiles.pagesRead'), icon: BookOpen, value: n(stats.value.totalPagesRead || 0) },
  { label: t('settings.activity.tiles.finished'), icon: CheckCircle, tone: 'text-emerald-500', value: n(stats.value.completedCount || 0) },
  { label: t('settings.activity.tiles.inProgress'), icon: Clock, value: n(stats.value.inProgressCount || 0) }
]);

onMounted(async () => {
  try {
    const [statsRes, activityRes] = await Promise.all([
      api.get('/stats/me'),
      api.get('/activity/me', { params: { limit: 25 } })
    ]);
    stats.value = statsRes.data.stats || {};
    activity.value = activityRes.data.activity || [];
  } catch (err) {
    console.warn('Could not load your activity:', err);
  } finally {
    loading.value = false;
  }
});
</script>
