<template>
  <div
    @click="$emit('select', series)"
    class="group relative flex flex-col bg-card border border-border hover:border-muted-foreground/30 rounded-xl p-2.5 transition-colors cursor-pointer"
    role="link"
    tabindex="0"
    :aria-label="`${series.name} — ${countLabel}`"
    @keydown.enter="$emit('select', series)"
  >
    <!-- Cover Stack Effect -->
    <div class="relative w-full aspect-[2/3]">
      <!-- Back shadow cards (stack illusion) -->
      <div
        v-if="series.volumes.length > 2"
        class="absolute inset-0 rounded-lg bg-muted/60 border border-border/40"
        style="transform: translate(5px, -5px) rotate(2deg); z-index: 1"
      />
      <div
        v-if="series.volumes.length > 1"
        class="absolute inset-0 rounded-lg bg-muted/80 border border-border/60"
        style="transform: translate(2px, -2px) rotate(1deg); z-index: 2"
      />

      <!-- Main Cover -->
      <div
        class="absolute inset-0 rounded-lg overflow-hidden bg-muted/40 border border-border/60"
        style="z-index: 3"
      >
        <!-- Skeleton shimmer while cover loads -->
        <div
          v-if="!imgLoaded"
          class="absolute inset-0 bg-muted/60 animate-pulse rounded-lg"
        />
        <img
          :src="coverUrl"
          :alt="series.name"
          loading="lazy"
          decoding="async"
          class="w-full h-full object-cover transition-opacity duration-300"
          :class="imgLoaded ? 'opacity-100' : 'opacity-0'"
          @load="imgLoaded = true"
          @error="imgLoaded = true"
        />

        <!-- Media type pill -->
        <div class="absolute top-2 left-2 z-10 pointer-events-none">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background/85 text-foreground backdrop-blur-md text-[11px] font-medium border border-border/80 shadow-sm">
            <component :is="typeIcon" class="w-3 h-3 text-muted-foreground" />
            <span>{{ vocab.type }}</span>
          </span>
        </div>

        <!-- Remove from a custom folder (series cards have no ⋮ menu of their own) -->
        <button
          v-if="removable"
          type="button"
          @click.stop="$emit('remove', series)"
          class="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-background/85 backdrop-blur-md border border-border/80 text-muted-foreground hover:text-destructive flex items-center justify-center shadow-sm transition"
          :aria-label="`Remove ${series.name} from this folder`"
          title="Remove from folder"
        >
          <FolderMinus class="w-3.5 h-3.5" />
        </button>

        <!-- Entry count badge (bottom right) -->
        <div class="absolute bottom-2 right-2 z-10 pointer-events-none">
          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[11px] font-mono font-bold backdrop-blur-sm">
            {{ countLabel }}
          </span>
        </div>

        <!-- Hover overlay -->
        <div class="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div class="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
            <Layers class="w-5 h-5" />
          </div>
        </div>

        <!-- Overall series progress bar -->
        <div v-if="overallProgress > 0" class="absolute bottom-0 inset-x-0 h-1.5 bg-background/70">
          <div
            class="h-full transition-all duration-300"
            :class="overallProgress >= 100 ? 'bg-emerald-500' : 'bg-primary'"
            :style="{ width: `${overallProgress}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Info -->
    <div class="mt-2.5 px-1 flex flex-col flex-1">
      <h3
        class="text-sm font-semibold text-foreground truncate leading-snug"
        :title="series.name"
      >
        {{ series.name }}
      </h3>
      <p class="text-xs text-muted-foreground truncate mt-0.5">
        {{ realCreator(series.author, series.name) || vocab.series }}
      </p>
      <div class="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span class="font-mono">{{ countLabel }}</span>
        <span v-if="finishedCount + skippedCount === series.volumes.length" class="text-emerald-500 font-semibold flex items-center gap-1">
          <BookCheck class="w-3 h-3" /> {{ skippedCount ? 'Caught up' : `All ${vocab.done.toLowerCase()}` }}
        </span>
        <span v-else-if="finishedCount + skippedCount > 0" class="font-mono" :title="skippedCount ? `${skippedCount} skipped` : undefined">
          {{ finishedCount + skippedCount }}/{{ series.volumes.length }} {{ skippedCount ? 'done' : vocab.done.toLowerCase() }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { placeholderCover } from '../utils/placeholder';
import { getMediaToken } from '../utils/mediaToken';
import { ref, computed } from 'vue';
import { BookImage, Layers, BookCheck, Headphones, Book, Tv, Film, Sparkles, FolderMinus } from 'lucide-vue-next';
import { vocabFor, realCreator } from '../utils/mediaVocab';
import { coverUrl as buildCoverUrl } from '../utils/cover';

const props = defineProps({
  series: {
    type: Object,
    required: true
    // { name, author, mediaType, libraryId, volumes: [ ...items ] } — any media type
  },
  removable: { type: Boolean, default: false }
});

const TYPE_ICONS = { manga: BookImage, book: Book, audiobook: Headphones, show: Tv, anime: Sparkles, movie: Film };
const mediaType = computed(() => props.series.mediaType || props.series.volumes[0]?.media_type || 'manga');
const vocab = computed(() => vocabFor(mediaType.value));
const typeIcon = computed(() => TYPE_ICONS[mediaType.value] || Layers);
const countLabel = computed(() => {
  const n = props.series.volumes.length;
  return `${n} ${(n === 1 ? vocab.value.unit : vocab.value.units).toLowerCase()}`;
});

defineEmits(['select', 'remove']);

const imgLoaded = ref(false);

const token = getMediaToken() || '';

const coverUrl = computed(() => {
  // Use the first volume's cover (lowest volume number, already sorted)
  const first = props.series.volumes[0];
  if (!first) return placeholderCover(props.series.name?.charAt(0));
  if (first.cover_path) return buildCoverUrl(first, { width: 360 });
  return placeholderCover(props.series.name?.charAt(0));
});

const finishedCount = computed(() => props.series.volumes.filter(v => v.is_finished).length);
// Skipped (e.g. covered by the anime) counts toward "done" but not toward "read".
const skippedCount = computed(() => props.series.volumes.filter(v => !v.is_finished && v.is_skipped).length);

const overallProgress = computed(() => {
  const vols = props.series.volumes;
  if (!vols.length) return 0;
  const total = vols.reduce((sum, v) => sum + (v.is_finished || v.is_skipped ? 100 : (v.progress_percent || 0)), 0);
  return Math.round(total / vols.length);
});
</script>
