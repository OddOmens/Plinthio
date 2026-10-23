<template>
  <SectionHeader :title="$t('admin.liveTv.title')" :description="$t('admin.liveTv.description')">
    <SaveStatus :status="setting.status.value" :message="setting.message.value" />
  </SectionHeader>

  <SettingsCard>
    <ToggleRow
      :label="$t('admin.liveTv.switch.label')"
      :description="$t('admin.liveTv.switch.desc')"
      :model-value="!!store.liveTvEnabled"
      @update:model-value="setting.set({ liveTvEnabled: $event })"
    />
    <p class="mt-3 text-[12px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
      <Info class="w-3.5 h-3.5 mt-px flex-shrink-0" />
      {{ $t('admin.liveTv.publicNote') }}
    </p>
  </SettingsCard>

  <!-- Where the channels come from -->
  <SettingsCard :title="$t('admin.liveTv.sources.title')" :description="$t('admin.liveTv.sources.desc')" flush>
    <template #actions>
      <button type="button" @click="showAdd = true" class="btn btn-primary">
        <Plus class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.sources.add') }}
      </button>
    </template>
    <p v-if="!sources.length" class="py-10 px-6 text-center text-xs text-muted-foreground">
      {{ loadingSources ? $t('common.loading') : (sourcesError || $t('admin.liveTv.sources.empty')) }}
    </p>
    <ul v-else class="divide-y divide-border">
      <li v-for="src in sources" :key="src.id" class="px-4 sm:px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0" :class="src.enabled ? '' : 'opacity-50'">
          <component :is="src.kind === 'iptv-org' ? RadioTower : ListVideo" class="w-5 h-5 text-muted-foreground" />
        </div>
        <!-- On a phone the name keeps its room and the buttons wrap onto a line of their own. -->
        <div class="min-w-[10rem] sm:min-w-0 flex-1">
          <p class="text-xs font-semibold text-foreground truncate flex items-center gap-2">
            <span class="truncate">{{ src.name }}</span>
            <span v-if="!src.enabled" class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground flex-shrink-0">{{ $t('admin.liveTv.sources.off') }}</span>
          </p>
          <p class="text-[12px] text-muted-foreground truncate">
            {{ $t(src.kind === 'iptv-org' ? 'admin.liveTv.sources.kinds.public' : 'admin.liveTv.sources.kinds.own') }}
            · {{ $t('admin.liveTv.channelCount', { count: src.channelCount || 0, number: $n(src.channelCount || 0) }) }}
          </p>
          <p v-if="src.kind === 'm3u'" class="text-[12px] text-muted-foreground font-mono truncate" :title="src.playlistUrl">{{ src.playlistUrl }}</p>
          <p v-if="src.refreshing" class="text-[12px] text-muted-foreground flex items-center gap-1.5" role="status">
            <Loader2 class="w-3 h-3 animate-spin flex-shrink-0" /> {{ $t('admin.liveTv.sources.refreshing') }}
          </p>
          <p v-else-if="src.lastError" class="text-[12px] text-destructive flex items-start gap-1.5">
            <AlertTriangle class="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span class="min-w-0 break-words">{{ $t('admin.liveTv.sources.failed', { error: src.lastError }) }}</span>
          </p>
          <p v-else class="text-[12px] text-muted-foreground">
            {{ src.lastRefreshedAt ? $t('admin.liveTv.sources.updated', { date: formatDateTime(src.lastRefreshedAt) }) : $t('admin.liveTv.sources.notLoaded') }}
          </p>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            role="switch"
            :aria-checked="String(!!src.enabled)"
            :aria-label="$t('admin.liveTv.sources.enabledAria', { name: src.name })"
            :title="src.enabled ? $t('admin.liveTv.sources.turnOff') : $t('admin.liveTv.sources.turnOn')"
            @click="setSourceEnabled(src, !src.enabled)"
            :class="[
              'relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background mr-1',
              src.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
            ]"
          >
            <span class="inline-block h-5 w-5 rounded-full shadow-sm transition-transform" :class="src.enabled ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-0.5 bg-white'" />
          </button>
          <button type="button" @click="refreshSource(src)" :disabled="src.refreshing" class="btn btn-secondary">
            <RefreshCw :class="['w-3.5 h-3.5', src.refreshing ? 'animate-spin' : '']" />
            {{ $t('common.refresh') }}
          </button>
          <button type="button" @click="openEdit(src)" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.sources.editAria', { name: src.name })" :title="$t('common.edit')">
            <Pencil class="w-4 h-4" />
          </button>
          <button type="button" @click="removeSource(src)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.liveTv.sources.removeAria', { name: src.name })" :title="$t('common.remove')">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>
    <template v-if="sources.length && !store.liveTvEnabled" #footer>
      <p class="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info class="w-3.5 h-3.5 mt-px flex-shrink-0" />
        {{ $t('admin.liveTv.sources.offHint') }}
      </p>
    </template>
  </SettingsCard>

  <LiveChannelManager v-if="sources.length" :sources="sources" :version="channelsVersion" />

  <LiveAddDialog :open="showAdd" :sources="sources" @close="showAdd = false" @added="onAdded" />

  <!-- Rename a source, or give it a guide address -->
  <SettingsDialog :open="!!edit" :title="$t('admin.liveTv.editDialog.title')" :subtitle="edit?.original.name || ''" @close="edit = null">
    <form v-if="edit" id="edit-live-source-form" @submit.prevent="submitEdit" class="flex flex-col gap-4">
      <div>
        <label for="live-source-name" class="field-label">{{ $t('admin.liveTv.addDialog.own.name') }}</label>
        <input id="live-source-name" v-model.trim="edit.name" required maxlength="100" class="field" />
      </div>
      <div>
        <label for="live-source-guide" class="field-label">{{ $t('admin.liveTv.addDialog.own.guideUrl') }}</label>
        <input id="live-source-guide" v-model.trim="edit.guideUrl" type="url" inputmode="url" :placeholder="$t('admin.liveTv.addDialog.own.guidePlaceholder')" class="field font-mono" />
        <p class="field-hint">{{ $t('admin.liveTv.editDialog.guideHint') }}</p>
      </div>
    </form>
    <template #footer>
      <button type="button" @click="edit = null" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="edit-live-source-form" :disabled="savingEdit" class="btn btn-primary">{{ savingEdit ? $t('common.saving') : $t('common.save') }}</button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { Plus, RefreshCw, Trash2, Pencil, Loader2, AlertTriangle, Info, RadioTower, ListVideo } from '@lucide/vue';
import api from '../../api/client';
import { useCustomizationStore } from '../../stores/customization';
import { useAuthStore } from '../../stores/auth';
import { useServerSetting } from '../../composables/useServerSetting';
import { useDialogStore } from '../../stores/dialog';
import { formatDateTime } from '../../utils/settingsFormat';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import LiveAddDialog from './live/LiveAddDialog.vue';
import LiveChannelManager from './live/LiveChannelManager.vue';
import { t, n } from '../../i18n';

const store = useCustomizationStore();
const authStore = useAuthStore();
const setting = useServerSetting();
const dialog = useDialogStore();

// ─── Sources ───────────────────────────────────────────────────────────────
const sources = ref([]);
const loadingSources = ref(true);
const sourcesError = ref('');
// Bumped whenever the channels may have changed (a list loaded, removed or switched),
// so the channel manager reloads its page.
const channelsVersion = ref(0);
const showAdd = ref(false);

// Channels arriving or going can bring Live TV into the menu or take it out; ask again.
watch(channelsVersion, () => store.loadLiveStatus?.(authStore.user?.id, { force: true }));

async function loadSources() {
  try {
    const res = await api.get('/live/admin/sources');
    const wasRefreshing = sources.value.some((s) => s.refreshing);
    sources.value = res.data.sources || [];
    sourcesError.value = '';
    if (wasRefreshing && !sources.value.some((s) => s.refreshing)) channelsVersion.value++;
  } catch (err) {
    sourcesError.value = err.response?.data?.error || t('admin.liveTv.sources.couldNotLoad');
  } finally {
    loadingSources.value = false;
    schedulePoll();
  }
}

// A list loads in the background on the server; check back until none are still loading.
let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (sources.value.some((s) => s.refreshing)) pollTimer = setTimeout(loadSources, 3000);
}
onUnmounted(() => clearTimeout(pollTimer));

function replaceSource(source) {
  if (!source) return;
  const i = sources.value.findIndex((s) => s.id === source.id);
  if (i === -1) sources.value.push(source);
  else sources.value[i] = source;
}

async function refreshSource(src) {
  src.refreshing = true;
  try {
    const res = await api.post(`/live/admin/sources/${src.id}/refresh`);
    replaceSource(res.data.source ? { ...res.data.source, refreshing: true } : null);
  } catch (err) {
    src.refreshing = false;
    dialog.alert(err.response?.data?.error || t('admin.liveTv.sources.couldNotRefresh'));
  }
  schedulePoll();
}

async function setSourceEnabled(src, enabled) {
  const before = src.enabled;
  src.enabled = enabled;
  try {
    const res = await api.patch(`/live/admin/sources/${src.id}`, { enabled });
    replaceSource(res.data.source);
    channelsVersion.value++;
  } catch (err) {
    src.enabled = before;
    dialog.alert(err.response?.data?.error || t('admin.liveTv.sources.couldNotSave'));
  }
}

async function removeSource(src) {
  const confirmed = await dialog.confirm({
    title: t('admin.liveTv.sources.removeTitle'),
    message: t('admin.liveTv.sources.removeMessage', { name: src.name, count: src.channelCount || 0, number: n(src.channelCount || 0) }),
    confirmText: t('common.remove'),
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/live/admin/sources/${src.id}`);
    sources.value = sources.value.filter((s) => s.id !== src.id);
    channelsVersion.value++;
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.sources.couldNotRemove'));
  }
}

function onAdded(added) {
  for (const source of added) replaceSource({ ...source, refreshing: source.refreshing ?? true });
  // Adding starts loading it; look again shortly for the server's own status.
  clearTimeout(pollTimer);
  pollTimer = setTimeout(loadSources, 1500);
}

// ─── Editing a source ──────────────────────────────────────────────────────
const edit = ref(null);
const savingEdit = ref(false);
function openEdit(src) {
  edit.value = { original: src, name: src.name, guideUrl: src.guideUrl || '' };
}
async function submitEdit() {
  savingEdit.value = true;
  try {
    const res = await api.patch(`/live/admin/sources/${edit.value.original.id}`, {
      name: edit.value.name,
      guideUrl: edit.value.guideUrl || null
    });
    replaceSource(res.data.source);
    edit.value = null;
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.sources.couldNotSave'));
  } finally {
    savingEdit.value = false;
  }
}

onMounted(() => {
  store.fetchCustomization();
  loadSources();
});
</script>
