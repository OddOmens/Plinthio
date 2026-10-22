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
          <p class="text-sm font-semibold truncate">{{ $t('setup.header.title', { name: form.serverName.trim() || 'Plinthio' }) }}</p>
          <p class="text-xs text-muted-foreground">
            <template v-if="!finished">{{ $t('setup.header.progress', { step, total: stepTitles.length, title: stepTitles[step - 1] }) }}</template>
            <template v-else>{{ $t('setup.header.almostDone') }}</template>
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
        <StepHeading :title="$t('setup.appearance.title')" :text="$t('setup.appearance.text')" />

        <div>
          <label for="setup-name" class="block text-sm font-medium mb-2">{{ $t('setup.appearance.serverName') }}</label>
          <input
            id="setup-name"
            v-model="form.serverName"
            type="text"
            class="w-full h-12 bg-background border border-border rounded-xl px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring transition"
            placeholder="Plinthio Media"
          />
        </div>

        <div>
          <p class="text-sm font-medium mb-2">{{ $t('setup.appearance.theme') }}</p>
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
          <p class="text-sm font-medium mb-2">{{ $t('setup.appearance.accent') }}</p>
          <div class="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
            <button
              v-for="acc in ACCENT_OPTIONS"
              :key="acc.id"
              type="button"
              @click="setAccent(acc.id)"
              :class="form.accentTheme === acc.id ? 'border-foreground ring-4 ring-foreground/10' : 'border-border hover:border-muted-foreground/50'"
              class="flex flex-col items-center p-3 rounded-2xl border-2 transition gap-2"
            >
              <span :class="acc.swatch" class="w-7 h-7 rounded-full border border-black/10"></span>
              <span class="text-xs font-medium capitalize">{{ acc.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- STEP 2: Administrator Account -->
      <section v-if="!finished && step === 2" class="flex flex-col gap-6 max-w-lg">
        <StepHeading :title="$t('setup.admin.title')" :text="$t('setup.admin.text')" />

        <div>
          <label for="setup-user" class="block text-sm font-medium mb-2">{{ $t('common.username') }}</label>
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
          <label for="setup-pass" class="block text-sm font-medium mb-2">{{ $t('common.password') }}</label>
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
          <p class="text-xs text-muted-foreground mt-1.5">{{ $t('setup.admin.passwordHint') }}</p>
        </div>

        <div>
          <label for="setup-pass2" class="block text-sm font-medium mb-2">{{ $t('setup.admin.confirmPassword') }}</label>
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
        <StepHeading :title="$t('setup.media.title')" :text="$t('setup.media.text')" />

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
          <StepHeading :title="$t('setup.libraries.title')" :text="$t('setup.libraries.text')" />
          <button
            type="button"
            @click="addLibraryRow"
            class="h-10 px-4 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium flex items-center gap-1.5 transition"
          >
            <Plus class="w-4 h-4" />
            {{ $t('setup.libraries.addFolder') }}
          </button>
        </div>

        <div v-if="form.libraries.length === 0" class="border-2 border-dashed border-border rounded-2xl p-8 text-center text-muted-foreground">
          <Folder class="w-9 h-9 mx-auto mb-2 opacity-40" />
          <p class="text-sm font-medium">{{ $t('setup.libraries.empty') }}</p>
          <I18nT keypath="setup.libraries.dockerHint" tag="p" class="text-xs mt-1">
            <template #path><code class="font-mono">/media</code></template>
          </I18nT>
          <button type="button" @click="addLibraryRow" class="mt-3 text-sm text-primary hover:underline font-medium">
            {{ $t('setup.libraries.addNow') }}
          </button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="(lib, idx) in form.libraries"
            :key="idx"
            class="p-4 bg-muted/30 border border-border rounded-2xl flex flex-col gap-3 relative"
          >
            <button :aria-label="$t('common.remove')" type="button" @click="removeLibraryRow(idx)" class="absolute top-3 right-3 text-muted-foreground hover:text-destructive p-1" :title="$t('common.remove')">
              <Trash2 class="w-4 h-4" />
            </button>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-7">
              <div>
                <label class="block text-xs font-medium mb-1">{{ $t('setup.libraries.name') }}</label>
                <input v-model="lib.name" type="text" :placeholder="$t('setup.libraries.namePlaceholder')" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">{{ $t('setup.libraries.type') }}</label>
                <select v-model="lib.type" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option v-for="type in LIBRARY_TYPES" :key="type" :value="type">{{ $t(`setup.libraries.types.${type}`) }}</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium mb-1">{{ $t('setup.libraries.path') }}</label>
              <input v-model="lib.path" type="text" placeholder="/media/yourname/Database1/Books" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
        </div>
      </section>

      <!-- STEP 5: Household members -->
      <section v-if="!finished && step === 5" class="flex flex-col gap-6">
        <StepHeading :title="$t('setup.household.title')" :text="$t('setup.household.text')" />

        <div class="flex flex-col gap-3">
          <div v-for="(member, idx) in form.extraUsers" :key="idx" class="relative p-4 border border-border rounded-2xl bg-muted/20 flex flex-col gap-3">
            <button :aria-label="$t('common.remove')" type="button" @click="removeMember(idx)" class="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition" :title="$t('common.remove')">
              <Trash2 class="w-4 h-4" />
            </button>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-7">
              <div>
                <label class="block text-xs font-medium mb-1">{{ $t('common.username') }}</label>
                <input v-model="member.username" type="text" :placeholder="$t('setup.household.usernamePlaceholder')" autocomplete="off" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">{{ $t('setup.household.role') }}</label>
                <select v-model="member.role" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option v-for="role in ['viewer', 'editor', 'admin']" :key="role" :value="role">{{ $t(`setup.household.roles.${role}`) }}</option>
                </select>
              </div>
            </div>
            <div class="pr-7">
              <label class="block text-xs font-medium mb-1">{{ $t('setup.household.password') }}</label>
              <input v-model="member.password" type="password" autocomplete="new-password" :placeholder="$t('setup.household.passwordPlaceholder')" class="w-full h-10 bg-background border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              <p v-if="member.password && member.password.length < 8" class="text-xs text-amber-500 mt-1">
                {{ $t('setup.household.tooShort') }}
              </p>
            </div>
          </div>
        </div>

        <button type="button" @click="addMember" class="w-full h-12 rounded-2xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/20 transition flex items-center justify-center gap-1.5">
          <Plus class="w-4 h-4" />
          {{ $t('setup.household.add') }}
        </button>

        <label class="flex items-start gap-3 p-4 rounded-2xl border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
          <input v-model="form.partyModeEnabled" type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-ring" />
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-semibold flex items-center gap-1.5">
              <PartyPopper class="w-4 h-4 text-primary" />
              {{ $t('setup.household.parties') }}
            </span>
            <span class="text-xs text-muted-foreground">
              {{ $t('setup.household.partiesText') }}
            </span>
          </div>
        </label>
      </section>

      <!-- STEP 6: Access — home only, Tailscale, or the internet -->
      <section v-if="!finished && step === 6" class="flex flex-col gap-6">
        <StepHeading :title="$t('setup.access.title')" :text="$t('setup.access.text')" />

        <div class="flex flex-col gap-3" role="radiogroup" :aria-label="$t('setup.access.groupLabel')">
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
          <p class="text-sm font-medium">{{ $t('setup.access.via.question') }}</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" :aria-label="$t('setup.access.via.groupLabel')">
            <button type="button" role="radio" :aria-checked="form.internetVia === 'funnel'" @click="form.internetVia = 'funnel'"
              class="p-4 rounded-2xl border-2 text-left transition" :class="form.internetVia === 'funnel' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/20'">
              <span class="text-sm font-semibold block">{{ $t('setup.access.via.funnel.title') }}</span>
              <span class="text-xs text-muted-foreground">{{ $t('setup.access.via.funnel.text') }}</span>
            </button>
            <button type="button" role="radio" :aria-checked="form.internetVia === 'domain'" @click="form.internetVia = 'domain'"
              class="p-4 rounded-2xl border-2 text-left transition" :class="form.internetVia === 'domain' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/20'">
              <span class="text-sm font-semibold block">{{ $t('setup.access.via.domain.title') }}</span>
              <span class="text-xs text-muted-foreground">{{ $t('setup.access.via.domain.text') }}</span>
            </button>
          </div>
        </div>

        <!-- Tailscale, step by step: for Tailscale itself, or for Funnel -->
        <div v-if="showTailscaleGuide" class="p-4 sm:p-5 rounded-2xl border border-border bg-card flex flex-col gap-3">
          <div>
            <p class="text-base font-semibold">{{ $t('setup.access.tailscale.title') }}</p>
            <p class="text-xs text-muted-foreground">{{ $t('setup.access.tailscale.text') }}</p>
          </div>
          <TailscaleGuide context="setup" :funnel="funnelChosen" @update:funnel="setFunnel" />
        </div>

        <div v-if="form.access === 'internet' && form.internetVia === 'domain'" class="p-4 rounded-2xl bg-muted/30 border border-border text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium mb-1">{{ $t('setup.access.domain.title') }}</p>
          <I18nT keypath="setup.access.domain.text">
            <template #url><code class="font-mono text-foreground">https://media.yourdomain.com</code></template>
            <template #docs><strong class="text-foreground">{{ $t('setup.access.domain.docs') }}</strong></template>
          </I18nT>
        </div>

        <label v-if="opensToInternet" class="flex items-start gap-3 p-4 rounded-2xl border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
          <input v-model="form.require2faOutside" type="checkbox" class="mt-1 rounded border-border text-primary focus:ring-ring" />
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-semibold flex items-center gap-1.5"><ShieldCheck class="w-4 h-4 text-primary" /> {{ $t('setup.access.require2fa') }}</span>
            <span class="text-xs text-muted-foreground">
              {{ $t('setup.access.require2faText') }}
            </span>
          </div>
        </label>
      </section>

      <!-- STEP 7: Review & Ready -->
      <section v-if="!finished && step === 7" class="flex flex-col gap-6">
        <StepHeading :title="$t('setup.review.title')" :text="$t('setup.review.text')" />

        <dl class="rounded-2xl border border-border bg-muted/20 divide-y divide-border text-sm">
          <div v-for="row in reviewRows" :key="row.label" class="flex justify-between gap-4 px-4 py-3">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd class="font-medium text-right">{{ row.value }}</dd>
          </div>
        </dl>

        <div v-if="tls?.enabled && form.access === 'home'" class="p-4 rounded-2xl border border-border bg-muted/20 text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium mb-1 flex items-center gap-2"><Lock class="w-4 h-4 text-primary" /> {{ $t('setup.review.https.title') }}</p>
          <I18nT keypath="setup.review.https.text">
            <template #url><code class="font-mono text-foreground break-all">{{ httpsUrl }}</code></template>
          </I18nT>
        </div>
      </section>

      <!-- After setup: optional two-factor for the new admin -->
      <section v-if="finished" class="flex flex-col gap-6">
        <div class="flex flex-col items-center text-center gap-3">
          <div class="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 class="w-7 h-7" />
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">{{ $t('setup.finished.title') }}</h1>
          <p class="text-sm text-muted-foreground max-w-md">
            {{ $t('setup.finished.text') }}
            {{ form.access === 'internet' ? $t('setup.finished.internet') : $t('setup.finished.later') }}
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
          <!-- Language sits here, after the steps, until the account exists to save it to -->
          <div class="flex items-center gap-4">
            <button v-if="step > 1" type="button" @click="prevStep" class="h-11 px-5 rounded-xl border border-border text-sm font-medium hover:bg-muted/40 transition">
              {{ $t('common.back') }}
            </button>
            <LanguagePicker />
          </div>

          <button v-if="step < stepTitles.length" type="button" @click="nextStep" class="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-sm font-semibold shadow-md shadow-primary/20 transition flex items-center gap-2">
            <span>{{ $t('common.continue') }}</span>
            <ArrowRight class="w-4 h-4" />
          </button>
          <button v-else type="button" :disabled="loading" @click="completeSetup" class="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground text-sm font-semibold shadow-md shadow-primary/20 transition flex items-center gap-2 disabled:opacity-50">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            <span>{{ $t('setup.nav.complete') }}</span>
          </button>
        </template>
        <template v-else>
          <div></div>
          <button type="button" @click="router.push('/')" class="h-11 px-6 rounded-xl text-sm font-semibold transition flex items-center gap-2" :class="twoFactorDone ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border hover:bg-muted/40'">
            {{ twoFactorDone ? $t('setup.nav.goToPlinthio') : $t('setup.nav.notNow') }}
            <ArrowRight class="w-4 h-4" />
          </button>
        </template>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ACCENT_OPTIONS, optionLabel } from '../constants/appearance';
import AppLogo from '../components/AppLogo.vue';
import LanguagePicker from '../components/LanguagePicker.vue';
import TwoFactorSetup from '../components/TwoFactorSetup.vue';
import TailscaleGuide from '../components/TailscaleGuide.vue';
import { ref, reactive, computed, h } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { useThemeStore } from '../stores/theme';
import { useCustomizationStore } from '../stores/customization';
import api from '../api/client';
import { t, list, storedLanguageChoice } from '../i18n';
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

const STEP_KEYS = ['appearance', 'admin', 'media', 'libraries', 'household', 'access', 'review'];
const stepTitles = computed(() => STEP_KEYS.map((key) => t(`setup.steps.${key}`)));

// Labels are looked up as they're drawn, so switching language mid-wizard redraws them.
const themeOptions = computed(() => [
  { id: 'dark', icon: Moon, swatch: 'bg-zinc-900 text-zinc-100 border-zinc-700' },
  { id: 'light', icon: Sun, swatch: 'bg-zinc-100 text-zinc-900 border-zinc-300' }
].map((opt) => ({ ...opt, label: t(`setup.themes.${opt.id}.label`), hint: t(`setup.themes.${opt.id}.hint`) })));

const allMedia = computed(() => [
  { id: 'audiobook', icon: Headphones, formats: 'M4B, MP3, FLAC' },
  { id: 'manga', icon: Layers, formats: 'CBZ, CBR, PDF' },
  { id: 'book', icon: BookOpen, formats: 'EPUB, PDF' },
  { id: 'movie', icon: Film, formats: 'MP4, MKV' },
  { id: 'show', icon: Tv, formats: 'MP4, MKV' },
  { id: 'anime', icon: Sparkles, formats: 'MP4, MKV' }
].map((m) => ({ ...m, title: t(`setup.media.types.${m.id}.title`), desc: t(`setup.media.types.${m.id}.desc`) })));

const LIBRARY_TYPES = ['audiobooks', 'manga', 'books', 'shows', 'movies', 'anime'];

// Where the server can be used from. "home" and "tailscale" are the same server setting
// (Tailscale devices count as home); "tailscale" just adds the how-to.
const accessOptions = computed(() => [
  { id: 'home', badge: t('setup.access.options.home.badge'), icon: House },
  { id: 'tailscale', icon: Waypoints },
  { id: 'internet', icon: Globe }
].map((opt) => ({ ...opt, title: t(`setup.access.options.${opt.id}.title`), text: t(`setup.access.options.${opt.id}.text`) })));

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

function accessSummary() {
  if (form.access !== 'internet') return t(`setup.review.access.${form.access === 'tailscale' ? 'tailscale' : 'home'}`);
  const access = t(`setup.review.access.${form.internetVia === 'funnel' ? 'funnel' : 'domain'}`);
  return form.require2faOutside ? t('setup.review.access.withTwoFactor', { access }) : access;
}

const reviewRows = computed(() => [
  { label: t('setup.review.rows.serverName'), value: form.serverName },
  { label: t('setup.review.rows.adminUsername'), value: form.username },
  { label: t('setup.review.rows.themeAccent'), value: `${t(`setup.themes.${form.theme === 'dark' ? 'dark' : 'light'}.label`)} · ${optionLabel(ACCENT_OPTIONS, form.accentTheme)}` },
  { label: t('setup.review.rows.media'), value: list(allMedia.value.filter((m) => form.enabledMediaTypes.includes(m.id)).map((m) => m.title)) },
  { label: t('setup.review.rows.libraries'), value: t('setup.review.folders', { count: form.libraries.filter((l) => l.name.trim() && l.path.trim()).length }) },
  { label: t('setup.review.rows.otherAccounts'), value: String(form.extraUsers.filter((u) => u.username.trim() && u.password.length >= 8).length) },
  { label: t('setup.review.rows.parties'), value: form.partyModeEnabled ? t('common.on') : t('common.off') },
  { label: t('setup.review.rows.access'), value: accessSummary() }
]);

// The language picked during the wizard becomes the new admin's own. Best effort: it's
// already remembered on this device, and can be set again in Settings → Appearance.
async function saveLanguage() {
  const language = storedLanguageChoice();
  if (language === 'auto') return;
  try {
    const res = await api.patch('/users/preferences', { language });
    authStore.user = { ...authStore.user, preferences: res.data.preferences || { ...authStore.user?.preferences, language } };
    localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
  } catch (err) {
    console.error('Failed to save the language to the new account:', err);
  }
}

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
      error.value = t('setup.errors.usernameRequired');
      return;
    }
    if (!form.password || form.password.length < 8) {
      error.value = t('setup.errors.passwordLength');
      return;
    }
    if (form.password !== form.confirmPassword) {
      error.value = t('setup.errors.passwordMismatch');
      return;
    }
  }
  if (step.value === 3 && form.enabledMediaTypes.length === 0) {
    error.value = t('setup.errors.mediaRequired');
    return;
  }
  // The last step (Review) has its own "Complete Setup" button instead of Continue.
  if (step.value < STEP_KEYS.length) {
    step.value++;
    window.scrollTo({ top: 0 });
    if (step.value === STEP_KEYS.length) loadTlsStatus();
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
    await saveLanguage();
    await customizationStore.updateCustomization({
      serverName: form.serverName.trim(),
      accentTheme: form.accentTheme,
      partyModeEnabled: form.partyModeEnabled
    });
    finished.value = true;
    window.scrollTo({ top: 0 });
  } catch (err) {
    error.value = err.response?.data?.error || t('setup.errors.failed');
  } finally {
    loading.value = false;
  }
}
</script>
