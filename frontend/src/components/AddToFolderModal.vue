<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div
      v-click-outside="close"
      class="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col transition-all"
    >
      <!-- Header -->
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <div class="min-w-0 pr-2">
          <h3 class="text-sm font-semibold text-foreground truncate">Add to Custom Folder</h3>
          <p class="text-xs text-muted-foreground truncate mt-0.5">{{ item?.title }}</p>
        </div>
        <button
          type="button"
          @click="close"
          class="p-2.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Folder Selection List -->
      <div class="p-5 flex flex-col gap-4 max-h-[350px] overflow-y-auto">
        <div v-if="loading" class="py-6 text-center text-xs text-muted-foreground">
          Loading folders...
        </div>

        <div v-else-if="folders.length === 0" class="py-6 text-center text-xs text-muted-foreground">
          No custom folders created yet. Create one below to organize your media!
        </div>

        <div v-else class="flex flex-col gap-2">
          <label
            v-for="folder in folders"
            :key="folder.id"
            class="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition select-none"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <Folder class="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span class="text-xs font-medium text-foreground truncate">{{ folder.name }}</span>
            </div>
            <input
              type="checkbox"
              :checked="folder.in_collection === 1"
              @change="toggleFolderItem(folder)"
              class="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary"
            />
          </label>
        </div>

        <!-- Create New Folder Form -->
        <div class="pt-3 border-t border-border flex flex-col gap-2.5">
          <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FolderPlus class="w-3.5 h-3.5 text-muted-foreground" />
            New Custom Folder
          </span>
          <div class="flex gap-2">
            <input
              v-model="newFolderName"
              @keyup.enter="createFolder"
              placeholder="e.g. Favorites, Bedtime..."
              class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              @click="createFolder"
              :disabled="!newFolderName.trim() || creating"
              class="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition disabled:opacity-50 shadow-sm"
            >
              {{ creating ? 'Adding...' : 'Create' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-border bg-muted/20 flex justify-end">
        <button
          type="button"
          @click="close"
          class="px-3.5 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition"
        >
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { X, Folder, FolderPlus } from 'lucide-vue-next';

const dialog = useDialogStore();

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  item: { type: Object, default: null }
});

const emit = defineEmits(['close', 'updated']);

const folders = ref([]);
const loading = ref(false);
const newFolderName = ref('');
const creating = ref(false);

async function loadItemFolders() {
  if (!props.item?.id) return;
  loading.value = true;
  try {
    const res = await api.get(`/collections/for-item/${props.item.id}`);
    folders.value = res.data.folders || [];
  } catch (err) {
    console.warn('Failed to load item folders:', err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.isOpen,
  (val) => {
    if (val && props.item) {
      newFolderName.value = '';
      loadItemFolders();
    }
  }
);

async function toggleFolderItem(folder) {
  const willBeIn = folder.in_collection === 0;
  folder.in_collection = willBeIn ? 1 : 0;

  try {
    if (willBeIn) {
      await api.post(`/collections/${folder.id}/items`, { itemId: props.item.id });
    } else {
      await api.delete(`/collections/${folder.id}/items/${props.item.id}`);
    }
    emit('updated');
  } catch (err) {
    // Revert on error
    folder.in_collection = willBeIn ? 0 : 1;
    dialog.alert(err.response?.data?.error || 'Failed to update folder');
  }
}

async function createFolder() {
  if (!newFolderName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    const res = await api.post('/collections', { name: newFolderName.value.trim() });
    const newCol = res.data.collection;

    // Immediately add the current item to the new folder
    await api.post(`/collections/${newCol.id}/items`, { itemId: props.item.id });

    newFolderName.value = '';
    await loadItemFolders();
    emit('updated');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to create folder');
  } finally {
    creating.value = false;
  }
}

function close() {
  emit('close');
}
</script>
