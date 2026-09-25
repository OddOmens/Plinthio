<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] bg-background flex flex-col overflow-y-auto">
      <!-- Ambient accent wash so the flow feels like part of the product, not a modal -->
      <div class="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 to-transparent" />

      <div class="relative flex-1 flex flex-col items-center justify-center px-5 py-10">
        <div class="w-full max-w-2xl flex flex-col gap-8">
          <!-- Progress -->
          <div class="flex items-center justify-center gap-2">
            <div
              v-for="(s, i) in steps"
              :key="s"
              :class="[
                'h-1.5 rounded-full transition-all duration-300',
                i === stepIndex ? 'w-8 bg-primary' : i < stepIndex ? 'w-8 bg-primary/40' : 'w-4 bg-muted'
              ]"
            />
          </div>

          <!-- STEP: Welcome -->
          <section v-if="step === 'welcome'" class="flex flex-col items-center text-center gap-5">
            <div class="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20">
              <BookOpen class="w-8 h-8" />
            </div>
            <div class="space-y-2">
              <h1 class="text-3xl font-bold tracking-tight text-foreground">
                Welcome to {{ serverName }}
              </h1>
              <p class="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
                Let's set things up the way you like them. This takes about thirty seconds, and
                you can change any of it later in Settings.
              </p>
            </div>
          </section>

          <!-- STEP: Theme -->
          <section v-else-if="step === 'theme'" class="flex flex-col gap-6">
            <header class="text-center space-y-2">
              <h2 class="text-2xl font-bold tracking-tight text-foreground">Pick your look</h2>
              <p class="text-sm text-muted-foreground">This one's just for you — it won't change what anyone else sees.</p>
            </header>

            <div class="grid grid-cols-2 gap-4">
              <button
                v-for="opt in themeOptions"
                :key="opt.id"
                type="button"
                @click="selectTheme(opt.id)"
                :class="[
                  'group rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.98]',
                  choices.theme === opt.id
                    ? 'border-primary ring-4 ring-primary/15 bg-muted/40'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted/20'
                ]"
              >
                <!-- Mini mock of the app in that theme -->
                <div :class="['rounded-xl border overflow-hidden mb-3 shadow-sm', opt.mockShell]">
                  <div :class="['h-6 border-b flex items-center gap-1 px-2', opt.mockBar]">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span :class="['h-1.5 w-10 rounded-full', opt.mockLineStrong]" />
                  </div>
                  <div class="p-2 grid grid-cols-3 gap-1.5">
                    <span v-for="n in 6" :key="n" :class="['aspect-[2/3] rounded', opt.mockTile]" />
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm font-semibold text-foreground flex items-center gap-2">
                    <component :is="opt.icon" class="w-4 h-4" />
                    {{ opt.label }}
                  </span>
                  <Check v-if="choices.theme === opt.id" class="w-5 h-5 text-primary" />
                </div>
              </button>
            </div>
          </section>

          <!-- STEP: Accent (admins only — it's a server-wide setting) -->
          <section v-else-if="step === 'accent'" class="flex flex-col gap-6">
            <header class="text-center space-y-2">
              <h2 class="text-2xl font-bold tracking-tight text-foreground">Choose an accent</h2>
              <p class="text-sm text-muted-foreground">
                Buttons, highlights and progress bars use this. As an admin, this sets it for the whole server.
              </p>
            </header>

            <div class="grid grid-cols-4 sm:grid-cols-8 gap-3">
              <button :aria-label="acc.label"
                v-for="acc in accentOptions"
                :key="acc.id"
                type="button"
                @click="selectAccent(acc.id)"
                :title="acc.label"
                :class="[
                  'aspect-square rounded-2xl border-2 flex items-center justify-center transition-all active:scale-95',
                  choices.accent === acc.id ? 'border-foreground ring-4 ring-foreground/10' : 'border-border hover:border-muted-foreground/50'
                ]"
              >
                <span :class="['w-7 h-7 rounded-full shadow-inner', acc.swatch]" />
              </button>
            </div>
            <p class="text-center text-sm text-muted-foreground capitalize">{{ choices.accent }}</p>
          </section>

          <!-- STEP: Interests -->
          <section v-else-if="step === 'interests'" class="flex flex-col gap-6">
            <header class="text-center space-y-2">
              <h2 class="text-2xl font-bold tracking-tight text-foreground">What are you here for?</h2>
              <p class="text-sm text-muted-foreground">
                We'll show these on your shelf and hide the rest. Pick as many as you like.
              </p>
            </header>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                v-for="type in mediaOptions"
                :key="type.id"
                type="button"
                @click="toggleMediaType(type.id)"
                :class="[
                  'rounded-2xl border-2 p-4 flex flex-col items-center gap-2.5 text-center transition-all active:scale-[0.98]',
                  choices.mediaTypes.includes(type.id)
                    ? 'border-primary bg-primary/5 ring-4 ring-primary/10'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted/20'
                ]"
              >
                <div
                  :class="[
                    'w-12 h-12 rounded-xl flex items-center justify-center transition-colors',
                    choices.mediaTypes.includes(type.id) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  ]"
                >
                  <component :is="type.icon" class="w-6 h-6" />
                </div>
                <span class="text-sm font-semibold text-foreground">{{ type.label }}</span>
                <span class="text-xs text-muted-foreground leading-snug">{{ type.hint }}</span>
              </button>
            </div>

            <p v-if="choices.mediaTypes.length === 0" class="text-center text-sm text-amber-500">
              Pick at least one so your shelf isn't empty.
            </p>
          </section>

          <!-- STEP: Done -->
          <section v-else-if="step === 'done'" class="flex flex-col items-center text-center gap-5">
            <div class="w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
              <Check class="w-8 h-8" />
            </div>
            <div class="space-y-2">
              <h2 class="text-2xl font-bold tracking-tight text-foreground">You're all set</h2>
              <p class="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
                {{ doneMessage }}
              </p>
            </div>
          </section>

          <!-- Nav -->
          <div class="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              @click="back"
              :disabled="stepIndex === 0 || saving"
              class="h-11 px-4 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-0 disabled:pointer-events-none"
            >
              Back
            </button>

            <div class="flex items-center gap-2">
              <button
                v-if="step !== 'done'"
                type="button"
                @click="finish(true)"
                :disabled="saving"
                class="h-11 px-4 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                @click="next"
                :disabled="saving || (step === 'interests' && choices.mediaTypes.length === 0)"
                class="h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition shadow-md shadow-primary/20 active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <span>{{ step === 'done' ? 'Start browsing' : 'Continue' }}</span>
                <ArrowRight v-if="step !== 'done' && !saving" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { useCustomizationStore } from '../stores/customization';
import { ALL_MEDIA_TYPES } from '../constants/media';
import {
  BookOpen, Headphones, FileImage, Book, Tv, Film, Sparkles,
  Check, ArrowRight, Loader2, Moon, Sun
} from 'lucide-vue-next';

const emit = defineEmits(['done']);

const authStore = useAuthStore();
const themeStore = useThemeStore();
const customizationStore = useCustomizationStore();

const serverName = computed(() => customizationStore.serverName || 'Plinthio');

// Accent is a server-wide customization (the PATCH is admin-only), so only admins get that
// step — showing it to a viewer would just hand them a control that 403s on save.
const steps = computed(() =>
  authStore.isAdmin
    ? ['welcome', 'theme', 'accent', 'interests', 'done']
    : ['welcome', 'theme', 'interests', 'done']
);

const stepIndex = ref(0);
const step = computed(() => steps.value[stepIndex.value]);
const saving = ref(false);

const choices = reactive({
  theme: themeStore.isDark ? 'dark' : 'light',
  accent: customizationStore.accentTheme || 'zinc',
  mediaTypes: [...(authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES)]
});

const themeOptions = [
  {
    id: 'dark', label: 'Dark', icon: Moon,
    mockShell: 'bg-zinc-900 border-zinc-700',
    mockBar: 'bg-zinc-800 border-zinc-700',
    mockLineStrong: 'bg-zinc-600',
    mockTile: 'bg-zinc-700'
  },
  {
    id: 'light', label: 'Light', icon: Sun,
    mockShell: 'bg-white border-zinc-200',
    mockBar: 'bg-zinc-50 border-zinc-200',
    mockLineStrong: 'bg-zinc-300',
    mockTile: 'bg-zinc-200'
  }
];

const accentOptions = [
  { id: 'zinc', label: 'Zinc', swatch: 'bg-zinc-500' },
  { id: 'slate', label: 'Slate', swatch: 'bg-slate-600' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'violet', label: 'Violet', swatch: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', swatch: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', swatch: 'bg-amber-500' },
  { id: 'sky', label: 'Sky', swatch: 'bg-sky-500' },
  { id: 'indigo', label: 'Indigo', swatch: 'bg-indigo-500' }
];

const mediaOptions = [
  { id: 'manga', label: 'Manga', hint: 'Comics & graphic novels', icon: FileImage },
  { id: 'book', label: 'Books', hint: 'EPUB & PDF reading', icon: Book },
  { id: 'audiobook', label: 'Audiobooks', hint: 'Listen with resume', icon: Headphones },
  { id: 'movie', label: 'Movies', hint: 'Watch in your browser', icon: Film },
  { id: 'show', label: 'TV Shows', hint: 'Seasons & episodes', icon: Tv },
  { id: 'anime', label: 'Anime', hint: 'Subbed & dubbed series', icon: Sparkles }
];

const doneMessage = computed(() => {
  const count = choices.mediaTypes.length;
  if (count === ALL_MEDIA_TYPES.length) return 'Your shelf is showing everything. Dive in.';
  const labels = mediaOptions.filter(m => choices.mediaTypes.includes(m.id)).map(m => m.label);
  const list = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels[0];
  return `Your shelf is tuned to ${list}. You can add more any time from Settings.`;
});

// Theme and accent apply live as they're picked — the whole point is seeing the choice,
// not reading a label about it.
function selectTheme(id) {
  choices.theme = id;
  if ((id === 'dark') !== themeStore.isDark) themeStore.toggleTheme();
}

function selectAccent(id) {
  choices.accent = id;
  document.documentElement.setAttribute('data-accent', id);
}

function toggleMediaType(id) {
  const i = choices.mediaTypes.indexOf(id);
  if (i === -1) choices.mediaTypes.push(id);
  else choices.mediaTypes.splice(i, 1);
}

function back() {
  if (stepIndex.value > 0) stepIndex.value--;
}

function next() {
  if (step.value === 'done') return finish(false);
  stepIndex.value++;
}

async function finish(skipped) {
  if (saving.value) return;
  saving.value = true;
  try {
    const preferences = {
      ...(authStore.user?.preferences || {}),
      theme: choices.theme,
      // A skip shouldn't quietly narrow someone's shelf to whatever was pre-selected.
      enabledMediaTypes: skipped
        ? (authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES)
        : choices.mediaTypes,
      onboardingComplete: true
    };

    await api.patch('/users/preferences', preferences);
    authStore.user = { ...authStore.user, preferences };
    localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));

    if (!skipped && authStore.isAdmin && choices.accent !== customizationStore.accentTheme) {
      await customizationStore.updateCustomization({ accentTheme: choices.accent });
    }
  } catch (err) {
    console.error('Failed to save onboarding preferences:', err);
  } finally {
    saving.value = false;
    emit('done');
  }
}
</script>
