<template>
  <div
    ref="readerEl"
    class="fixed inset-0 z-50 bg-black text-white flex flex-col select-none overflow-hidden"
    @pointermove="onPointerMove"
    tabindex="0"
  >
    <!-- Top Controls — always visible on desktop (hover), auto-hide on touch -->
    <header
      :class="[
        'absolute top-0 inset-x-0 z-30 transition-all duration-300 bg-gradient-to-b from-black/90 via-black/60 to-transparent pt-safe pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-4 flex flex-col gap-2 sm:flex-row landscape:flex-row sm:items-center landscape:items-center sm:justify-between landscape:justify-between sm:gap-3',
        controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
      ]"
    >
      <!-- min-w-0 is load-bearing: without it a long title grows this block and shoves the
           reading-mode controls off the edge of a phone/tablet screen entirely. -->
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <button aria-label="Back to shelf"
          @click="closeReader"
          class="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 active:scale-95 transition flex-shrink-0"
          title="Back to shelf"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold truncate text-zinc-100">{{ item.title }}</h2>
          <p class="text-xs text-zinc-400 truncate">{{ pageDisplayLabel }}</p>
        </div>
      </div>

      <!-- On phones these wrap onto their own row and scroll sideways if the mode buttons
           still don't fit, so every control stays reachable. -->
      <div class="flex items-center gap-2 flex-shrink-0 overflow-x-auto no-scrollbar -mx-1 px-1 sm:overflow-visible sm:mx-0 sm:px-0">
        <!-- Bookmark Button -->
        <button
          @click.stop="showBookmarksModal = !showBookmarksModal"
          :class="[
            'px-2.5 py-1.5 rounded-lg border text-xs transition flex items-center gap-1.5 flex-shrink-0',
            showBookmarksModal
              ? 'bg-zinc-100 text-zinc-900 border-zinc-100 font-semibold'
              : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:text-white'
          ]"
          title="Bookmarks"
        >
          <Bookmark class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Bookmark</span>
          <span v-if="bookmarks.length > 0" class="text-[10px] bg-zinc-700 text-zinc-200 px-1 py-0.5 rounded-full font-mono">
            {{ bookmarks.length }}
          </span>
        </button>

        <!-- Spread Mode Toggle (Single vs 2-Page Spread) -->
        <div v-if="mode !== 'webtoon'" class="flex items-center gap-0.5 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800 flex-shrink-0">
          <button
            @click="setSpread('single')"
            :class="['px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1', spread === 'single' ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-400 hover:text-white']"
            title="Single Page view"
          >
            <Square class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">1-Page</span>
          </button>
          <button
            @click="setSpread('double')"
            :class="['px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1', spread === 'double' ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-400 hover:text-white']"
            title="2-Page Spread view"
          >
            <Columns2 class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">2-Page</span>
          </button>
        </div>

        <!-- Page Turn Style Toggle (Fade vs realistic page Flip) -->
        <div v-if="mode !== 'webtoon'" class="flex items-center gap-0.5 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800 flex-shrink-0">
          <button
            @click="setPageTurnStyle('fade')"
            :class="['px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1', pageTurnStyle === 'fade' ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-400 hover:text-white']"
            title="Fade page transition"
          >
            <Layers class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Fade</span>
          </button>
          <button
            @click="setPageTurnStyle('flip')"
            :class="['px-2 py-1 rounded-md text-xs font-medium transition flex items-center gap-1', pageTurnStyle === 'flip' ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-400 hover:text-white']"
            title="Realistic page-flip transition"
          >
            <BookOpen class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Flip</span>
          </button>
        </div>

        <!-- Mode Selector -->
        <div class="flex items-center gap-0.5 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800 flex-shrink-0">
          <button
            v-for="m in modes"
            :key="m.id"
            @click="setMode(m.id)"
            :class="['px-2.5 py-1 rounded-md text-xs font-medium transition', mode === m.id ? 'bg-zinc-100 text-zinc-900 font-semibold' : 'text-zinc-400 hover:text-white']"
            :title="m.label"
          >{{ m.short }}</button>
        </div>
      </div>
    </header>

    <!-- Main Viewport -->
    <main class="flex-1 w-full h-full relative overflow-hidden flex items-center justify-center">
      <!-- Loading -->
      <div v-if="loading" class="flex flex-col items-center gap-3 text-zinc-400">
        <Loader2 class="w-7 h-7 animate-spin" />
        <span class="text-xs font-mono">Loading pages...</span>
      </div>

      <!-- Paged mode (RTL / LTR) -->
      <template v-else-if="mode === 'rtl' || mode === 'ltr'">
        <!-- Page image (Single or 2-Page Spread) — pinch-zoom / pan target -->
        <div class="h-full w-full flex items-center justify-center" :style="zoomStyle">
          <transition :name="pageTurnStyle === 'flip' ? 'no-anim' : 'page-fade'" mode="out-in">
            <div
              v-if="spread === 'double' && displaySecondUrl"
              :key="`spread-${displayIndex}`"
              class="h-full w-full flex items-center justify-center gap-1 sm:gap-2 px-2"
            >
              <!-- Left / right cells are mode-resolved (RTL: N+1 left, N right — LTR: N left, N+1 right).
                   Each cell is its own 3D-perspective context so a flipping leaf pivots correctly on its own edge. -->
              <div class="relative max-h-full max-w-[49.5%] flex-1 h-full flex items-center justify-center flip-cell">
                <img :src="displayLeftUrl" :alt="`Page ${displayLeftIndex + 1}`" class="max-h-full max-w-full object-contain pointer-events-none" @load="onPageLoad" />
                <div v-if="isFlipping" class="flip-leaf" :style="flipLeafStyle" @transitionend="onFlipTransitionEnd">
                  <img :src="flipOldLeftUrl" alt="" aria-hidden="true" class="w-full h-full object-contain pointer-events-none" />
                </div>
              </div>
              <div class="relative max-h-full max-w-[49.5%] flex-1 h-full flex items-center justify-center flip-cell">
                <img :src="displayRightUrl" :alt="`Page ${displayRightIndex + 1}`" class="max-h-full max-w-full object-contain pointer-events-none" @load="onPageLoad" />
                <div v-if="isFlipping" class="flip-leaf" :style="flipLeafStyle" @transitionend="onFlipTransitionEnd">
                  <img :src="flipOldRightUrl" alt="" aria-hidden="true" class="w-full h-full object-contain pointer-events-none" />
                </div>
              </div>
            </div>

            <div
              v-else-if="displayCurrentUrl"
              :key="`single-${displayIndex}`"
              class="relative h-full w-full flex items-center justify-center flip-cell"
            >
              <img :src="displayCurrentUrl" :alt="`Page ${displayIndex + 1}`" class="max-h-full max-w-full object-contain pointer-events-none" @load="onPageLoad" />
              <div v-if="isFlipping" class="flip-leaf" :style="flipLeafStyle" @transitionend="onFlipTransitionEnd">
                <img :src="flipOldFullUrl" alt="" aria-hidden="true" class="w-full h-full object-contain pointer-events-none" />
              </div>
            </div>
          </transition>
        </div>

        <!-- Invisible touch/click zones — also captures pinch-zoom & pan gestures -->
        <div
          class="absolute inset-0 z-20 grid touch-none"
          :class="{ 'pointer-events-none': isFlipping }"
          style="grid-template-columns: 30% 40% 30%"
          @pointerdown="onZonePointerDown"
          @pointermove="onZonePointerMove"
          @pointerup="onZonePointerUp"
          @pointercancel="onZonePointerUp"
        >
          <!-- Left zone -->
          <div @click="handleLeftZone" class="h-full cursor-pointer" />
          <!-- Center zone — toggle controls -->
          <div @click="toggleControls" class="h-full cursor-pointer" />
          <!-- Right zone -->
          <div @click="handleRightZone" class="h-full cursor-pointer" />
        </div>

        <!-- Zoom level indicator -->
        <div
          v-if="zoomScale > 1.01"
          class="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none bg-black/70 text-white text-[11px] font-mono px-2 py-1 rounded-full backdrop-blur-sm"
        >
          {{ Math.round(zoomScale * 100) }}%
        </div>

        <!-- Desktop left/right tap hint arrows (show when controls visible) -->
        <div
          :class="['absolute left-3 top-1/2 -translate-y-1/2 z-10 transition-opacity duration-300 pointer-events-none', controlsVisible && zoomScale <= 1.01 ? 'opacity-40' : 'opacity-0']"
        >
          <ChevronLeft class="w-8 h-8 text-white drop-shadow-lg" />
        </div>
        <div
          :class="['absolute right-3 top-1/2 -translate-y-1/2 z-10 transition-opacity duration-300 pointer-events-none', controlsVisible && zoomScale <= 1.01 ? 'opacity-40' : 'opacity-0']"
        >
          <ChevronRight class="w-8 h-8 text-white drop-shadow-lg" />
        </div>
      </template>

      <!-- Webtoon / Vertical Scroll -->
      <div
        v-else-if="mode === 'webtoon'"
        ref="webtoonContainer"
        @scroll="onWebtoonScroll"
        @pointerdown="touchStart"
        @pointerup="touchEnd"
        @click="toggleControls"
        class="w-full h-full overflow-y-auto flex flex-col items-center"
      >
        <div
          v-for="index in totalPages"
          :key="index"
          class="w-full max-w-2xl flex justify-center"
        >
          <img
            :src="getPageUrl(index - 1)"
            loading="lazy"
            :alt="`Page ${index}`"
            class="w-full h-auto object-contain"
          />
        </div>
        <!-- Bottom spacer so last page is reachable -->
        <div class="h-20 flex-shrink-0" />
      </div>
    </main>

    <!-- Bottom Scrubber -->
    <footer
      :class="[
        'absolute bottom-0 inset-x-0 z-30 transition-all duration-300 bg-gradient-to-t from-black/90 via-black/60 to-transparent pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-safe pt-8 flex flex-col gap-2',
        controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
      ]"
    >
      <div class="max-w-md mx-auto w-full flex items-center gap-3">
        <button aria-label="Previous page" @click="prevPage" class="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 transition active:scale-95">
          <ChevronLeft class="w-4 h-4" />
        </button>
        <span class="text-xs font-mono tabular-nums text-zinc-400 w-8 text-right flex-shrink-0">
          {{ currentPageIndex + 1 }}
        </span>
        <input
          type="range"
          min="0"
          :max="Math.max(0, totalPages - 1)"
          :value="currentPageIndex"
          @input="goToPage(parseInt($event.target.value))"
          class="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-200"
        />
        <span class="text-xs font-mono tabular-nums text-zinc-400 w-8 flex-shrink-0">
          {{ totalPages }}
        </span>
        <button aria-label="Next page" @click="nextPage" class="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 transition active:scale-95">
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>
    </footer>

    <!-- Next Volume Prompt (Floating above footer on the last page) -->
    <Transition name="sheet-fade">
      <div
        v-if="currentPageIndex === totalPages - 1 && totalPages > 0 && nextVolume"
        class="absolute bottom-20 z-40 left-1/2 -translate-x-1/2 bg-zinc-900/95 border border-primary/50 text-white rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-md flex items-center gap-4 max-w-sm w-[90%] sm:w-auto"
      >
        <div class="flex-1 min-w-0">
          <p class="text-[11px] uppercase font-bold tracking-wider text-primary">Volume Complete!</p>
          <p class="text-xs font-semibold text-zinc-100 truncate mt-0.5">Next: {{ nextVolume.title }}</p>
        </div>
        <button
          @click="goToNextVolume"
          class="h-8 px-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition active:scale-95 flex items-center gap-1.5 flex-shrink-0 shadow-md"
        >
          <span>Next Vol</span>
          <ChevronRight class="w-3.5 h-3.5" />
        </button>
      </div>
    </Transition>

    <!-- Bookmarks Overlay -->
    <Transition name="sheet-fade">
      <div
        v-if="showBookmarksModal"
        @click.stop
        class="absolute top-16 right-4 z-40 w-72 bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 shadow-2xl flex flex-col gap-3 text-xs select-auto"
      >
        <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div class="flex items-center gap-1.5 font-semibold text-zinc-100">
            <Bookmark class="w-3.5 h-3.5 text-zinc-300" />
            <span>Page Bookmarks</span>
          </div>
          <button aria-label="Close bookmarks" @click="showBookmarksModal = false" class="text-zinc-400 hover:text-white p-1 rounded transition">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="flex flex-col gap-2 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
          <div class="flex items-center justify-between text-zinc-300">
            <span>Bookmark page</span>
            <span class="font-mono font-bold text-white">#{{ currentPageIndex + 1 }}</span>
          </div>
          <input
            v-model="newBookmarkNote"
            @keyup.enter="createBookmark"
            placeholder="Optional note..."
            class="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
          <button
            @click="createBookmark"
            class="self-end px-2.5 py-1 rounded bg-zinc-100 text-zinc-900 hover:bg-white font-medium text-[11px] transition"
          >
            Save
          </button>
        </div>

        <div class="max-h-48 overflow-y-auto flex flex-col gap-1.5 divide-y divide-zinc-800/60">
          <div
            v-for="bm in bookmarks"
            :key="bm.id"
            class="pt-1.5 flex items-start justify-between gap-2"
          >
            <button
              @click="goToPage(Math.max(0, Math.floor(bm.position) - 1)); showBookmarksModal = false"
              class="flex-1 text-left hover:text-white transition"
            >
              <span class="font-mono font-bold text-zinc-200">Page {{ Math.floor(bm.position) }}</span>
              <p v-if="bm.notes" class="text-zinc-400 text-[11px] truncate">{{ bm.notes }}</p>
            </button>
            <button aria-label="Delete bookmark" @click="deleteBookmark(bm.id)" class="p-1 text-zinc-500 hover:text-destructive transition">
              <Trash2 class="w-3 h-3" />
            </button>
          </div>
          <div v-if="bookmarks.length === 0" class="py-4 text-center text-zinc-500 text-[11px]">
            No bookmarks yet.
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { useViewSession } from '../composables/useViewSession';
import { ArrowLeft, Loader2, Bookmark, Trash2, X, ChevronLeft, ChevronRight, Square, Columns2, Layers, BookOpen } from 'lucide-vue-next';

const dialog = useDialogStore();
const viewSession = useViewSession();

const props = defineProps({
  item: { type: Object, required: true },
  volumes: { type: Array, default: () => [] }
});
const emit = defineEmits(['close', 'switch-volume']);

// ─── Next Volume in Series ───────────────────────────────────────────────────
const nextVolume = computed(() => {
  if (!props.volumes || props.volumes.length <= 1) return null;
  const sorted = [...props.volumes].sort((a, b) => {
    if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title, undefined, { numeric: true });
    if (a.volume == null) return 1;
    if (b.volume == null) return -1;
    return a.volume - b.volume;
  });
  const currentIndex = sorted.findIndex(v => v.id === props.item.id);
  if (currentIndex >= 0 && currentIndex < sorted.length - 1) {
    return sorted[currentIndex + 1];
  }
  return null;
});

function goToNextVolume() {
  if (nextVolume.value) {
    saveProgress();
    emit('switch-volume', nextVolume.value);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
const readerEl = ref(null);
const token = getMediaToken() || '';
const loading = ref(true);
const totalPages = ref(props.item.total_pages || 0);
const currentPageIndex = ref(
  props.item.initialPage !== undefined
    ? Math.max(0, props.item.initialPage - 1)
    : (props.item.current_page ? Math.max(0, props.item.current_page - 1) : 0)
);

const mode = ref('rtl');
const modes = [
  { id: 'rtl', short: 'RTL', label: 'Right to Left (Japanese Manga)' },
  { id: 'ltr', short: 'LTR', label: 'Left to Right (Comics)' },
  { id: 'webtoon', short: 'Scroll', label: 'Continuous Vertical Scroll (Webtoon)' },
];

const spread = ref('single'); // 'single' | 'double'
function setSpread(s) {
  cancelFlip();
  spread.value = s;
  showControlsNow();
}

// ─── Page Turn Style: Fade vs realistic Flip ─────────────────────────────────
const pageTurnStyle = ref('fade'); // 'fade' | 'flip'
function setPageTurnStyle(s) {
  pageTurnStyle.value = s;
  showControlsNow();
}

const secondPageIndex = computed(() => {
  if (spread.value !== 'double' || mode.value === 'webtoon') return null;
  const next = currentPageIndex.value + 1;
  return next < totalPages.value ? next : null;
});

const secondPageUrl = computed(() => {
  if (secondPageIndex.value == null) return null;
  return getPageUrl(secondPageIndex.value);
});

// ─── Page Flip Animation state ───────────────────────────────────────────────
// A flip turns the outgoing page into a "leaf" that hinges on a fixed edge and rotates
// away via CSS 3D transform; backface-visibility hides it past 90°, letting the already
// re-pointed static image underneath (see displayIndex/displayCurrentUrl below) show
// through. See startFlip()/onFlipTransitionEnd() further down for the full sequence.
const isFlipping = ref(false);
const flipAnimating = ref(false);
const flipPivot = ref('left'); // 'left' | 'right' — the fixed edge every active leaf hinges on this turn
const flipRotateDeg = computed(() => (flipPivot.value === 'left' ? -180 : 180));
const flipLeafStyle = computed(() => ({
  transformOrigin: flipPivot.value === 'left' ? '0% 50%' : '100% 50%',
  transform: `rotateY(${flipAnimating.value ? flipRotateDeg.value : 0}deg)`,
}));
const flipOldLeftUrl = ref(null);
const flipOldRightUrl = ref(null);
const flipOldFullUrl = ref(null);
let flipTargetIndex = null;

// Abandons an in-progress flip without committing it — used when something else (a mode
// switch, a scrub, a volume change) invalidates the animation already in flight.
function cancelFlip() {
  isFlipping.value = false;
  flipAnimating.value = false;
  flipTargetIndex = null;
}

// While isFlipping, the resting image(s) must already show the destination page (the
// leaf sits on top and reveals them as it rotates away) — these resolve to the flip
// target during that window, and to the real current page otherwise.
const displayIndex = computed(() => (isFlipping.value && flipTargetIndex !== null ? flipTargetIndex : currentPageIndex.value));
const displaySecondIndex = computed(() => {
  if (mode.value === 'webtoon' || spread.value !== 'double') return null;
  const next = displayIndex.value + 1;
  return next < totalPages.value ? next : null;
});
const displayCurrentUrl = computed(() => getPageUrl(displayIndex.value));
const displaySecondUrl = computed(() => (displaySecondIndex.value != null ? getPageUrl(displaySecondIndex.value) : null));
const displayLeftIndex = computed(() => (mode.value === 'rtl' ? displaySecondIndex.value : displayIndex.value));
const displayRightIndex = computed(() => (mode.value === 'rtl' ? displayIndex.value : displaySecondIndex.value));
const displayLeftUrl = computed(() => (mode.value === 'rtl' ? displaySecondUrl.value : displayCurrentUrl.value));
const displayRightUrl = computed(() => (mode.value === 'rtl' ? displayCurrentUrl.value : displaySecondUrl.value));

const pageDisplayLabel = computed(() => {
  if (totalPages.value === 0) return 'Page 0 of 0';
  if (spread.value === 'double' && mode.value !== 'webtoon' && secondPageIndex.value !== null) {
    const p1 = Math.min(currentPageIndex.value, secondPageIndex.value) + 1;
    const p2 = Math.max(currentPageIndex.value, secondPageIndex.value) + 1;
    return `Pages ${p1}–${p2} of ${totalPages.value}`;
  }
  return `Page ${currentPageIndex.value + 1} of ${totalPages.value}`;
});

const webtoonContainer = ref(null);
const controlsVisible = ref(true);
let hideTimer = null;

const showBookmarksModal = ref(false);
const bookmarks = ref([]);
const newBookmarkNote = ref('');

// Touch tracking for swipe detection
let touchStartX = 0;
let touchStartY = 0;
let isTouchDevice = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;

// ─── Pinch-to-zoom & pan (iPad/tablet panel inspection) ───────────────────────
// Paged mode takes over touch entirely (touch-action: none on the gesture layer) so swipes
// turn pages, which also means native pinch can't reach it — so pages get their own
// gesture-driven zoom/pan. Webtoon mode scrolls natively and uses browser pinch-zoom.
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const zoomScale = ref(1);
const zoomX = ref(0);
const zoomY = ref(0);
const zoomStyle = computed(() => ({
  transform: `translate(${zoomX.value}px, ${zoomY.value}px) scale(${zoomScale.value})`,
  transition: (isPinching || isPanning) ? 'none' : 'transform 0.2s ease-out',
  willChange: 'transform',
}));

const activePointers = new Map();
let isPinching = false;
let isPanning = false;
let pinchOccurred = false;
let dragMoved = false;
let pinchStartDist = 1;
let pinchStartScale = 1;
let pinchStartMid = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let zoomStartOffset = { x: 0, y: 0 };

function pointDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}
function pointMidpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function resetZoom() {
  zoomScale.value = 1;
  zoomX.value = 0;
  zoomY.value = 0;
}

function onZonePointerDown(e) {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  isTouchDevice = e.pointerType === 'touch';
  dragMoved = false;
  swipeHandled = false;
  touchStartX = e.clientX;
  touchStartY = e.clientY;

  if (activePointers.size === 2) {
    isPinching = true;
    pinchOccurred = true;
    isPanning = false;
    const pts = [...activePointers.values()];
    pinchStartDist = pointDistance(pts[0], pts[1]) || 1;
    pinchStartScale = zoomScale.value;
    pinchStartMid = pointMidpoint(pts[0], pts[1]);
    zoomStartOffset = { x: zoomX.value, y: zoomY.value };
  } else if (activePointers.size === 1 && zoomScale.value > 1.01) {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    zoomStartOffset = { x: zoomX.value, y: zoomY.value };
  }
}

function onZonePointerMove(e) {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (isPinching && activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const dist = pointDistance(pts[0], pts[1]);
    const mid = pointMidpoint(pts[0], pts[1]);
    zoomScale.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartScale * (dist / pinchStartDist)));
    zoomX.value = zoomStartOffset.x + (mid.x - pinchStartMid.x);
    zoomY.value = zoomStartOffset.y + (mid.y - pinchStartMid.y);
    dragMoved = true;
  } else if (isPanning) {
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
    zoomX.value = zoomStartOffset.x + dx;
    zoomY.value = zoomStartOffset.y + dy;
  }
}

function onZonePointerUp(e) {
  activePointers.delete(e.pointerId);

  if (isPinching && activePointers.size < 2) {
    isPinching = false;
    if (zoomScale.value <= 1.02) {
      resetZoom();
    } else if (activePointers.size === 1) {
      const [remaining] = activePointers.values();
      isPanning = true;
      panStart = { x: remaining.x, y: remaining.y };
      zoomStartOffset = { x: zoomX.value, y: zoomY.value };
    }
  }

  if (activePointers.size > 0) return;

  isPanning = false;

  if (pinchOccurred) {
    // Gesture (pinch, possibly followed by a one-finger tail-pan) fully ended —
    // never treat its release as a page-turn tap.
    pinchOccurred = false;
    swipeHandled = true;
    return;
  }

  if (zoomScale.value > 1.01) {
    if (!dragMoved) resetZoom();
    swipeHandled = true; // block tap-to-navigate while zoomed / right after a pan
    return;
  }

  touchEnd(e);
}

watch(currentPageIndex, resetZoom);
watch(mode, resetZoom);
watch(spread, resetZoom);

// ─── URLs ─────────────────────────────────────────────────────────────────────
const currentPageUrl = computed(() =>
  `/api/media/manga/${props.item.id}/page/${currentPageIndex.value}?token=${token}`
);
function getPageUrl(index) {
  return `/api/media/manga/${props.item.id}/page/${index}?token=${token}`;
}

// ─── Controls auto-hide ───────────────────────────────────────────────────────
function showControlsNow() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  if (isTouchDevice) {
    hideTimer = setTimeout(() => { controlsVisible.value = false; }, 3000);
  }
}

function toggleControls() {
  if (swipeHandled) return;
  if (controlsVisible.value) {
    controlsVisible.value = false;
    clearTimeout(hideTimer);
  } else {
    showControlsNow();
  }
}

function onPointerMove() {
  // On desktop (non-touch), pointer move keeps controls visible
  if (!isTouchDevice) {
    showControlsNow();
  }
}

// Turning a page should NOT summon the chrome on touch: tapping the left/right zone is the
// primary way to read, so flashing the title bar and mode buttons on every single tap (then
// fading them out 3s later) makes the whole reader strobe. On desktop the controls are
// already pinned by pointer movement, so keeping it there costs nothing and still updates
// the page counter for keyboard users.
function showControlsOnNavigate() {
  if (!isTouchDevice) {
    showControlsNow();
  }
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function setMode(m) {
  cancelFlip();
  mode.value = m;
  showControlsNow();
}

// ─── Navigation ───────────────────────────────────────────────────────────────
// Routes a page change either straight through (default) or via startFlip() when the
// flip page-turn style is active — every caller below (taps, swipe, arrow keys) goes
// through nextPage()/prevPage(), so they all get the flip for free.
function navigateTo(target, isForward) {
  if (target === currentPageIndex.value || isFlipping.value) return;
  // Only clean, fully-paired spreads get the two-leaf flip; a boundary spread (e.g. the
  // last, odd-numbered page of the volume) falls back to an instant page change.
  const spreadOk = spread.value !== 'double'
    || (secondPageIndex.value !== null && target + 1 < totalPages.value);
  const canFlip = pageTurnStyle.value === 'flip' && mode.value !== 'webtoon' && zoomScale.value <= 1.01 && spreadOk;

  if (!canFlip) {
    currentPageIndex.value = target;
    saveProgress();
    showControlsOnNavigate();
    return;
  }
  startFlip(target, isForward);
}

function nextPage() {
  const step = (spread.value === 'double' && mode.value !== 'webtoon') ? 2 : 1;
  if (currentPageIndex.value >= totalPages.value - 1) return;
  navigateTo(Math.min(totalPages.value - 1, currentPageIndex.value + step), true);
}
function prevPage() {
  const step = (spread.value === 'double' && mode.value !== 'webtoon') ? 2 : 1;
  if (currentPageIndex.value <= 0) return;
  navigateTo(Math.max(0, currentPageIndex.value - step), false);
}
function goToPage(index) {
  cancelFlip(); // scrubbing mid-flip abandons the in-progress animation rather than leaving orphaned leaves
  currentPageIndex.value = Math.max(0, Math.min(index, totalPages.value - 1));
  saveProgress();
  showControlsOnNavigate();
}

// ─── Page Flip Animation ──────────────────────────────────────────────────────
function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(); return; }
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
  });
}

async function startFlip(target, isForward) {
  // Pivot rule: forward always hinges on the reading-direction's spine edge (left for
  // LTR, right for RTL); backward hinges on the opposite edge — mirrors how you'd grab
  // a physical page from the side you're turning toward.
  flipPivot.value = mode.value === 'ltr' ? (isForward ? 'left' : 'right') : (isForward ? 'right' : 'left');

  const spreadNow = spread.value === 'double' && secondPageIndex.value !== null;
  if (spreadNow) {
    flipOldLeftUrl.value = mode.value === 'rtl' ? secondPageUrl.value : currentPageUrl.value;
    flipOldRightUrl.value = mode.value === 'rtl' ? currentPageUrl.value : secondPageUrl.value;
    flipOldFullUrl.value = null;
  } else {
    flipOldFullUrl.value = currentPageUrl.value;
    flipOldLeftUrl.value = null;
    flipOldRightUrl.value = null;
  }

  flipTargetIndex = target;
  isFlipping.value = true; // mounts the leaf(ves) and re-points the static layer at the target
  showControlsOnNavigate();

  const targetSecond = target + 1 < totalPages.value ? target + 1 : null;
  const toPreload = spreadNow && targetSecond !== null
    ? [getPageUrl(target), getPageUrl(targetSecond)]
    : [getPageUrl(target)];
  // Don't reveal a blank frame mid-turn — but don't let a slow/broken image load hang the animation either.
  await Promise.race([
    Promise.all(toPreload.map(preloadImage)),
    new Promise((resolve) => setTimeout(resolve, 300)),
  ]);

  // Two rAFs: the first lets the leaf paint at rotateY(0) (matching the old page exactly,
  // so there's no visible jump), the second then flips it to the target angle so the
  // CSS transition on .flip-leaf actually has a "from" state to animate away from.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flipAnimating.value = true;
    });
  });
}

function onFlipTransitionEnd(e) {
  if (e && e.propertyName && e.propertyName !== 'transform') return;
  if (!isFlipping.value) return;
  currentPageIndex.value = flipTargetIndex;
  flipTargetIndex = null;
  isFlipping.value = false;
  flipAnimating.value = false;
  flipOldLeftUrl.value = null;
  flipOldRightUrl.value = null;
  flipOldFullUrl.value = null;
  saveProgress();
}

function handleLeftZone() {
  if (swipeHandled) return;
  mode.value === 'rtl' ? nextPage() : prevPage();
}
function handleRightZone() {
  if (swipeHandled) return;
  mode.value === 'rtl' ? prevPage() : nextPage();
}

// ─── Swipe gesture ────────────────────────────────────────────────────────────
let swipeHandled = false;

function touchStart(e) {
  touchStartX = e.clientX;
  touchStartY = e.clientY;
  swipeHandled = false;
  isTouchDevice = e.pointerType === 'touch';
}

function touchEnd(e) {
  const dx = e.clientX - touchStartX;
  const dy = e.clientY - touchStartY;

  // Only treat as swipe if horizontal distance > 40px and > vertical distance (not a scroll)
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
    swipeHandled = true;
    if (dx < 0) {
      // Swipe left → go forward (next in LTR, prev in RTL)
      mode.value === 'rtl' ? nextPage() : nextPage();
    } else {
      // Swipe right → go back
      prevPage();
    }
  }
}

// ─── Webtoon scroll tracking ──────────────────────────────────────────────────
function onWebtoonScroll(e) {
  const el = e.target;
  const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight || 1);
  currentPageIndex.value = Math.min(totalPages.value - 1, Math.floor(ratio * totalPages.value));
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (showBookmarksModal.value && e.key === 'Escape') {
    showBookmarksModal.value = false;
    return;
  }
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      mode.value === 'rtl' ? nextPage() : prevPage();
      break;
    case 'ArrowRight':
      e.preventDefault();
      mode.value === 'rtl' ? prevPage() : nextPage();
      break;
    case 'ArrowDown':
    case ' ':
      e.preventDefault();
      nextPage();
      break;
    case 'ArrowUp':
      e.preventDefault();
      prevPage();
      break;
    case 'Escape':
      closeReader();
      break;
  }
}

function onPageLoad() {
  // Preload upcoming pages
  const nextIdx = currentPageIndex.value + (spread.value === 'double' ? 2 : 1);
  if (nextIdx < totalPages.value) {
    const next = new Image();
    next.src = getPageUrl(nextIdx);
    if (spread.value === 'double' && nextIdx + 1 < totalPages.value) {
      const next2 = new Image();
      next2.src = getPageUrl(nextIdx + 1);
    }
  }
}

// ─── Backend ──────────────────────────────────────────────────────────────────
async function loadPages() {
  loading.value = true;
  try {
    const res = await api.get(`/media/manga/${props.item.id}/pages`);
    totalPages.value = res.data.totalPages || 0;
    if (currentPageIndex.value >= totalPages.value) currentPageIndex.value = 0;
  } catch (err) {
    console.error('Failed to load manga pages:', err);
  } finally {
    loading.value = false;
  }
}

async function saveProgress() {
  try {
    await api.post(`/progress/${props.item.id}`, {
      currentPage: currentPageIndex.value + 1,
      totalPages: totalPages.value
    });
  } catch (err) {
    console.warn('Failed to save progress:', err);
  }
}

async function loadBookmarks() {
  try {
    const res = await api.get(`/bookmarks/${props.item.id}`);
    bookmarks.value = res.data.bookmarks || [];
  } catch (err) { /* silent */ }
}
async function createBookmark() {
  try {
    await api.post('/bookmarks', {
      itemId: props.item.id, type: 'manga',
      position: currentPageIndex.value + 1,
      title: `Page ${currentPageIndex.value + 1}`,
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
  } catch (err) { /* silent */ }
}

function closeReader() {
  saveProgress();
  emit('close');
}

watch(() => props.item?.id, async (newId) => {
  if (!newId) return;
  cancelFlip(); // switching volumes mid-flip would otherwise strand the leaf overlay on screen
  currentPageIndex.value = props.item.initialPage !== undefined
    ? Math.max(0, props.item.initialPage - 1)
    : (props.item.current_page ? Math.max(0, props.item.current_page - 1) : 0);
  totalPages.value = props.item.total_pages || 0;
  await loadSeriesSettings();
  await loadPages();
  loadBookmarks();
  viewSession.open(newId);
});

// ─── Tablet landscape default ─────────────────────────────────────────────────
// On a touch tablet (iPad et al) held sideways, a single portrait manga page
// leaves most of the screen empty — default to a 2-page spread there. Only
// applied once at open so it never overrides a choice made mid-session.
function applyTabletLandscapeDefault() {
  if (mode.value === 'webtoon') return;
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const isLandscape = window.innerWidth > window.innerHeight;
  const isTabletWidth = window.innerWidth >= 900;
  if (isCoarsePointer && isLandscape && isTabletWidth) {
    spread.value = 'double';
  }
}

// Reading direction is a property of the series, not of this session — a Japanese manga
// should open right-to-left every time without the reader having to flip it on each open.
async function loadSeriesSettings() {
  const { library_id: libraryId, series } = props.item;
  if (!libraryId || !series) return;

  try {
    const res = await api.get(`/series/${libraryId}/${encodeURIComponent(series)}/settings`);
    const direction = res.data?.settings?.readingDirection;
    if (direction && modes.some((m) => m.id === direction)) {
      mode.value = direction;
    }
  } catch (err) {
    console.warn('Could not load series reading settings:', err.message);
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  applyTabletLandscapeDefault();
  await loadSeriesSettings();
  await loadPages();
  loadBookmarks();
  await nextTick();
  readerEl.value?.focus();
  // Auto-hide controls on touch after 3s
  showControlsNow();
  window.addEventListener('keydown', onKeyDown);
  viewSession.open(props.item.id);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  clearTimeout(hideTimer);
  viewSession.close();
});
</script>

<style scoped>
.pt-safe { padding-top: max(1rem, env(safe-area-inset-top)); }
.pb-safe { padding-bottom: max(1rem, env(safe-area-inset-bottom)); }

/* Page flip: perspective lives on each cell (the leaf's direct parent) so rotateY reads
   as a hinge rather than a flat squash — CSS only applies perspective to direct children. */
.flip-cell {
  perspective: 1600px;
}
.flip-leaf {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  will-change: transform;
  pointer-events: none;
  transition: transform 0.46s cubic-bezier(0.45, 0, 0.2, 1);
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.1s ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
}
</style>
