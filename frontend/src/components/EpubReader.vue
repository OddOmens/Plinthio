<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-background text-foreground transition-colors">
    <!-- Top Bar -->
    <header class="flex items-center justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] min-h-14 py-2 border-b border-border bg-background/95 backdrop-blur flex-shrink-0 pt-safe">
      <div class="flex items-center gap-3 min-w-0">
        <button aria-label="Back to shelf"
          @click="closeReader"
          class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95"
        >
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="min-w-0">
          <h2 class="text-sm font-semibold truncate text-foreground">{{ item.title }}</h2>
          <p class="text-xs text-muted-foreground">{{ item.author }}</p>
          <RatingBar :item="item" compact class="mt-1" />
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- Search inside the book -->
        <button
          @click="toggleSearch"
          aria-label="Search in book"
          :class="[
            'px-2.5 py-1.5 rounded-lg border text-xs transition flex items-center gap-1.5',
            showSearch
              ? 'bg-foreground text-background border-foreground'
              : 'text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground'
          ]"
        >
          <Search class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Search</span>
        </button>

        <!-- Font Settings -->
        <button
          @click="showSettings = !showSettings; showSearch = false"
          :class="[
            'px-2.5 py-1.5 rounded-lg border text-xs transition flex items-center gap-1.5',
            showSettings
              ? 'bg-foreground text-background border-foreground'
              : 'text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground'
          ]"
        >
          <Type class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Display</span>
        </button>

        <!-- Bookmark button -->
        <button
          @click="showBookmarks = !showBookmarks; showSearch = false"
          :class="[
            'px-2.5 py-1.5 rounded-lg border text-xs transition flex items-center gap-1.5',
            showBookmarks
              ? 'bg-foreground text-background border-foreground'
              : 'text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground'
          ]"
        >
          <Bookmark class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Bookmarks</span>
          <span v-if="bookmarks.length > 0" class="text-[10px] bg-muted px-1 py-0.5 rounded font-mono">{{ bookmarks.length }}</span>
        </button>
      </div>
    </header>

    <!-- EPUB Container -->
    <div class="flex-1 relative overflow-hidden">
      <!-- Loading State -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-background z-10">
        <div class="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 class="w-7 h-7 animate-spin" />
          <span class="text-sm">Opening book...</span>
        </div>
      </div>

      <!-- EPUB renders here -->
      <div
        ref="viewerEl"
        class="w-full h-full"
        :style="{ fontSize: settings.fontSize + 'px' }"
      />

      <!-- Paged mode left/right tap zones -->
      <template v-if="settings.layout === 'paged' && !loading">
        <div class="absolute inset-y-0 left-0 w-[20%] z-20 cursor-pointer" @click="prevPage" />
        <div class="absolute inset-y-0 right-0 w-[20%] z-20 cursor-pointer" @click="nextPage" />
      </template>
    </div>

    <!-- Bottom progress bar (paged mode) -->
    <div
      v-if="settings.layout === 'paged' && progressPercent > 0"
      class="flex-shrink-0 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-2 border-t border-border bg-background/95 flex items-center gap-3 pb-safe"
    >
      <span class="text-xs text-muted-foreground font-mono w-10 text-right flex-shrink-0">
        {{ Math.round(progressPercent) }}%
      </span>
      <div class="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full bg-primary transition-all duration-300 rounded-full"
          :style="{ width: progressPercent + '%' }"
        />
      </div>
    </div>

    <!-- Search Panel -->
    <Transition name="panel-slide">
      <div
        v-if="showSearch"
        @click.stop
        class="absolute top-[calc(3.5rem+env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-4.5rem)] bg-popover border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-3 text-sm"
      >
        <form @submit.prevent="runSearch" class="flex items-center gap-2">
          <div class="relative flex-1">
            <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              ref="searchInputEl"
              v-model="bookSearch"
              type="search"
              placeholder="Search this book…"
              class="w-full h-9 bg-background border border-border rounded-lg pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button type="submit" :disabled="searching || bookSearch.trim().length < 2" class="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
            <Loader2 v-if="searching" class="w-3.5 h-3.5 animate-spin" />
            <span v-else>Find</span>
          </button>
        </form>
        <p v-if="searchDone" class="text-[11px] text-muted-foreground">
          {{ searchResults.length ? `${searchResults.length}${searchResults.length >= SEARCH_LIMIT ? '+' : ''} match${searchResults.length === 1 ? '' : 'es'}` : 'No matches' }}
        </p>
        <ul class="flex-1 overflow-y-auto -mx-2 divide-y divide-border/60">
          <li v-for="(result, idx) in searchResults" :key="idx">
            <button @click="goToResult(result)" class="w-full text-left px-2 py-2 rounded-lg hover:bg-muted/60 transition">
              <p class="text-[11px] text-muted-foreground mb-0.5">{{ result.chapter }}</p>
              <p class="text-xs text-foreground leading-snug">{{ result.excerpt }}</p>
            </button>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- Display Settings Panel -->
    <Transition name="panel-slide">
      <div
        v-if="showSettings"
        @click.stop
        class="absolute top-[calc(3.5rem+env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-50 w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-4.5rem)] overflow-y-auto bg-popover border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-4 text-sm"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-foreground">Display Settings</span>
          <button aria-label="Close reader settings" @click="showSettings = false" class="text-muted-foreground hover:text-foreground p-1 rounded transition">
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Font Family -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Font</label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="f in fontOptions"
              :key="f.id"
              @click="settings.fontFamily = f.id; applySettings()"
              :class="[
                'px-3 py-2 rounded-lg border text-xs transition text-left',
                settings.fontFamily === f.id
                  ? 'bg-foreground text-background border-foreground font-semibold'
                  : 'border-border text-foreground hover:border-muted-foreground'
              ]"
              :style="{ fontFamily: f.css }"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <!-- Font Size -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Size</label>
            <span class="text-xs font-mono text-foreground">{{ settings.fontSize }}px</span>
          </div>
          <div class="flex items-center gap-2">
            <button aria-label="Decrease font size"
              @click="settings.fontSize = Math.max(12, settings.fontSize - 2); applySettings()"
              class="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-foreground hover:bg-muted transition text-sm font-bold"
            >A</button>
            <input
              type="range" min="12" max="28" step="1"
              v-model.number="settings.fontSize"
              @input="applySettings()"
              class="flex-1 accent-foreground"
            />
            <button aria-label="Increase font size"
              @click="settings.fontSize = Math.min(28, settings.fontSize + 2); applySettings()"
              class="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-foreground hover:bg-muted transition text-base font-bold"
            >A</button>
          </div>
        </div>

        <!-- Layout -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Layout</label>
          <div class="flex gap-1.5">
            <button
              v-for="l in layoutOptions"
              :key="l.id"
              @click="settings.layout = l.id; applyLayout()"
              :class="[
                'flex-1 px-3 py-2 rounded-lg border text-xs transition flex items-center justify-center gap-1.5',
                settings.layout === l.id
                  ? 'bg-foreground text-background border-foreground font-semibold'
                  : 'border-border text-foreground hover:border-muted-foreground'
              ]"
            >
              <component :is="l.icon" class="w-3.5 h-3.5" />
              {{ l.label }}
            </button>
          </div>
        </div>

        <!-- Theme -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reading Theme</label>
          <div class="flex gap-1.5">
            <button
              v-for="t in themeOptions"
              :key="t.id"
              @click="settings.readingTheme = t.id; applySettings()"
              :class="[
                'flex-1 py-2 rounded-lg border text-xs transition font-medium',
                settings.readingTheme === t.id ? 'ring-2 ring-foreground/80' : '',
                t.buttonClass
              ]"
            >{{ t.label }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Bookmarks Panel -->
    <Transition name="panel-slide">
      <div
        v-if="showBookmarks"
        @click.stop
        class="absolute top-[calc(3.5rem+env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-50 w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-4.5rem)] overflow-y-auto bg-popover border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-3 text-sm"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-foreground flex items-center gap-1.5">
            <Bookmark class="w-3.5 h-3.5" />
            Bookmarks
          </span>
          <button aria-label="Close bookmarks" @click="showBookmarks = false" class="text-muted-foreground hover:text-foreground p-1 rounded transition">
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Add bookmark -->
        <div class="flex flex-col gap-2 p-2.5 bg-muted/50 rounded-lg border border-border">
          <span class="text-xs text-muted-foreground">Bookmark current position</span>
          <input
            v-model="newBookmarkNote"
            @keyup.enter="createBookmark"
            placeholder="Optional note..."
            class="bg-background border border-border rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            @click="createBookmark"
            class="self-end px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 transition"
          >
            Save
          </button>
        </div>

        <!-- Bookmark list -->
        <div class="max-h-52 overflow-y-auto flex flex-col gap-1 divide-y divide-border/50">
          <div
            v-for="bm in bookmarks"
            :key="bm.id"
            class="pt-1.5 flex items-start justify-between gap-2"
          >
            <button
              @click="jumpToBookmark(bm)"
              class="flex-1 text-left text-xs hover:text-foreground text-muted-foreground transition"
            >
              <span class="font-medium text-foreground">{{ bm.title || 'Bookmark' }}</span>
              <p v-if="bm.notes" class="text-[11px] truncate mt-0.5">{{ bm.notes }}</p>
            </button>
            <button aria-label="Delete bookmark" @click="deleteBookmark(bm.id)" class="p-1 text-muted-foreground hover:text-destructive transition">
              <Trash2 class="w-3 h-3" />
            </button>
          </div>
          <div v-if="bookmarks.length === 0" class="py-4 text-center text-xs text-muted-foreground">
            No bookmarks yet.
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { ArrowLeft, Type, Bookmark, Loader2, X, Trash2, BookOpen, AlignJustify, Search } from 'lucide-vue-next';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { useViewSession } from '../composables/useViewSession';
import RatingBar from './RatingBar.vue';

const dialog = useDialogStore();
const viewSession = useViewSession();

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['close']);

const viewerEl = ref(null);
const loading = ref(true);
const showSettings = ref(false);
const showBookmarks = ref(false);
const progressPercent = ref(0);
const bookmarks = ref([]);
const newBookmarkNote = ref('');

let book = null;
let rendition = null;
let currentCfi = null;

const settings = reactive({
  fontFamily: 'sans',
  fontSize: 18,
  layout: 'paged',
  readingTheme: 'default',
});

const fontOptions = [
  { id: 'sans',   label: 'Sans-Serif', css: 'system-ui, -apple-system, sans-serif' },
  { id: 'serif',  label: 'Serif',      css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono',   label: 'Monospace',  css: '"Courier New", Courier, monospace' },
  { id: 'dyslexic', label: 'Readable', css: 'Verdana, Geneva, Tahoma, sans-serif' },
];

const layoutOptions = [
  { id: 'paged',    label: 'Paged',    icon: BookOpen },
  { id: 'scrolled', label: 'Scroll',   icon: AlignJustify },
];

const themeOptions = [
  { id: 'default', label: 'Default', buttonClass: 'bg-white text-zinc-900 border-zinc-200' },
  { id: 'sepia',   label: 'Sepia',   buttonClass: 'bg-amber-50 text-stone-800 border-amber-200' },
  { id: 'dark',    label: 'Dark',    buttonClass: 'bg-zinc-900 text-zinc-100 border-zinc-700' },
];

const themes = {
  default: { body: { background: '#ffffff', color: '#1a1a1a' } },
  sepia:   { body: { background: '#f5f0e8', color: '#3b2e20' } },
  dark:    { body: { background: '#18181b', color: '#e4e4e7' } },
};

function getFontCss(id) {
  return fontOptions.find(f => f.id === id)?.css || 'system-ui, sans-serif';
}

function applySettings() {
  if (!rendition) return;
  const theme = themes[settings.readingTheme] || themes.default;
  rendition.themes.override('body', `
    font-family: ${getFontCss(settings.fontFamily)} !important;
    font-size: ${settings.fontSize}px !important;
    line-height: 1.7 !important;
    background-color: ${theme.body.background} !important;
    color: ${theme.body.color} !important;
    padding: 1em 2em !important;
  `);
  rendition.themes.override('p', `
    font-family: ${getFontCss(settings.fontFamily)} !important;
    font-size: ${settings.fontSize}px !important;
  `);
}

async function applyLayout() {
  if (!book) return;
  // Destroy and recreate rendition with new layout
  if (rendition) {
    rendition.destroy();
  }
  createRendition();
}

async function createRendition() {
  const ePub = (await import('epubjs')).default;
  const w = viewerEl.value.clientWidth;
  const h = viewerEl.value.clientHeight;

  rendition = book.renderTo(viewerEl.value, {
    width: w,
    height: h,
    spread: 'none',
    flow: settings.layout === 'scrolled' ? 'scrolled' : 'paginated',
  });

  rendition.on('relocated', (location) => {
    currentCfi = location.start.cfi;
    progressPercent.value = Math.round((location.start.percentage || 0) * 100);
    saveProgress();
  });

  rendition.on('rendered', () => {
    applySettings();
  });

  // Start at saved position or beginning
  const savedCfi = props.item.current_page_cfi;
  if (savedCfi) {
    await rendition.display(savedCfi);
  } else {
    await rendition.display();
  }

  loading.value = false;
}

async function init() {
  const ePub = (await import('epubjs')).default;
  const token = getMediaToken() || '';
  const url = `/api/media/book/${props.item.id}/file?token=${token}`;

  // The file route has no .epub extension, and epub.js decides "zipped book vs unpacked
  // folder" from the extension — without openAs it went looking for
  // /file/META-INF/container.xml and never opened anything.
  book = ePub(url, { openAs: 'epub' });
  await book.ready;
  await createRendition();
}

// ─── Search inside the book ───────────────────────────────────────────────────
const SEARCH_LIMIT = 200;
const showSearch = ref(false);
const bookSearch = ref('');
const searchResults = ref([]);
const searching = ref(false);
const searchDone = ref(false);
const searchInputEl = ref(null);
let activeHighlight = null;

async function toggleSearch() {
  showSearch.value = !showSearch.value;
  if (showSearch.value) {
    showSettings.value = false;
    showBookmarks.value = false;
    await nextTick();
    searchInputEl.value?.focus();
  }
}

function chapterLabel(href) {
  const flat = [];
  const walk = (items) => items?.forEach((t) => { flat.push(t); walk(t.subitems); });
  walk(book?.navigation?.toc);
  const base = (href || '').split('#')[0];
  const match = flat.find((t) => (t.href || '').split('#')[0].endsWith(base) || base.endsWith((t.href || '').split('#')[0]));
  return match?.label?.trim() || '';
}

// epub.js can search one spine section at a time; sections are loaded, searched and
// unloaded in order so a long book doesn't hold every chapter's DOM in memory at once.
async function runSearch() {
  const query = bookSearch.value.trim();
  if (!book || query.length < 2) return;
  searching.value = true;
  searchDone.value = false;
  searchResults.value = [];
  try {
    const results = [];
    for (const section of book.spine.spineItems) {
      if (results.length >= SEARCH_LIMIT) break;
      try {
        await section.load(book.load.bind(book));
        const found = section.find(query) || [];
        const chapter = chapterLabel(section.href);
        for (const hit of found) {
          results.push({ cfi: hit.cfi, excerpt: hit.excerpt.trim(), chapter });
          if (results.length >= SEARCH_LIMIT) break;
        }
      } finally {
        section.unload();
      }
    }
    searchResults.value = results;
  } catch (err) {
    console.warn('Book search failed:', err);
  } finally {
    searching.value = false;
    searchDone.value = true;
  }
}

async function goToResult(result) {
  if (!rendition) return;
  if (activeHighlight) {
    try { rendition.annotations.remove(activeHighlight, 'highlight'); } catch (e) { /* gone */ }
  }
  await rendition.display(result.cfi);
  try {
    rendition.annotations.highlight(result.cfi, {}, null, 'plinthio-search-hit', { fill: 'yellow', 'fill-opacity': '0.35' });
    activeHighlight = result.cfi;
  } catch (e) {
    // Highlighting is cosmetic; navigation already happened.
  }
  // On a phone the panel covers the page, so get out of the way.
  if (window.matchMedia?.('(max-width: 640px)').matches) showSearch.value = false;
}

function nextPage() {
  rendition?.next();
}
function prevPage() {
  rendition?.prev();
}

function onKeyDown(e) {
  if (showSettings.value || showBookmarks.value || showSearch.value) {
    if (e.key === 'Escape') { showSettings.value = false; showBookmarks.value = false; showSearch.value = false; }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); toggleSearch(); return; }
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextPage(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); }
  else if (e.key === 'Escape') closeReader();
}

async function saveProgress() {
  if (!currentCfi) return;
  try {
    await api.post(`/progress/${props.item.id}`, {
      currentPage: Math.round(progressPercent.value),
      totalPages: 100,
      cfi: currentCfi,
    });
  } catch (err) { /* silent */ }
}

async function loadBookmarks() {
  try {
    const res = await api.get(`/bookmarks/${props.item.id}`);
    bookmarks.value = res.data.bookmarks || [];
  } catch (err) { /* silent */ }
}

async function createBookmark() {
  if (!currentCfi) return;
  try {
    await api.post('/bookmarks', {
      itemId: props.item.id,
      type: 'book',
      position: Math.round(progressPercent.value),
      title: `${Math.round(progressPercent.value)}% through`,
      notes: newBookmarkNote.value.trim() || null,
      cfi: currentCfi,
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

function jumpToBookmark(bm) {
  if (bm.cfi && rendition) rendition.display(bm.cfi);
  showBookmarks.value = false;
}

function closeReader() {
  saveProgress();
  if (rendition) rendition.destroy();
  if (book) book.destroy();
  emit('close');
}

onMounted(() => {
  init();
  loadBookmarks();
  window.addEventListener('keydown', onKeyDown);
  viewSession.open(props.item.id);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  viewSession.close();
});
</script>

<style scoped>
.pt-safe { padding-top: max(0px, env(safe-area-inset-top)); }
.pb-safe { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }

.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-6px);
}
</style>
