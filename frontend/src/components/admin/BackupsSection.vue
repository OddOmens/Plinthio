<template>
  <SectionHeader :title="$t('admin.backups.title')" :description="$t('admin.backups.description')" />

  <SettingsCard :title="$t('admin.backups.automatic')">
    <div class="divide-y divide-border">
      <ToggleRow v-model="config.enabled" :label="$t('admin.backups.schedule.label')" :description="$t('admin.backups.schedule.desc')" />
      <div v-if="config.enabled" class="py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label for="backup-frequency" class="field-label">{{ $t('admin.backups.howOften') }}</label>
          <select id="backup-frequency" v-model.number="config.intervalHours" class="field">
            <option :value="6">{{ $t('admin.backups.frequency.every6h') }}</option>
            <option :value="12">{{ $t('admin.backups.frequency.every12h') }}</option>
            <option :value="24">{{ $t('admin.backups.frequency.daily') }}</option>
            <option :value="72">{{ $t('admin.backups.frequency.every3d') }}</option>
            <option :value="168">{{ $t('admin.backups.frequency.weekly') }}</option>
          </select>
        </div>
        <div>
          <label for="backup-keep" class="field-label">{{ $t('admin.backups.keepLast') }}</label>
          <input id="backup-keep" type="number" min="1" max="30" v-model.number="config.retentionCount" class="field" />
        </div>
      </div>

      <!-- Second place -->
      <div class="pt-3 flex flex-col gap-2">
        <div>
          <label class="text-xs font-semibold text-foreground" for="backup-destination">{{ $t('admin.backups.destination.label') }}</label>
          <p class="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
            {{ $t('admin.backups.destination.why') }}
          </p>
        </div>
        <div class="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <input
            id="backup-destination"
            v-model.trim="config.destination"
            @input="destinationCheck = null"
            :placeholder="$t('admin.backups.destination.placeholder')"
            class="field font-mono flex-1 min-w-0 basis-full sm:basis-auto"
          />
          <button type="button" :aria-label="$t('admin.backups.destination.browseAria')" @click="showPicker = true" class="btn btn-secondary">
            <FolderOpen class="w-3.5 h-3.5" /> {{ $t('admin.backups.destination.browse') }}
          </button>
          <button type="button" :aria-label="$t('admin.backups.destination.testAria')" @click="testDestination" :disabled="!config.destination || checkingDestination" class="btn btn-secondary">
            {{ checkingDestination ? $t('admin.backups.destination.checking') : $t('admin.backups.destination.test') }}
          </button>
          <button v-if="config.destination" type="button" @click="config.destination = ''; destinationCheck = null" class="btn btn-ghost">{{ $t('common.clear') }}</button>
        </div>
        <p v-if="destinationCheck && !destinationCheck.ok" class="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5 mt-px flex-shrink-0" />{{ destinationCheck.error }}
        </p>
        <p v-else-if="destinationCheck?.ok" class="text-xs flex items-start gap-1.5" :class="destinationCheck.sameDisk ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
          <AlertTriangle v-if="destinationCheck.sameDisk" class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <CheckCircle v-else class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>
            {{ destinationCheck.freeBytes != null
              ? $t('admin.backups.destination.writableFree', { free: formatBytes(destinationCheck.freeBytes) })
              : $t('admin.backups.destination.writable') }}
            {{ destinationCheck.sameDisk ? $t('admin.backups.destination.sameDisk') : $t('admin.backups.destination.otherDisk') }}
          </span>
        </p>
        <I18nT v-else keypath="admin.backups.destination.hint" tag="p" class="text-[12px] text-muted-foreground">
          <template #media><code class="bg-muted px-1 rounded">/media</code></template>
          <template #backups><code class="bg-muted px-1 rounded">/backups</code></template>
        </I18nT>
        <div v-if="config.destination" class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label class="field-label" for="backup-copy-retention">{{ $t('admin.backups.destination.keepThere') }}</label>
            <input id="backup-copy-retention" type="number" min="1" max="365" v-model.number="config.copyRetentionCount" class="field" />
          </div>
          <label class="flex items-start gap-2.5 cursor-pointer select-none sm:pt-6">
            <input type="checkbox" v-model="config.copyFiles" class="mt-0.5 rounded border-border accent-primary focus:ring-ring" />
            <span class="text-xs text-foreground">{{ $t('admin.backups.destination.copyFiles') }}</span>
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <SaveStatus :status="save.status.value" :message="save.message.value" />
      <button :aria-label="$t('admin.backups.saveAria')" @click="saveConfig" :disabled="save.status.value === 'saving' || !dirty" class="btn btn-primary ml-auto">
        {{ $t('common.save') }}
      </button>
    </template>
  </SettingsCard>

  <!-- How copying to the second place is going -->
  <div v-if="savedDestination" class="rounded-xl border p-4 flex flex-wrap items-center gap-3 text-xs" :class="copyError ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'">
    <span v-if="copyError" class="flex-1 min-w-0 text-destructive flex items-start gap-1.5">
      <AlertTriangle class="w-3.5 h-3.5 mt-px flex-shrink-0" />
      <I18nT keypath="admin.backups.copyFailed" :params="{ error: copyError }">
        <template #path><code class="bg-muted px-1 rounded">{{ savedDestination }}</code></template>
      </I18nT>
    </span>
    <span v-else class="flex-1 min-w-0 text-muted-foreground flex items-start gap-1.5">
      <CheckCircle class="w-3.5 h-3.5 mt-px flex-shrink-0 text-emerald-500" />
      <I18nT keypath="admin.backups.copiedTo" :params="{ when: lastCopyAt ? formatFullDateTime(lastCopyAt) : $t('admin.backups.notYet') }">
        <template #path><code class="bg-muted px-1 rounded text-foreground">{{ savedDestination }}</code></template>
      </I18nT>
    </span>
    <button type="button" @click="copyNow" :disabled="copying" class="btn btn-secondary">
      <Copy class="w-3.5 h-3.5" /> {{ copying ? $t('admin.backups.copying') : $t('admin.backups.copyNow') }}
    </button>
  </div>

  <SettingsCard :title="stored.length ? $t('admin.backups.storedCount', { count: $n(stored.length) }) : $t('admin.backups.stored')" flush>
    <template #actions>
      <button @click="createNow" :disabled="creating" class="btn btn-secondary">
        <Save class="w-3.5 h-3.5" /> {{ creating ? $t('admin.backups.backingUp') : $t('admin.backups.backUpNow') }}
      </button>
      <button @click="downloadSnapshot" :disabled="downloading" class="btn btn-secondary">
        <Download class="w-3.5 h-3.5" /> {{ downloading ? $t('admin.backups.preparing') : $t('admin.backups.downloadSnapshot') }}
      </button>
    </template>
    <p v-if="!stored.length" class="py-8 text-center text-xs text-muted-foreground">{{ $t('admin.backups.empty') }}</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="b in stored" :key="b.filename" class="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5">
        <div class="min-w-0">
          <p class="text-xs font-medium text-foreground truncate">{{ formatFullDateTime(b.createdAt) }}</p>
          <p class="text-[12px] text-muted-foreground font-mono">{{ formatBytes(b.size) }}</p>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button @click="downloadStored(b)" class="btn btn-ghost btn-icon" :aria-label="$t('admin.backups.downloadThis')" :title="$t('common.download')">
            <Download class="w-4 h-4" />
          </button>
          <button @click="deleteStored(b)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.backups.deleteThis')" :title="$t('common.delete')">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>
  </SettingsCard>

  <FolderPicker
    :open="showPicker"
    :start="config.destination || '/media'"
    :title="$t('admin.backups.destination.pickerTitle')"
    @close="showPicker = false"
    @select="(p) => { config.destination = p; showPicker = false; testDestination(); }"
  />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { FolderOpen, AlertTriangle, CheckCircle, Copy, Save, Download, Trash2 } from '@lucide/vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import { formatBytes, formatFullDateTime } from '../../utils/settingsFormat';
import FolderPicker from '../FolderPicker.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t } from '../../i18n';

const dialog = useDialogStore();
const save = useSaveStatus();

const config = ref({ enabled: true, intervalHours: 24, retentionCount: 7, destination: '', copyRetentionCount: 30, copyFiles: true });
const savedConfig = ref('');
const dirty = computed(() => JSON.stringify(config.value) !== savedConfig.value);

// What the server has for the second place, and how the last copy went.
const savedDestination = ref('');
const lastCopyAt = ref(null);
const copyError = ref('');

function applyConfig(data) {
  config.value = {
    enabled: !!data.enabled,
    intervalHours: data.intervalHours || 24,
    retentionCount: data.retentionCount || 7,
    destination: data.destination || '',
    copyRetentionCount: data.copyRetentionCount || 30,
    copyFiles: data.copyFiles !== false
  };
  savedConfig.value = JSON.stringify(config.value);
  savedDestination.value = data.destination || '';
  lastCopyAt.value = data.lastCopyAt || null;
  // Stored as "<time> <message>".
  copyError.value = (data.lastCopyError || '').replace(/^\S+\s/, '');
}

async function loadConfig() {
  try {
    const res = await api.get('/settings/backup/config');
    applyConfig(res.data);
  } catch (err) {
    console.warn('Could not load the backup settings:', err);
  }
}

async function saveConfig() {
  const newPlace = config.value.destination && config.value.destination !== savedDestination.value;
  const { ok, data } = await save.run(
    () => api.put('/settings/backup/config', config.value),
    { saved: newPlace ? t('admin.backups.savedCopying', { path: config.value.destination }) : '' }
  );
  if (!ok) return;
  applyConfig(data.data);
  // The first copy runs in the background; pick up how it went.
  if (newPlace) setTimeout(loadConfig, 4000);
}

// ─── The second place ─────────────────────────────────────────────────────
const destinationCheck = ref(null);
const checkingDestination = ref(false);
const showPicker = ref(false);
const copying = ref(false);

async function testDestination() {
  if (!config.value.destination) return;
  checkingDestination.value = true;
  try {
    const res = await api.post('/settings/backup/destination/check', { path: config.value.destination });
    destinationCheck.value = res.data;
  } catch (err) {
    destinationCheck.value = { ok: false, error: err.response?.data?.error || t('admin.backups.destination.couldNotCheck') };
  } finally {
    checkingDestination.value = false;
  }
}

async function copyNow() {
  copying.value = true;
  try {
    await api.post('/settings/backup/copy');
  } catch (err) {
    // The failure is recorded on the server; loadConfig shows it.
  } finally {
    const unsaved = dirty.value ? config.value : null;
    await loadConfig();
    if (unsaved) config.value = unsaved;
    copying.value = false;
  }
}

// ─── Stored backups ───────────────────────────────────────────────────────
const stored = ref([]);
const creating = ref(false);
const downloading = ref(false);

async function loadStored() {
  try {
    const res = await api.get('/settings/backup/list');
    stored.value = res.data.backups || [];
  } catch (err) {
    console.warn('Could not list backups:', err);
  }
}

async function createNow() {
  creating.value = true;
  try {
    const res = await api.post('/settings/backup/create');
    stored.value = res.data.backups || [];
    if (savedDestination.value) setTimeout(loadConfig, 1500);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.backups.couldNotBackUp'));
  } finally {
    creating.value = false;
  }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadSnapshot() {
  downloading.value = true;
  try {
    const res = await api.get('/settings/backup', { responseType: 'blob' });
    const match = (res.headers['content-disposition'] || '').match(/filename="?([^"]+)"?/);
    saveBlob(res.data, match ? match[1] : `plinthio-backup-${Date.now()}.sqlite`);
  } catch (err) {
    console.error('Snapshot download failed:', err);
    dialog.alert(t('admin.backups.couldNotSnapshot'));
  } finally {
    downloading.value = false;
  }
}

async function downloadStored(backup) {
  try {
    const res = await api.get(`/settings/backup/${encodeURIComponent(backup.filename)}`, { responseType: 'blob' });
    saveBlob(res.data, backup.filename);
  } catch (err) {
    console.error('Backup download failed:', err);
    dialog.alert(t('admin.backups.couldNotDownload'));
  }
}

async function deleteStored(backup) {
  const confirmed = await dialog.confirm({
    title: t('admin.backups.deleteTitle'),
    message: t('admin.backups.deleteMessage', { date: formatFullDateTime(backup.createdAt) }),
    confirmText: t('common.delete'),
    danger: true
  });
  if (!confirmed) return;
  try {
    const res = await api.delete(`/settings/backup/${encodeURIComponent(backup.filename)}`);
    stored.value = res.data.backups || [];
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.backups.couldNotDelete'));
  }
}

onMounted(() => {
  loadConfig();
  loadStored();
});
</script>
