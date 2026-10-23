<template>
  <!-- Admin → Live TV → Channel health: a few channels are checked in the background to spot
       the ones that have gone offline. A check only asks the stream for its first couple of
       kilobytes, so it costs the server next to nothing. -->
  <SettingsCard :title="$t('admin.liveTv.health.title')" :description="$t('admin.liveTv.health.desc')">
    <template #actions><SaveStatus :status="save.status.value" :message="save.message.value" /></template>

    <div v-if="!data" class="py-6 text-center text-xs flex flex-col items-center gap-3" :class="loadError ? 'text-destructive' : 'text-muted-foreground'">
      <template v-if="loadError">
        <span>{{ loadError }}</span>
        <button type="button" @click="load" class="btn btn-secondary">{{ $t('common.retry') }}</button>
      </template>
      <span v-else>{{ $t('common.loading') }}</span>
    </div>

    <template v-else>
      <div class="divide-y divide-border">
        <ToggleRow
          :label="$t('admin.liveTv.health.enabled.label')"
          :description="$t('admin.liveTv.health.enabled.desc')"
          :icon="Activity"
          :model-value="data.enabled"
          @update:model-value="set({ enabled: $event })"
        />
        <ToggleRow
          :label="$t('admin.liveTv.health.hideOffline.label')"
          :description="$t('admin.liveTv.health.hideOffline.desc')"
          :icon="EyeOff"
          :model-value="data.hideOffline"
          @update:model-value="set({ hideOffline: $event })"
        />
      </div>

      <!-- How the last checks went. Offline opens those channels in the channel manager. -->
      <div class="mt-4 grid grid-cols-3 gap-2">
        <div class="rounded-lg border border-border bg-muted/30 px-3 py-2.5 min-w-0">
          <p class="text-lg font-semibold tabular-nums text-foreground leading-tight">{{ $n(counts.ok) }}</p>
          <p class="text-[12px] text-muted-foreground flex items-start gap-1 leading-tight mt-0.5">
            <span class="w-2 h-2 mt-[3px] rounded-full bg-emerald-500 flex-shrink-0" aria-hidden="true" />
            <span class="min-w-0 break-words">{{ $t('admin.liveTv.health.counts.ok') }}</span>
          </p>
        </div>
        <button
          type="button"
          @click="$emit('show-offline')"
          :disabled="!counts.offline"
          :title="counts.offline ? $t('admin.liveTv.health.showOffline') : ''"
          class="rounded-lg border px-3 py-2.5 min-w-0 text-left transition enabled:hover:bg-muted/60 disabled:cursor-default"
          :class="counts.offline ? 'border-destructive/40 bg-destructive/[0.06]' : 'border-border bg-muted/30'"
        >
          <p class="text-lg font-semibold tabular-nums leading-tight" :class="counts.offline ? 'text-destructive' : 'text-foreground'">{{ $n(counts.offline) }}</p>
          <p class="text-[12px] text-muted-foreground flex items-start gap-1 leading-tight mt-0.5">
            <span class="w-2 h-2 mt-[3px] rounded-full bg-destructive flex-shrink-0" aria-hidden="true" />
            <span class="min-w-0 break-words">{{ $t('admin.liveTv.health.counts.offline') }}</span>
          </p>
        </button>
        <div class="rounded-lg border border-border bg-muted/30 px-3 py-2.5 min-w-0">
          <p class="text-lg font-semibold tabular-nums text-foreground leading-tight">{{ $n(counts.unchecked) }}</p>
          <p class="text-[12px] text-muted-foreground flex items-start gap-1 leading-tight mt-0.5">
            <span class="w-2 h-2 mt-[3px] rounded-full bg-muted-foreground/40 flex-shrink-0" aria-hidden="true" />
            <span class="min-w-0 break-words">{{ $t('admin.liveTv.health.counts.unchecked') }}</span>
          </p>
        </div>
      </div>

      <p class="mt-3 text-[12px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <Clock class="w-3.5 h-3.5 mt-px flex-shrink-0" />
        <span>
          {{ data.lastCheckedAt ? $t('admin.liveTv.health.lastChecked', { date: formatDateTime(data.lastCheckedAt) }) : $t('admin.liveTv.health.neverChecked') }}
          {{ data.enabled ? $t('admin.liveTv.health.pace') : $t('admin.liveTv.health.paused') }}
        </span>
      </p>
    </template>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Activity, EyeOff, Clock } from '@lucide/vue';
import api from '../../../api/client';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { formatDateTime } from '../../../utils/settingsFormat';
import SettingsCard from '../../settings/SettingsCard.vue';
import SaveStatus from '../../settings/SaveStatus.vue';
import ToggleRow from '../../settings/ToggleRow.vue';
import { t } from '../../../i18n';

const props = defineProps({
  // Changes when the channels may have changed elsewhere (a list loaded, a channel checked).
  version: { type: Number, default: 0 }
});
// changed: hiding offline channels was switched, so what viewers see changed.
// show-offline: the Offline count was pressed.
const emit = defineEmits(['changed', 'show-offline']);

const save = useSaveStatus();
const data = ref(null);
const loadError = ref('');

const counts = computed(() => ({ ok: 0, offline: 0, unchecked: 0, ...(data.value?.counts || {}) }));

function adopt(body) {
  if (!body || typeof body !== 'object') return;
  data.value = { ...data.value, ...body, enabled: body.enabled ?? data.value?.enabled ?? true, hideOffline: body.hideOffline ?? data.value?.hideOffline ?? true };
}

async function load() {
  try {
    const res = await api.get('/live/admin/health');
    adopt(res.data);
    loadError.value = '';
  } catch (err) {
    if (!data.value) loadError.value = err.response?.data?.error || t('admin.liveTv.health.couldNotLoad');
  }
}
watch(() => props.version, load);
onMounted(load);

// Switched at once, put back if the save fails.
async function set(patch) {
  const before = { enabled: data.value.enabled, hideOffline: data.value.hideOffline };
  Object.assign(data.value, patch);
  const { ok, data: res } = await save.run(() => api.patch('/live/admin/health', patch));
  if (!ok) {
    Object.assign(data.value, before);
    return;
  }
  if (res?.data && typeof res.data === 'object' && 'counts' in res.data) adopt(res.data);
  if ('hideOffline' in patch) emit('changed');
}
</script>
