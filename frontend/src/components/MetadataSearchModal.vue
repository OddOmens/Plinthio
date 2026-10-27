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
          <h3 class="text-sm font-semibold text-foreground truncate">{{ $t('metadata.edit.title') }}</h3>
          <p class="text-xs text-muted-foreground truncate mt-0.5">
            {{ isBulk ? $t('metadata.edit.appliesToAll', { count: applyToIds.length }) : item?.title }}
          </p>
        </div>
        <button :aria-label="$t('common.close')"
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
                  :alt="$t('metadata.edit.coverPreview')"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center">
                  <ImageOff class="w-4 h-4 text-muted-foreground" />
                </div>

                <!-- Click the art itself to replace it -->
                <button
                  type="button"
                  @click="coverFileInput?.click()"
                  :disabled="uploadingCover"
                  class="absolute inset-0 bg-black/60 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100 transition flex flex-col items-center justify-center gap-1 text-white disabled:opacity-100"
                  :title="$t('metadata.edit.replaceCover')"
                >
                  <Loader2 v-if="uploadingCover" class="w-4 h-4 animate-spin" />
                  <Upload v-else class="w-4 h-4" />
                  <span class="text-[10px] font-medium leading-none text-center px-1">
                    {{ uploadingCover ? $t('metadata.edit.coverSaving') : (isBulk ? $t('metadata.edit.setForSeries') : $t('metadata.edit.replace')) }}
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
                <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.title') }}</label>
                <input
                  v-model="form.title"
                  :placeholder="$t('metadata.fields.title')"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ authorLabel }}</label>
                <input
                  v-model="form.author"
                  :placeholder="isVideoType ? $t('metadata.fields.directors') : $t('metadata.edit.unknownAuthor')"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ artistsLabel }}</label>
                <input
                  v-model="form.artists"
                  :placeholder="isVideoType ? $t('metadata.edit.commaSeparatedActors') : $t('metadata.edit.commaSeparated')"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div class="flex gap-2">
                <div class="flex-1 min-w-0">
                  <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.series') }}</label>
                  <input
                    v-model="form.series"
                    :placeholder="$t('metadata.edit.seriesName')"
                    class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <!-- A book's or volume's place in its series; episodes keep theirs in the file name. -->
                <div v-if="showSeriesNumber" class="w-20 flex-shrink-0">
                  <label class="block text-[12px] font-medium text-muted-foreground mb-1 truncate" :title="$t('metadata.fields.seriesNumber')">{{ $t('metadata.fields.seriesNumberShort') }}</label>
                  <input
                    v-model="form.volume"
                    inputmode="decimal"
                    :placeholder="$t('metadata.edit.seriesNumberExample')"
                    :aria-label="$t('metadata.fields.seriesNumber')"
                    class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Extended metadata -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.releaseDate') }}</label>
              <input
                v-model="form.releaseDate"
                :placeholder="$t('metadata.edit.releaseDateExample')"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.ageRating') }}</label>
              <select
                v-model="form.ageRating"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{{ form.series ? $t('metadata.edit.sameAsSeries') : $t('metadata.edit.unrated') }}</option>
                <option v-for="rating in AGE_RATINGS" :key="rating" :value="rating">{{ $t(`metadata.ageRatings.${rating.toLowerCase()}`) }}</option>
              </select>
            </div>
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.status') }}</label>
              <input
                v-model="form.status"
                :placeholder="$t('metadata.edit.statusExample')"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.publisher') }}</label>
              <input
                v-model="form.publisher"
                :placeholder="$t('metadata.fields.publisher')"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <template v-if="hasLanguage">
              <div v-if="!isBulk && isBook">
                <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.isbn') }}</label>
                <input
                  v-model="form.isbn"
                  inputmode="numeric"
                  :placeholder="$t('metadata.edit.isbnExample')"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-[12px] font-medium text-muted-foreground mb-1">
                  {{ $t('metadata.fields.language') }}<span v-if="languageName(form.language) !== form.language.trim()" class="font-normal text-muted-foreground/70"> · {{ languageName(form.language.trim()) }}</span>
                </label>
                <input
                  v-model="form.language"
                  :placeholder="$t('metadata.edit.languageExample')"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </template>
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.genres') }}</label>
              <input
                v-model="form.genres"
                :placeholder="$t('metadata.edit.commaSeparated')"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.themes') }}</label>
              <input
                v-model="form.themes"
                :placeholder="$t('metadata.edit.commaSeparated')"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label class="block text-[12px] font-medium text-muted-foreground mb-1">{{ $t('metadata.fields.description') }}</label>
            <textarea
              v-model="form.description"
              :placeholder="$t('metadata.edit.descriptionPlaceholder')"
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
            <span>{{ saving ? $t('metadata.edit.saving') : (loadingFull ? $t('common.loading') : $t('common.save')) }}</span>
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
              {{ $t('metadata.edit.searchToFill', { provider: providerLabel }) }}
            </span>
            <ChevronDown :class="['w-4 h-4 text-muted-foreground transition-transform', expanded ? 'rotate-180' : '']" />
          </button>

          <div v-if="expanded" class="flex flex-col gap-2 pt-1">
            <div class="flex gap-2">
              <input
                v-model="query"
                @keyup.enter="search"
                :placeholder="$t('metadata.edit.searchPlaceholder')"
                class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                v-if="isVideoType"
                v-model="yearQuery"
                @keyup.enter="search"
                :placeholder="$t('metadata.edit.year')"
                :title="$t('metadata.edit.yearHint')"
                class="w-20 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center"
              />
              <button
                type="button"
                @click="search"
                :disabled="searching || !query.trim()"
                class="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition disabled:opacity-50 shadow-sm flex items-center gap-1.5"
              >
                <SearchIcon class="w-3.5 h-3.5" />
                <span>{{ searching ? $t('metadata.edit.searching') : $t('common.search') }}</span>
              </button>
            </div>

            <div class="flex flex-col gap-2">
              <div v-if="searching" class="py-6 text-center text-xs text-muted-foreground">
                {{ $t('metadata.edit.searchingProvider', { provider: providerLabel }) }}
              </div>

              <div v-else-if="errorMessage" class="py-4 text-center text-xs text-destructive px-2">
                {{ errorMessage }}
              </div>

              <div v-else-if="hasSearched && results.length === 0" class="py-6 text-center text-xs text-muted-foreground">
                {{ $t('metadata.edit.noResults') }}
              </div>

              <div v-if="searchedAs && hasSearched && !searching" class="text-[11px] text-muted-foreground/60 text-center px-2">
                <I18nT keypath="metadata.edit.searchedAs" tag="">
                  <template #query><span class="font-mono">{{ searchedAs }}</span></template>
                </I18nT>
              </div>

              <p
                v-for="notice in (searching ? [] : notices)"
                :key="notice.provider"
                class="text-[11px] leading-snug text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-2.5 py-1.5"
              >
                {{ noticeText(notice) }}
              </p>

              <div
                v-for="result in results"
                :key="resultKey(result)"
                class="flex flex-col gap-2 p-2.5 rounded-lg border border-border hover:border-muted-foreground/30 transition"
              >
                <div class="flex gap-3">
                  <div class="w-10 h-14 flex-shrink-0 rounded-md overflow-hidden bg-muted/40 border border-border/60">
                    <img
                      v-if="hasCover(result)"
                      :src="result.coverUrl"
                      :alt="result.title"
                      class="w-full h-full object-cover"
                      loading="lazy"
                      @error="brokenCovers.add(result.coverUrl)"
                    />
                    <div v-else class="w-full h-full flex items-center justify-center">
                      <ImageOff class="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div class="flex flex-col min-w-0 flex-1 gap-0.5">
                    <span class="text-xs font-semibold text-foreground truncate">{{ result.title }}</span>
                    <span v-if="result.author" class="text-[12px] text-muted-foreground truncate">{{ isVideoType ? $t('metadata.edit.resultDirector', { name: result.author }) : result.author }}</span>
                    <span v-if="result.artists" class="text-[12px] text-muted-foreground truncate">{{ isVideoType ? $t('metadata.edit.resultCast', { names: result.artists }) : isAudiobook ? $t('metadata.edit.resultNarrators', { names: result.artists }) : $t('metadata.edit.resultArt', { names: result.artists }) }}</span>
                    <span v-if="result.series && result.series !== result.title" class="text-[12px] text-muted-foreground truncate">{{ result.seriesNumber != null ? `${result.series} #${$n(result.seriesNumber)}` : result.series }}</span>
                    <span v-if="result.releaseDate" class="text-[12px] text-muted-foreground font-mono">
                      {{ result.releaseDate }}<template v-if="result.rating != null"> · ★ {{ $n(result.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}/10</template>
                    </span>
                    <span v-if="result.isbn || result.language || result.publisher" class="text-[12px] text-muted-foreground truncate">{{ [result.publisher, result.isbn && $t('metadata.edit.resultIsbn', { isbn: result.isbn }), result.language && languageName(result.language)].filter(Boolean).join(' · ') }}</span>
                    <span v-if="result.genres?.length" class="text-[12px] text-muted-foreground truncate">{{ result.genres.join(', ') }}</span>
                    <span v-if="result.themes?.length" class="text-[12px] text-muted-foreground truncate">{{ result.themes.join(', ') }}</span>
                    <span v-if="result.overview" class="text-[12px] text-muted-foreground line-clamp-2">{{ result.overview }}</span>
                    <span v-else-if="loadingDetails.has(resultKey(result))" class="text-[12px] text-muted-foreground/70 flex items-center gap-1">
                      <Loader2 class="w-3 h-3 animate-spin" />{{ $t('metadata.edit.loadingDetails') }}
                    </span>
                    <span class="text-[11px] uppercase font-mono tracking-wide text-muted-foreground/70 mt-auto">{{ sourceLabel(result.source) }}</span>
                  </div>
                </div>

                <!-- Pick which fields from this result to apply -->
                <div class="flex flex-wrap gap-1.5 pt-1.5 border-t border-border/50">
                  <button
                    type="button"
                    @click="fillFromResult(result)"
                    class="px-2 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground text-[11px] font-semibold transition"
                  >
                    {{ $t('metadata.edit.useAll') }}
                  </button>
                  <button
                    v-for="field in pickableFields(result)"
                    :key="field.key"
                    type="button"
                    @click="applyField(result, field)"
                    class="px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground text-[11px] font-medium transition"
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
import { t, languageName, locale } from '../i18n';
import { SOURCE_LABELS } from '../utils/externalTitle';
import { X, Search as SearchIcon, ImageOff, Check, ChevronDown, Upload, Loader2 } from '@lucide/vue';

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
  description: '', releaseDate: '', genres: '', themes: '', publisher: '', status: '',
  volume: '', isbn: '', language: ''
});
// Where a picked cover came from: a Google Books pick is saved from its full-size image,
// not the search thumbnail (see POST /metadata/apply).
const pickedCoverFrom = ref(null);
const pickedCoverUrl = ref(null);
// A TMDB result's community score, carried along when "use all" picks that result so the
// item gets its world rating saved with the rest of the metadata.
const pickedRating = ref(null);
// Which TMDB title "use all" picked, so the title page's cast and crew follow it.
const pickedTmdbId = ref(null);
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
    dialog.alert(err.response?.data?.error || t('metadata.edit.uploadFailed'));
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
// Book providers that didn't answer the last search, and why (see GET /metadata/search).
const notices = ref([]);
const expanded = ref(false);
// Cover links that failed to load, so their result shows the placeholder and offers no cover.
const brokenCovers = reactive(new Set());
// Results whose details are being fetched (see loadDetails), and the fetches themselves, so
// "Use all" can wait for one.
const loadingDetails = reactive(new Set());
let detailRequests = new Map();
// How many results get their missing details fetched right after a search.
const DETAILS_PREFETCH = 5;

const token = getMediaToken() || '';

const isVideoType = computed(() =>
  ['movie', 'show', 'anime'].includes(props.item?.media_type)
);
const isBook = computed(() => props.item?.media_type === 'book');
const isAudiobook = computed(() => props.item?.media_type === 'audiobook');
// Books and audiobooks have a language; it also picks Open Library's edition and Audible's
// country when searching.
const hasLanguage = computed(() => isBook.value || isAudiobook.value);
const showSeriesNumber = computed(() => !isBulk.value && !isVideoType.value);

const authorLabel = computed(() => isVideoType.value ? t('metadata.fields.directors') : t('metadata.fields.authors'));
const artistsLabel = computed(() => (isVideoType.value ? t('metadata.fields.castActors') : isAudiobook.value ? t('metadata.fields.narrators') : t('metadata.fields.artists')));

const previewCoverUrl = computed(() => {
  if (pickedCoverUrl.value) return pickedCoverUrl.value;
  const targetId = props.item?.id || (isBulk.value && props.applyToIds?.[0]);
  if (!targetId) return null;
  // Always fetch from the server — it returns a styled placeholder SVG when no artwork
  // exists yet, which is far better than showing the ImageOff icon. coverCacheBust forces
  // a fresh fetch after a user upload so the old art isn't served from the browser cache.
  const bust = coverCacheBust.value ? `&v=${coverCacheBust.value}` : '';
  return `/api/media/cover/${targetId}?token=${token}${bust}`;
});

const providerLabel = computed(() => {
  switch (props.item?.media_type) {
    case 'manga': return 'MangaDex / AniList / Comic Vine';
    case 'book': return 'Open Library / Google Books';
    case 'audiobook': return 'Audible';
    case 'movie': return 'TMDB';
    case 'show': return 'TMDB / TVmaze';
    case 'anime': return 'TMDB / AniList / TVmaze';
    default: return t('metadata.edit.externalSources');
  }
});

function resultKey(result) {
  return `${result.source}-${result.externalId}`;
}

function hasCover(result) {
  return !!result.coverUrl && !brokenCovers.has(result.coverUrl);
}

function noticeText(notice) {
  const provider = sourceLabel(notice.provider);
  if (notice.reason === 'quota' && notice.keyed) return t('metadata.edit.notices.keyQuota', { provider });
  if (notice.reason === 'quota' && notice.provider === 'google-books') return t('metadata.edit.notices.googleQuota');
  if (notice.reason === 'quota') return t('metadata.edit.notices.busy', { provider });
  if (notice.reason === 'rejected' && notice.keyed) return t('metadata.edit.notices.keyRejected', { provider });
  return t('metadata.edit.notices.unavailable', { provider });
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

// Fields a search result can contribute, and which form field they map to. `bulkHidden`
// fields don't make sense to apply across every volume in a series-wide (bulk) edit.
const PICK_FIELDS = computed(() => [
  { key: 'title', label: t('metadata.fields.title'), bulkHidden: true },
  { key: 'author', label: isVideoType.value ? t('metadata.fields.director') : t('metadata.fields.author') },
  { key: 'artists', label: isVideoType.value ? t('metadata.fields.cast') : isAudiobook.value ? t('metadata.fields.narratorsShort') : t('metadata.fields.artistsShort') },
  { key: 'series', label: t('metadata.fields.series') },
  { key: 'seriesNumber', label: t('metadata.fields.seriesNumberShort'), formKey: 'volume', bulkHidden: true },
  { key: 'releaseDate', label: t('metadata.fields.date') },
  { key: 'status', label: t('metadata.fields.status') },
  { key: 'publisher', label: t('metadata.fields.publisher') },
  { key: 'isbn', label: t('metadata.fields.isbn'), bulkHidden: true },
  { key: 'language', label: t('metadata.fields.language') },
  { key: 'genres', label: t('metadata.fields.genres') },
  { key: 'themes', label: t('metadata.fields.themes') },
  { key: 'overview', label: t('metadata.fields.description'), formKey: 'description' },
  { key: 'coverUrl', label: t('metadata.fields.cover') }
]);

function hasValue(val) {
  return Array.isArray(val) ? val.length > 0 : !!val;
}

function pickableFields(result) {
  return PICK_FIELDS.value.filter((f) => (!isBulk.value || !f.bulkHidden) && hasValue(result[f.key])
    && (f.key !== 'coverUrl' || hasCover(result)));
}

// Some searches leave things out: Open Library's the description, Audible's the ISBN and
// tidier genres (from Audnexus), Comic Vine's the creators. This fetches the rest and fills
// in only what the result is missing.
const DETAIL_SOURCES = new Set(['open-library', 'audible', 'comicvine']);
const needsDetails = (r) => (r.source === 'open-library' && !r.overview) || (r.source === 'comicvine' && !r.author);

function loadDetails(result) {
  const key = resultKey(result);
  if (!DETAIL_SOURCES.has(result.source)) return Promise.resolve();
  if (!detailRequests.has(key)) {
    const requests = detailRequests;
    loadingDetails.add(key);
    requests.set(key, api.get('/metadata/details', {
      params: {
        source: result.source,
        externalId: result.externalId,
        isbn: result.publisher ? undefined : result.isbn || undefined,
        region: result.region || undefined
      }
    })
      .then((res) => {
        for (const [field, value] of Object.entries(res.data.details || {})) {
          if (hasValue(value) && !hasValue(result[field])) result[field] = value;
        }
      })
      .catch(() => {})
      .finally(() => { if (requests === detailRequests) loadingDetails.delete(key); }));
  }
  return detailRequests.get(key);
}

function applyField(result, field) {
  const raw = result[field.key];
  if (field.key === 'coverUrl') {
    pickedCoverUrl.value = raw;
    pickedCoverFrom.value = result.source === 'google-books' ? { source: result.source, externalId: result.externalId } : null;
    return;
  }
  const formKey = field.formKey || field.key;
  form[formKey] = Array.isArray(raw) ? raw.join(', ') : String(raw);
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
      pickedCoverFrom.value = null;
      pickedRating.value = null;
      pickedTmdbId.value = null;
      query.value = defaultQuery(props.item);
      yearQuery.value = (props.item.release_date ? props.item.release_date.slice(0, 4) : props.item.detectedYear) || '';
      results.value = [];
      notices.value = [];
      hasSearched.value = false;
      errorMessage.value = '';
      searchedAs.value = '';
      expanded.value = false;
    }
  }
);

const loadingFull = ref(false);

// A book is found by title and author: a title alone brings up every summary and study
// guide of it first.
function defaultQuery(item) {
  if ((item.media_type === 'book' || item.media_type === 'audiobook') && !isBulk.value && item.title) {
    const author = item.author && item.author !== 'Unknown Author' ? item.author.split(',')[0].trim() : '';
    return author ? `${item.title} ${author}` : item.title;
  }
  return item.cleanTitle || item.series || item.title || '';
}

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
  form.volume = item.volume != null ? String(item.volume) : '';
  form.isbn = item.isbn || '';
  form.language = item.language || '';
}

async function search() {
  if (!query.value.trim() || !props.item) return;
  searching.value = true;
  errorMessage.value = '';
  searchedAs.value = '';
  notices.value = [];
  detailRequests = new Map();
  loadingDetails.clear();
  try {
    const res = await api.get('/metadata/search', {
      params: {
        mediaType: props.item.media_type,
        query: query.value.trim(),
        year: yearQuery.value.trim() || undefined,
        // Which edition Open Library brings along: the book's language, else the reader's.
        language: hasLanguage.value ? (props.item.language || locale.value) : undefined
      }
    });
    results.value = res.data.results || [];
    searchedAs.value = res.data.searchedAs || '';
    notices.value = res.data.notices || [];
    results.value
      .filter(needsDetails)
      .slice(0, DETAILS_PREFETCH)
      .forEach(loadDetails);
  } catch (err) {
    console.error('Metadata search failed:', err);
    results.value = [];
    errorMessage.value = err.response?.data?.error || t('metadata.edit.searchFailed');
  } finally {
    searching.value = false;
    hasSearched.value = true;
  }
}

async function fillFromResult(result) {
  await loadDetails(result);
  pickableFields(result).forEach((field) => applyField(result, field));
  pickedTmdbId.value = result.source === 'tmdb' ? result.externalId : null;
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
      ...(hasLanguage.value ? { language: form.language.trim() || null } : {}),
      ...(pickedCoverUrl.value && pickedCoverFrom.value ? pickedCoverFrom.value : {}),
      ...(pickedRating.value || {}),
      ...(pickedTmdbId.value ? { source: 'tmdb', externalId: pickedTmdbId.value } : {})
    };

    if (isBulk.value) {
      const payload = {
        ...sharedFields,
        applyToIds: props.applyToIds,
        series: form.series.trim() || props.item?.series || null,
        title: form.series.trim() || props.item?.series || undefined,
        mediaType: props.item?.media_type,
        libraryId: props.item?.library_id
      };
      if (pickedCoverUrl.value) payload.coverUrl = pickedCoverUrl.value;
      const res = await api.post('/metadata/apply-series', payload);
      const count = res.data.updatedCount ?? props.applyToIds.length;
      dialog.alert({ title: t('metadata.edit.savedTitle'), message: t('metadata.edit.savedSeries', { count }), type: 'success' });
    } else {
      if (!props.item) return;
      const payload = {
        title: form.title.trim() || props.item.title,
        ...sharedFields,
        ...(showSeriesNumber.value ? { volume: form.volume.trim() || null } : {}),
        ...(isBook.value ? { isbn: form.isbn.trim() || null } : {})
      };
      if (pickedCoverUrl.value) payload.coverUrl = pickedCoverUrl.value;
      await api.post(`/metadata/apply/${props.item.id}`, payload);
      dialog.alert({ title: t('metadata.edit.savedTitle'), message: t('metadata.edit.savedOne', { title: payload.title }), type: 'success' });
    }
    emit('applied');
    close();
  } catch (err) {
    console.error('Metadata save failed:', err);
    dialog.alert(err.response?.data?.error || t('metadata.edit.saveFailed'));
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
