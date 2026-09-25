<template>
  <div class="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6 safe-top pb-32">
    <div class="flex items-center gap-3">
      <router-link
        to="/"
        class="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
        title="Back to Shelves"
        aria-label="Back to Shelves"
      >
        <ArrowLeft class="w-4 h-4" />
      </router-link>
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-foreground">Downloads</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Books, comics and audiobooks saved on this device for reading without a connection.
        </p>
      </div>
    </div>

    <p v-if="!online" class="text-xs rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2 flex items-center gap-2">
      <WifiOff class="w-4 h-4 flex-shrink-0" />
      You're offline. Downloads still open; reading progress syncs when you're back online.
    </p>

    <p v-if="!downloads.supported" class="text-sm text-muted-foreground">
      This browser can't store downloads (it needs Service Worker and Cache Storage support, and a secure https:// or localhost address).
    </p>

    <!-- Storage -->
    <div v-if="downloads.supported" class="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span class="font-medium text-foreground">{{ formatBytes(downloads.totalBytes) }} in {{ downloads.list.length }} download{{ downloads.list.length === 1 ? '' : 's' }}</span>
        <span v-if="downloads.quota" class="text-muted-foreground">{{ formatBytes(downloads.usage) }} of {{ formatBytes(downloads.quota) }} used on this device</span>
      </div>
      <div v-if="downloads.quota" class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full bg-primary" :style="{ width: `${Math.min(100, (downloads.usage / downloads.quota) * 100)}%` }" />
      </div>
      <p class="text-[11px] text-muted-foreground">
        Downloads are tied to this browser and your account — signing out removes them.
      </p>
    </div>

    <!-- In progress -->
    <section v-if="activeList.length" class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold text-foreground">Downloading</h2>
      <div v-for="entry in activeList" :key="entry.id" class="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-foreground truncate">{{ entry.title }}</p>
          <p v-if="entry.error" class="text-xs text-destructive">{{ entry.error }}</p>
          <template v-else>
            <div class="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: `${entry.percent}%` }" />
            </div>
            <p class="text-[11px] text-muted-foreground mt-1 tabular-nums">{{ entry.label }}</p>
          </template>
        </div>
        <button
          type="button"
          @click="entry.error ? downloads.dismissError(entry.id) : downloads.cancel(entry.id)"
          class="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition"
        >
          {{ entry.error ? 'Dismiss' : 'Cancel' }}
        </button>
      </div>
    </section>

    <!-- Downloaded -->
    <section v-if="downloads.list.length" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div v-for="entry in downloads.list" :key="entry.id" class="rounded-xl border border-border bg-card p-3 flex gap-3">
        <button type="button" @click="openEntry(entry)" class="w-16 aspect-[2/3] rounded-lg overflow-hidden bg-muted flex-shrink-0" :aria-label="`Open ${entry.item.title}`">
          <img :src="coverUrl(entry.item, { width: 180 })" :alt="''" class="w-full h-full object-cover" loading="lazy" />
        </button>
        <div class="min-w-0 flex-1 flex flex-col">
          <p class="text-sm font-semibold text-foreground line-clamp-2 leading-snug">{{ entry.item.title }}</p>
          <p class="text-xs text-muted-foreground truncate">{{ entry.item.series || entry.item.author || '' }}</p>
          <p class="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <component :is="kindIcon(entry.kind)" class="w-3 h-3" />
            {{ formatBytes(entry.bytes) }}
          </p>
          <div class="mt-auto pt-2 flex items-center gap-2">
            <button
              type="button"
              @click="openEntry(entry)"
              class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition active:scale-95 flex items-center gap-1.5"
            >
              <Play v-if="entry.kind === 'audio'" class="w-3.5 h-3.5 fill-current" />
              <BookOpen v-else class="w-3.5 h-3.5" />
              {{ entry.kind === 'audio' ? 'Play' : 'Read' }}
            </button>
            <button
              type="button"
              @click="removeEntry(entry)"
              class="h-8 w-8 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition flex items-center justify-center"
              :aria-label="`Remove download of ${entry.item.title}`"
              title="Remove download"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <div v-else-if="downloads.supported && !activeList.length" class="flex flex-col items-center text-center py-16 border border-dashed border-border rounded-2xl">
      <Download class="w-6 h-6 text-muted-foreground mb-2" />
      <p class="text-sm font-medium text-foreground">Nothing downloaded yet</p>
      <p class="text-xs text-muted-foreground mt-1 max-w-xs">
        Use <strong>Download for offline</strong> in a title's ⋮ menu, or the download button on a manga volume.
      </p>
    </div>

    <MangaReader v-if="activeManga" :item="activeManga" @close="activeManga = null" />
    <EpubReader v-if="activeEpub" :item="activeEpub" @close="activeEpub = null" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import api from '../api/client';
import { useDownloadsStore } from '../stores/downloads';
import { usePlayerStore } from '../stores/player';
import { useDialogStore } from '../stores/dialog';
import { coverUrl } from '../utils/cover';
import { getMediaToken } from '../utils/mediaToken';
import { ArrowLeft, WifiOff, Download, Trash2, Play, BookOpen, Headphones, FileImage, Book } from 'lucide-vue-next';

const MangaReader = defineAsyncComponent(() => import('../components/MangaReader.vue'));
const EpubReader = defineAsyncComponent(() => import('../components/EpubReader.vue'));

const downloads = useDownloadsStore();
const player = usePlayerStore();
const dialog = useDialogStore();

const online = ref(navigator.onLine);
const setOnline = () => { online.value = navigator.onLine; };
const activeManga = ref(null);
const activeEpub = ref(null);

const activeList = computed(() => Object.entries(downloads.active).map(([id, a]) => {
  const pages = a.pages;
  const percent = pages?.total
    ? Math.round((pages.done / pages.total) * 100)
    : a.total ? Math.min(100, Math.round((a.received / a.total) * 100)) : 0;
  return {
    id,
    title: a.title || 'Download',
    error: a.error,
    percent,
    label: pages?.total ? `${pages.done} / ${pages.total} pages` : `${formatBytes(a.received)}${a.total ? ` of ${formatBytes(a.total)}` : ''}`
  };
}));

function kindIcon(kind) {
  return kind === 'audio' ? Headphones : kind === 'pages' ? FileImage : Book;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

// Online, reopen with the server's current progress (it may have moved on another device);
// offline, the stored row is the best we have.
async function freshItem(entry) {
  if (!navigator.onLine) return withQueuedProgress(entry.item);
  try {
    const res = await api.get(`/items/${entry.id}`, { timeout: 4000 });
    if (res.data.item) {
      downloads.updateStoredProgress(entry.id, res.data.item);
      return { ...entry.item, ...res.data.item };
    }
  } catch (e) {
    // Fall back to the stored copy.
  }
  return withQueuedProgress(entry.item);
}

// Progress saved while offline sits in the sync queue (utils/offlineQueue.js) until the
// connection returns — it's newer than the stored copy, so resume from it.
function withQueuedProgress(item) {
  try {
    const queued = JSON.parse(localStorage.getItem('plinthio_progress_queue') || '{}')[`/progress/${item.id}`]?.data;
    if (!queued) return item;
    return {
      ...item,
      ...(queued.currentTime != null && { current_time: queued.currentTime }),
      ...(queued.currentPage != null && { current_page: queued.currentPage }),
      ...(queued.cfi && { current_page_cfi: queued.cfi })
    };
  } catch (e) {
    return item;
  }
}

async function openEntry(entry) {
  const item = await freshItem(entry);
  if (entry.kind === 'audio') {
    player.playItem(item);
  } else if (entry.kind === 'pages') {
    activeManga.value = item;
  } else if ((item.format || '').toLowerCase() === 'epub') {
    activeEpub.value = item;
  } else {
    window.open(`/api/media/book/${item.id}/file?token=${getMediaToken()}`, '_blank');
  }
}

async function removeEntry(entry) {
  const confirmed = await dialog.confirm({
    title: 'Remove download',
    message: `Remove "${entry.item.title}" from this device? It stays in your library.`,
    confirmText: 'Remove',
    danger: true
  });
  if (confirmed) downloads.remove(entry.id);
}

onMounted(() => {
  downloads.refreshUsage();
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
});
onUnmounted(() => {
  window.removeEventListener('online', setOnline);
  window.removeEventListener('offline', setOnline);
});
</script>
