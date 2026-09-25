<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 bg-background/95 backdrop-blur-2xl flex flex-col safe-top safe-bottom transition-all select-none">
    <!-- Top Header Bar -->
    <header class="px-5 py-3 flex items-center justify-between border-b border-border/40">
      <button aria-label="Minimize player"
        @click="close"
        class="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition"
        title="Minimize player"
      >
        <ChevronDown class="w-5 h-5" />
      </button>

      <div class="text-center">
        <span class="text-[10px] uppercase font-mono tracking-widest text-muted-foreground">Playing Audiobook</span>
        <h4 class="text-xs font-semibold text-foreground truncate max-w-[240px] sm:max-w-md">
          {{ player.currentItem?.title }}
        </h4>
      </div>

      <div class="flex items-center gap-1">
      <button
        v-if="player.chapters.length"
        @click="showChapters = !showChapters; showBookmarksDrawer = false"
        :class="[
          'p-2 rounded-full transition',
          showChapters
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        ]"
        title="Chapters"
        aria-label="Chapters"
      >
        <ListOrdered class="w-5 h-5" />
      </button>
      <button
        @click="showBookmarksDrawer = !showBookmarksDrawer; showChapters = false"
        :class="[
          'p-2 rounded-full transition flex items-center gap-1.5',
          showBookmarksDrawer
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        ]"
        title="Bookmarks"
      >
        <Bookmark class="w-5 h-5" />
        <span v-if="bookmarks.length > 0" class="text-[10px] font-bold font-mono">
          {{ bookmarks.length }}
        </span>
      </button>
      </div>
    </header>

    <!-- Main Player Body -->
    <main class="flex-1 overflow-y-auto flex flex-col items-center justify-center p-4 sm:p-6 max-w-lg mx-auto w-full gap-3 sm:gap-6 my-auto">
      <!-- Bookmarks Drawer Overlay if active -->
      <div v-if="showBookmarksDrawer" class="w-full flex-1 flex flex-col gap-4 max-h-[600px] overflow-hidden bg-card border border-border rounded-2xl p-5 shadow-2xl">
        <div class="flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-2">
            <Bookmark class="w-4 h-4 text-primary" />
            <h3 class="text-sm font-semibold text-foreground">Bookmarks & Notes</h3>
          </div>
          <button @click="showBookmarksDrawer = false" class="text-xs text-muted-foreground hover:text-foreground">
            Back to Player
          </button>
        </div>

        <!-- Add Bookmark at Current Position -->
        <div class="flex flex-col gap-2 bg-muted/40 p-3 rounded-xl border border-border">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-foreground">Add Bookmark</span>
            <span class="text-xs font-mono text-primary font-bold">@ {{ formatTime(player.currentTime) }}</span>
          </div>
          <input
            v-model="newBookmarkNote"
            @keyup.enter="createBookmark"
            placeholder="Optional note (e.g. key quote, clue)..."
            class="bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            @click="createBookmark"
            class="self-end px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm"
          >
            Save Bookmark
          </button>
        </div>

        <!-- Bookmarks List -->
        <div class="flex-1 overflow-y-auto flex flex-col gap-2 divide-y divide-border/60">
          <div
            v-for="bm in bookmarks"
            :key="bm.id"
            class="pt-2 flex items-start justify-between gap-2 group"
          >
            <button
              @click="jumpToBookmark(bm.position)"
              class="flex-1 text-left hover:text-primary transition"
            >
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-bold text-primary">{{ formatTime(bm.position) }}</span>
                <span v-if="bm.title" class="text-xs font-semibold text-foreground truncate">{{ bm.title }}</span>
              </div>
              <p v-if="bm.notes" class="text-xs text-muted-foreground mt-0.5 break-words">{{ bm.notes }}</p>
            </button>

            <button aria-label="Delete bookmark"
              @click="deleteBookmark(bm.id)"
              class="p-1 text-muted-foreground hover:text-destructive transition opacity-60 group-hover:opacity-100"
              title="Delete bookmark"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>

          <div v-if="bookmarks.length === 0" class="py-12 text-center text-xs text-muted-foreground">
            No bookmarks saved for this audiobook yet.
          </div>
        </div>
      </div>

      <!-- Chapter list -->
      <div v-else-if="showChapters" class="w-full flex-1 flex flex-col gap-3 max-h-[600px] overflow-hidden bg-card border border-border rounded-2xl p-5 shadow-2xl">
        <div class="flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-2">
            <ListOrdered class="w-4 h-4 text-primary" />
            <h3 class="text-sm font-semibold text-foreground">Chapters</h3>
            <span class="text-[11px] text-muted-foreground">{{ player.chapters.length }}</span>
          </div>
          <button @click="showChapters = false" class="text-xs text-muted-foreground hover:text-foreground">
            Back to Player
          </button>
        </div>
        <ol ref="chapterListEl" class="flex-1 overflow-y-auto -mx-2">
          <li v-for="chapter in player.chapters" :key="chapter.index">
            <button
              @click="player.seekChapter(chapter.index); showChapters = false"
              :data-current="chapter.index === player.currentChapterIndex || undefined"
              :class="[
                'w-full text-left px-2 py-2.5 rounded-lg flex items-center gap-3 transition',
                chapter.index === player.currentChapterIndex ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
              ]"
            >
              <span class="text-[11px] font-mono text-muted-foreground w-6 text-right tabular-nums">{{ chapter.index + 1 }}</span>
              <span class="flex-1 text-sm truncate" :class="chapter.index === player.currentChapterIndex ? 'font-semibold' : ''">{{ chapter.title }}</span>
              <span class="text-[11px] font-mono text-muted-foreground tabular-nums">{{ formatTime(chapter.end - chapter.start) }}</span>
            </button>
          </li>
        </ol>
      </div>

      <!-- Regular Player UI (Artwork, Scrubber, Controls) -->
      <template v-else>
        <!-- Large High-Res Cover Artwork with dynamic height clamp for landscape -->
        <div class="relative w-40 h-40 sm:w-64 sm:h-64 md:w-72 md:h-72 max-h-[30dvh] sm:max-h-[40dvh] aspect-square rounded-2xl overflow-hidden shadow-2xl border border-border/80 flex-shrink-0">
          <img :src="coverUrl" :alt="`Cover of ${player.currentItem?.title}`" class="w-full h-full object-cover" />
        </div>

        <!-- Title & Metadata -->
        <div class="w-full text-center flex flex-col gap-1">
          <h2 class="text-base sm:text-lg font-bold text-foreground truncate" :title="player.currentItem?.title">
            {{ player.currentItem?.title }}
          </h2>
          <p class="text-xs sm:text-sm text-muted-foreground truncate">
            {{ player.currentItem?.author || 'Unknown Author' }}
          </p>
          <span v-if="player.currentItem?.series" class="text-xs font-mono text-muted-foreground mt-0.5">
            {{ player.currentItem.series }}
          </span>
          <button
            v-if="player.currentChapter"
            @click="showChapters = true"
            class="mx-auto mt-1 max-w-full px-3 py-1 rounded-full bg-muted/60 hover:bg-muted text-xs text-foreground truncate transition"
          >
            {{ player.currentChapter.title }}
            <span class="text-muted-foreground font-mono">· {{ player.currentChapterIndex + 1 }}/{{ player.chapters.length }}</span>
          </button>
        </div>

        <!-- Scrubber Timeline -->
        <div class="w-full flex flex-col gap-1.5">
          <input
            type="range"
            min="0"
            :max="player.duration || 100"
            step="1"
            :value="player.currentTime"
            @input="handleScrub"
            class="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div class="flex items-center justify-between text-xs font-mono text-muted-foreground tabular-nums">
            <span>{{ formatTime(player.currentTime) }}</span>
            <span v-if="player.currentChapter" class="text-[10px]">{{ formatTime(chapterRemaining) }} left in chapter</span>
            <span>-{{ formatTime(remainingSeconds) }}</span>
          </div>
        </div>

        <!-- Primary Playback Controls: -30s, -15s, Play/Pause, +15s, +30s -->
        <div class="flex items-center justify-center gap-3 sm:gap-5 w-full">
          <button v-if="player.chapters.length" aria-label="Previous chapter"
            @click="player.previousChapter()"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90"
            title="Previous chapter"
          >
            <SkipBack class="w-5 h-5" />
          </button>
          <button v-else aria-label="Skip back 30s"
            @click="player.skip(-30)"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90 flex flex-col items-center gap-0.5"
            title="Skip back 30s"
          >
            <RotateCcw class="w-5 h-5" />
            <span class="text-[9px] font-mono font-bold leading-none">30</span>
          </button>

          <button aria-label="Skip back 15s"
            @click="player.skip(-15)"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90 flex flex-col items-center gap-0.5"
            title="Skip back 15s"
          >
            <RotateCcw class="w-5 h-5" />
            <span class="text-[9px] font-mono font-bold leading-none">15</span>
          </button>

          <button :aria-label="player.isPlaying ? 'Pause' : 'Play'"
            @click="player.togglePlay"
            class="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl active:scale-95 hover:scale-105 transition"
          >
            <Pause v-if="player.isPlaying" class="w-7 h-7 fill-current" />
            <Play v-else class="w-7 h-7 fill-current ml-1" />
          </button>

          <button aria-label="Skip forward 15s"
            @click="player.skip(15)"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90 flex flex-col items-center gap-0.5"
            title="Skip forward 15s"
          >
            <RotateCw class="w-5 h-5" />
            <span class="text-[9px] font-mono font-bold leading-none">15</span>
          </button>

          <button v-if="player.chapters.length" aria-label="Next chapter"
            @click="player.nextChapter()"
            :disabled="player.currentChapterIndex >= player.chapters.length - 1"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90 disabled:opacity-30"
            title="Next chapter"
          >
            <SkipForward class="w-5 h-5" />
          </button>
          <button v-else aria-label="Skip forward 30s"
            @click="player.skip(30)"
            class="p-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-90 flex flex-col items-center gap-0.5"
            title="Skip forward 30s"
          >
            <RotateCw class="w-5 h-5" />
            <span class="text-[9px] font-mono font-bold leading-none">30</span>
          </button>
        </div>

        <!-- Secondary Controls: Speed Chips, Sleep Timer, Volume -->
        <div class="w-full flex flex-col gap-4 pt-2 border-t border-border/40">
          <!-- Speed Chips -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-muted-foreground font-medium">Speed</span>
            <div class="flex items-center gap-1">
              <button
                v-for="rate in PLAYBACK_SPEEDS"
                :key="rate"
                @click="player.setPlaybackRate(rate)"
                :class="[
                  'px-2 py-0.5 rounded text-[10px] font-mono font-medium transition',
                  player.playbackRate === rate
                    ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                    : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                ]"
              >
                {{ rate }}x
              </button>
            </div>
          </div>

          <!-- Sleep Timer Chips -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
              <Moon class="w-3.5 h-3.5" /> Sleep
            </span>
            <div class="flex items-center gap-1 flex-wrap justify-end">
              <button
                v-for="opt in sleepOptions"
                :key="opt ?? 'off'"
                @click="player.setSleepTimer(opt)"
                :class="[
                  'px-2 py-0.5 rounded text-[10px] font-mono font-medium transition',
                  player.sleepTimerMinutes === opt
                    ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                    : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                ]"
              >
                {{ opt === 'chapter' ? 'End of ch.' : (opt ? `${opt}m` : 'Off') }}
              </button>
            </div>
          </div>
          <p v-if="player.sleepTimerMinutes" class="-mt-2 text-right text-[11px] text-primary font-mono tabular-nums">
            {{ player.sleepTimerMinutes === 'chapter' ? 'Stopping at the end of this chapter' : `Stopping in ${formatTime(player.sleepRemaining)}` }}
          </p>

          <!-- Volume Slider -->
          <div class="flex items-center gap-2 pt-1">
            <Volume2 class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="player.volume"
              @input="player.setVolume(parseFloat($event.target.value))"
              class="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, computed, watch, nextTick } from 'vue';
import api from '../api/client';
import { usePlayerStore, PLAYBACK_SPEEDS } from '../stores/player';
import { useDialogStore } from '../stores/dialog';
import { coverUrl as buildCoverUrl } from '../utils/cover';
import {
  ChevronDown,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Moon,
  Volume2,
  Bookmark,
  Trash2,
  ListOrdered,
  SkipBack,
  SkipForward
} from 'lucide-vue-next';

const props = defineProps({
  isOpen: { type: Boolean, default: false }
});

const emit = defineEmits(['close']);

const player = usePlayerStore();
const dialog = useDialogStore();
const token = getMediaToken() || '';

const showBookmarksDrawer = ref(false);
const showChapters = ref(false);
const chapterListEl = ref(null);

const sleepOptions = computed(() => (
  player.chapters.length ? [null, 'chapter', 15, 30, 45, 60] : [null, 15, 30, 45, 60]
));

const chapterRemaining = computed(() => {
  const chapter = player.currentChapter;
  return chapter ? Math.max(0, chapter.end - player.currentTime) : 0;
});

// Opening the list scrolls the chapter you're in into view.
watch(showChapters, async (open) => {
  if (!open) return;
  await nextTick();
  chapterListEl.value?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' });
});
const bookmarks = ref([]);
const newBookmarkNote = ref('');

const coverUrl = computed(() => {
  if (!player.currentItem?.id) return '';
  return buildCoverUrl(player.currentItem, { width: 720 });
});

const remainingSeconds = computed(() => {
  const dur = player.duration || 0;
  const cur = player.currentTime || 0;
  return Math.max(0, dur - cur);
});

async function loadBookmarks() {
  if (!player.currentItem?.id) return;
  try {
    const res = await api.get(`/bookmarks/${player.currentItem.id}`);
    bookmarks.value = res.data.bookmarks || [];
  } catch (err) {
    console.warn('Failed to load bookmarks:', err);
  }
}

watch(
  () => [props.isOpen, player.currentItem?.id],
  ([open, id]) => {
    if (open && id) {
      loadBookmarks();
    }
  },
  { immediate: true }
);

async function createBookmark() {
  if (!player.currentItem?.id) return;
  try {
    await api.post('/bookmarks', {
      itemId: player.currentItem.id,
      type: 'audiobook',
      position: player.currentTime,
      title: `Bookmark @ ${formatTime(player.currentTime)}`,
      notes: newBookmarkNote.value.trim() || null
    });
    newBookmarkNote.value = '';
    await loadBookmarks();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save bookmark');
  }
}

async function deleteBookmark(id) {
  try {
    await api.delete(`/bookmarks/${id}`);
    await loadBookmarks();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to delete bookmark');
  }
}

function jumpToBookmark(position) {
  player.seek(position);
  showBookmarksDrawer.value = false;
}

function handleScrub(e) {
  const val = parseFloat(e.target.value);
  player.seek(val);
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function close() {
  emit('close');
}
</script>
