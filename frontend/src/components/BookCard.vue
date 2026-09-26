<template>
  <div
    class="group relative flex flex-col bg-card border border-border hover:border-muted-foreground/30 rounded-xl p-2.5 transition-colors cursor-pointer"
  >
    <!-- Cover Image Container (No Zoom animations) -->
    <div
      @click="$emit('select', item)"
      class="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-muted/40 border border-border/60"
    >
      <!-- Skeleton shimmer while cover loads -->
      <div
        v-if="!imgLoaded"
        class="absolute inset-0 bg-muted/60 animate-pulse rounded-lg"
      />
      <img
        :src="coverUrl"
        :alt="item.title"
        loading="lazy"
        decoding="async"
        class="w-full h-full object-cover transition-opacity duration-300"
        :class="imgLoaded ? 'opacity-100' : 'opacity-0'"
        @load="imgLoaded = true"
        @error="imgLoaded = true"
      />

      <!-- Media Type Pill Badge -->
      <div class="absolute top-2 left-2 z-10 pointer-events-none">
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-background/85 text-foreground backdrop-blur-md text-[11px] font-medium border border-border/80 shadow-sm">
          <component :is="badgeIcon" class="w-3 h-3 text-muted-foreground" />
          <span class="capitalize">{{ item.media_type }}</span>
        </span>
      </div>

      <!-- Your own star rating, when you've given one -->
      <div v-if="showMyRating" class="absolute top-2 right-2 z-10 pointer-events-none">
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-background/85 text-foreground backdrop-blur-md text-[11px] font-semibold border border-border/80 shadow-sm">
          <Star class="w-3 h-3 text-amber-400 fill-amber-400" />
          {{ myRating }}
        </span>
      </div>

      <!-- Quick Action Overlay on Hover -->
      <div class="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <div class="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
          <Play v-if="item.media_type === 'audiobook' || item.media_type === 'show' || item.media_type === 'movie' || item.media_type === 'anime'" class="w-5 h-5 fill-current ml-0.5" />
          <Book v-else-if="!item.is_finished && !hasProgress" class="w-5 h-5" />
          <BookOpen v-else class="w-5 h-5" />
        </div>
      </div>

      <!-- Reading / Playback Progress Bar -->
      <div v-if="hasProgress" class="absolute bottom-0 inset-x-0 h-1.5 bg-background/70">
        <div
          class="h-full bg-primary transition-all duration-300"
          :style="{ width: `${item.progress_percent}%` }"
        ></div>
      </div>
    </div>

    <!-- Metadata Content -->
    <div class="mt-2.5 px-1 flex flex-col flex-1">
      <div class="flex items-start justify-between gap-1.5">
        <h3
          @click="$emit('select', item)"
          class="text-sm font-semibold text-foreground truncate leading-snug hover:underline underline-offset-2 flex-1"
          :title="item.title"
        >
          {{ item.title }}
        </h3>
        <!-- Volume number pill — shown for manga/book items inside a series -->
        <span
          v-if="item.volume != null && (item.media_type === 'manga' || item.media_type === 'book')"
          class="flex-shrink-0 text-[10px] font-mono font-bold bg-muted text-muted-foreground rounded px-1.5 py-0.5 ml-1 self-start mt-0.5"
        >Vol {{ item.volume % 1 === 0 ? Math.trunc(item.volume) : item.volume }}</span>

        <!-- Context Menu Dropdown Trigger (Visible on touch, 34px target) -->
        <div class="relative">
          <button aria-label="Options"
            type="button"
            @click.stop="showMenu = !showMenu"
            class="w-9 h-9 -mr-1 -my-0.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/70 flex items-center justify-center transition opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 active:scale-95"
            title="Options"
          >
            <MoreVertical class="w-4 h-4" />
          </button>

          <!-- Dropdown Menu -->
          <div
            v-if="showMenu"
            v-click-outside="() => showMenu = false"
            @click.stop
            class="absolute right-0 top-8 z-30 w-48 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-2xl py-1.5 text-xs text-foreground divide-y divide-border/40"
          >
            <div class="pb-1">
              <button
                type="button"
                @click="toggleFinished"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5"
              >
                <component :is="item.is_finished ? inProgressIcon : finishedIcon" class="w-4 h-4 text-muted-foreground" />
                <span>{{ item.is_finished ? 'Mark In Progress' : 'Mark as Finished' }}</span>
              </button>
              <button
                type="button"
                @click="openFolderDialog"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5"
              >
                <FolderPlus class="w-4 h-4 text-muted-foreground" />
                <span>Add to Folder...</span>
              </button>
              <button
                v-if="inCustomFolder"
                type="button"
                @click="$emit('remove-from-folder', item)"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 text-destructive transition flex items-center gap-2.5"
              >
                <FolderMinus class="w-4 h-4" />
                <span>Remove from Folder</span>
              </button>
              <button
                v-if="customizationStore.ratingsEnabled"
                type="button"
                @click="openRatingDialog"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5"
              >
                <Star class="w-4 h-4 text-muted-foreground" />
                <span>{{ customizationStore.ratings.showPersonal ? 'Rate...' : 'Ratings...' }}</span>
              </button>
              <button
                type="button"
                @click="openBookmarksDialog"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5"
              >
                <Bookmark class="w-4 h-4 text-muted-foreground" />
                <span>Bookmarks & Notes...</span>
              </button>
              <button
                v-if="authStore.isEditor"
                type="button"
                @click="openMetadataDialog"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5"
              >
                <Search class="w-4 h-4 text-muted-foreground" />
                <span>Edit Metadata...</span>
              </button>
            </div>
            <div class="pt-1">
              <button
                type="button"
                @click="hideItem"
                class="w-full text-left px-3.5 py-2 hover:bg-muted/70 text-destructive transition flex items-center gap-2.5"
              >
                <EyeOff class="w-4 h-4" />
                <span>Hide from Shelf</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <p class="text-xs text-muted-foreground truncate mt-1">
        {{ item.author || 'Unknown Author' }}
      </p>

      <!-- Details footer (duration, pages, or format) -->
      <div class="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span v-if="item.media_type === 'audiobook' && item.duration" class="font-mono">
          {{ formatDuration(item.duration) }}
        </span>
        <span v-else-if="item.total_pages" class="font-mono">
          {{ item.total_pages }} pages
        </span>
        <span v-else class="uppercase font-mono text-[11px]">
          {{ item.format }}
        </span>

        <span v-if="item.is_finished" class="text-foreground font-semibold flex items-center gap-1">
          <component :is="finishedIcon" class="w-3 h-3 text-emerald-500" />
          Finished
        </span>
        <span v-else-if="hasProgress" class="font-medium font-mono text-foreground">
          {{ Math.round(item.progress_percent) }}%
        </span>
      </div>
    </div>

    <RatingModal
      v-if="showRating"
      :isOpen="showRating"
      :item="item"
      @close="showRating = false"
      @rated="onRated"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import RatingModal from './RatingModal.vue';
import { coverUrl as buildCoverUrl } from '../utils/cover';
import {
  Headphones,
  FileImage,
  Book,
  Play,
  BookOpen,
  BookCheck,
  MonitorPlay,
  MonitorCheck,
  MoreVertical,
  EyeOff,
  FolderPlus,
  FolderMinus,
  Bookmark,
  Tv,
  Film,
  Sparkles,
  Search,
  Star
} from 'lucide-vue-next';

const props = defineProps({
  item: { type: Object, required: true },
  inCustomFolder: { type: Boolean, default: false }
});

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();

const emit = defineEmits(['select', 'refresh', 'add-to-folder', 'remove-from-folder', 'open-bookmarks', 'edit-metadata']);

const showMenu = ref(false);
const imgLoaded = ref(false);

function openFolderDialog() {
  showMenu.value = false;
  emit('add-to-folder', props.item);
}

function openBookmarksDialog() {
  showMenu.value = false;
  emit('open-bookmarks', props.item);
}

// The card owns its rating modal (rather than bubbling an event up to every shelf that
// renders cards), and tracks the rating locally so the badge updates without a refetch.
const showRating = ref(false);
const myRating = ref(props.item.user_rating ?? null);
watch(() => props.item.user_rating, (val) => { myRating.value = val ?? null; });
const showMyRating = computed(() => customizationStore.ratings.showPersonal && !!myRating.value);

function openRatingDialog() {
  showMenu.value = false;
  showRating.value = true;
}

function onRated({ rating }) {
  myRating.value = rating;
}

function openMetadataDialog() {
  showMenu.value = false;
  emit('edit-metadata', props.item);
}
const token = localStorage.getItem('plinthio_token') || '';

const coverUrl = computed(() => {
  return buildCoverUrl(props.item, { width: 360 });
});

const hasProgress = computed(() => {
  return props.item.progress_percent && props.item.progress_percent > 0;
});

const badgeIcon = computed(() => {
  switch (props.item.media_type) {
    case 'audiobook': return Headphones;
    case 'manga': return FileImage;
    case 'show': return Tv;
    case 'movie': return Film;
    case 'anime': return Sparkles;
    default: return Book;
  }
});

// Status icons: book/book-open/book-check for readables, monitor/monitor-play/monitor-check for watchables
const isWatchable = computed(() => ['show', 'movie', 'anime'].includes(props.item.media_type));
const finishedIcon = computed(() => isWatchable.value ? MonitorCheck : BookCheck);
const inProgressIcon = computed(() => isWatchable.value ? MonitorPlay : BookOpen);

function formatDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function toggleFinished() {
  showMenu.value = false;
  try {
    const isFinished = props.item.is_finished ? 0 : 1;
    // Marking finished jumps to the very end (intentional). Un-marking must NOT reset to
    // the beginning — it should restore whatever position was last saved, or "Mark In
    // Progress" silently destroys real reading/listening progress.
    const payload = isFinished
      ? {
          currentTime: props.item.duration || 1,
          duration: props.item.duration || 1,
          currentPage: props.item.total_pages || 1,
          totalPages: props.item.total_pages || 1,
          isFinished: 1
        }
      : {
          currentTime: props.item.current_time || 0,
          duration: props.item.duration || 1,
          currentPage: props.item.current_page || 0,
          totalPages: props.item.total_pages || 1,
          progressPercent: props.item.progress_percent || 0,
          isFinished: 0
        };
    await api.post(`/progress/${props.item.id}`, payload);
    emit('refresh');
  } catch (err) {
    console.error('Failed to update progress:', err);
  }
}

async function hideItem() {
  showMenu.value = false;
  try {
    await api.post(`/items/${props.item.id}/hide`);
    emit('refresh');
  } catch (err) {
    console.error('Failed to hide item:', err);
  }
}

// Simple click outside directive. The listener is attached on a deferred tick so the
// same click that mounts this element (opening the menu) doesn't immediately bubble
// into it and close the menu right back up.
const vClickOutside = {
  mounted(el, binding) {
    el.clickOutsideEvent = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value();
      }
    };
    el._clickOutsideTimer = setTimeout(() => {
      document.addEventListener('click', el.clickOutsideEvent);
    }, 0);
  },
  unmounted(el) {
    clearTimeout(el._clickOutsideTimer);
    document.removeEventListener('click', el.clickOutsideEvent);
  }
};
</script>
