<template>
  <div v-if="isOpen && item" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-card border border-border rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
      <!-- Modal Header -->
      <div class="px-5 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <Bookmark class="w-4 h-4 text-primary flex-shrink-0" />
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-foreground truncate">Bookmarks: {{ item.title }}</h3>
            <p class="text-[11px] text-muted-foreground truncate">{{ item.author || 'Unknown' }}</p>
          </div>
        </div>
        <button aria-label="Close bookmarks"
          @click="$emit('close')"
          class="p-2.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Add Bookmark Section -->
      <div class="p-4 border-b border-border bg-muted/20">
        <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Bookmark</span>
          <span class="text-[11px] text-muted-foreground font-mono">
            {{ item.media_type === 'audiobook' ? 'Timestamp (hh:mm:ss or seconds)' : 'Page Number' }}
          </span>
        </div>

        <form @submit.prevent="createBookmark" class="flex flex-col gap-2.5">
          <div class="flex gap-2">
            <input
              v-model="newPositionInput"
              :placeholder="item.media_type === 'audiobook' ? 'e.g. 01:15:30 or 4500' : 'e.g. 42'"
              required
              class="w-36 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            />
            <input
              v-model="newTitleInput"
              placeholder="Title / Label (optional)"
              class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <textarea
            v-model="newNotesInput"
            placeholder="Add notes, quotes, or thoughts (optional)..."
            rows="2"
            class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          ></textarea>

          <button
            type="submit"
            :disabled="!newPositionInput.trim() || saving"
            class="self-end px-3.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>{{ saving ? 'Saving...' : 'Add Bookmark' }}</span>
          </button>
        </form>
      </div>

      <!-- Bookmarks List -->
      <div class="p-4 overflow-y-auto flex-1 flex flex-col gap-2.5">
        <div v-if="loading" class="text-center py-8 text-xs text-muted-foreground">
          Loading bookmarks...
        </div>

        <div
          v-else-if="bookmarks.length === 0"
          class="text-center py-8 text-xs text-muted-foreground border border-dashed border-border rounded-xl"
        >
          No bookmarks saved yet. Use the form above to bookmark a position or page.
        </div>

        <div
          v-else
          v-for="bm in bookmarks"
          :key="bm.id"
          class="bg-muted/40 border border-border rounded-xl p-3 flex flex-col gap-1.5 hover:bg-muted/60 transition"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                {{ formatPosition(bm.position) }}
              </span>
              <span class="text-xs font-semibold text-foreground truncate">
                {{ bm.title || 'Bookmark' }}
              </span>
            </div>

            <div class="flex items-center gap-1">
              <button
                @click="jumpToBookmark(bm)"
                class="px-2 py-1 rounded bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-medium transition flex items-center gap-1 border border-border"
                title="Jump to position"
              >
                <Play v-if="item.media_type === 'audiobook'" class="w-3 h-3" />
                <BookOpen v-else class="w-3 h-3" />
                <span>Jump</span>
              </button>
              <button aria-label="Delete bookmark"
                @click="deleteBookmark(bm.id)"
                class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition"
                title="Delete bookmark"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p v-if="bm.notes" class="text-xs text-muted-foreground bg-background/50 border border-border/60 rounded-md p-2 mt-0.5 whitespace-pre-wrap">
            {{ bm.notes }}
          </p>

          <span class="text-[10px] text-muted-foreground/80 self-end">
            {{ formatDate(bm.created_at) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import api from '../api/client';
import { usePlayerStore } from '../stores/player';
import { useDialogStore } from '../stores/dialog';
import { Bookmark, X, Plus, Trash2, Play, BookOpen } from 'lucide-vue-next';

const props = defineProps({
  isOpen: Boolean,
  item: Object
});

const emit = defineEmits(['close', 'select-manga-page']);
const player = usePlayerStore();
const dialog = useDialogStore();

const bookmarks = ref([]);
const loading = ref(false);
const saving = ref(false);

const newPositionInput = ref('');
const newTitleInput = ref('');
const newNotesInput = ref('');

function parsePositionInput(val) {
  if (!val) return 0;
  if (val.includes(':')) {
    const parts = val.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }
  return parseFloat(val) || 0;
}

function formatPosition(sec) {
  if (props.item?.media_type === 'audiobook') {
    const s = Math.floor(sec || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `Page ${Math.floor(sec || 1)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadBookmarks() {
  if (!props.item?.id) return;
  loading.value = true;
  try {
    const res = await api.get(`/bookmarks/${props.item.id}`);
    bookmarks.value = res.data.bookmarks || [];
  } catch (err) {
    console.warn('Failed to load bookmarks:', err);
  } finally {
    loading.value = false;
  }
}

async function createBookmark() {
  const pos = parsePositionInput(newPositionInput.value);
  saving.value = true;
  try {
    await api.post('/bookmarks', {
      itemId: props.item.id,
      type: props.item.media_type,
      position: pos,
      title: newTitleInput.value.trim() || undefined,
      notes: newNotesInput.value.trim() || undefined
    });
    newPositionInput.value = '';
    newTitleInput.value = '';
    newNotesInput.value = '';
    await loadBookmarks();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to create bookmark');
  } finally {
    saving.value = false;
  }
}

async function deleteBookmark(id) {
  try {
    await api.delete(`/bookmarks/${id}`);
    bookmarks.value = bookmarks.value.filter(b => b.id !== id);
  } catch (err) {
    dialog.alert('Failed to delete bookmark');
  }
}

function jumpToBookmark(bm) {
  if (props.item.media_type === 'audiobook') {
    if (player.currentItem?.id !== props.item.id) {
      player.playItem(props.item);
    }
    player.seek(bm.position);
    emit('close');
  } else if (props.item.media_type === 'manga') {
    emit('select-manga-page', { item: props.item, page: Math.floor(bm.position) });
    emit('close');
  } else {
    const token = localStorage.getItem('plinthio_token');
    window.open(`/api/media/book/${props.item.id}/file?token=${token}`, '_blank');
  }
}

watch(
  () => props.isOpen,
  (val) => {
    if (val && props.item) {
      loadBookmarks();
    }
  }
);
</script>
