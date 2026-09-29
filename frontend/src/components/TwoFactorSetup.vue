<template>
  <!-- Two-factor sign-in for your own account: turn it on (scan, confirm a code, save the
       backup codes), or manage it once it's on. Used in Settings → Security and onboarding. -->
  <div class="flex flex-col gap-4">
    <p v-if="loading" class="text-sm text-muted-foreground">Checking…</p>

    <!-- Off -->
    <template v-else-if="stage === 'off'">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center flex-shrink-0">
          <ShieldOff class="w-5 h-5" />
        </div>
        <div class="text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium">Two-factor is off</p>
          <p>
            Optional. When it's on, signing in also asks for a 6-digit code from an app on your phone (Google Authenticator,
            Microsoft Authenticator, 1Password, Bitwarden, Aegis…), so a password alone isn't enough.
          </p>
        </div>
      </div>
      <button type="button" @click="start" :disabled="busy" class="self-start h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
        <Loader2 v-if="busy" class="w-4 h-4 animate-spin" />
        <ShieldCheck v-else class="w-4 h-4" />
        Turn on two-factor
      </button>
    </template>

    <!-- 1. Scan, 2. confirm -->
    <template v-else-if="stage === 'scan'">
      <ol class="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
        <li>Open your authenticator app and add an account (usually a <strong class="text-foreground">+</strong> button).</li>
        <li>Scan this code. On this phone? Tap <strong class="text-foreground">Copy key</strong> and paste it into the app instead.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div class="flex flex-col sm:flex-row items-center sm:items-start gap-4">
        <img v-if="qr" :src="qr" alt="QR code for your authenticator app" class="w-44 h-44 rounded-xl bg-white p-2 border border-border" />
        <div class="flex-1 min-w-0 flex flex-col gap-2 w-full">
          <p class="text-xs text-muted-foreground">Key, for typing in by hand:</p>
          <code class="block text-sm font-mono text-foreground bg-muted px-3 py-2 rounded-lg break-all tracking-wider">{{ groupedSecret }}</code>
          <button type="button" @click="copy(setup.secret, 'key')" class="self-start h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted flex items-center gap-1.5">
            <Copy class="w-3.5 h-3.5" /> {{ copied === 'key' ? 'Copied' : 'Copy key' }}
          </button>
        </div>
      </div>
      <form @submit.prevent="confirm" class="flex items-center gap-2">
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          aria-label="Six-digit code"
          placeholder="000000"
          class="w-36 h-11 px-3 rounded-xl bg-background border border-border text-center text-lg font-mono tracking-widest text-foreground"
        />
        <button type="submit" :disabled="busy || code.replace(/\s/g, '').length !== 6" class="h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
          Confirm
        </button>
        <button type="button" @click="stage = 'off'" class="h-11 px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground">Cancel</button>
      </form>
    </template>

    <!-- 3. Backup codes, shown once -->
    <template v-else-if="stage === 'codes'">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center flex-shrink-0">
          <ShieldCheck class="w-5 h-5" />
        </div>
        <div class="text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium">Two-factor is on. Save your backup codes.</p>
          <p>If you lose your phone, each of these signs you in once. They won't be shown again. Keep them somewhere safe, like a password manager.</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 p-3 rounded-xl bg-muted/50 border border-border font-mono text-sm text-foreground">
        <span v-for="c in recoveryCodes" :key="c" class="text-center">{{ c }}</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" @click="download" class="h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted flex items-center gap-1.5">
          <Download class="w-4 h-4" /> Download
        </button>
        <button type="button" @click="copy(recoveryCodes.join('\n'), 'codes')" class="h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted flex items-center gap-1.5">
          <Copy class="w-4 h-4" /> {{ copied === 'codes' ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <label class="flex items-center gap-2 text-sm text-foreground select-none">
        <input v-model="saved" type="checkbox" class="rounded border-border text-primary" />
        I've saved these codes
      </label>
      <button type="button" @click="finish" :disabled="!saved" class="self-start h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
        Done
      </button>
    </template>

    <!-- On -->
    <template v-else-if="stage === 'on'">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center flex-shrink-0">
          <ShieldCheck class="w-5 h-5" />
        </div>
        <div class="text-sm text-muted-foreground leading-relaxed">
          <p class="text-foreground font-medium">Two-factor is on</p>
          <p>
            {{ status.recoveryCodesLeft }} of 10 backup codes left.
            <span v-if="status.recoveryCodesLeft <= 3" class="text-amber-600 dark:text-amber-400">Make new ones soon.</span>
          </p>
        </div>
      </div>

      <form v-if="action" @submit.prevent="runAction" class="flex flex-col gap-2 p-3 rounded-xl border border-border bg-muted/20">
        <p class="text-sm text-foreground font-medium">{{ action === 'disable' ? 'Turn off two-factor' : 'Make new backup codes' }}</p>
        <p class="text-xs text-muted-foreground">Confirm it's you: your password and a code from your app.</p>
        <input v-model="confirmPassword" type="password" autocomplete="current-password" placeholder="Password" class="h-10 px-3 rounded-lg bg-background border border-border text-sm text-foreground" />
        <input v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="6-digit code (or a backup code)" class="h-10 px-3 rounded-lg bg-background border border-border text-sm font-mono text-foreground" />
        <div class="flex gap-2">
          <button type="submit" :disabled="busy || !confirmPassword || !code.trim()" class="h-9 px-3 rounded-lg text-sm font-semibold disabled:opacity-50" :class="action === 'disable' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'">
            {{ action === 'disable' ? 'Turn off' : 'Make new codes' }}
          </button>
          <button type="button" @click="action = null" class="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </form>
      <div v-else class="flex flex-wrap gap-2">
        <button type="button" @click="openAction('codes')" class="h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted flex items-center gap-1.5">
          <RefreshCw class="w-4 h-4" /> New backup codes
        </button>
        <button type="button" @click="openAction('disable')" class="h-9 px-3 rounded-lg border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10">
          Turn off
        </button>
      </div>
    </template>

    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldOff, Copy, Download, Loader2, RefreshCw } from '@lucide/vue';
import api from '../api/client';
import { useCustomizationStore } from '../stores/customization';

const emit = defineEmits(['done']);
const customizationStore = useCustomizationStore();

const loading = ref(true);
const busy = ref(false);
const error = ref('');
const stage = ref('off'); // off | scan | codes | on
const status = ref({ enabled: false, recoveryCodesLeft: 0 });
const setup = ref({ secret: '', uri: '' });
const qr = ref('');
const code = ref('');
const recoveryCodes = ref([]);
const saved = ref(false);
const copied = ref('');
const action = ref(null); // disable | codes
const confirmPassword = ref('');

const groupedSecret = computed(() => (setup.value.secret.match(/.{1,4}/g) || []).join(' '));

async function load() {
  loading.value = true;
  try {
    status.value = (await api.get('/auth/2fa')).data;
    stage.value = status.value.enabled ? 'on' : 'off';
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not check two-factor';
  } finally {
    loading.value = false;
  }
}

async function start() {
  busy.value = true;
  error.value = '';
  try {
    setup.value = (await api.post('/auth/2fa/setup')).data;
    // Drawn here, from the otpauth link: the secret never goes to a QR service.
    qr.value = await QRCode.toDataURL(setup.value.uri, { margin: 1, width: 352, errorCorrectionLevel: 'M' });
    code.value = '';
    stage.value = 'scan';
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not start setting up two-factor';
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.post('/auth/2fa/enable', { code: code.value.replace(/\s/g, '') });
    status.value = res.data;
    recoveryCodes.value = res.data.recoveryCodes;
    saved.value = false;
    stage.value = 'codes';
  } catch (err) {
    error.value = err.response?.data?.error || 'That code did not work';
  } finally {
    busy.value = false;
    code.value = '';
  }
}

function openAction(which) {
  action.value = which;
  confirmPassword.value = '';
  code.value = '';
  error.value = '';
}

async function runAction() {
  busy.value = true;
  error.value = '';
  const answer = code.value.trim();
  const body = { password: confirmPassword.value, ...(/^\d[\d\s]{5,6}$/.test(answer) ? { code: answer.replace(/\s/g, '') } : { recoveryCode: answer }) };
  try {
    if (action.value === 'disable') {
      status.value = (await api.post('/auth/2fa/disable', body)).data;
      stage.value = 'off';
    } else {
      const res = await api.post('/auth/2fa/recovery-codes', body);
      status.value = res.data;
      recoveryCodes.value = res.data.recoveryCodes;
      saved.value = false;
      stage.value = 'codes';
    }
    action.value = null;
  } catch (err) {
    error.value = err.response?.data?.error || 'That did not work';
  } finally {
    busy.value = false;
    confirmPassword.value = '';
    code.value = '';
  }
}

async function copy(text, which) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = which;
    setTimeout(() => { if (copied.value === which) copied.value = ''; }, 2000);
  } catch (e) {
    error.value = 'Copying is blocked here. Select the text and copy it instead.';
  }
}

function download() {
  const name = customizationStore.serverName || 'Plinthio';
  const text = `${name} backup codes\nEach one signs you in once, instead of a code from your app.\n\n${recoveryCodes.value.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase()}-backup-codes.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function finish() {
  recoveryCodes.value = [];
  stage.value = 'on';
  emit('done');
}

onMounted(load);
</script>
