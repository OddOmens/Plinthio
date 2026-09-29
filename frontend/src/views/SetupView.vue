<template>
  <!-- First-run setup, full screen: one question per step, big enough to read on a phone or
       across the room. Ends with an optional two-factor step for the new admin. -->
  <div class="min-h-screen bg-background text-foreground flex flex-col safe-top safe-bottom transition-colors">
    <div class="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 to-transparent" />

    <!-- Header: who, where you are, progress -->
    <header class="relative z-10 border-b border-border bg-background/80 backdrop-blur-md">
      <div class="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-3">
        <AppLogo class="w-9 h-9 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">Set up {{ form.serverName.trim() || 'Plinthio' }}</p>
          <p class="text-xs text-muted-foreground">
            <template v-if="!finished">Step {{ step }} of {{ stepTitles.length }}: {{ stepTitles[step - 1] }}</template>
            <template v-else>Almost done</template>
          </p>
        </div>
      </div>
      <div class="h-1 bg-muted">
        <div class="h-full bg-primary transition-all duration-300" :style="{ width: `${finished ? 100 : (step / stepTitles.length) * 100}%` }" />
      </div>
    </header>

    <main class="relative z-10 flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-8 sm:py-12 flex flex-col gap-6">
      <div v-if="error" class="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2.5">
        <AlertCircle class="w-4 h-4 flex-shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- STEP 1: Appearance & Branding -->
      <section v-if="!finished && step === 1" class="flex flex-col gap-7">
        <StepHeading title="Make it yours" text="A name and a look for your server. You can change all of this later in Admin." />

        <div>
          <label for="setup-name" class="block text-sm font-medium mb-2">Server name</label>
          <input
            id="setup-name"
            v-model="form.serverName"
            type="text"
            class="w-full h-12 bg-background border border-border rounded-xl px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring transition"
            placeholder="Plinthio Media"
          />
        </div>

        <div>
          <p class="text-sm font-medium mb-2">Theme</p>
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="opt in themeOptions"
              :key="opt.id"
              type="button"
              @click="setTheme(opt.id)"
              :class="form.theme === opt.id ? 'border-primary ring-4 ring-primary/15 bg-muted/40' : 'border-border hover:bg-muted/20'"
              class="flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition"
            >
              <div :class="opt.swatch" class="w-10 h-10 rounded-xl border flex items-center justify-center">
                <component :is="opt.icon" class="w-5 h-5" />
              </div>
              <div>
                <div class="text-sm font-semibold">{{ opt.label }}</div>
                <div class="text-xs text-muted-foreground">{{ opt.hint }}</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <p class="text-sm font-medium mb-2">Accent colour</p>
          <div class="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            <button
              v-for="acc in accentOptions"
              :key="acc.id"
              type="button"
              @click="setAccent(acc.id)"
              :class="form.accentTheme === acc.id ? 'border-foreground ring-4 ring-foreground/10' : 'border-border hover:border-muted-foreground/50'"
              class="flex flex-col items-center p-3 rounded-2xl border-2 transition gap-2"
            >
              <span :class="acc.bg" class="w-7 h-7 rounded-full border border-black/10"></span>
              <span class="text-xs font-medium capitalize">{{ acc.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- STEP 2: Administrator Account -->
      <section v-if="!finished && step === 2" class="flex flex-col gap-6 max-w-lg">
        <StepHeading title="Your admin account" text="This account manages libraries, settings and who can use the server." />

        <div>
          <label for="setup-user" class="block text-sm font-medium mb-2">Username</label>
          <div class="relative">
            <User class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="setup-user"
              v-model="form.username"
              type="text"
              required
              autocomplete="username"
              autocapitalize="none"
              class="w-full h-12 bg-background border border-border rounded-xl pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-ring transition"
              placeholder="admin"
            />
          </div>
        </div>

        <div>
          <label for="setup-pass" class="block text-sm font-medium mb-2">Password</label>
          <div class="relative">
            <Lock class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="setup-pass"
              v-model="form.password"
              type="password"
              required
              autocomplete="new-password"
              class="w-full h-12 bg-background border border-border rounded-xl pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-ring transition"
              placeholder="••••••••"
            />
          </div>
          <p class="text-xs text-muted-foreground mt-1.5">At least 8 characters. Longer is better, especially if you'll open Plinthio to the internet.</p>
        </div>

        <div>
          <label for="setup-pass2" class="block text-sm font-medium mb-2">Confirm password</label>
          <div class="relative">
            <Lock class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="setup-pass2"
              v-model="form.confirmPassword"
              type="password"
              required
              autocomplete="new-password"
              class="w-full h-12 bg-background border border-border rounded-xl pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-ring transition"
              placeholder="••••••••"
            />
          </div>
        </div>
      </section>

      <!-- STEP 3: Media Type Selection -->
      <section v-if="!finished && step === 3" class="flex flex-col gap-6">
        <StepHeading title="What will you keep here?" text="These show on your shelf. Everyone picks their own later, too." />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label
            v-for="item in allMedia"
            :key="item.id"
            class="flex items-start gap-3 p-4 rounded-2xl border-2 cursor-pointer transition"
            :class="form.enabledMediaTypes.includes(item.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/20'"
          >
            <input
              type="checkbox"
              v-model="form.enabledMediaTypes"
              :value="item.id"
              class="mt-1 rounded border-border text-primary focus:ring-primary h-4 w-4"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <component :is="item.icon" class="w-4 h-4" />
                <span class="text-sm font-semibold">{{ item.title }}</span>
                <span class="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{{ item.formats }}</span>
              </div>
              <p class="text-xs text-muted-foreground mt-1">{{ item.desc }}</p>
            </div>
          </label>
        </div>
      </section>

      <!-- STEP 4: Initial Libraries (Optional) -->
      <section v-if="!finished && step === 4" class="flex flex-col gap-6">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <StepHeading title="Add your media folders" text="Optional. Point Plinthio at the folders your files are in; it scans them straight away. You can add more later in Admin." />
          <button
            type="button"
            @click="addLibraryRow"
            class="h-10 px-4 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium flex items-center gap-1.5 transition"
          >
            <Plus class="w-4 h-4" />
            Add folder
          </button>
        </div>

        <div v-if="form.libraries.length === 0" class="border-2 border-dashed border-border rounded-2xl p-8 text-center text-muted-foreground">
          <Folder class="w-9 h-9 mx-auto mb-2 opacity-40" />
          <p class="text-sm font-medium">No folders yet.</p>
          <p class="text-xs mt-1">In Docker, your media is under <code class="font-mono">/media</code>.</p>
          <button type="button" @click="addLibraryRow" class="mt-3 text-sm text-primary hover:underline font-medium">
            + Add a library folder now
          </button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="(lib, idx) in form.libraries"
            :key="idx"
            class="p-4 bg-muted/30 border border-border rounded-2xl flex flex-col gap-3 relative"
          >
            <button aria-label="Remove" type="button" @click="removeLibraryRow(idx)" class="absolute top-3 right-3 text-muted-foreground hover:text-destructive p-1" title="Remove">
              <Trash2 class="w-4 h-4" />
            </button>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-7">
              <div>
                <label class="block text-xs font-medium mb-1">Library name</label>
                <input v-model="lib.name" type="text" placeholder="e.g. My Audiobooks" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">Type</label>
                <select v-model="lib.type" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
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
              <label class="block text-xs font-medium mb-1">Folder path (on the host or in the container)</label>
              <input v-model="lib.path" type="text" placeholder="/media/yourname/Database1/Books" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
        </div>
      </section>

      <!-- STEP 5: Household members -->
      <section v-if="!finished && step === 5" class="flex flex-col gap-6">
        <StepHeading title="Who else uses it?" text="Optional. Each person gets their own progress, bookmarks and look. You can add people any time in Admin." />

        <div class="flex flex-col gap-3">
          <div v-for="(member, idx) in form.extraUsers" :key="idx" class="relative p-4 border border-border rounded-2xl bg-muted/20 flex flex-col gap-3">
            <button aria-label="Remove" type="button" @click="removeMember(idx)" class="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition" title="Remove">
              <Trash2 class="w-4 h-4" />
            </button>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-7">
              <div>
                <label class="block text-xs font-medium mb-1">Username</label>
                <input v-model="member.username" type="text" placeholder="e.g. alex" autocomplete="off" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">Role</label>
                <select v-model="member.role" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="viewer">Viewer: browse, read & track progress</option>
                  <option value="editor">Editor: can also fix metadata & covers</option>
                  <option value="admin">Admin: full server control</option>
                </select>
              </div>
            </div>
            <div class="pr-7">
              <label class="block text-xs font-medium mb-1">Password (at least 8 characters)</label>
              <input v-model="member.password" type="password" autocomplete="new-password" placeholder="Set a password for them" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              <p v-if="member.password && member.password.length < 8" class="text-xs text-amber-500 mt-1">
                Too short: accounts with a password under 8 characters are skipped.
              </p>
            </div>
          </div>
        </div>

        <button type="button" @click="addMember" class="w-full h-12 rounded-2xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/20 transition flex items-center justify-center gap-1.5">
          <Plus class="w-4 h-4" />
          Add someone
        </button>

        <label class="flex items-start gap-3 p-4 rounded-2xl border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
          <input v-model="form.partyModeEnabled" type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-ring" />
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-semibold flex items-center gap-1.5">
              <PartyPopper class="w-4 h-4 text-primary" />
              Turn on watch parties
            </span>
            <span class="text-xs text-muted-foreground">
              Watch a movie or show together from different places, in sync, with chat. Friends away from home need a way
              in (next step). You can change this any time in Admin.
            </span>
          </div>
        </label>
      </section>

      <!-- STEP 6: Access — home only, Tailscale, or the internet -->
      <section v-if="!finished && step === 6" class="flex flex-col gap-6">
        <StepHeading title="Where will you use Plinthio?" text="Start with what you need now. You can change this any time in Admin → Network." />

        <div class="flex flex-col gap-3" role="radiogroup" aria-label="Where you'll use Plinthio">
          <button
            v-for="opt in accessOptions"
            :key="opt.id"
            type="button"
            role="radio"
            :aria-checked="form.access === opt.id"
            @click="form.access = opt.id"
            class="flex items-start gap-4 p-4 sm:p-5 rounded-2xl border-2 text-left transition"
            :class="form.access === opt.id ? 'border-primary ring-4 ring-primary/15 bg-primary/5' : 'border-border hover:bg-muted/20'"
          >
            <div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" :class="form.access === opt.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'">
              <component :is="opt.icon" class="w-5 h-5" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-semibold">{{ opt.title }}</span>
                <span v-if="opt.badge" class="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">{{ opt.badge }}</span>
              </div>
              <p class="text-sm text-muted-foreground mt-1 leading-relaxed">{{ opt.text }}</p>
            </div>
            <Check v-if="form.access === opt.id" class="w-5 h-5 text-primary flex-shrink-0" />
          </button>
        </div>

        <!-- Opening to the internet: through Funnel (no domain) or a web address of your own -->
        <div v-if="form.access === 'internet'" class="flex flex-col gap-2">
          <p class="text-sm font-medium">How will guests reach it?</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="How guests reach it">
            <button type="button" role="radio" :aria-checked="form.internetVia === 'funnel'" @click="form.internetVia = 'funnel'"
              class="p-4 rounded-2xl border-2 text-left transition" :class="form.internetVia === 'funnel' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/20'">
              <span class="text-sm font-semibold block">No domain: Tailscale Funnel</span>
              <span class="text-xs text-muted-foreground">A permanent link, no router changes. Best for reading and listening; video may be slower.</span>
            </button>
            <button type="button" role="radio" :aria-checked="form.internetVia === 'domain'" @click="form.internetVia = 'domain'"
              class="p-4 rounded-2xl border-2 text-left transition" :class="form.internetVia === 'domain' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/20'">
              <span class="text-sm font-semibold block">My own domain</span>
              <span class="text-xs text-muted-foreground">Full speed, like media.yourdomain.com. Needs ports opened on your router.</span>
            </button>
          </div>
        </div>

        <!-- Tailscale, step by step: for Tailscale itself, or for Funnel -->
        <div v-if="showTailscaleGuide" class="p-4 sm:p-5 rounded-2xl border border-border bg-card flex flex-col gap-3">
          <div>
            <p class="text-base font-semibold">Set up Tailscale</p>
            <p class="text-xs text-muted-foreground">Now, or any time after setup: Admin → Network has this same guide, and shows when it's working.</p>
          </div>
          <TailscaleGuide context="setup" :funnel="funnelChosen" @update:funnel="setFunnel" />
        </div>

        <div v-if="form.access === 'internet' && form.internetVia === 'domain'" class="p-4 rounded-2xl bg-muted/30 border border-border text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium mb-1">After setup: give it a web address</p>
          The Caddy add-on gives <code class="font-mono text-foreground">https://media.yourdomain.com</code> with a real certificate. It
          needs a domain and ports 80 and 443 forwarded on your router. Step by step, including how to check your internet
          connection allows it: <strong class="text-foreground">Docs → Remote Access &amp; Tailscale</strong>. Until then, nothing changes.
        </div>

        <label v-if="opensToInternet" class="flex items-start gap-3 p-4 rounded-2xl border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
          <input v-model="form.require2faOutside" type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-ring" />
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-semibold flex items-center gap-1.5"><ShieldCheck class="w-4 h-4 text-primary" /> Require two-factor away from home</span>
            <span class="text-xs text-muted-foreground">
              Optional, recommended. Signing in from outside the home network then needs a code from a phone app; at home a
              password is enough. Anyone without two-factor can still sign in at home and set it up there.
            </span>
          </div>
        </label>
      </section>

      <!-- STEP 7: Review & Ready -->
      <section v-if="!finished && step === 7" class="flex flex-col gap-6">
        <StepHeading title="Review & Launch Plinthio" text="Check everything looks right. You can change any of it later." />

        <dl class="rounded-2xl border border-border bg-muted/20 divide-y divide-border text-sm">
          <div v-for="row in reviewRows" :key="row.label" class="flex justify-between gap-4 px-4 py-3">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd class="font-medium text-right">{{ row.value }}</dd>
          </div>
        </dl>

        <div v-if="tls?.enabled && form.access === 'home'" class="p-4 rounded-2xl border border-border bg-muted/20 text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium mb-1 flex items-center gap-2"><Lock class="w-4 h-4 text-primary" /> Secure connection at home</p>
          The installed app and offline downloads need HTTPS. Plinthio is also at
          <code class="font-mono text-foreground break-all">{{ httpsUrl }}</code> with its own certificate, which each device
          installs once (Docs → PWA Mobile App Setup). Or use Tailscale for a trusted address with nothing to install.
        </div>
      </section>

      <!-- After setup: optional two-factor for the new admin -->
      <section v-if="finished" class="flex flex-col gap-6">
        <div class="flex flex-col items-center text-center gap-3">
          <div class="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 class="w-7 h-7" />
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Plinthio is ready</h1>
          <p class="text-sm text-muted-foreground max-w-md">
            One last, optional thing: protect your admin account with two-factor, so a password alone isn't enough.
            {{ form.access === 'internet' ? 'Worth it, since the server will be reachable from the internet.' : 'You can also do this later in Settings → Security.' }}
          </p>
        </div>
        <div class="rounded-2xl border border-border bg-card p-5">
          <TwoFactorSetup @done="twoFactorDone = true" />
        </div>
      </section>
    </main>

    <!-- Footer: always in reach -->
    <footer class="sticky bottom-0 z-10 border-t border-border bg-background/90 backdrop-blur-md safe-bottom">
      <div class="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
        <template v-if="!finished">
          <button v-if="step > 1" type="button" @click="prevStep" class="h-11 px-5 rounded-xl border border-border text-sm font-medium hover:bg-muted/40 transition">
            Back
          </button>
          <div v-else></div>

          <button v-if="step < stepTitles.length" type="button" @click="nextStep" class="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-sm font-semibold shadow-md shadow-primary/20 transition flex items-center gap-2">
            <span>Continue</span>
            <ArrowRight class="w-4 h-4" />
          </button>
          <button v-else type="button" :disabled="loading" @click="completeSetup" class="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-sm font-semibold shadow-md shadow-primary/20 transition flex items-center gap-2 disabled:opacity-50">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            <span>Complete Setup & Launch</span>
          </button>
        </template>
        <template v-else>
          <div></div>
          <button type="button" @click="router.push('/')" class="h-11 px-6 rounded-xl text-sm font-semibold transition flex items-center gap-2" :class="twoFactorDone ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border hover:bg-muted/40'">
            {{ twoFactorDone ? 'Go to Plinthio' : 'Not now' }}
            <ArrowRight class="w-4 h-4" />
          </button>
        </template>
      </div>
    </footer>
  </div>
</template>

<script setup>
import AppLogo from '../components/AppLogo.vue';
import TwoFactorSetup from '../components/TwoFactorSetup.vue';
import TailscaleGuide from '../components/TailscaleGuide.vue';
import { ref, reactive, computed, h } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { useThemeStore } from '../stores/theme';
import { useCustomizationStore } from '../stores/customization';
import {
  Headphones, BookOpen, Layers, Tv, Film, Sparkles, Moon, Sun, User, Lock, Plus, Trash2, Folder,
  ArrowRight, CheckCircle2, AlertCircle, Loader2, PartyPopper, Check, House, Globe, ShieldCheck, Waypoints
} from '@lucide/vue';

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const customizationStore = useCustomizationStore();

const step = ref(1);
const loading = ref(false);
const error = ref('');
// Set once the server is created: the wizard then shows the optional two-factor step.
const finished = ref(false);
const twoFactorDone = ref(false);

// A step's big title and one line under it.
const StepHeading = (props) => h('div', { class: 'flex flex-col gap-2' }, [
  h('h1', { class: 'text-2xl sm:text-3xl font-bold tracking-tight' }, props.title),
  h('p', { class: 'text-sm sm:text-base text-muted-foreground leading-relaxed max-w-2xl' }, props.text)
]);
StepHeading.props = ['title', 'text'];

// Built-in HTTPS status, shown on the Review step.
const tls = ref(null);
const httpsUrl = computed(() => (tls.value?.port
  ? `https://${window.location.hostname}${tls.value.port === 443 ? '' : `:${tls.value.port}`}`
  : ''));
async function loadTlsStatus() {
  try {
    const res = await fetch('/api/tls');
    if (res.ok) tls.value = await res.json();
  } catch {
    // Older server — the card just doesn't show.
  }
}

const stepTitles = ['Appearance', 'Admin Account', 'Media Types', 'Libraries', 'Household', 'Access', 'Review & Finish'];

const themeOptions = [
  { id: 'dark', label: 'Dark', hint: 'Easy on the eyes', icon: Moon, swatch: 'bg-zinc-900 text-zinc-100 border-zinc-700' },
  { id: 'light', label: 'Light', hint: 'Clean and bright', icon: Sun, swatch: 'bg-zinc-100 text-zinc-900 border-zinc-300' }
];

const accentOptions = [
  { id: 'zinc', label: 'Zinc', bg: 'bg-zinc-500' },
  { id: 'slate', label: 'Slate', bg: 'bg-slate-500' },
  { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500' },
  { id: 'violet', label: 'Violet', bg: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', bg: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', bg: 'bg-amber-500' }
];

const allMedia = [
  { id: 'audiobook', title: 'Audiobooks', desc: 'Chapters, bookmarks and resume.', icon: Headphones, formats: 'M4B, MP3, FLAC' },
  { id: 'manga', title: 'Manga & Comics', desc: 'Page-by-page reader, single or double page.', icon: Layers, formats: 'CBZ, CBR, PDF' },
  { id: 'book', title: 'Books', desc: 'EPUB and PDF reader with progress.', icon: BookOpen, formats: 'EPUB, PDF' },
  { id: 'movie', title: 'Movies', desc: 'Films with resume, collections and extras.', icon: Film, formats: 'MP4, MKV' },
  { id: 'show', title: 'TV Shows', desc: 'Seasons and episodes, up next.', icon: Tv, formats: 'MP4, MKV' },
  { id: 'anime', title: 'Anime', desc: 'Series sorted by season and episode.', icon: Sparkles, formats: 'MP4, MKV' }
];

// Where the server can be used from. "home" and "tailscale" are the same server setting
// (Tailscale devices count as home); "tailscale" just adds the how-to.
const accessOptions = [
  { id: 'home', title: 'At home only', badge: 'Start here', icon: House, text: 'Phones, tablets and computers on your home network. Nothing is reachable from the internet.' },
  { id: 'tailscale', title: 'At home, and away with Tailscale', icon: Waypoints, text: 'For you and people you invite to your Tailscale: private, with nothing opened on your router. Each device needs the free Tailscale app.' },
  { id: 'internet', title: 'Also from the internet, for guests', icon: Globe, text: 'Friends and family open a link and sign in, with no apps to install: through Tailscale Funnel (no domain, no router changes) or a web address of your own.' }
];

const form = reactive({
  serverName: 'Plinthio',
  theme: 'dark',
  accentTheme: 'zinc',
  username: 'admin',
  password: '',
  confirmPassword: '',
  enabledMediaTypes: [...ALL_MEDIA_TYPES],
  libraries: [],
  extraUsers: [],
  partyModeEnabled: false,
  access: 'home',
  // With access 'internet': through Tailscale Funnel or a domain of your own.
  internetVia: 'funnel',
  require2faOutside: false
});

// Funnel is chosen either as the way to the internet, or by switching it on in the Tailscale
// guide; both open the server to the outside.
const funnelChosen = computed(() => form.access === 'internet' && form.internetVia === 'funnel');
const showTailscaleGuide = computed(() => form.access === 'tailscale' || funnelChosen.value);
const opensToInternet = computed(() => form.access === 'internet');
function setFunnel(on) {
  if (on) {
    form.access = 'internet';
    form.internetVia = 'funnel';
  } else if (funnelChosen.value) {
    form.access = 'tailscale';
  }
}

const reviewRows = computed(() => [
  { label: 'Server name', value: form.serverName },
  { label: 'Admin username', value: form.username },
  { label: 'Theme & accent', value: `${form.theme === 'dark' ? 'Dark' : 'Light'} · ${form.accentTheme}` },
  { label: 'Media', value: allMedia.filter((m) => form.enabledMediaTypes.includes(m.id)).map((m) => m.title).join(', ') },
  { label: 'Libraries', value: `${form.libraries.filter((l) => l.name.trim() && l.path.trim()).length} folder(s)` },
  { label: 'Other accounts', value: String(form.extraUsers.filter((u) => u.username.trim() && u.password.length >= 8).length) },
  { label: 'Watch parties', value: form.partyModeEnabled ? 'On' : 'Off' },
  {
    label: 'Access',
    value: form.access === 'internet'
      ? `Home and the internet${form.internetVia === 'funnel' ? ' (Tailscale Funnel)' : ' (your own domain)'}${form.require2faOutside ? ', two-factor away from home' : ''}`
      : form.access === 'tailscale' ? 'Home and Tailscale' : 'Home only'
  }
]);

function setTheme(theme) {
  form.theme = theme;
  if ((theme === 'dark') !== themeStore.isDark) themeStore.toggleTheme();
}

function setAccent(accent) {
  form.accentTheme = accent;
  document.documentElement.setAttribute('data-accent', accent);
}

function addLibraryRow() {
  form.libraries.push({ name: '', path: '', type: 'audiobooks' });
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
  if (step.value === 3 && form.enabledMediaTypes.length === 0) {
    error.value = 'Please select at least one media type';
    return;
  }
  // The last step (Review) has its own "Complete Setup" button instead of Continue.
  if (step.value < stepTitles.length) {
    step.value++;
    window.scrollTo({ top: 0 });
    if (step.value === stepTitles.length) loadTlsStatus();
  }
}

function prevStep() {
  error.value = '';
  if (step.value > 1) step.value--;
}

async function completeSetup() {
  error.value = '';
  loading.value = true;
  try {
    await authStore.setup({
      username: form.username.trim(),
      password: form.password,
      theme: form.theme,
      serverName: form.serverName.trim(),
      enabledMediaTypes: form.enabledMediaTypes,
      libraries: form.libraries.filter((l) => l.name.trim() && l.path.trim()),
      extraUsers: form.extraUsers,
      access: {
        remoteAccess: form.access === 'internet',
        tailscaleIsHome: true,
        require2faOutside: form.access === 'internet' && form.require2faOutside
      }
    });
    await customizationStore.updateCustomization({
      serverName: form.serverName.trim(),
      accentTheme: form.accentTheme,
      partyModeEnabled: form.partyModeEnabled
    });
    finished.value = true;
    window.scrollTo({ top: 0 });
  } catch (err) {
    error.value = err.response?.data?.error || 'Setup failed. Please check server connection.';
  } finally {
    loading.value = false;
  }
}
</script>
