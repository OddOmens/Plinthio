<template>
  <div class="login-root relative min-h-screen bg-background text-foreground overflow-hidden safe-top safe-bottom transition-colors">
    <!-- Backdrop: an endless, slowly drifting wall of stylised shelf tiles, one icon per kind
         of media. Decorative only: it needs no API and shows nothing from the library, so
         it's safe in front of anyone who opens the address. -->
    <div class="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
      <div class="glow glow-a"></div>
      <div class="glow glow-b"></div>
      <div class="shelf-wall">
        <div v-for="(row, r) in wallRows" :key="r" class="shelf-row" :class="r % 2 ? 'drift-right' : 'drift-left'" :style="{ animationDuration: `${90 + r * 25}s` }">
          <div v-for="(tile, i) in row" :key="i" class="shelf-tile" :style="{ background: tile.bg }">
            <component :is="tile.icon" class="w-1/3 h-1/3 text-white/35" />
          </div>
        </div>
      </div>
      <img src="/icons/logo.svg" alt="" class="ghost-logo" />
      <div class="absolute inset-0 veil"></div>
    </div>

    <div class="relative min-h-screen w-full max-w-6xl mx-auto px-4 sm:px-8 py-10 flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-16">
      <!-- Welcome -->
      <div class="flex flex-col items-center lg:items-start text-center lg:text-left gap-4 lg:flex-1 max-w-xl login-in">
        <AppLogo class="w-16 h-16 lg:w-24 lg:h-24" />
        <div class="flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-[0.25em] text-primary">{{ isSetup ? 'Welcome to' : 'Let\'s get started' }}</p>
          <h1 class="text-3xl sm:text-4xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            {{ isSetup ? (customizationStore.serverName || 'Plinthio') : 'Set up Plinthio' }}
          </h1>
          <p class="text-sm lg:text-base text-muted-foreground leading-relaxed max-w-md mx-auto lg:mx-0">
            {{ isSetup
              ? 'Books, comics, audiobooks, movies and shows. All in one place, and right where you left off.'
              : 'Create the administrator account for this server. You can add libraries and invite people next.' }}
          </p>
        </div>
        <ul class="hidden sm:flex flex-wrap justify-center lg:justify-start gap-2 mt-1">
          <li v-for="m in mediaKinds" :key="m.label" class="h-8 px-3 rounded-full border border-border bg-card/60 backdrop-blur text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <component :is="m.icon" class="w-3.5 h-3.5 text-primary" />{{ m.label }}
          </li>
        </ul>
        <!-- The admin's notice (Admin → Server Config → Server Branding) -->
        <div
          v-if="isSetup && customizationStore.loginMessage"
          class="w-full max-w-md flex items-start gap-2.5 p-3 rounded-xl bg-primary/10 border border-primary/25 text-sm text-foreground text-left leading-relaxed backdrop-blur"
        >
          <Megaphone class="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <p class="whitespace-pre-line">{{ customizationStore.loginMessage }}</p>
        </div>
      </div>

      <!-- Sign-in card -->
      <div class="w-full max-w-sm lg:flex-shrink-0 bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-6 sm:p-7 shadow-2xl login-in login-in-late">
        <!-- Expired Account State -->
        <div v-if="isExpired" class="flex flex-col items-center text-center py-2 animate-in fade-in duration-200">
          <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center mb-3.5 shadow-sm">
            <Lock class="w-6 h-6" />
          </div>
          <h2 class="text-base font-bold text-foreground">Account Access Expired</h2>
          <p class="text-xs text-muted-foreground mt-2 leading-relaxed">
            Your access pass for <strong class="text-foreground font-semibold">@{{ username }}</strong> has concluded. Please reach out to your server administrator to renew or extend your access.
          </p>

          <button
            type="button"
            @click="resetExpired"
            class="mt-6 w-full h-10 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition active:scale-95"
          >
            Back to Sign In
          </button>
        </div>

        <!-- Regular Login Form -->
        <template v-else>
          <div class="mb-5">
            <h2 class="text-lg font-semibold tracking-tight">{{ isSetup ? 'Sign in' : 'Create admin account' }}</h2>
            <p class="text-xs text-muted-foreground mt-0.5">{{ isSetup ? 'Use the account your server admin gave you.' : 'Password needs at least 8 characters.' }}</p>
          </div>

          <!-- Error Alert -->
          <div v-if="error" class="mb-4 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            <span>{{ error }}</span>
          </div>

          <!-- Form -->
          <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
            <div>
              <label for="login-username" class="block text-xs font-medium text-foreground mb-1.5">Username</label>
              <div class="relative">
                <User class="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-username"
                  v-model="username"
                  type="text"
                  required
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck="false"
                  class="w-full h-10 bg-background/70 border border-border rounded-lg pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition"
                  placeholder="Your username"
                />
              </div>
            </div>

            <div>
              <label for="login-password" class="block text-xs font-medium text-foreground mb-1.5">Password</label>
              <div class="relative">
                <KeyRound class="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  :autocomplete="isSetup ? 'current-password' : 'new-password'"
                  class="w-full h-10 bg-background/70 border border-border rounded-lg pl-9 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  @click="showPassword = !showPassword"
                  class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :aria-pressed="String(showPassword)"
                >
                  <EyeOff v-if="showPassword" class="w-4 h-4" />
                  <Eye v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              type="submit"
              :disabled="loading"
              class="mt-1 w-full h-10 bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground font-semibold rounded-lg text-sm shadow-lg shadow-primary/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <span>{{ isSetup ? 'Sign In' : 'Create Account' }}</span>
              <ArrowRight v-if="!loading" class="w-4 h-4" />
            </button>
          </form>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import AppLogo from '../components/AppLogo.vue';
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import { AlertCircle, Loader2, Lock, User, KeyRound, Eye, EyeOff, ArrowRight, Megaphone, BookOpen, Book, FileImage, Headphones, Film, Tv, Sparkles } from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const isSetup = ref(true);
const isExpired = ref(false);
const showPassword = ref(false);

const mediaKinds = [
  { label: 'Books', icon: Book },
  { label: 'Comics & Manga', icon: FileImage },
  { label: 'Audiobooks', icon: Headphones },
  { label: 'Movies', icon: Film },
  { label: 'Shows', icon: Tv },
  { label: 'Anime', icon: Sparkles }
];

// The backdrop's tiles: each row is its tiles twice over, so sliding it by half its width
// loops without a seam. Colours are a fixed spread around the wheel, darkened, so they read
// as posters in either theme without looking like any real one.
const TILE_ICONS = [BookOpen, Headphones, Film, Tv, FileImage, Sparkles, Book];
const wallRows = Array.from({ length: 5 }, (_, r) => {
  const row = Array.from({ length: 12 }, (_, i) => {
    const hue = (r * 67 + i * 41) % 360;
    return {
      icon: TILE_ICONS[(r * 3 + i) % TILE_ICONS.length],
      bg: `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${(hue + 35) % 360} 55% 14%))`
    };
  });
  return [...row, ...row];
});

onMounted(async () => {
  isSetup.value = await authStore.checkSetupStatus();
});

function resetExpired() {
  isExpired.value = false;
  error.value = '';
  password.value = '';
}

async function handleSubmit() {
  error.value = '';
  isExpired.value = false;
  loading.value = true;
  try {
    if (!isSetup.value) {
      await authStore.setup(username.value, password.value);
    } else {
      await authStore.login(username.value, password.value);
    }
    // Only an in-app path ("/party/K7Q2"), never another site.
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
    router.push(/^\/(?!\/)/.test(redirect) ? redirect : '/');
  } catch (err) {
    if (err.response?.data?.code === 'P103') {
      isExpired.value = true;
    } else {
      error.value = err.response?.data?.error || 'Authentication failed';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.glow {
  position: absolute;
  width: 60vmax;
  height: 60vmax;
  border-radius: 9999px;
  filter: blur(90px);
  opacity: 0.35;
  /* The logo's steel blue, not the accent: the default accent is near-white in dark mode
     and would fog the whole page. */
  background: radial-gradient(circle, hsl(213 45% 55%), transparent 65%);
  animation: float 28s ease-in-out infinite alternate;
}
.glow-a { top: -25vmax; left: -15vmax; }
.dark .glow { opacity: 0.18; }
.glow-b { bottom: -30vmax; right: -20vmax; opacity: 0.22; background: radial-gradient(circle, hsl(250 45% 55%), transparent 65%); animation-duration: 36s; animation-direction: alternate-reverse; }

/* Tilted so the rows read as shelves receding, and masked so they fade out at the edges. */
.shelf-wall {
  position: absolute;
  inset: -20% -30%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.25rem;
  transform: rotate(-12deg) scale(1.05);
  opacity: 0.55;
  -webkit-mask-image: radial-gradient(ellipse 70% 65% at 60% 50%, #000 30%, transparent 75%);
  mask-image: radial-gradient(ellipse 70% 65% at 60% 50%, #000 30%, transparent 75%);
}
.dark .shelf-wall { opacity: 0.4; }
.shelf-row { display: flex; gap: 1.25rem; width: max-content; animation: drift linear infinite; }
.drift-right { animation-direction: reverse; }
.shelf-tile {
  width: clamp(88px, 11vw, 150px);
  aspect-ratio: 2 / 3;
  border-radius: 0.9rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 30px -12px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.12);
}

.ghost-logo {
  position: absolute;
  width: min(80vmin, 720px);
  right: -8vmin;
  top: 50%;
  transform: translateY(-50%) rotate(8deg);
  opacity: 0.07;
  filter: blur(1px);
  animation: bob 18s ease-in-out infinite alternate;
}

/* Keeps the text side readable over the wall in both themes. */
.veil { background: linear-gradient(90deg, hsl(var(--background)) 0%, hsl(var(--background) / 0.85) 35%, hsl(var(--background) / 0.35) 100%); }
@media (max-width: 1023px) {
  .veil { background: linear-gradient(180deg, hsl(var(--background) / 0.55) 0%, hsl(var(--background) / 0.9) 60%, hsl(var(--background)) 100%); }
}

.login-in { animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.login-in-late { animation-delay: 0.12s; }

@keyframes drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes float { from { transform: translate(0, 0); } to { transform: translate(8vmax, 6vmax); } }
@keyframes bob { from { transform: translateY(-52%) rotate(6deg); } to { transform: translateY(-48%) rotate(10deg); } }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .shelf-row, .glow, .ghost-logo, .login-in { animation: none; }
}
</style>
