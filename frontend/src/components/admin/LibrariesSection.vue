<template>
  <SectionHeader :title="$t('admin.libraries.title')" :description="$t('admin.libraries.description')">
    <button @click="openAddLibrary" class="btn btn-primary">
      <Plus class="w-3.5 h-3.5" /> {{ $t('admin.libraries.add') }}
    </button>
  </SectionHeader>

  <SettingsCard flush>
    <p v-if="!libraries.length" class="py-12 px-6 text-center text-xs text-muted-foreground">
      {{ $t('admin.libraries.empty') }}
    </p>
    <ul v-else class="divide-y divide-border">
      <li v-for="lib in libraries" :key="lib.id" class="px-4 sm:px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <component :is="libraryIcon(lib.type)" class="w-5 h-5 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-foreground truncate flex items-center gap-2">
            {{ lib.name }}
            <span v-if="lib.kids_allowed" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-500"><Baby class="w-2.5 h-2.5" /> {{ $t('admin.libraries.kids') }}</span>
          </p>
          <p class="text-[12px] text-muted-foreground font-mono truncate" :title="lib.path">{{ lib.path }}</p>
          <p class="text-[12px] text-muted-foreground">{{ libraryTypeLabel(lib.type) }} · {{ $t('admin.libraries.items', { count: lib.item_count || 0, number: $n(lib.item_count || 0) }) }}</p>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <button @click="triggerScan(lib)" :disabled="scanningId === lib.id" class="btn btn-secondary">
            <RefreshCw :class="['w-3.5 h-3.5', scanningId === lib.id ? 'animate-spin' : '']" />
            {{ scanningId === lib.id ? $t('admin.libraries.scanning') : $t('admin.libraries.scan') }}
          </button>
          <button @click="deleteLibrary(lib)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.libraries.deleteAria', { name: lib.name })" :title="$t('admin.libraries.deleteLibrary')">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>
  </SettingsCard>

  <SettingsCard :title="$t('admin.libraries.autoScan.title')" :description="$t('admin.libraries.autoScan.desc')">
    <template #actions><SaveStatus :status="scanSave.status.value" :message="scanSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow v-model="autoScan.enabled" :label="$t('admin.libraries.autoScan.scheduled.label')" :description="$t('admin.libraries.autoScan.scheduled.desc')" />
      <template v-if="autoScan.enabled">
        <div class="py-3 flex flex-wrap items-center justify-between gap-3">
          <label for="auto-scan-mode" class="text-xs font-semibold text-foreground">{{ $t('admin.libraries.autoScan.schedule') }}</label>
          <select id="auto-scan-mode" v-model="autoScan.mode" class="field w-auto min-w-[10rem]">
            <option value="interval">{{ $t('admin.libraries.autoScan.modes.interval') }}</option>
            <option value="times">{{ $t('admin.libraries.autoScan.modes.times') }}</option>
          </select>
        </div>
        <div v-if="autoScan.mode === 'interval'" class="py-3 flex flex-wrap items-center justify-between gap-3">
          <label for="auto-scan-interval" class="text-xs font-semibold text-foreground">{{ $t('admin.libraries.autoScan.every') }}</label>
          <select id="auto-scan-interval" v-model.number="autoScan.intervalMinutes" class="field w-auto min-w-[10rem]">
            <option v-for="minutes in [15, 30, 60, 360, 1440]" :key="minutes" :value="minutes">{{ $t(`admin.libraries.autoScan.intervals.${minutes}`) }}</option>
          </select>
        </div>
        <div v-else class="py-3 flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-xs font-semibold text-foreground">{{ $t('admin.libraries.autoScan.at') }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <div v-for="(time, index) in autoScan.times" :key="index" class="flex items-center gap-1">
                <input type="time" v-model="autoScan.times[index]" :aria-label="$t('admin.libraries.autoScan.timeAria', { number: index + 1 })" class="field w-auto" />
                <button type="button" @click="autoScan.times.splice(index, 1)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('admin.libraries.autoScan.removeTime', { time: time || $t('admin.libraries.autoScan.thisTime') })">
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
              <button v-if="autoScan.times.length < 12" type="button" @click="autoScan.times.push('03:00')" class="btn btn-secondary">
                <Plus class="w-3.5 h-3.5" /> {{ $t('admin.libraries.autoScan.addTime') }}
              </button>
            </div>
          </div>
          <p class="field-hint">{{ $t('admin.libraries.autoScan.timesHint') }}</p>
        </div>
      </template>
      <ToggleRow v-model="autoScan.watchEnabled" :label="$t('admin.libraries.autoScan.watch.label')" :description="$t('admin.libraries.autoScan.watch.desc')" />
    </div>
    <p v-if="scanningIsManual" class="mt-3 text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-400" role="status">
      <TriangleAlert class="w-3.5 h-3.5 mt-px flex-shrink-0" />
      {{ $t('admin.libraries.autoScan.manual') }}
    </p>
    <p v-else-if="!autoScan.enabled" class="mt-3 text-xs text-muted-foreground">
      {{ $t('admin.libraries.autoScan.noSchedule') }}
    </p>
    <p v-else-if="autoScan.mode === 'times' && !autoScan.times.length" class="mt-3 text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-400" role="status">
      <TriangleAlert class="w-3.5 h-3.5 mt-px flex-shrink-0" />
      {{ $t('admin.libraries.autoScan.noTimes') }}
    </p>
  </SettingsCard>

  <!-- Add a library -->
  <SettingsDialog :open="showAdd" :title="$t('admin.libraries.addDialog.title')" @close="showAdd = false">
    <form id="add-library-form" @submit.prevent="submitAddLibrary" class="flex flex-col gap-4">
      <div>
        <label for="lib-path" class="field-label">{{ $t('admin.libraries.addDialog.folder') }}</label>
        <div class="flex gap-2">
          <input id="lib-path" v-model="newLib.path" required placeholder="/media/Books" class="field font-mono flex-1 min-w-0" />
          <button type="button" @click="showPicker = true" class="btn btn-secondary flex-shrink-0">
            <FolderOpen class="w-3.5 h-3.5" /> {{ $t('admin.libraries.addDialog.browse') }}
          </button>
        </div>
        <I18nT keypath="admin.libraries.addDialog.folderHint" tag="p" class="field-hint">
          <template #path><code class="bg-muted px-1 rounded font-mono">/media</code></template>
        </I18nT>
        <div v-if="discoveredFolders.length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="folder in discoveredFolders"
            :key="folder.path"
            type="button"
            @click="useFolder(folder.path)"
            class="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/70 text-[12px] font-mono text-foreground border border-border transition"
          >{{ folder.name }}</button>
        </div>
      </div>
      <div>
        <label for="lib-name" class="field-label">{{ $t('admin.libraries.addDialog.name') }}</label>
        <input id="lib-name" v-model="newLib.name" required :placeholder="$t('admin.libraries.addDialog.namePlaceholder')" class="field" />
      </div>
      <div>
        <p class="field-label">{{ $t('admin.libraries.addDialog.whatsInIt') }}</p>
        <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="$t('admin.libraries.addDialog.whatsInIt')">
          <button
            v-for="t in LIBRARY_TYPES"
            :key="t.id"
            type="button"
            role="radio"
            :aria-checked="newLib.type === t.id"
            @click="newLib.type = t.id"
            :class="[
              'p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition',
              newLib.type === t.id ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/30'
            ]"
          >
            <component :is="t.icon" class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span class="min-w-0">
              <span class="block text-xs font-semibold text-foreground">{{ t.label }}</span>
              <span class="block text-[11px] text-muted-foreground truncate">{{ t.formats }}</span>
            </span>
          </button>
        </div>
      </div>
    </form>
    <template #footer>
      <button type="button" @click="showAdd = false" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="add-library-form" :disabled="adding" class="btn btn-primary">
        {{ adding ? $t('admin.libraries.addDialog.adding') : $t('admin.libraries.addDialog.addAndScan') }}
      </button>
    </template>
  </SettingsDialog>

  <FolderPicker
    :open="showPicker"
    :start="newLib.path || '/media'"
    :title="$t('admin.libraries.addDialog.pickerTitle')"
    @close="showPicker = false"
    @select="(p) => { useFolder(p); showPicker = false; }"
  />
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Plus, RefreshCw, Trash2, FolderOpen, Baby, Headphones, FileImage, Book, Film, Tv, Sparkles, X, TriangleAlert } from '@lucide/vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import FolderPicker from '../FolderPicker.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t, list } from '../../i18n';

const props = defineProps({
  libraries: { type: Array, default: () => [] }
});
const emit = defineEmits(['changed']);
const dialog = useDialogStore();

// Labels are getters so they follow the current language.
const libraryType = (id, formats, icon) => ({ id, formats, icon, get label() { return t(`admin.libraries.types.${id}`); } });
const LIBRARY_TYPES = [
  libraryType('movies', '.mp4, .mkv', Film),
  libraryType('shows', '.mp4, .mkv', Tv),
  libraryType('anime', '.mp4, .mkv', Sparkles),
  libraryType('books', '.epub, .pdf', Book),
  libraryType('manga', '.cbz, .cbr, .zip', FileImage),
  libraryType('audiobooks', '.m4b, .mp3', Headphones)
];
const libraryIcon = (type) => LIBRARY_TYPES.find((x) => x.id === type)?.icon || Book;
const libraryTypeLabel = (type) => LIBRARY_TYPES.find((x) => x.id === type)?.label || type;

// ─── Scanning ──────────────────────────────────────────────────────────────
const scanningId = ref(null);
async function triggerScan(lib) {
  scanningId.value = lib.id;
  try {
    const res = await api.post(`/libraries/${lib.id}/scan`);
    emit('changed');
    const { added = 0, updated = 0, renamed = 0, removed = 0 } = res.data || {};
    const parts = [];
    if (added) parts.push(t('admin.libraries.scanResult.added', { count: added }));
    if (renamed) parts.push(t('admin.libraries.scanResult.renamed', { count: renamed }));
    if (updated) parts.push(t('admin.libraries.scanResult.updated', { count: updated }));
    if (removed) parts.push(t('admin.libraries.scanResult.removed', { count: removed }));
    dialog.alert({
      title: t('admin.libraries.scanResult.title', { name: lib.name }),
      message: parts.length
        ? t('admin.libraries.scanResult.summary', { parts: list(parts, { type: 'unit', style: 'short' }) })
        : t('admin.libraries.scanResult.nothingNew'),
      type: 'success'
    });
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.libraries.scanFailed'));
  } finally {
    scanningId.value = null;
  }
}

async function deleteLibrary(lib) {
  const confirmed = await dialog.confirm({
    title: t('admin.libraries.deleteLibrary'),
    message: t('admin.libraries.deleteMessage', { name: lib.name }),
    confirmText: t('admin.libraries.deleteLibrary'),
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/libraries/${lib.id}`);
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.libraries.couldNotDelete'));
  }
}

// ─── Automatic scanning (saves as it changes) ─────────────────────────────
const scanSave = useSaveStatus();
const autoScan = ref({ enabled: true, mode: 'interval', intervalMinutes: 60, times: ['03:00'], watchEnabled: true });
const scanningIsManual = computed(() => !autoScan.value.enabled && !autoScan.value.watchEnabled);
let autoScanLoaded = false;
onMounted(async () => {
  try {
    const res = await api.get('/settings/auto-scan');
    autoScan.value = {
      enabled: !!res.data.enabled,
      mode: res.data.mode === 'times' ? 'times' : 'interval',
      intervalMinutes: res.data.intervalMinutes || 60,
      times: Array.isArray(res.data.times) ? [...res.data.times] : [],
      watchEnabled: !!res.data.watchEnabled
    };
  } catch (err) {
    console.warn('Could not load automatic scanning:', err);
  }
  autoScanLoaded = true;
});
watch(autoScan, (value) => {
  if (!autoScanLoaded) return;
  // A time input is briefly empty while it's being edited; only send complete ones.
  const times = value.times.filter((time) => /^\d{2}:\d{2}$/.test(time));
  scanSave.run(() => api.put('/settings/auto-scan', { ...value, times }));
}, { deep: true });

// ─── Adding a library ──────────────────────────────────────────────────────
const showAdd = ref(false);
const showPicker = ref(false);
const adding = ref(false);
const discoveredFolders = ref([]);
const newLib = ref({ name: '', path: '', type: 'movies' });

async function openAddLibrary() {
  newLib.value = { name: '', path: '', type: 'movies' };
  showAdd.value = true;
  try {
    const res = await api.get('/libraries/browse');
    // Folders already used by a library aren't offered again.
    const used = new Set(props.libraries.map((l) => l.path));
    discoveredFolders.value = (res.data.directories || []).filter((d) => !used.has(d.path));
  } catch (err) {
    discoveredFolders.value = [];
  }
}

// A folder picked: name the library after it, and guess what's in it from the name.
function useFolder(path) {
  newLib.value.path = path;
  const name = path.split('/').filter(Boolean).pop() || '';
  if (!newLib.value.name) newLib.value.name = name;
  const lower = name.toLowerCase();
  const guess = [
    [/manga|comic/, 'manga'],
    [/audio/, 'audiobooks'],
    [/book|ebook|epub/, 'books'],
    [/anime/, 'anime'],
    [/tv|show|series/, 'shows'],
    [/movie|film/, 'movies']
  ].find(([re]) => re.test(lower));
  if (guess) newLib.value.type = guess[1];
}

async function submitAddLibrary() {
  adding.value = true;
  try {
    await api.post('/libraries', newLib.value);
    showAdd.value = false;
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.libraries.couldNotAdd'));
  } finally {
    adding.value = false;
  }
}
</script>
