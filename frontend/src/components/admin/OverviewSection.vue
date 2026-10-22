<template>
  <SectionHeader :title="$t('admin.overview.title')" :description="$t('admin.overview.description')" />

  <!-- Version & updates -->
  <div class="rounded-xl border p-4 flex flex-wrap items-center gap-3" :class="updateInfo?.updateAvailable ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'">
    <div class="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
      <AppLogo class="w-5 h-5" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold text-foreground">Plinthio {{ updateInfo?.current || '…' }}</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        <template v-if="updateInfo && !updateInfo.enabled">{{ $t('admin.overview.checksOff') }}</template>
        <template v-else-if="updateInfo?.updateAvailable">
          <span class="text-primary font-medium">{{ $t('admin.overview.available', { version: updateInfo.latest }) }}</span>
          <I18nT keypath="admin.overview.updateWith">
            <template #command><code class="bg-muted px-1 rounded">docker compose pull &amp;&amp; docker compose up -d</code></template>
          </I18nT>
        </template>
        <template v-else-if="updateInfo?.checkedAt">{{ updateInfo.error ? $t('admin.overview.upToDateCheckFailed') : $t('admin.overview.upToDate') }}</template>
        <template v-else>{{ $t('admin.overview.notChecked') }}</template>
      </p>
    </div>
    <div class="flex items-center gap-2">
      <a v-if="updateInfo?.releaseUrl" :href="updateInfo.releaseUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">{{ $t('admin.overview.releaseNotes') }}</a>
      <button type="button" @click="checkUpdates(true)" :disabled="checkingUpdates || (updateInfo && !updateInfo.enabled)" class="btn btn-secondary">
        <RefreshCw class="w-3.5 h-3.5" :class="checkingUpdates ? 'animate-spin' : ''" />
        {{ checkingUpdates ? $t('admin.overview.checking') : $t('admin.overview.checkNow') }}
      </button>
    </div>
  </div>

  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <div v-for="tile in tiles" :key="tile.label" class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <span class="text-xs text-muted-foreground flex items-center gap-1.5"><component :is="tile.icon" class="w-3.5 h-3.5" /> {{ tile.label }}</span>
      <span class="text-xl font-bold font-mono text-foreground">{{ stats ? tile.value : '—' }}</span>
    </div>
  </div>

  <SettingsCard v-if="stats?.byType" :title="$t('admin.overview.byMediaType')" flush>
    <ul class="divide-y divide-border">
      <li v-for="cat in stats.byType" :key="cat.media_type" class="px-4 sm:px-5 py-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center row-span-2">
          <component :is="mediaTypeIcon(cat.media_type)" class="w-4 h-4 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex items-baseline gap-2 flex-wrap">
          <span class="text-xs font-semibold text-foreground">{{ mediaTypeLabel(cat.media_type) }}</span>
          <span class="text-[12px] text-muted-foreground">
            {{ $t('admin.overview.files', { count: cat.count || 0, number: $n(cat.count || 0) }) }} · {{ $t('admin.overview.series', { count: cat.unique_series || 0, number: $n(cat.unique_series || 0) }) }} · {{ $t('admin.overview.creators', { count: cat.unique_authors || 0, number: $n(cat.unique_authors || 0) }) }}<template v-if="cat.media_type === 'audiobook' && cat.duration > 0"> · {{ formatHours(cat.duration) }}</template>
          </span>
        </div>
        <span class="text-[12px] font-mono text-muted-foreground text-right">{{ formatBytes(cat.bytes) }}</span>
        <div class="col-span-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div class="h-full bg-primary transition-all duration-300" :style="{ width: `${cat.percentage_of_storage || 0}%` }" />
        </div>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { RefreshCw, Library, HardDrive, Clock, Users } from '@lucide/vue';
import api from '../../api/client';
import { mediaTypeLabel, mediaTypeIcon, formatBytes, formatHours } from '../../utils/settingsFormat';
import AppLogo from '../AppLogo.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t, n } from '../../i18n';

const stats = ref(null);
const updateInfo = ref(null);
const checkingUpdates = ref(false);

const tiles = computed(() => [
  { label: t('admin.overview.tiles.files'), icon: Library, value: n(stats.value?.totalItems || 0) },
  { label: t('admin.overview.tiles.onDisk'), icon: HardDrive, value: formatBytes(stats.value?.totalBytes) },
  { label: t('admin.overview.tiles.audio'), icon: Clock, value: formatHours(stats.value?.totalAudioDuration) },
  { label: t('admin.overview.tiles.accounts'), icon: Users, value: n(stats.value?.totalUsers || 0) }
]);

async function checkUpdates(force) {
  checkingUpdates.value = true;
  try {
    const res = await api.get('/system/update', { params: force ? { refresh: '1' } : {} });
    updateInfo.value = res.data;
  } catch (err) {
    // Leave the card as it was.
  } finally {
    checkingUpdates.value = false;
  }
}

onMounted(async () => {
  checkUpdates(false);
  try {
    const res = await api.get('/stats/admin');
    stats.value = res.data;
  } catch (err) {
    console.warn('Could not load server stats:', err);
  }
});
</script>
