<template>
  <div class="min-h-screen bg-background flex flex-col items-center justify-center p-4 sm:p-6 transition-colors overflow-y-auto safe-top safe-bottom">
    <div class="w-full max-w-xl bg-card border border-border rounded-2xl shadow-xl overflow-hidden flex flex-col my-auto">
      
      <!-- Wizard Progress Header -->
      <div class="p-6 border-b border-border bg-muted/20">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm font-bold text-base">
              S
            </div>
            <div>
              <h1 class="text-base font-semibold text-foreground tracking-tight">Plinthio Setup Wizard</h1>
              <p class="text-xs text-muted-foreground">Step {{ step }} of 6: {{ stepTitles[step - 1] }}</p>
            </div>
          </div>
          <span class="text-xs font-mono font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            {{ Math.round((step / 5) * 100) }}%
          </span>
        </div>

        <!-- Progress Bar -->
        <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            class="h-full bg-primary transition-all duration-300 rounded-full"
            :style="{ width: `${(step / 5) * 100}%` }"
          ></div>
        </div>
      </div>

      <!-- Error Alert -->
      <div v-if="error" class="m-6 mb-0 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2.5">
        <AlertCircle class="w-4 h-4 flex-shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- Wizard Step Content -->
      <div class="p-6 flex-1 flex flex-col">

        <!-- STEP 1: Appearance & Branding -->
        <div v-if="step === 1" class="space-y-5">
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Server Appearance & Branding</h2>
            <p class="text-xs text-muted-foreground">Personalize your media server's look and theme right out of the box.</p>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Server Name</label>
            <input
              v-model="form.serverName"
              type="text"
              class="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
              placeholder="Plinthio Media"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-2">Theme Mode</label>
            <div class="grid grid-cols-2 gap-3">
              <button
                type="button"
                @click="setTheme('dark')"
                :class="form.theme === 'dark' ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/20'"
                class="flex items-center gap-3 p-3 rounded-xl border text-left transition"
              >
                <div class="w-8 h-8 rounded-lg bg-zinc-900 text-zinc-100 border border-zinc-700 flex items-center justify-center">
                  <Moon class="w-4 h-4" />
                </div>
                <div>
                  <div class="text-xs font-medium text-foreground">Dark Theme</div>
                  <div class="text-[11px] text-muted-foreground">Deep shadcn zinc</div>
                </div>
              </button>

              <button
                type="button"
                @click="setTheme('light')"
                :class="form.theme === 'light' ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/20'"
                class="flex items-center gap-3 p-3 rounded-xl border text-left transition"
              >
                <div class="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-900 border border-zinc-300 flex items-center justify-center">
                  <Sun class="w-4 h-4" />
                </div>
                <div>
                  <div class="text-xs font-medium text-foreground">Light Theme</div>
                  <div class="text-[11px] text-muted-foreground">Clean high-contrast</div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-2">Accent Color</label>
            <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <button
                v-for="acc in accentOptions"
                :key="acc.id"
                type="button"
                @click="setAccent(acc.id)"
                :class="form.accentTheme === acc.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'"
                class="flex flex-col items-center p-2 rounded-xl border hover:bg-muted/20 transition gap-1.5"
              >
                <span :class="acc.bg" class="w-5 h-5 rounded-full border border-black/10"></span>
                <span class="text-[11px] font-medium text-foreground capitalize">{{ acc.label }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- STEP 2: Administrator Account -->
        <div v-if="step === 2" class="space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Create Admin Account</h2>
            <p class="text-xs text-muted-foreground">This master account will manage libraries, server customizations, and user access.</p>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Admin Username</label>
            <div class="relative">
              <User class="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <input
                v-model="form.username"
                type="text"
                required
                autocomplete="username"
                class="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                placeholder="admin"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Password</label>
            <div class="relative">
              <Lock class="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <input
                v-model="form.password"
                type="password"
                required
                autocomplete="new-password"
                class="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                placeholder="••••••••"
              />
            </div>
            <p class="text-[11px] text-muted-foreground mt-1">Must be at least 8 characters long</p>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Confirm Password</label>
            <div class="relative">
              <Lock class="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <input
                v-model="form.confirmPassword"
                type="password"
                required
                autocomplete="new-password"
                class="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                placeholder="••••••••"
              />
            </div>
          </div>
        </div>

        <!-- STEP 3: Media Type Selection -->
        <div v-if="step === 3" class="space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Select Media You Want to Consume</h2>
            <p class="text-xs text-muted-foreground">
              Choose which categories appear in your interface. Video media is optional and turned off by default.
            </p>
          </div>

          <div class="space-y-2.5">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">
              Primary Books & Audio (Default)
            </div>

            <label
              v-for="item in primaryMedia"
              :key="item.id"
              class="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-muted/20 cursor-pointer transition"
            >
              <input
                type="checkbox"
                v-model="form.enabledMediaTypes"
                :value="item.id"
                class="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <component :is="item.icon" class="w-4 h-4 text-foreground" />
                  <span class="text-xs font-medium text-foreground">{{ item.title }}</span>
                  <span class="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{{ item.formats }}</span>
                </div>
                <p class="text-[11px] text-muted-foreground mt-0.5">{{ item.desc }}</p>
              </div>
            </label>

            <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-3">
              Optional Video Formats (Hidden by default)
            </div>

            <label
              v-for="item in videoMedia"
              :key="item.id"
              class="flex items-start gap-3 p-3 rounded-xl border border-border/80 hover:bg-muted/20 cursor-pointer transition"
            >
              <input
                type="checkbox"
                v-model="form.enabledMediaTypes"
                :value="item.id"
                class="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <component :is="item.icon" class="w-4 h-4 text-foreground" />
                  <span class="text-xs font-medium text-foreground">{{ item.title }}</span>
                  <span class="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-medium">Video</span>
                  <span class="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{{ item.formats }}</span>
                </div>
                <p class="text-[11px] text-muted-foreground mt-0.5">{{ item.desc }}</p>
              </div>
            </label>
          </div>
        </div>

        <!-- STEP 4: Initial Libraries (Optional) -->
        <div v-if="step === 4" class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-foreground mb-1">Set Up Media Libraries (Optional)</h2>
              <p class="text-xs text-muted-foreground">Add folder paths on your host/container to scan right away.</p>
            </div>
            <button
              type="button"
              @click="addLibraryRow"
              class="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
            >
              <Plus class="w-3.5 h-3.5" />
              Add Folder
            </button>
          </div>

          <div v-if="form.libraries.length === 0" class="border border-dashed border-border rounded-xl p-6 text-center text-muted-foreground">
            <Folder class="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p class="text-xs font-medium">No libraries configured yet.</p>
            <p class="text-[11px] text-muted-foreground mt-1">You can also add libraries anytime later from the Admin Dashboard.</p>
            <button
              type="button"
              @click="addLibraryRow"
              class="mt-3 text-xs text-primary hover:underline font-medium"
            >
              + Add a library folder now
            </button>
          </div>

          <div v-else class="space-y-3 max-h-64 overflow-y-auto pr-1">
            <div
              v-for="(lib, idx) in form.libraries"
              :key="idx"
              class="p-3 bg-muted/30 border border-border rounded-xl flex flex-col gap-2.5 relative"
            >
              <button aria-label="Remove"
                type="button"
                @click="removeLibraryRow(idx)"
                class="absolute top-2.5 right-2.5 text-muted-foreground hover:text-destructive p-1"
                title="Remove"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-6">
                <div>
                  <label class="block text-[11px] font-medium text-foreground mb-1">Library Name</label>
                  <input
                    v-model="lib.name"
                    type="text"
                    placeholder="e.g. My Audiobooks"
                    class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-foreground mb-1">Type</label>
                  <select
                    v-model="lib.type"
                    class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="audiobooks">Audiobooks</option>
                    <option value="manga">Manga / Comics</option>
                    <option value="books">Books & PDFs</option>
                    <option value="shows">TV Shows</option>
                    <option value="movies">Movies</option>
                    <option value="anime">Anime</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="block text-[11px] font-medium text-foreground mb-1">Folder Path (on host / container)</label>
                <input
                  v-model="lib.path"
                  type="text"
                  placeholder="/media/yourname/Database1/Books"
                  class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- STEP 5: Household members -->
        <div v-if="step === 5" class="space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Add Your Household</h2>
            <p class="text-xs text-muted-foreground">
              Optional — create accounts for anyone else who'll use this server. Each person gets their own
              progress, bookmarks and preferences, and picks their own look on first login. You can always add
              more later in Admin.
            </p>
          </div>

          <div class="space-y-2.5">
            <div
              v-for="(member, idx) in form.extraUsers"
              :key="idx"
              class="relative p-3 border border-border rounded-xl bg-muted/20 space-y-2.5"
            >
              <button aria-label="Remove"
                type="button"
                @click="removeMember(idx)"
                class="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition"
                title="Remove"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-6">
                <div>
                  <label class="block text-[11px] font-medium text-foreground mb-1">Username</label>
                  <input
                    v-model="member.username"
                    type="text"
                    placeholder="e.g. alex"
                    autocomplete="off"
                    class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-foreground mb-1">Role</label>
                  <select
                    v-model="member.role"
                    class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="viewer">Viewer — browse, read & track progress</option>
                    <option value="editor">Editor — can also fix metadata & covers</option>
                    <option value="admin">Admin — full server control</option>
                  </select>
                </div>
              </div>

              <div class="pr-6">
                <label class="block text-[11px] font-medium text-foreground mb-1">Password (min 8 characters)</label>
                <input
                  v-model="member.password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Set a password for them"
                  class="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p v-if="member.password && member.password.length < 8" class="text-[11px] text-amber-500 mt-1">
                  Too short — accounts with a password under 8 characters are skipped.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            @click="addMember"
            class="w-full py-2.5 rounded-xl border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/20 transition flex items-center justify-center gap-1.5"
          >
            <Plus class="w-3.5 h-3.5" />
            Add someone
          </button>
        </div>

        <!-- STEP 6: Review & Ready -->
        <div v-if="step === 6" class="space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-foreground mb-1">Review & Launch Plinthio</h2>
            <p class="text-xs text-muted-foreground">Verify your initial setup details before initializing the server.</p>
          </div>

          <div class="p-4 bg-muted/30 border border-border rounded-xl space-y-3 text-xs">
            <div class="flex justify-between items-center py-1 border-b border-border/60">
              <span class="text-muted-foreground">Server Name</span>
              <span class="font-medium text-foreground">{{ form.serverName }}</span>
            </div>
            <div class="flex justify-between items-center py-1 border-b border-border/60">
              <span class="text-muted-foreground">Admin Username</span>
              <span class="font-medium text-foreground">{{ form.username }}</span>
            </div>
            <div class="flex justify-between items-center py-1 border-b border-border/60">
              <span class="text-muted-foreground">Theme & Accent</span>
              <span class="font-medium text-foreground capitalize">{{ form.theme }} Mode · {{ form.accentTheme }}</span>
            </div>
            <div class="flex justify-between items-center py-1 border-b border-border/60">
              <span class="text-muted-foreground">Enabled Media</span>
              <span class="font-medium text-foreground capitalize">{{ form.enabledMediaTypes.join(', ') }}</span>
            </div>
            <div class="flex justify-between items-center py-1">
              <span class="text-muted-foreground">Libraries Configured</span>
              <span class="font-medium text-foreground">{{ form.libraries.length }} folder(s)</span>
            </div>
          </div>

          <div class="p-3 rounded-xl bg-primary/5 border border-primary/10 text-xs text-foreground flex items-center gap-2.5">
            <CheckCircle2 class="w-4 h-4 text-primary flex-shrink-0" />
            <span>Ready! You can access all documentation anytime from the top bar or via <strong>/docs</strong>.</span>
          </div>
        </div>

      </div>

      <!-- Navigation Footer -->
      <div class="p-6 border-t border-border bg-muted/10 flex items-center justify-between">
        <button
          v-if="step > 1"
          type="button"
          @click="prevStep"
          class="px-4 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted/40 transition"
        >
          Back
        </button>
        <div v-else></div>

        <button
          v-if="step < 6"
          type="button"
          @click="nextStep"
          class="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-xs font-medium shadow-sm transition flex items-center gap-2"
        >
          <span>Continue</span>
          <ArrowRight class="w-3.5 h-3.5" />
        </button>

        <button
          v-else
          type="button"
          :disabled="loading"
          @click="completeSetup"
          class="px-6 py-2 rounded-lg bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-xs font-medium shadow-sm transition flex items-center gap-2 disabled:opacity-50"
        >
          <Loader2 v-if="loading" class="w-3.5 h-3.5 animate-spin" />
          <span>Complete Setup & Launch</span>
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { useThemeStore } from '../stores/theme';
import { useCustomizationStore } from '../stores/customization';
import { 
  Headphones, 
  BookOpen, 
  Layers, 
  Tv, 
  Film, 
  Sparkles, 
  Moon, 
  Sun, 
  User, 
  Lock, 
  Plus, 
  Trash2, 
  Folder, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Loader2 
} from 'lucide-vue-next';

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const customizationStore = useCustomizationStore();

const step = ref(1);
const loading = ref(false);
const error = ref('');

const stepTitles = [
  'Appearance',
  'Admin Account',
  'Media Types',
  'Libraries',
  'Household',
  'Review & Finish'
];

const accentOptions = [
  { id: 'zinc', label: 'Zinc', bg: 'bg-zinc-500' },
  { id: 'slate', label: 'Slate', bg: 'bg-slate-500' },
  { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500' },
  { id: 'violet', label: 'Violet', bg: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', bg: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', bg: 'bg-amber-500' }
];

const primaryMedia = [
  { id: 'audiobook', title: 'Audiobooks', desc: 'Narrated audiobooks with chapter bookmarks and resume.', icon: Headphones, formats: 'M4B, MP3, FLAC' },
  { id: 'manga', title: 'Manga & Comics', desc: 'Archive reader with dual-page and responsive reading.', icon: Layers, formats: 'CBZ, ZIP' },
  { id: 'book', title: 'Books & Docs', desc: 'EPUB and PDF reader with bookmarking and progress.', icon: BookOpen, formats: 'EPUB, PDF' }
];

const videoMedia = [
  { id: 'show', title: 'TV Shows & Series', desc: 'Episodic series streaming with progress tracking.', icon: Tv, formats: 'MP4, MKV' },
  { id: 'movie', title: 'Movies', desc: 'Full length feature films with resume tracking.', icon: Film, formats: 'MP4, MKV' },
  { id: 'anime', title: 'Anime Series', desc: 'Japanese animation series with season/episode sorting.', icon: Sparkles, formats: 'MP4, MKV' }
];

const form = reactive({
  serverName: 'Plinthio',
  theme: 'dark',
  accentTheme: 'zinc',
  username: 'admin',
  password: '',
  confirmPassword: '',
  enabledMediaTypes: ALL_MEDIA_TYPES,
  libraries: [],
  extraUsers: []
});

function setTheme(theme) {
  form.theme = theme;
  if (theme === 'dark') themeStore.setDark();
  else themeStore.setLight();
}

function setAccent(accent) {
  form.accentTheme = accent;
  document.documentElement.setAttribute('data-accent', accent);
}

function addLibraryRow() {
  form.libraries.push({
    name: '',
    path: '',
    type: 'audiobooks'
  });
}

function removeLibraryRow(idx) {
  form.libraries.splice(idx, 1);
}

function addMember() {
  form.extraUsers.push({ username: '', password: '', role: 'viewer' });
}

function removeMember(idx) {
  form.extraUsers.splice(idx, 1);
}

function nextStep() {
  error.value = '';
  if (step.value === 2) {
    if (!form.username.trim()) {
      error.value = 'Username is required';
      return;
    }
    if (!form.password || form.password.length < 8) {
      error.value = 'Password must be at least 8 characters';
      return;
    }
    if (form.password !== form.confirmPassword) {
      error.value = 'Passwords do not match';
      return;
    }
  }

  if (step.value === 3) {
    if (form.enabledMediaTypes.length === 0) {
      error.value = 'Please select at least one media type';
      return;
    }
  }

  if (step.value < 5) {
    step.value++;
  }
}

function prevStep() {
  error.value = '';
  if (step.value > 1) {
    step.value--;
  }
}

async function completeSetup() {
  error.value = '';
  loading.value = true;
  try {
    // 1. Send onboarding payload to backend
    await authStore.setup({
      username: form.username.trim(),
      password: form.password,
      theme: form.theme,
      serverName: form.serverName.trim(),
      enabledMediaTypes: form.enabledMediaTypes,
      libraries: form.libraries.filter(l => l.name.trim() && l.path.trim()),
      extraUsers: form.extraUsers
    });

    // 2. Set server customizations in customization store
    await customizationStore.updateCustomization({
      serverName: form.serverName.trim(),
      accentTheme: form.accentTheme
    });

    // 3. Navigate home
    router.push('/');
  } catch (err) {
    error.value = err.response?.data?.error || 'Setup failed. Please check server connection.';
  } finally {
    loading.value = false;
  }
}
</script>
