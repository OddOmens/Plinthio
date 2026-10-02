<template>
  <SectionHeader title="Libraries" description="The folders Plinthio reads your media from. It never changes your files.">
    <button @click="openAddLibrary" class="btn btn-primary">
      <Plus class="w-3.5 h-3.5" /> Add library
    </button>
  </SectionHeader>

  <SettingsCard flush>
    <p v-if="!libraries.length" class="py-12 px-6 text-center text-xs text-muted-foreground">
      No libraries yet. Add one to point Plinthio at a folder of media.
    </p>
    <ul v-else class="divide-y divide-border">
      <li v-for="lib in libraries" :key="lib.id" class="px-4 sm:px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <component :is="libraryIcon(lib.type)" class="w-5 h-5 text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-foreground truncate flex items-center gap-2">
            {{ lib.name }}
            <span v-if="lib.kids_allowed" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-500"><Baby class="w-2.5 h-2.5" /> Kids</span>
          </p>
          <p class="text-[12px] text-muted-foreground font-mono truncate" :title="lib.path">{{ lib.path }}</p>
          <p class="text-[12px] text-muted-foreground">{{ libraryTypeLabel(lib.type) }} · {{ (lib.item_count || 0).toLocaleString() }} items</p>
        </div>
        <div class="flex items-center gap-1.5 ml-auto">
          <button @click="triggerScan(lib)" :disabled="scanningId === lib.id" class="btn btn-secondary">
            <RefreshCw :class="['w-3.5 h-3.5', scanningId === lib.id ? 'animate-spin' : '']" />
            {{ scanningId === lib.id ? 'Scanning…' : 'Scan' }}
          </button>
          <button @click="deleteLibrary(lib)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="`Delete ${lib.name}`" title="Delete library">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>
  </SettingsCard>

  <SettingsCard title="Automatic scanning" description="Picks up media added to your library folders without anyone pressing Scan.">
    <template #actions><SaveStatus :status="scanSave.status.value" :message="scanSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow v-model="autoScan.enabled" label="Re-scan on a schedule" description="The dependable one: works on network shares and mounts that report no changes." />
      <div v-if="autoScan.enabled" class="py-3 flex flex-wrap items-center justify-between gap-3">
        <label for="auto-scan-interval" class="text-xs font-semibold text-foreground">Re-scan every</label>
        <select id="auto-scan-interval" v-model.number="autoScan.intervalMinutes" class="field w-auto min-w-[10rem]">
          <option :value="15">15 minutes</option>
          <option :value="30">30 minutes</option>
          <option :value="60">hour</option>
          <option :value="360">6 hours</option>
          <option :value="1440">day</option>
        </select>
      </div>
      <ToggleRow v-if="autoScan.enabled" v-model="autoScan.watchEnabled" label="Watch folders for changes" description="Scans about 30 seconds after a file appears, where the filesystem reports it." />
    </div>
  </SettingsCard>

  <!-- Add a library -->
  <SettingsDialog :open="showAdd" title="Add a library" @close="showAdd = false">
    <form id="add-library-form" @submit.prevent="submitAddLibrary" class="flex flex-col gap-4">
      <div>
        <label for="lib-path" class="field-label">Folder</label>
        <div class="flex gap-2">
          <input id="lib-path" v-model="newLib.path" required placeholder="/media/Books" class="field font-mono flex-1 min-w-0" />
          <button type="button" @click="showPicker = true" class="btn btn-secondary flex-shrink-0">
            <FolderOpen class="w-3.5 h-3.5" /> Browse
          </button>
        </div>
        <p class="field-hint">As the server sees it. In Docker, your media is mounted at <code class="bg-muted px-1 rounded font-mono">/media</code>.</p>
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
        <label for="lib-name" class="field-label">Name</label>
        <input id="lib-name" v-model="newLib.name" required placeholder="e.g. Audiobooks" class="field" />
      </div>
      <div>
        <p class="field-label">What's in it</p>
        <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What's in it">
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
      <button type="button" @click="showAdd = false" class="btn btn-secondary ml-auto">Cancel</button>
      <button type="submit" form="add-library-form" :disabled="adding" class="btn btn-primary">
        {{ adding ? 'Adding…' : 'Add and scan' }}
      </button>
    </template>
  </SettingsDialog>

  <FolderPicker
    :open="showPicker"
    :start="newLib.path || '/media'"
    title="Choose the library folder"
    @close="showPicker = false"
    @select="(p) => { useFolder(p); showPicker = false; }"
  />
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { Plus, RefreshCw, Trash2, FolderOpen, Baby, Headphones, FileImage, Book, Film, Tv, Sparkles } from '@lucide/vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import FolderPicker from '../FolderPicker.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';

const props = defineProps({
  libraries: { type: Array, default: () => [] }
});
const emit = defineEmits(['changed']);
const dialog = useDialogStore();

const LIBRARY_TYPES = [
  { id: 'movies', label: 'Movies', formats: '.mp4, .mkv', icon: Film },
  { id: 'shows', label: 'TV shows', formats: '.mp4, .mkv', icon: Tv },
  { id: 'anime', label: 'Anime', formats: '.mp4, .mkv', icon: Sparkles },
  { id: 'books', label: 'Books', formats: '.epub, .pdf', icon: Book },
  { id: 'manga', label: 'Manga & comics', formats: '.cbz, .cbr, .zip', icon: FileImage },
  { id: 'audiobooks', label: 'Audiobooks', formats: '.m4b, .mp3', icon: Headphones }
];
const libraryIcon = (type) => LIBRARY_TYPES.find((t) => t.id === type)?.icon || Book;
const libraryTypeLabel = (type) => LIBRARY_TYPES.find((t) => t.id === type)?.label || type;

// ─── Scanning ──────────────────────────────────────────────────────────────
const scanningId = ref(null);
async function triggerScan(lib) {
  scanningId.value = lib.id;
  try {
    const res = await api.post(`/libraries/${lib.id}/scan`);
    emit('changed');
    const { added = 0, updated = 0, renamed = 0, removed = 0 } = res.data || {};
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (renamed) parts.push(`${renamed} renamed or moved`);
    if (updated) parts.push(`${updated} updated`);
    if (removed) parts.push(`${removed} removed`);
    dialog.alert({ title: `Scanned ${lib.name}`, message: parts.length ? `${parts.join(', ')}.` : 'Nothing new.', type: 'success' });
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Scan failed');
  } finally {
    scanningId.value = null;
  }
}

async function deleteLibrary(lib) {
  const confirmed = await dialog.confirm({
    title: 'Delete library',
    message: `Delete "${lib.name}"? Your files aren't touched, and progress and bookmarks come back if you add the same folder again. Its titles, covers and details are removed until it's scanned again.`,
    confirmText: 'Delete library',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/libraries/${lib.id}`);
    emit('changed');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not delete that library');
  }
}

// ─── Automatic scanning (saves as it changes) ─────────────────────────────
const scanSave = useSaveStatus();
const autoScan = ref({ enabled: true, intervalMinutes: 60, watchEnabled: true });
let autoScanLoaded = false;
onMounted(async () => {
  try {
    const res = await api.get('/settings/auto-scan');
    autoScan.value = { enabled: !!res.data.enabled, intervalMinutes: res.data.intervalMinutes || 60, watchEnabled: !!res.data.watchEnabled };
  } catch (err) {
    console.warn('Could not load automatic scanning:', err);
  }
  autoScanLoaded = true;
});
watch(autoScan, (value) => {
  if (!autoScanLoaded) return;
  scanSave.run(() => api.put('/settings/auto-scan', value));
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
    dialog.alert(err.response?.data?.error || 'Could not add that library');
  } finally {
    adding.value = false;
  }
}
</script>
