<template>
  <!-- Shown by VideoPlayer after a few idle seconds paused; it never takes clicks (any movement
       or touch hides it), so the controls underneath keep working. The style is the admin's
       choice (Admin → Appearance → Pause screen). Everything is sized from the player's own
       box (container units), so it fills a TV as well as a phone, and the admin preview can
       render it at a fixed size and scale it down. -->
  <div class="pause-root absolute inset-0 z-20 pointer-events-none text-white overflow-hidden" aria-live="polite">
    <!-- Details: the title's page, full-screen, over a gradient -->
    <div v-if="mode === 'details'" class="absolute inset-0 details-bg flex items-end sm:items-center">
      <img v-if="poster" :src="poster" alt="" class="absolute inset-0 w-full h-full object-cover opacity-25 blur-3xl scale-110" @error="poster = ''" />
      <div class="details-body relative w-full flex items-end sm:items-center">
        <img
          v-if="poster"
          :src="poster"
          alt=""
          class="details-poster hidden sm:block aspect-[2/3] object-cover rounded-xl shadow-2xl border border-white/10 shrink-0"
          @error="poster = ''"
        />
        <div class="details-text min-w-0 flex flex-col">
          <p class="pz-eyebrow font-semibold uppercase tracking-[0.2em] text-white/60">You're watching</p>
          <h2 class="pz-title font-bold leading-[1.05]">{{ heading }}</h2>
          <p v-if="subheading" class="pz-sub text-white/85">{{ subheading }}</p>
          <p v-if="metaLine" class="pz-body text-white/60">{{ metaLine }}</p>
          <p v-if="credits?.tagline" class="pz-sub italic text-white/80">“{{ credits.tagline }}”</p>
          <p v-if="item.description" class="pz-body text-white/75 leading-relaxed line-clamp-5">{{ item.description }}</p>
          <dl class="pz-body grid grid-cols-[auto,1fr] gap-x-[1em] gap-y-[0.3em]">
            <template v-if="directors">
              <dt class="text-white/50">{{ directorLabel }}</dt><dd class="text-white/90">{{ directors }}</dd>
            </template>
            <template v-if="starring">
              <dt class="text-white/50">Starring</dt><dd class="text-white/90">{{ starring }}</dd>
            </template>
          </dl>
          <p class="pz-sub text-white/80 font-medium">{{ remainingLine }}</p>
        </div>
      </div>
    </div>

    <!-- Cinematic: the picture dims behind a centred title card, cast photos and facts -->
    <div v-else-if="mode === 'cinematic'" class="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center">
      <img v-if="poster" :src="poster" alt="" class="absolute inset-0 w-full h-full object-cover opacity-20 blur-2xl scale-110" @error="poster = ''" />
      <div class="cine-body relative w-full flex flex-col items-center text-center">
        <p class="pz-eyebrow font-semibold uppercase tracking-[0.3em] text-white/50">Paused</p>
        <h2 class="pz-title font-bold leading-[1.05]">{{ heading }}</h2>
        <p v-if="subheading" class="pz-sub text-white/80">{{ subheading }}</p>
        <p v-if="credits?.tagline" class="pz-sub italic text-white/80">“{{ credits.tagline }}”</p>
        <p v-if="metaLine" class="pz-body text-white/60">{{ metaLine }}</p>

        <div v-if="castWithPhotos.length" class="cine-cast flex flex-wrap justify-center">
          <div v-for="person in castWithPhotos" :key="person.name" class="cine-person flex flex-col items-center">
            <img :src="person.photo" alt="" class="cine-photo rounded-full object-cover border border-white/15" />
            <p class="pz-small font-semibold leading-tight">{{ person.name }}</p>
            <p v-if="person.character" class="pz-small text-white/50 leading-tight line-clamp-2">{{ person.character }}</p>
          </div>
        </div>

        <ul v-if="facts.length" class="cine-facts pz-body grid grid-cols-1 sm:grid-cols-2 text-left w-full">
          <li v-for="fact in facts" :key="fact.label" class="flex gap-[0.6em]">
            <span class="text-white/50 shrink-0">{{ fact.label }}</span>
            <span class="text-white/90">{{ fact.value }}</span>
          </li>
        </ul>
        <p v-if="keywords" class="pz-small text-white/50">{{ keywords }}</p>
        <p class="pz-sub text-white/75 font-medium">{{ remainingLine }}</p>
      </div>
    </div>

    <!-- Bedtime: a dim clock and when things end — nothing bright -->
    <div v-else-if="mode === 'bedtime'" class="bed-body absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center">
      <p class="bed-clock font-light tabular-nums text-white/60 leading-none">{{ clock }}</p>
      <p class="pz-sub text-white/50">{{ heading }}<template v-if="subheading"> · {{ subheading }}</template></p>
      <p class="pz-sub text-white/70">
        {{ remainingShort }} left · ends at <span class="font-semibold text-white/85">{{ endsAt(remaining) }}</span>
      </p>
      <p v-if="seasonRest && seasonRest.count" class="pz-body text-white/45">
        Rest of the season ({{ seasonRest.count }} more {{ seasonRest.count === 1 ? 'episode' : 'episodes' }}) would end at
        {{ endsAt(remaining + seasonRest.seconds) }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { coverUrl } from '../utils/cover';

const props = defineProps({
  mode: { type: String, required: true },
  item: { type: Object, required: true },
  credits: { type: Object, default: null },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  // Bedtime, for an episode: the episodes after this one in its season.
  seasonRest: { type: Object, default: null },
  // Overrides the item's cover (the admin preview's sample poster).
  posterUrl: { type: String, default: '' }
});

const posterFor = () => props.posterUrl || coverUrl(props.item, { width: 780 });
const poster = ref(posterFor());
watch(() => [props.item.id, props.posterUrl], () => { poster.value = posterFor(); });

const isEpisode = computed(() => ['show', 'anime'].includes(props.item.media_type));

// Episodes store season + episode/1000 in `volume` (S02E05 is 2.005).
const episodeCode = computed(() => {
  const v = Number(props.item.volume);
  if (!isEpisode.value || !Number.isFinite(v)) return '';
  const season = Math.floor(v);
  const episode = Math.round((v - season) * 1000);
  return episode > 0 ? `S${season} · E${episode}` : '';
});

const heading = computed(() => (isEpisode.value && props.item.series) ? props.item.series : props.item.title);
const subheading = computed(() => {
  if (!isEpisode.value || !props.item.series) return '';
  return [episodeCode.value, props.item.title !== props.item.series ? props.item.title : ''].filter(Boolean).join(' — ');
});

const year = computed(() => (props.item.release_date || props.credits?.facts?.releaseDate || '').slice(0, 4));
const metaLine = computed(() => {
  const parts = [];
  if (year.value) parts.push(year.value);
  if (props.duration) parts.push(runtime(props.duration));
  if (props.item.age_rating) parts.push(props.item.age_rating);
  const genres = String(props.item.genres || '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 3);
  if (genres.length) parts.push(genres.join(', '));
  return parts.join(' · ');
});

const directorJobs = computed(() => (isEpisode.value ? null : ['Director']));
const directorLabel = computed(() => (isEpisode.value ? 'Created by' : 'Directed by'));
const directors = computed(() => {
  const c = props.credits;
  if (!c) return '';
  if (isEpisode.value) return (c.creators || []).slice(0, 3).join(', ');
  return (c.crew || []).filter((p) => directorJobs.value.includes(p.job)).map((p) => p.name).slice(0, 3).join(', ');
});
const starring = computed(() => (props.credits?.cast || []).slice(0, 4).map((p) => p.name).join(', '));
const castWithPhotos = computed(() => (props.credits?.cast || []).filter((p) => p.photo).slice(0, 6));

const money = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)} million`;
  return `$${n.toLocaleString()}`;
};
const languageName = (code) => {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code);
  } catch (e) {
    return code;
  }
};

// TMDB keeps no trivia, but it does keep these.
const facts = computed(() => {
  const c = props.credits;
  if (!c) return [];
  const f = c.facts || {};
  const out = [];
  if (f.originalTitle && f.originalTitle !== props.item.title && f.originalTitle !== props.item.series) {
    out.push({ label: 'Original title', value: f.originalTitle });
  }
  if (f.originalLanguage && f.originalLanguage !== 'en') out.push({ label: 'Language', value: languageName(f.originalLanguage) });
  if (f.budget) out.push({ label: 'Budget', value: money(f.budget) });
  if (f.revenue) {
    const multiple = f.budget ? ` (${(f.revenue / f.budget).toFixed(1)}× its budget)` : '';
    out.push({ label: 'Box office', value: `${money(f.revenue)}${multiple}` });
  }
  if (f.seasons) out.push({ label: 'Series', value: `${f.seasons} ${f.seasons === 1 ? 'season' : 'seasons'}${f.episodes ? `, ${f.episodes} episodes` : ''}` });
  if (f.releaseDate && isEpisode.value) {
    const span = [f.releaseDate.slice(0, 4), c.status === 'Ended' && f.lastAirDate ? f.lastAirDate.slice(0, 4) : ''].filter(Boolean);
    out.push({ label: 'On air', value: span.length === 2 && span[0] !== span[1] ? `${span[0]}–${span[1]}` : (c.status === 'Ended' ? span[0] : `since ${span[0]}`) });
  }
  if (c.collection) out.push({ label: 'Part of', value: c.collection });
  const makers = (isEpisode.value ? c.networks : c.studios) || [];
  if (makers.length) out.push({ label: isEpisode.value ? 'Network' : 'Studio', value: makers.slice(0, 2).join(', ') });
  const composer = (c.crew || []).find((p) => p.job === 'Original Music Composer');
  if (composer) out.push({ label: 'Music', value: composer.name });
  const dop = (c.crew || []).find((p) => p.job === 'Director of Photography');
  if (dop) out.push({ label: 'Cinematography', value: dop.name });
  if (!isEpisode.value && directors.value) out.unshift({ label: 'Directed by', value: directors.value });
  return out.slice(0, 8);
});
const keywords = computed(() => (props.credits?.keywords || []).slice(0, 8).join(' · '));

const remaining = computed(() => Math.max(0, (props.duration || 0) - (props.currentTime || 0)));

function runtime(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const remainingShort = computed(() => runtime(remaining.value));

// The clock ticks so "ends at" stays right however long it sits paused.
const now = ref(Date.now());
let tick = null;
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 15000); });
onUnmounted(() => clearInterval(tick));

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const clock = computed(() => timeFmt.format(now.value));
function endsAt(seconds) {
  return timeFmt.format(now.value + seconds * 1000);
}
const remainingLine = computed(() => (props.duration
  ? `${remainingShort.value} left · ends at ${endsAt(remaining.value)}`
  : ''));
</script>

<style scoped>
/* Sizes come from the player's box: cqh/cqw are 1% of its height/width. min() keeps a tall,
   narrow phone from blowing text up; clamp() floors keep it readable in a small window. */
.pause-root { container-type: size; }

.pz-eyebrow { font-size: clamp(11px, min(1.9cqh, 1.3cqw), 22px); }
.pz-title   { font-size: clamp(24px, min(7.5cqh, 5.4cqw), 104px); }
.pz-sub     { font-size: clamp(15px, min(3cqh, 2.1cqw), 38px); }
.pz-body    { font-size: clamp(13px, min(2.5cqh, 1.75cqw), 30px); }
.pz-small   { font-size: clamp(11px, min(1.9cqh, 1.35cqw), 22px); }

.details-bg { background: linear-gradient(to top, #000 0%, rgba(0,0,0,.85) 45%, rgba(0,0,0,.45) 100%); }
@media (min-width: 640px) {
  .details-bg { background: linear-gradient(to right, rgba(0,0,0,.95) 0%, rgba(0,0,0,.75) 50%, rgba(0,0,0,.35) 100%); }
}
.details-body {
  gap: min(4cqw, 6cqh);
  padding: 0 max(6cqw, env(safe-area-inset-left)) calc(5.5rem + env(safe-area-inset-bottom));
}
@media (min-width: 640px) { .details-body { padding-bottom: 0; } }
.details-poster { height: min(72cqh, 44cqw); }
.details-text { gap: min(1.6cqh, 1.2cqw); max-width: min(62cqw, 110ch); }

.cine-body {
  gap: min(2cqh, 1.4cqw);
  max-width: min(88cqw, 160cqh);
  max-height: 100%;
  overflow-y: auto;
  padding: 6cqh 5cqw;
}
.cine-cast { gap: min(3cqh, 2.2cqw); margin-top: 1cqh; }
.cine-person { width: min(16cqh, 11cqw); gap: 0.6cqh; }
.cine-photo { width: min(13cqh, 9cqw); height: min(13cqh, 9cqw); }
.cine-facts { gap: 0.8cqh 4cqw; margin-top: 1.5cqh; max-width: min(80cqw, 140cqh); }

.bed-body { gap: 2cqh; padding: 0 6cqw; }
.bed-clock { font-size: clamp(56px, min(26cqh, 18cqw), 320px); margin-bottom: 1cqh; }
</style>
