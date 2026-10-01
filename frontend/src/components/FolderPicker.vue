<template>
  <!-- Picks a folder on the server (as the server sees it: in Docker, the container's
       paths). Uses the same browse endpoint as Add Library. -->
  <div v-if="open" class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" @click.self="$emit('close')">
    <div role="dialog" aria-modal="true" :aria-label="title" class="bg-card border border-border rounded-t-2xl sm:rounded-xl w-full sm:max-w-md shadow-xl flex flex-col max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
      <div class="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h3 class="text-sm font-semibold text-foreground">{{ title }}</h3>
        <button type="button" aria-label="Close" @click="$emit('close')" class="w-8 h-8 -mr-2 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="px-5 pb-2 flex items-center gap-2">
        <button type="button" @click="goUp" :disabled="current === '/'" aria-label="Up one folder" class="w-9 h-9 flex-shrink-0 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition">
          <ArrowUp class="w-4 h-4" />
        </button>
        <code class="flex-1 min-w-0 truncate text-xs text-foreground bg-muted rounded-lg px-2.5 py-2" :title="current">{{ current }}</code>
      </div>

      <div class="flex-1 min-h-[12rem] overflow-y-auto px-3 pb-2">
        <p v-if="loading" class="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        <p v-else-if="error" class="py-6 text-center text-xs text-destructive">{{ error }}</p>
        <template v-else>
          <button
            v-for="d in entries"
            :key="d.path"
            type="button"
            @click="browse(d.path)"
            class="w-full h-10 px-2 rounded-lg flex items-center gap-2.5 text-sm text-foreground hover:bg-muted/70 transition text-left"
          >
            <Folder class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span class="truncate">{{ d.name }}</span>
          </button>
          <p v-if="!entries.length" class="py-6 text-center text-xs text-muted-foreground">No folders in here.</p>
        </template>
      </div>

      <div class="px-5 py-3 border-t border-border flex flex-col gap-2">
        <label class="text-[12px] text-muted-foreground" for="folder-picker-new">New folder inside this one (optional)</label>
        <input
          id="folder-picker-new"
          v-model="newFolder"
          placeholder="e.g. Plinthio Backups"
          class="w-full h-9 bg-background border border-border rounded-md px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" @click="$emit('close')" class="h-9 px-3.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">Cancel</button>
          <button type="button" @click="choose" class="h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-xs font-medium">Use {{ newFolder.trim() ? 'new folder' : 'this folder' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { X, ArrowUp, Folder } from '@lucide/vue';
import api from '../api/client';

const props = defineProps({
  open: { type: Boolean, default: false },
  start: { type: String, default: '/media' },
  title: { type: String, default: 'Choose a folder' }
});
const emit = defineEmits(['close', 'select']);

const current = ref('/');
const entries = ref([]);
const loading = ref(false);
const error = ref('');
const newFolder = ref('');

async function browse(dir) {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/libraries/browse', { params: { dir } });
    current.value = res.data.currentDir || dir;
    entries.value = res.data.directories || [];
  } catch (err) {
    error.value = err.response?.data?.error || "Couldn't open that folder";
  } finally {
    loading.value = false;
  }
}

function goUp() {
  const parts = current.value.split('/').filter(Boolean);
  parts.pop();
  browse(`/${parts.join('/')}`);
}

function choose() {
  const sub = newFolder.value.trim().replace(/^\/+|\/+$/g, '');
  const base = current.value.replace(/\/+$/, '');
  emit('select', sub ? `${base}/${sub}` : (current.value || '/'));
}

watch(() => props.open, (open) => {
  if (!open) return;
  newFolder.value = '';
  browse(props.start || '/media');
}, { immediate: true });
</script>
