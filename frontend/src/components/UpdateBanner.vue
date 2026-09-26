<template>
  <div
    v-if="visible"
    role="status"
    class="relative z-[45] bg-primary text-primary-foreground pt-[env(safe-area-inset-top)]"
  >
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm">
      <Sparkles class="w-4 h-4 flex-shrink-0" />
      <p class="flex-1 min-w-[12rem]">
        <strong>Plinthio {{ status.latest }}</strong> is available
        <span class="opacity-80">— you're on {{ status.current }}.</span>
      </p>
      <div class="flex items-center gap-1.5">
        <a
          v-if="status.releaseUrl"
          :href="status.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="h-8 px-3 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 font-medium flex items-center gap-1 transition"
        >
          What's new
          <ExternalLink class="w-3.5 h-3.5" />
        </a>
        <button
          type="button"
          @click="showHow = !showHow"
          :aria-expanded="String(showHow)"
          class="h-8 px-3 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 font-medium transition"
        >
          How to update
        </button>
        <button
          type="button"
          @click="dismiss"
          class="h-8 w-8 rounded-lg hover:bg-primary-foreground/20 flex items-center justify-center transition"
          :aria-label="`Dismiss the ${status.latest} update notice`"
          title="Dismiss until the next version"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div v-if="showHow" class="basis-full min-w-0 w-full pb-1.5 flex flex-col gap-1.5">
        <p class="opacity-90">On the machine running Plinthio, in the folder with your <code>docker-compose.yml</code>:</p>
        <div class="flex items-center gap-2 max-w-full">
          <code class="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-black/25 px-3 py-2 font-mono text-xs">{{ UPDATE_COMMAND }}</code>
          <button
            type="button"
            @click="copyCommand"
            class="h-8 px-3 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 font-medium flex items-center gap-1.5 flex-shrink-0 transition"
          >
            <component :is="copied ? Check : Copy" class="w-3.5 h-3.5" />
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="opacity-80 text-[11px] sm:text-xs">
          Your database is backed up to <code>config/backups</code> automatically before the new version starts.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { Sparkles, X, ExternalLink, Copy, Check } from 'lucide-vue-next';

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';
// Local fallback so the banner stays dismissed even if saving the preference fails.
const LOCAL_KEY = 'plinthio_dismissed_update';

const authStore = useAuthStore();
const status = ref(null);
const showHow = ref(false);
const copied = ref(false);
const localDismissed = ref(readLocal());

function readLocal() {
  try { return localStorage.getItem(LOCAL_KEY) || ''; } catch (e) { return ''; }
}

// Dismissal is per version: hiding 1.1.0 doesn't hide 1.2.0 when that ships.
const dismissedVersion = computed(() =>
  authStore.user?.preferences?.dismissedUpdateVersion || localDismissed.value
);

const visible = computed(() =>
  authStore.isAdmin &&
  status.value?.updateAvailable &&
  status.value.latest &&
  dismissedVersion.value !== status.value.latest
);

async function load() {
  if (!authStore.isAdmin) return;
  try {
    const res = await api.get('/system/update');
    status.value = res.data;
  } catch (e) {
    // Offline or the check is disabled — just don't show anything.
  }
}

async function dismiss() {
  const version = status.value.latest;
  localDismissed.value = version;
  try { localStorage.setItem(LOCAL_KEY, version); } catch (e) { /* ignore */ }
  try {
    const res = await api.patch('/users/preferences', { dismissedUpdateVersion: version });
    if (authStore.user && res.data.preferences) {
      authStore.user = { ...authStore.user, preferences: res.data.preferences };
      localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
    }
  } catch (e) {
    // The local copy still keeps it hidden on this device.
  }
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(UPDATE_COMMAND);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch (e) {
    // Clipboard blocked (plain-HTTP origin) — the command is selectable text anyway.
  }
}

// Re-check when an admin signs in, and every few hours for tabs left open.
watch(() => authStore.isAdmin, (isAdmin) => { if (isAdmin) load(); }, { immediate: true });
const timer = setInterval(load, 6 * 60 * 60 * 1000);
onUnmounted(() => clearInterval(timer));

defineExpose({ load });
</script>
