<template>
  <!-- Admin → Server Config: a miniature of what users will see, redrawn as each setting
       changes. Screens are laid out at a fixed "virtual" size and scaled to fit, so they look
       like the real thing rather than a squashed version of it. Posters come from this
       server's own movies when it has any. -->
  <div class="bg-card border border-border rounded-xl p-3 flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="relative flex w-2 h-2">
          <span class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping"></span>
          <span class="relative inline-flex w-2 h-2 rounded-full bg-primary"></span>
        </span>
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Live preview</h3>
      </div>
      <div class="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-lg border border-border text-[12px]">
        <button
          v-for="v in views"
          :key="v.id"
          type="button"
          @click="$emit('update:view', v.id)"
          :class="[
            'px-2 py-1 rounded-md font-medium transition',
            view === v.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          ]"
        >{{ v.label }}</button>
      </div>
    </div>

    <div ref="frameEl" class="relative w-full overflow-hidden rounded-lg border border-border bg-background" :style="{ height: `${frameHeight}px` }">
      <div class="absolute top-0 left-0 origin-top-left" :style="{ width: `${VW}px`, height: `${virtualHeight}px`, transform: `scale(${scale})` }">
        <!-- Shelf: the navigation layout, branding and accent colour -->
        <div v-if="view === 'shelf'" class="w-full h-full bg-background text-foreground flex" :class="settings.layoutMode === 'sidebar' ? 'flex-row' : 'flex-col'">
          <aside v-if="settings.layoutMode === 'sidebar'" class="w-[230px] shrink-0 border-r border-border bg-card/40 p-4 flex flex-col gap-1">
            <div class="flex items-center gap-2.5 mb-5 px-1">
              <AppLogo class="w-9 h-9" />
              <span class="text-base font-semibold tracking-tight truncate">{{ brand }}</span>
            </div>
            <div
              v-for="tab in navTabs"
              :key="tab.label"
              :class="['flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm font-medium', tab.active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground']"
            >
              <component :is="tab.icon" class="w-4 h-4" />{{ tab.label }}
            </div>
          </aside>
          <header v-else class="h-[60px] shrink-0 border-b border-border px-8 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <AppLogo class="w-9 h-9" />
              <span class="text-lg font-semibold tracking-tight">{{ brand }}</span>
            </div>
            <nav class="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border">
              <span
                v-for="tab in navTabs"
                :key="tab.label"
                :class="['px-3 h-8 rounded-lg text-sm font-medium flex items-center gap-1.5', tab.active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground']"
              ><component :is="tab.icon" class="w-4 h-4" />{{ tab.label }}</span>
            </nav>
            <div class="flex items-center gap-2">
              <div class="w-44 h-9 rounded-lg border border-border bg-muted/30 flex items-center gap-2 px-3 text-sm text-muted-foreground"><Search class="w-4 h-4" />Search</div>
              <div class="w-9 h-9 rounded-full bg-secondary"></div>
            </div>
          </header>

          <main class="flex-1 min-w-0 px-8 py-6 flex flex-col gap-4 overflow-hidden">
            <div class="flex items-end justify-between">
              <div>
                <h1 class="text-2xl font-semibold tracking-tight">Movies</h1>
                <p class="text-sm text-muted-foreground">{{ samples.length ? `${samples.length}+ titles` : 'Your library' }}</p>
              </div>
              <span class="px-3 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 shadow-sm"><Play class="w-4 h-4" />Continue watching</span>
            </div>
            <div class="grid gap-5" :class="settings.layoutMode === 'sidebar' ? 'grid-cols-5' : 'grid-cols-6'">
              <div v-for="(card, i) in shelfCards" :key="i" class="flex flex-col gap-2 min-w-0">
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border relative">
                  <img v-if="card.cover" :src="card.cover" alt="" class="w-full h-full object-cover" />
                  <div v-else class="w-full h-full bg-gradient-to-br from-muted to-secondary flex items-center justify-center"><Film class="w-8 h-8 text-muted-foreground/50" /></div>
                  <div v-if="i === 1" class="absolute bottom-0 inset-x-0 h-1.5 bg-black/40"><div class="h-full w-2/3 bg-primary"></div></div>
                </div>
                <p class="text-sm font-medium truncate">{{ card.title }}</p>
              </div>
            </div>
          </main>
        </div>

        <!-- Title page: ratings, watch parties, collections -->
        <div v-else-if="view === 'title'" class="w-full h-full bg-background text-foreground px-10 py-8 flex flex-col gap-6 overflow-hidden">
          <div class="flex gap-8">
            <div class="w-[220px] aspect-[2/3] shrink-0 rounded-xl overflow-hidden bg-muted border border-border shadow-lg">
              <img v-if="hero.cover" :src="hero.cover" alt="" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full bg-gradient-to-br from-muted to-secondary flex items-center justify-center"><Film class="w-10 h-10 text-muted-foreground/50" /></div>
            </div>
            <div class="flex flex-col gap-3 min-w-0 pt-2">
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Movie</p>
              <h1 class="text-4xl font-bold tracking-tight leading-tight">{{ hero.title }}</h1>
              <p class="text-sm text-muted-foreground">{{ heroMeta }}</p>

              <div v-if="ratingsOn" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <div v-if="settings.ratings.showPersonal" class="inline-flex items-center gap-1.5">
                  <span class="text-muted-foreground font-medium">Your rating</span>
                  <Star v-for="n in 5" :key="n" :class="['w-4 h-4', n <= 4 ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/40']" />
                </div>
                <span v-if="settings.ratings.showPersonal && (settings.ratings.showCommunity || settings.ratings.showExternal)" class="h-3.5 w-px bg-border" />
                <div v-if="settings.ratings.showCommunity" class="inline-flex items-center gap-1">
                  <Users class="w-4 h-4 text-muted-foreground" /><span class="text-muted-foreground">{{ brand }}</span>
                  <Star class="w-4 h-4 text-amber-400 fill-amber-400" /><span class="font-semibold">4.3</span><span class="text-muted-foreground">(12)</span>
                </div>
                <span v-if="settings.ratings.showCommunity && settings.ratings.showExternal" class="h-3.5 w-px bg-border" />
                <div v-if="settings.ratings.showExternal" class="inline-flex items-center gap-1">
                  <span class="text-[11px] font-bold px-1.5 py-0.5 rounded bg-sky-600 text-white">TMDB</span><span class="font-semibold">7.8</span>
                </div>
              </div>
              <p v-else class="text-sm text-muted-foreground italic">Ratings are hidden</p>

              <p class="text-sm text-muted-foreground leading-relaxed line-clamp-3 max-w-2xl">{{ hero.description || sampleDescription }}</p>
              <div class="flex items-center gap-2 mt-1">
                <span class="px-5 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2 shadow-sm"><Play class="w-4 h-4 fill-current" />Play</span>
                <span v-if="settings.partyModeEnabled" class="px-4 h-10 rounded-lg border border-border text-sm font-medium flex items-center gap-2"><Users class="w-4 h-4" />Watch Together</span>
                <span class="w-10 h-10 rounded-lg border border-border flex items-center justify-center"><Plus class="w-4 h-4" /></span>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold tracking-tight">Part of the collection</h2>
            <div class="flex gap-4">
              <div v-for="(card, i) in collectionCards" :key="i" class="w-[130px] flex flex-col gap-1.5">
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border relative" :class="card.missing ? 'opacity-40 grayscale' : ''">
                  <img v-if="card.cover" :src="card.cover" alt="" class="w-full h-full object-cover" />
                  <div v-else class="w-full h-full bg-gradient-to-br from-muted to-secondary"></div>
                </div>
                <p class="text-xs font-medium truncate" :class="card.missing ? 'text-muted-foreground' : ''">{{ card.title }}</p>
                <span v-if="card.missing" class="self-start text-[11px] font-medium px-2 py-0.5 rounded-md border border-primary/40 text-primary">Request</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sign-in: server name and the sign-in notice, laid out like LoginView -->
        <div v-else-if="view === 'login'" class="w-full h-full bg-background relative overflow-hidden flex items-center justify-center">
          <div class="absolute -top-40 -left-24 w-[640px] h-[640px] rounded-full blur-[100px] bg-[hsl(213_55%_50%/0.28)]"></div>
          <div class="absolute -bottom-48 -right-24 w-[560px] h-[560px] rounded-full blur-[100px] bg-[hsl(255_45%_50%/0.24)]"></div>
          <div class="relative w-[448px] flex flex-col items-center gap-8">
            <div class="flex flex-col items-center text-center gap-4">
              <AppLogo class="w-24 h-24" />
              <h1 class="text-4xl font-bold tracking-tight leading-tight text-foreground">Welcome to {{ brand }}</h1>
              <p class="text-base text-muted-foreground leading-relaxed">Books, comics, audiobooks, movies and shows. All in one place, and right where you left off.</p>
            </div>
            <div class="w-full bg-card/80 border border-border rounded-2xl p-7 shadow-2xl flex flex-col gap-4">
              <div v-if="settings.loginMessage" class="flex items-start gap-2.5 p-3 rounded-xl bg-primary/10 border border-primary/20 text-sm text-foreground leading-relaxed">
                <Megaphone class="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <p class="whitespace-pre-line">{{ settings.loginMessage }}</p>
              </div>
              <div v-for="field in ['Username', 'Password']" :key="field">
                <p class="text-xs font-medium text-foreground mb-1.5">{{ field }}</p>
                <div class="w-full h-10 bg-background/70 border border-border rounded-lg"></div>
              </div>
              <div class="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center shadow-lg">Sign In</div>
            </div>
          </div>
        </div>

        <!-- Pause screen: the real component, over a stand-in for the paused picture -->
        <div v-else class="w-full h-full bg-black relative overflow-hidden">
          <img v-if="hero.backdrop" :src="hero.backdrop" alt="" class="absolute inset-0 w-full h-full object-cover" />
          <img v-else :src="hero.cover" alt="" class="absolute inset-0 w-full h-full object-cover blur-sm scale-105" />
          <PauseScreen
            v-if="pauseMode !== 'simple'"
            :key="`${pauseMode}-${hero.id}`"
            :mode="pauseMode"
            :item="pauseItem"
            :credits="heroItem ? heroCredits : SAMPLE_CREDITS"
            :poster-url="heroItem ? '' : hero.cover"
            :current-time="pauseItem.duration * 0.42"
            :duration="pauseItem.duration"
            :season-rest="null"
          />
          <div v-else class="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white flex items-center gap-4">
            <Play class="w-7 h-7 fill-current" />
            <div class="flex-1 h-1.5 rounded-full bg-white/25"><div class="h-full w-[42%] rounded-full bg-white"></div></div>
            <span class="text-base tabular-nums text-white/80">{{ simpleTime }}</span>
          </div>
        </div>
      </div>
    </div>

    <p class="text-[12px] text-muted-foreground leading-snug">{{ caption }}</p>
  </div>
</template>

<script setup>
import AppLogo from './AppLogo.vue';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { Search, Play, Film, Tv, Headphones, Book, Users, Star, Plus, LayoutGrid, Megaphone } from '@lucide/vue';
import api from '../api/client';
import { coverUrl } from '../utils/cover';
import PauseScreen from './PauseScreen.vue';

const props = defineProps({
  // { accentTheme, layoutMode, serverName, loginMessage, ratings, showMissingFilms, partyModeEnabled, pauseScreen }
  settings: { type: Object, required: true },
  view: { type: String, default: 'shelf' }
});
defineEmits(['update:view']);

const views = [
  { id: 'shelf', label: 'Shelf' },
  { id: 'title', label: 'Title' },
  { id: 'login', label: 'Sign-in' },
  { id: 'pause', label: 'Pause' }
];

// The virtual screen: app views at a laptop's 16:10, the player at 16:9.
const VW = 1280;
const virtualHeight = computed(() => (props.view === 'pause' ? 720 : 800));
const frameEl = ref(null);
const frameWidth = ref(640);
const scale = computed(() => frameWidth.value / VW);
const frameHeight = computed(() => Math.round(virtualHeight.value * scale.value));
let observer = null;

const brand = computed(() => (props.settings.serverName || '').trim() || 'Plinthio');
const ratingsOn = computed(() => {
  const r = props.settings.ratings || {};
  return r.showPersonal || r.showCommunity || r.showExternal;
});
const pauseMode = computed(() => props.settings.pauseScreen || 'simple');

const navTabs = [
  { label: 'All', icon: LayoutGrid },
  { label: 'Movies', icon: Film, active: true },
  { label: 'Shows', icon: Tv },
  { label: 'Books', icon: Book },
  { label: 'Audiobooks', icon: Headphones }
];

// Sample titles: the server's own movies when it has some, placeholders otherwise.
const samples = ref([]);
const heroItem = ref(null);
const heroCredits = ref(null);
const PLACEHOLDER_TITLES = ['The Long Voyage', 'Northern Lights', 'City of Glass', 'Paper Moon', 'Harbour', 'The Quiet Year', 'Second Wind'];
// A stand-in poster: a two-tone gradient with the title on it, so an empty server's preview
// still looks like a shelf rather than a row of grey boxes.
function samplePoster(title, i) {
  const hue = (i * 47 + 200) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,42%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,12%)"/></linearGradient></defs>
<rect width="400" height="600" fill="url(#g)"/><circle cx="300" cy="170" r="90" fill="hsla(${(hue + 180) % 360},70%,75%,0.35)"/>
<text x="32" y="540" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="#fff">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const SAMPLE_CREDITS = {
  tagline: 'Some messages take a lifetime to arrive.',
  crew: [{ name: 'Maren Holt', job: 'Director' }, { name: 'Tomas Reyes', job: 'Original Music Composer' }, { name: 'Ada Kwan', job: 'Director of Photography' }],
  cast: ['Ingrid Solberg', 'Theo Marsh', 'Nadia Farouk', 'Sam Okafor'].map((name, i) => ({ name, character: ['Elin', 'Jonah', 'Mira', 'The Harbourmaster'][i] })),
  studios: ['Northlight Pictures'],
  keywords: ['lighthouse', 'island', 'letters', 'second chances'],
  facts: { originalLanguage: 'en', budget: 18000000, revenue: 64000000 }
};
const sampleDescription = 'A lighthouse keeper on a remote island finds a message in a bottle that pulls her back into the life she left behind.';

const shelfCards = computed(() => Array.from({ length: 12 }, (_, i) => {
  const item = samples.value[i];
  return item
    ? { title: item.title, cover: coverUrl(item, { width: 300 }) }
    : { title: PLACEHOLDER_TITLES[i % PLACEHOLDER_TITLES.length], cover: samplePoster(PLACEHOLDER_TITLES[i % PLACEHOLDER_TITLES.length], i) };
}).slice(0, props.settings.layoutMode === 'sidebar' ? 10 : 12));

const hero = computed(() => {
  const item = heroItem.value;
  if (!item) return { id: 0, title: 'The Long Voyage', cover: samplePoster('The Long Voyage', 0), backdrop: '', description: '' };
  return {
    id: item.id,
    title: item.title,
    cover: coverUrl(item, { width: 440 }),
    backdrop: coverUrl(item, { width: 1280 }),
    description: item.description
  };
});
const heroMeta = computed(() => {
  const item = heroItem.value;
  const parts = [];
  const year = (item?.release_date || '').slice(0, 4);
  parts.push(year || '2021');
  const minutes = Math.round((item?.duration || 7440) / 60);
  parts.push(`${Math.floor(minutes / 60)} h ${minutes % 60} min`);
  if (item?.age_rating) parts.push(item.age_rating);
  parts.push(item?.genres ? String(item.genres).split(',').slice(0, 2).map((g) => g.trim()).join(', ') : 'Drama, Adventure');
  return parts.join(' · ');
});

const collectionCards = computed(() => {
  const owned = samples.value.slice(0, 3).map((item) => ({ title: item.title, cover: coverUrl(item, { width: 260 }) }));
  while (owned.length < 3) owned.push({ title: PLACEHOLDER_TITLES[owned.length + 1], cover: samplePoster(PLACEHOLDER_TITLES[owned.length + 1], owned.length + 1) });
  if (props.settings.showMissingFilms) {
    owned.push({ title: 'The Long Voyage II', cover: samplePoster('The Long Voyage II', 5), missing: true });
    owned.push({ title: 'The Long Voyage III', cover: samplePoster('The Long Voyage III', 6), missing: true });
  }
  return owned;
});

const pauseItem = computed(() => heroItem.value
  ? { ...heroItem.value, duration: heroItem.value.duration || 7440 }
  : {
      id: null,
      title: 'The Long Voyage',
      media_type: 'movie',
      description: sampleDescription,
      release_date: '2021-06-11',
      genres: 'Drama, Adventure',
      age_rating: 'PG-13',
      duration: 7440
    });
const simpleTime = computed(() => {
  const t = Math.round(pauseItem.value.duration * 0.42 / 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}:00`;
});

const caption = computed(() => {
  switch (props.view) {
    case 'title': return 'A movie page with the rating, watch party and collection settings above.';
    case 'login': return 'The sign-in screen, with your server name and notice.';
    case 'pause': return {
      simple: 'Simple: nothing covers the picture. Pick another style to see it here.',
      details: 'Details: shown after a couple of seconds paused. Hover a style to compare.',
      cinematic: 'Cinematic: cast photos and facts come from TMDB when a key is set.',
      bedtime: 'Bedtime: a dim clock and when it ends.'
    }[pauseMode.value] || '';
    default: return `The home shelf with the ${props.settings.layoutMode === 'sidebar' ? 'sidebar' : 'top navigation'} layout and the ${props.settings.accentTheme || 'zinc'} accent.`;
  }
});

async function loadSamples() {
  try {
    const res = await api.get('/items', { params: { mediaType: 'movie', sort: 'added', limit: 12 } });
    samples.value = (res.data.items || []).filter((i) => i.cover_path);
    const first = samples.value[0];
    if (!first) return;
    const [full, credits] = await Promise.allSettled([
      api.get(`/items/${first.id}`),
      api.get(`/items/${first.id}/credits`)
    ]);
    heroItem.value = full.status === 'fulfilled' ? full.value.data.item : first;
    heroCredits.value = credits.status === 'fulfilled' ? credits.value.data.credits || null : null;
  } catch (e) {
    // Placeholders are fine.
  }
}

onMounted(() => {
  if (frameEl.value) {
    frameWidth.value = frameEl.value.clientWidth || 640;
    observer = new ResizeObserver(([entry]) => { frameWidth.value = entry.contentRect.width; });
    observer.observe(frameEl.value);
  }
  loadSamples();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
