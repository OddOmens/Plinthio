<template>
  <div class="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6 safe-top pb-32">
    <div class="flex items-center gap-3">
      <router-link
        to="/"
        class="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
        :title="$t('nav.backToShelves')"
        :aria-label="$t('nav.backToShelves')"
      >
        <ArrowLeft class="w-4 h-4" />
      </router-link>
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-foreground">{{ $t('downloads.title') }}</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          {{ $t('downloads.intro') }}
        </p>
      </div>
    </div>

    <p v-if="!online" class="text-xs rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2 flex items-center gap-2">
      <WifiOff class="w-4 h-4 flex-shrink-0" />
      {{ $t('downloads.offline') }}
    </p>

    <I18nT v-if="!downloads.supported && downloads.needsHttps" keypath="downloads.needsHttps" tag="p" class="text-sm text-muted-foreground">
      <template #link><router-link to="/docs#pwa" class="text-primary font-medium hover:underline">{{ $t('downloads.switchToHttps') }}</router-link></template>
    </I18nT>
    <p v-else-if="!downloads.supported" class="text-sm text-muted-foreground">
      {{ $t('downloads.unsupported') }}
    </p>

    <!-- Storage -->
    <div v-if="downloads.supported" class="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span class="font-medium text-foreground">{{ $t('downloads.summary', { size: formatBytes(downloads.totalBytes), count: downloads.list.length }) }}</span>
        <span v-if="downloads.quota" class="text-muted-foreground">{{ $t('downloads.usage', { used: formatBytes(downloads.usage), quota: formatBytes(downloads.quota) }) }}</span>
      </div>
      <div v-if="downloads.quota" class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full bg-primary" :style="{ width: `${Math.min(100, (downloads.usage / downloads.quota) * 100)}%` }" />
      </div>
      <p class="text-[12px] text-muted-foreground">
        {{ $t('downloads.tiedToAccount') }}
      </p>
    </div>

    <!-- In progress -->
    <section v-if="activeList.length" class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold text-foreground">{{ $t('downloads.downloading') }}</h2>
      <div v-for="entry in activeList" :key="entry.id" class="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-foreground truncate">{{ entry.title }}</p>
          <p v-if="entry.error" class="text-xs text-destructive">{{ entry.error }}</p>
          <template v-else>
            <div class="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: `${entry.percent}%` }" />
            </div>
            <p class="text-[12px] text-muted-foreground mt-1 tabular-nums">{{ entry.label }}</p>
          </template>
        </div>
        <button
          type="button"
          @click="entry.error ? downloads.dismissError(entry.id) : downloads.cancel(entry.id)"
          class="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition"
        >
          {{ entry.error ? $t('downloads.dismiss') : $t('common.cancel') }}
        </button>
      </div>
    </section>

    <!-- Downloaded -->
    <section v-if="downloads.list.length" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div v-for="entry in downloads.list" :key="entry.id" class="rounded-xl border border-border bg-card p-3 flex gap-3">
        <button type="button" @click="openEntry(entry)" class="w-16 aspect-[2/3] rounded-lg overflow-hidden bg-muted flex-shrink-0" :aria-label="$t('downloads.openItem', { title: entry.item.title })">
          <img :src="coverUrl(entry.item, { width: 180 })" :alt="''" class="w-full h-full object-cover" loading="lazy" />
        </button>
        <div class="min-w-0 flex-1 flex flex-col">
          <p class="text-sm font-semibold text-foreground line-clamp-2 leading-snug">{{ entry.item.title }}</p>
          <p class="text-xs text-muted-foreground truncate">{{ entry.item.series || entry.item.author || '' }}</p>
          <p class="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
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
              {{ entry.kind === 'audio' ? $t('common.play') : $t('downloads.read') }}
            </button>
            <button
              type="button"
              @click="removeEntry(entry)"
              class="h-8 w-8 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition flex items-center justify-center"
              :aria-label="$t('downloads.removeItemLabel', { title: entry.item.title })"
              :title="$t('downloads.remove')"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <div v-else-if="downloads.supported && !activeList.length" class="flex flex-col items-center text-center py-16 border border-dashed border-border rounded-2xl">
      <Download class="w-6 h-6 text-muted-foreground mb-2" />
      <p class="text-sm font-medium text-foreground">{{ $t('downloads.empty.title') }}</p>
      <I18nT keypath="downloads.empty.hint" tag="p" class="text-xs text-muted-foreground mt-1 max-w-xs">
        <template #action><strong>{{ $t('downloads.empty.action') }}</strong></template>
      </I18nT>
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
import { ArrowLeft, WifiOff, Download, Trash2, Play, BookOpen, Headphones, FileImage, Book } from '@lucide/vue';
import { t, n } from '../i18n';

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
    title: a.title || t('downloads.untitled'),
    error: a.error,
    percent,
    label: pages?.total
      ? t('downloads.pagesProgress', { done: pages.done, total: pages.total })
      : a.total ? t('downloads.bytesProgress', { received: formatBytes(a.received), total: formatBytes(a.total) }) : formatBytes(a.received)
  };
}));

function kindIcon(kind) {
  return kind === 'audio' ? Headphones : kind === 'pages' ? FileImage : Book;
}

// The number in the reader's format; the unit from the locale ("Mo" in French).
function formatBytes(bytes) {
  if (!bytes) return t('downloads.size.B', { value: n(0) });
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const digits = i >= 2 ? 1 : 0;
  return t(`downloads.size.${units[i]}`, { value: n(bytes / 1024 ** i, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }) });
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
    title: t('downloads.remove'),
    message: t('downloads.removeConfirm', { title: entry.item.title }),
    confirmText: t('common.remove'),
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
