<template>
  <Teleport to="body">
  <div v-if="isOpen" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
    <div
      v-click-outside="close"
      class="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90dvh] my-auto transition-all"
    >
      <!-- Header -->
      <div class="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div class="min-w-0 pr-2">
          <h3 class="text-sm font-semibold text-foreground truncate">Edit Metadata</h3>
          <p class="text-xs text-muted-foreground truncate mt-0.5">
            {{ isBulk ? `Applies to all ${applyToIds.length} volumes` : item?.title }}
          </p>
        </div>
        <button aria-label="Close"
          type="button"
          @click="close"
          class="p-2.5 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="overflow-y-auto flex-1">
        <!-- Editable Fields -->
        <div class="px-5 py-4 flex flex-col gap-3 border-b border-border">
          <div class="flex gap-3">
            <div class="flex-shrink-0 flex flex-col gap-1.5">
              <div class="relative w-16 h-24 rounded-md overflow-hidden bg-muted/40 border border-border/60 group">
                <img
                  v-if="previewCoverUrl"
                  :src="previewCoverUrl"
                  alt="Cover preview"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center">
                  <ImageOff class="w-4 h-4 text-muted-foreground" />
                </div>

                <!-- Click the art itself to replace it, the way Jellyfin does -->
                <button
                  type="button"
                  @click="coverFileInput?.click()"
                  :disabled="uploadingCover"
                  class="absolute inset-0 bg-black/60 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100 transition flex flex-col items-center justify-center gap-1 text-white disabled:opacity-100"
                  title="Replace cover art"
                >
                  <Loader2 v-if="uploadingCover" class="w-4 h-4 animate-spin" />
                  <Upload v-else class="w-4 h-4" />
                  <span class="text-[9px] font-medium leading-none text-center px-1">
                    {{ uploadingCover ? 'Saving' : (isBulk ? 'Set for series' : 'Replace') }}
                  </span>
                </button>
              </div>

              <input
                ref="coverFileInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="onCoverSelected"
              />
            </div>

            <div class="flex-1 flex flex-col gap-2.5 min-w-0">
              <div v-if="!isBulk">
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">Title</label>
                <input
                  v-model="form.title"
                  placeholder="Title"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">{{ authorLabel }}</label>
                <input
                  v-model="form.author"
                  :placeholder="isVideoType ? 'Director(s)' : 'Unknown Author'"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">{{ artistsLabel }}</label>
                <input
                  v-model="form.artists"
                  :placeholder="isVideoType ? 'Comma separated actors' : 'Comma separated'"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">Series</label>
                <input
                  v-model="form.series"
                  placeholder="Series name"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          <!-- Extended metadata -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Release Date</label>
              <input
                v-model="form.releaseDate"
                placeholder="e.g. 2019 or 2019-06-26"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Age Rating</label>
              <select
                v-model="form.ageRating"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{{ form.series ? 'Same as series' : 'Unrated' }}</option>
                <option v-for="rating in AGE_RATINGS" :key="rating" :value="rating">{{ rating }}</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
              <input
                v-model="form.status"
                placeholder="e.g. Ongoing, Completed"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Publisher</label>
              <input
                v-model="form.publisher"
                placeholder="Publisher"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Genres</label>
              <input
                v-model="form.genres"
                placeholder="Comma separated"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-muted-foreground mb-1">Themes</label>
              <input
                v-model="form.themes"
                placeholder="Comma separated"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label class="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
            <textarea
              v-model="form.description"
              placeholder="Synopsis / description"
              rows="3"
              class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          <button
            type="button"
            @click="saveForm"
            :disabled="saving || loadingFull"
            class="self-end px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition disabled:opacity-50 shadow-sm flex items-center gap-1.5"
          >
            <Check class="w-3.5 h-3.5" />
            <span>{{ saving ? 'Saving...' : (loadingFull ? 'Loading…' : 'Save') }}</span>
          </button>
        </div>

        <!-- Search External Database (to fill in blanks) -->
        <div class="px-5 py-4 flex flex-col gap-2">
          <button
            type="button"
            @click="expanded = !expanded"
            class="w-full flex items-center justify-between text-xs font-semibold text-foreground"
          >
            <span class="flex items-center gap-1.5">
              <SearchIcon class="w-3.5 h-3.5 text-muted-foreground" />
              Search {{ providerLabel }} to fill in missing info
            </span>
            <ChevronDown :class="['w-4 h-4 text-muted-foreground transition-transform', expanded ? 'rotate-180' : '']" />
          </button>

          <div v-if="expanded" class="flex flex-col gap-2 pt-1">
            <div class="flex gap-2">
              <input
                v-model="query"
                @keyup.enter="search"
                placeholder="Search title..."
                class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                v-if="isVideoType"
                v-model="yearQuery"
                @keyup.enter="search"
                placeholder="Year"
                title="Filter by release year (e.g. 2002)"
                class="w-20 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center"
              />
              <button
                type="button"
                @click="search"
                :disabled="searching || !query.trim()"
                class="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition disabled:opacity-50 shadow-sm flex items-center gap-1.5"
              >
                <SearchIcon class="w-3.5 h-3.5" />
                <span>{{ searching ? 'Searching...' : 'Search' }}</span>
              </button>
            </div>

            <div class="flex flex-col gap-2">
              <div v-if="searching" class="py-6 text-center text-xs text-muted-foreground">
                Searching {{ providerLabel }}...
              </div>

              <div v-else-if="errorMessage" class="py-4 text-center text-xs text-destructive px-2">
                {{ errorMessage }}
              </div>

              <div v-else-if="hasSearched && results.length === 0" class="py-6 text-center text-xs text-muted-foreground">
                No results found. Try a different search term.
              </div>

              <div v-if="searchedAs && hasSearched && !searching" class="text-[10px] text-muted-foreground/60 text-center px-2">
                Searched as: <span class="font-mono">{{ searchedAs }}</span>
              </div>

              <div
                v-for="result in results"
                :key="`${result.source}-${result.externalId}`"
                class="flex flex-col gap-2 p-2.5 rounded-lg border border-border hover:border-muted-foreground/30 transition"
              >
                <div class="flex gap-3">
                  <div class="w-10 h-14 flex-shrink-0 rounded-md overflow-hidden bg-muted/40 border border-border/60">
                    <img
                      v-if="result.coverUrl"
                      :src="result.coverUrl"
                      :alt="result.title"
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div v-else class="w-full h-full flex items-center justify-center">
                      <ImageOff class="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div class="flex flex-col min-w-0 flex-1 gap-0.5">
                    <span class="text-xs font-semibold text-foreground truncate">{{ result.title }}</span>
                    <span v-if="result.author" class="text-[11px] text-muted-foreground truncate">{{ isVideoType ? 'Dir: ' : '' }}{{ result.author }}</span>
                    <span v-if="result.artists" class="text-[11px] text-muted-foreground truncate">{{ isVideoType ? 'Cast: ' : 'Art: ' }}{{ result.artists }}</span>
                    <span v-if="result.releaseDate" class="text-[11px] text-muted-foreground font-mono">
                      {{ result.releaseDate }}<template v-if="result.rating != null"> · ★ {{ result.rating.toFixed(1) }}/10</template>
                    </span>
                    <span v-if="result.genres?.length" class="text-[11px] text-muted-foreground truncate">{{ result.genres.join(', ') }}</span>
                    <span v-if="result.themes?.length" class="text-[11px] text-muted-foreground truncate">{{ result.themes.join(', ') }}</span>
                    <span class="text-[10px] uppercase font-mono tracking-wide text-muted-foreground/70 mt-auto">{{ sourceLabel(result.source) }}</span>
                  </div>
                </div>

                <!-- Pick which fields from this result to apply -->
                <div class="flex flex-wrap gap-1.5 pt-1.5 border-t border-border/50">
                  <button
                    type="button"
                    @click="fillFromResult(result)"
                    class="px-2 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground text-[10px] font-semibold transition"
                  >
                    Use All
                  </button>
                  <button
                    v-for="field in pickableFields(result)"
                    :key="field.key"
                    type="button"
                    @click="applyField(result, field)"
                    class="px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground text-[10px] font-medium transition"
                  >
                    {{ field.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, reactive, computed, watch } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { X, Search as SearchIcon, ImageOff, Check, ChevronDown, Upload, Loader2 } from 'lucide-vue-next';

const dialog = useDialogStore();

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  item: { type: Object, default: null },
  // When provided, Save writes author + series to every id in this list (bulk series edit)
  // instead of title/author/series/cover on the single `item` above.
  applyToIds: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'applied']);

const isBulk = computed(() => props.applyToIds && props.applyToIds.length > 0);

// Used by parental controls (Admin → Users → Content Limit).
const AGE_RATINGS = ['Everyone', 'Teen', 'Mature', 'Explicit'];
const form = reactive({ ageRating: '',
  title: '', author: '', artists: '', series: '',
  description: '', releaseDate: '', genres: '', themes: '', publisher: '', status: ''
});
const pickedCoverUrl = ref(null);
// A TMDB result's community score, carried along when "use all" picks that result so the
// item gets its world rating saved with the rest of the metadata.
const pickedRating = ref(null);
const saving = ref(false);
const yearQuery = ref('');

const coverFileInput = ref(null);
const uploadingCover = ref(false);
// Bumped after an upload to bust the browser's image cache — the cover URL is stable
// (/cover/:id) so without it the old art would keep showing.
const coverCacheBust = ref(0);

async function onCoverSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // allow re-picking the same file after a failure
  if (!file || !props.item) return;

  uploadingCover.value = true;
  try {
    const form = new FormData();
    form.append('cover', file);

    // A series-wide edit sets the art for every volume; a single-item edit sets just that one.
    if (isBulk.value && props.item.series) {
      form.append('series', props.item.series);
      if (props.item.library_id) form.append('libraryId', props.item.library_id);
      if (props.item.media_type) form.append('mediaType', props.item.media_type);
      await api.post('/metadata/series-cover', form);
    } else {
      await api.post(`/metadata/cover/${props.item.id}`, form);
    }

    pickedCoverUrl.value = null; // a real cover now exists; stop previewing a remote URL
    coverCacheBust.value = Date.now();
    emit('applied');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not upload that image.');
  } finally {
    uploadingCover.value = false;
  }
}

const query = ref('');
const results = ref([]);
const searching = ref(false);
const hasSearched = ref(false);
const errorMessage = ref('');
const searchedAs = ref('');
const expanded = ref(false);

const token = getMediaToken() || '';

const isVideoType = computed(() =>
  ['movie', 'show', 'anime'].includes(props.item?.media_type)
);

const authorLabel = computed(() => isVideoType.value ? 'Director(s)' : 'Author(s)');
const artistsLabel = computed(() => isVideoType.value ? 'Cast / Actors' : 'Artist(s)');

const previewCoverUrl = computed(() => {
  if (pickedCoverUrl.value) return pickedCoverUrl.value;
  // Series-wide edits pass a synthetic item with no id, so there's nothing to preview —
  // the upload button still works, since that path keys off the series name.
  if (!props.item?.id) return null;
  // Always fetch from the server — it returns a styled placeholder SVG when no artwork
  // exists yet, which is far better than showing the ImageOff icon. coverCacheBust forces
  // a fresh fetch after a user upload so the old art isn't served from the browser cache.
  const bust = coverCacheBust.value ? `&v=${coverCacheBust.value}` : '';
  return `/api/media/cover/${props.item.id}?token=${token}${bust}`;
});

const providerLabel = computed(() => {
  switch (props.item?.media_type) {
    case 'manga': return 'MangaDex';
    case 'book': return 'Google Books / Open Library';
    case 'movie': return 'TMDB';
    case 'show': return 'TMDB';
    case 'anime': return 'TMDB';
    default: return 'external sources';
  }
});

function sourceLabel(source) {
  return {
    mangadex: 'MangaDex',
    'google-books': 'Google Books',
    'open-library': 'Open Library',
    tmdb: 'TMDB'
  }[source] || source;
}

// Fields a search result can contribute, and which form field they map to. `bulkHidden`
// fields don't make sense to apply across every volume in a series-wide (bulk) edit.
const PICK_FIELDS = computed(() => [
  { key: 'title', label: 'Title', bulkHidden: true },
  { key: 'author', label: isVideoType.value ? 'Director' : 'Author' },
  { key: 'artists', label: isVideoType.value ? 'Cast' : 'Artists' },
  { key: 'series', label: 'Series' },
  { key: 'releaseDate', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'genres', label: 'Genres' },
  { key: 'themes', label: 'Themes' },
  { key: 'overview', label: 'Description', formKey: 'description' },
  { key: 'coverUrl', label: 'Cover', bulkHidden: true }
]);

function hasValue(val) {
  return Array.isArray(val) ? val.length > 0 : !!val;
}

function pickableFields(result) {
  return PICK_FIELDS.value.filter((f) => (!isBulk.value || !f.bulkHidden) && hasValue(result[f.key]));
}

function applyField(result, field) {
  const raw = result[field.key];
  if (field.key === 'coverUrl') {
    pickedCoverUrl.value = raw;
    return;
  }
  const formKey = field.formKey || field.key;
  form[formKey] = Array.isArray(raw) ? raw.join(', ') : raw;
}

watch(
  () => props.isOpen,
  (val) => {
    if (val && props.item) {
      fillForm(props.item);
      // Shelf cards carry a trimmed row (no description, themes, publisher, status, rating),
      // and saving sends every field — so without the full row, saving from the shelf
      // silently blanked all of those. Load it before the user can save.
      if (!isBulk.value && props.item.id) {
        const id = props.item.id;
        loadingFull.value = true;
        api.get(`/items/${id}`)
          .then((res) => { if (props.item?.id === id && res.data.item) fillForm(res.data.item); })
          .catch(() => {})
          .finally(() => { loadingFull.value = false; });
      }
      pickedCoverUrl.value = null;
      pickedRating.value = null;
      query.value = props.item.cleanTitle || props.item.series || props.item.title || '';
      yearQuery.value = (props.item.release_date ? props.item.release_date.slice(0, 4) : props.item.detectedYear) || '';
      results.value = [];
      hasSearched.value = false;
      errorMessage.value = '';
      searchedAs.value = '';
      expanded.value = false;
    }
  }
);

const loadingFull = ref(false);

function fillForm(item) {
  form.title = isBulk.value ? '' : (item.title || '');
  form.author = item.author || '';
  form.artists = item.artists || '';
  form.series = item.series || '';
  form.description = item.description || '';
  form.releaseDate = item.release_date || '';
  form.genres = item.genres || '';
  form.themes = item.themes || '';
  form.publisher = item.publisher || '';
  form.status = item.status || '';
  form.ageRating = item.age_rating || '';
}

async function search() {
  if (!query.value.trim() || !props.item) return;
  searching.value = true;
  errorMessage.value = '';
  searchedAs.value = '';
  try {
    const res = await api.get('/metadata/search', {
      params: {
        mediaType: props.item.media_type,
        query: query.value.trim(),
        year: yearQuery.value.trim() || undefined
      }
    });
    results.value = res.data.results || [];
    searchedAs.value = res.data.searchedAs || '';
  } catch (err) {
    console.error('Metadata search failed:', err);
    results.value = [];
    errorMessage.value = err.response?.data?.error || 'Failed to search metadata providers — see browser console for details.';
  } finally {
    searching.value = false;
    hasSearched.value = true;
  }
}

function fillFromResult(result) {
  pickableFields(result).forEach((field) => applyField(result, field));
  pickedRating.value = result.source === 'tmdb' && result.rating != null
    ? { source: result.source, rating: result.rating, ratingVotes: result.ratingVotes }
    : null;
}

async function saveForm() {
  if (saving.value || loadingFull.value) return;
  saving.value = true;
  try {
    const sharedFields = {
      author: form.author.trim() || null,
      artists: form.artists.trim() || null,
      series: form.series.trim() || null,
      description: form.description.trim() || null,
      releaseDate: form.releaseDate.trim() || null,
      genres: form.genres.trim() || null,
      themes: form.themes.trim() || null,
      publisher: form.publisher.trim() || null,
      status: form.status.trim() || null,
      ageRating: form.ageRating || null,
      ...(pickedRating.value || {})
    };

    if (isBulk.value) {
      const outcomes = await Promise.allSettled(
        props.applyToIds.map((id) => api.post(`/metadata/apply/${id}`, sharedFields))
      );
      const failed = outcomes.filter((o) => o.status === 'rejected');
      const succeeded = outcomes.length - failed.length;
      if (failed.length > 0) {
        failed.forEach((f) => console.error('Metadata save failed for a volume:', f.reason));
        dialog.alert(`Saved to ${succeeded} of ${outcomes.length} volumes. ${failed.length} failed — see browser console for details.`);
      } else {
        dialog.alert({ title: 'Metadata saved', message: `Updated all ${outcomes.length} volumes.`, type: 'success' });
      }
    } else {
      if (!props.item) return;
      const payload = {
        title: form.title.trim() || props.item.title,
        ...sharedFields
      };
      if (pickedCoverUrl.value) payload.coverUrl = pickedCoverUrl.value;
      await api.post(`/metadata/apply/${props.item.id}`, payload);
      dialog.alert({ title: 'Metadata saved', message: `Updated "${payload.title}".`, type: 'success' });
    }
    emit('applied');
    close();
  } catch (err) {
    console.error('Metadata save failed:', err);
    dialog.alert(err.response?.data?.error || 'Failed to save metadata — see browser console for details.');
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}

// The listener is attached on a deferred tick so the same click that opens this modal
// (e.g. a button not wrapped in @click.stop) doesn't immediately bubble into it and
// close the modal right back up before it's visible.
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
