<template>
  <div class="login-root relative min-h-screen bg-background text-foreground overflow-hidden safe-top safe-bottom transition-colors">
    <!-- Backdrop: a few soft glows in the logo's colours drifting very slowly, with a faint
         grain. Decorative only: no API, nothing from the library. -->
    <div class="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
      <div class="aura aura-a"></div>
      <div class="aura aura-b"></div>
      <div class="aura aura-c"></div>
      <div class="absolute inset-0 grain"></div>
    </div>

    <div class="relative min-h-screen w-full max-w-md mx-auto px-4 sm:px-6 py-10 flex flex-col items-center justify-center gap-8">
      <!-- Welcome -->
      <div class="flex flex-col items-center text-center gap-4 login-in">
        <AppLogo class="w-20 h-20 sm:w-24 sm:h-24" />
        <div class="flex flex-col gap-2">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            {{ isSetup ? `Welcome to ${customizationStore.serverName || 'Plinthio'}` : 'Set up Plinthio' }}
          </h1>
          <p class="text-sm sm:text-base text-muted-foreground leading-relaxed">
            {{ isSetup
              ? 'Books, comics, audiobooks, movies and shows. All in one place, and right where you left off.'
              : 'Create the administrator account for this server. You can add libraries and invite people next.' }}
          </p>
        </div>
      </div>

      <!-- Sign-in card -->
      <div class="w-full bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-6 sm:p-7 shadow-2xl login-in login-in-late">
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

        <!-- Home-only server, opened from outside: nothing to sign in to from here -->
        <div v-else-if="isSetup && access && !access.allowed" class="flex flex-col items-center text-center py-2">
          <div class="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mb-3.5">
            <House class="w-6 h-6" />
          </div>
          <h2 class="text-base font-bold text-foreground">Available at home only</h2>
          <p class="text-sm text-muted-foreground mt-2 leading-relaxed">
            This server can only be used from its home network, and this device is connecting from outside it.
            Connect to your home Wi-Fi (or Tailscale, if you use it) and try again.
          </p>
        </div>

        <!-- Two-factor: the second step of signing in -->
        <form v-else-if="challenge" @submit.prevent="submitCode" class="flex flex-col gap-4">
          <div class="flex flex-col items-center text-center gap-2">
            <div class="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck class="w-6 h-6" />
            </div>
            <h2 class="text-base font-bold text-foreground">{{ useBackup ? 'Enter a backup code' : 'Enter your code' }}</h2>
            <p class="text-sm text-muted-foreground leading-relaxed">
              {{ useBackup
                ? 'One of the backup codes you saved when you turned on two-factor. Each works once.'
                : 'Open your authenticator app and enter the 6-digit code for this server.' }}
            </p>
          </div>

          <div v-if="error" class="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            <span>{{ error }}</span>
          </div>

          <input
            v-if="!useBackup"
            ref="codeInput"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9 ]*"
            maxlength="7"
            aria-label="Six-digit code"
            class="w-full h-14 bg-background/70 border border-border rounded-xl text-center text-2xl font-mono tracking-[0.4em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition"
            placeholder="000000"
            @input="autoSubmit"
          />
          <input
            v-else
            ref="codeInput"
            v-model="backupCode"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            aria-label="Backup code"
            class="w-full h-12 bg-background/70 border border-border rounded-xl text-center text-lg font-mono tracking-widest text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition"
            placeholder="xxxx-xxxx"
          />

          <button
            type="submit"
            :disabled="loading || (useBackup ? !backupCode.trim() : code.replace(/\s/g, '').length !== 6)"
            class="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg text-sm shadow-lg shadow-primary/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            <span>Verify</span>
          </button>
          <div class="flex items-center justify-between text-xs">
            <button type="button" @click="cancelChallenge" class="text-muted-foreground hover:text-foreground">Back</button>
            <button type="button" @click="toggleBackup" class="text-primary font-medium hover:underline">
              {{ useBackup ? 'Use the app instead' : 'Lost your phone? Use a backup code' }}
            </button>
          </div>
        </form>

        <!-- Regular Login Form -->
        <template v-else>
          <!-- The admin's notice (Admin → Server Config → Server Branding), read before signing in -->
          <div
            v-if="isSetup && customizationStore.loginMessage"
            class="mb-5 flex items-start gap-2.5 p-3 rounded-xl bg-primary/10 border border-primary/20 text-sm text-foreground leading-relaxed"
          >
            <Megaphone class="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <p class="whitespace-pre-line">{{ customizationStore.loginMessage }}</p>
          </div>
          <p v-if="!isSetup" class="mb-4 text-xs text-muted-foreground">Password needs at least 8 characters.</p>

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
import { ref, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import { AlertCircle, Loader2, Lock, User, KeyRound, Eye, EyeOff, ArrowRight, Megaphone, House, ShieldCheck } from '@lucide/vue';

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

// Whether this device may sign in from where it is (GET /api/auth/access): a home-only
// server opened from outside shows a note instead of a form that could only fail.
const access = ref(null);

// Two-factor: the challenge from the password step, and the code or backup code for it.
const challenge = ref('');
const code = ref('');
const backupCode = ref('');
const useBackup = ref(false);
const codeInput = ref(null);

onMounted(async () => {
  isSetup.value = await authStore.checkSetupStatus();
  try {
    access.value = (await api.get('/auth/access')).data;
  } catch (e) {
    // An older server, or offline: just show the form.
  }
});

function resetExpired() {
  isExpired.value = false;
  error.value = '';
  password.value = '';
}

function goOn() {
  // Only an in-app path ("/party/K7Q2"), never another site.
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
  router.push(/^\/(?!\/)/.test(redirect) ? redirect : '/');
}

async function handleSubmit() {
  error.value = '';
  isExpired.value = false;
  loading.value = true;
  try {
    if (!isSetup.value) {
      await authStore.setup(username.value, password.value);
      return goOn();
    }
    const result = await authStore.login(username.value, password.value);
    if (result.twoFactorRequired) {
      challenge.value = result.challenge;
      code.value = '';
      backupCode.value = '';
      useBackup.value = false;
      await nextTick();
      codeInput.value?.focus();
      return;
    }
    goOn();
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

async function submitCode() {
  if (loading.value) return;
  error.value = '';
  loading.value = true;
  try {
    await authStore.loginTwoFactor(challenge.value, useBackup.value
      ? { recoveryCode: backupCode.value.trim() }
      : { code: code.value.replace(/\s/g, '') });
    goOn();
  } catch (err) {
    const data = err.response?.data || {};
    // The challenge ran out (time, or tries): back to the password.
    if (data.code === 'P113') {
      cancelChallenge();
      error.value = data.error || 'That took too long. Sign in again.';
    } else {
      error.value = data.error || 'That code did not work';
      code.value = '';
      await nextTick();
      codeInput.value?.focus();
    }
  } finally {
    loading.value = false;
  }
}

// Six digits typed (or filled in by the phone): go.
function autoSubmit() {
  if (code.value.replace(/\s/g, '').length === 6) submitCode();
}

async function toggleBackup() {
  useBackup.value = !useBackup.value;
  error.value = '';
  await nextTick();
  codeInput.value?.focus();
}

function cancelChallenge() {
  challenge.value = '';
  password.value = '';
  code.value = '';
  backupCode.value = '';
  useBackup.value = false;
}
</script>

<style scoped>
/* Three large, heavily blurred glows in the logo's steel blue and a violet, drifting over a
   minute or so. Stronger in dark mode, where they read as light; softer in light mode. */
.aura {
  position: absolute;
  border-radius: 9999px;
  filter: blur(100px);
  will-change: transform;
}
.aura-a {
  width: 55vmax; height: 55vmax; top: -18vmax; left: -12vmax;
  background: hsl(213 60% 62% / 0.35);
  animation: drift-a 60s ease-in-out infinite alternate;
}
.aura-b {
  width: 45vmax; height: 45vmax; bottom: -20vmax; right: -10vmax;
  background: hsl(255 55% 64% / 0.28);
  animation: drift-b 75s ease-in-out infinite alternate;
}
.aura-c {
  width: 30vmax; height: 30vmax; top: 35%; left: 45%;
  background: hsl(195 55% 60% / 0.18);
  animation: drift-c 90s ease-in-out infinite alternate;
}
.dark .aura-a { background: hsl(213 55% 45% / 0.35); }
.dark .aura-b { background: hsl(255 45% 45% / 0.30); }
.dark .aura-c { background: hsl(195 50% 40% / 0.20); }

/* Fine film grain so the gradients don't band. */
.grain {
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.dark .grain { opacity: 0.07; }

.login-in { animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.login-in-late { animation-delay: 0.12s; }

@keyframes drift-a { to { transform: translate(10vmax, 8vmax) scale(1.1); } }
@keyframes drift-b { to { transform: translate(-12vmax, -6vmax) scale(0.9); } }
@keyframes drift-c { to { transform: translate(-18vmax, 10vmax) scale(1.2); } }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .aura, .login-in { animation: none; }
}
</style>
