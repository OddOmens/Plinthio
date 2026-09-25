<template>
  <div class="relative flex-shrink-0" ref="rootEl">
    <button
      @click="open = !open"
      :class="[
        showLabel
          ? 'h-10 pl-1.5 pr-2.5 rounded-xl flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/70'
          : 'w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center hover:ring-2 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/50',
        open && (showLabel ? 'bg-muted/70 text-foreground' : 'ring-2 ring-primary/50'),
        'active:scale-95 transition flex-shrink-0'
      ]"
      :title="`Account menu (${authStore.user?.username || ''})`"
      :aria-label="`Account menu for ${authStore.user?.username || 'user'}`"
    >
      <img
        v-if="authStore.user?.avatar && !avatarLoadFailed"
        :src="authStore.user.avatar"
        :alt="authStore.user?.username || 'Avatar'"
        class="w-8 h-8 rounded-full object-cover ring-1 ring-border shadow-xs flex-shrink-0"
        @error="avatarLoadFailed = true"
      />
      <div
        v-else
        class="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold uppercase flex-shrink-0 ring-1 ring-border/40 select-none"
      >
        {{ initials }}
      </div>
      <span v-if="showLabel" :class="labelClass" class="text-sm font-medium text-foreground max-w-[100px] truncate">
        {{ authStore.user?.username }}
      </span>
      <ChevronDown v-if="showLabel" class="w-4 h-4 transition-transform flex-shrink-0" :class="open ? 'rotate-180' : ''" />
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        :class="popoverClass"
        class="absolute z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-lg shadow-black/5 py-2 origin-top-right"
      >
        <div class="px-3.5 py-2.5 border-b border-border mb-1 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
            <img
              v-if="authStore.user?.avatar && !avatarLoadFailed"
              :src="authStore.user.avatar"
              :alt="authStore.user?.username"
              class="w-full h-full object-cover ring-1 ring-border"
              @error="avatarLoadFailed = true"
            />
            <div
              v-else
              class="w-full h-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold uppercase ring-1 ring-border/40 select-none"
            >
              {{ initials }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-foreground truncate">{{ authStore.user?.username }}</p>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs text-muted-foreground capitalize">{{ authStore.user?.role }}</span>
              <span
                v-if="expirationLabel"
                class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-medium"
                :title="`Account expires: ${new Date(authStore.user.expires_at).toLocaleString()}`"
              >
                {{ expirationLabel }}
              </span>
            </div>
          </div>
        </div>

        <button @click="go('/downloads')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <Download class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Downloads</span>
        </button>

        <button @click="go('/lists')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <ListOrdered class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Lists</span>
        </button>

        <button @click="go(authStore.isEditor && pendingRequests ? '/requests?scope=all' : '/requests')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <Inbox class="w-[18px] h-[18px] text-muted-foreground" />
          <span class="flex-1 text-left">Requests</span>
          <span v-if="authStore.isEditor && pendingRequests" class="min-w-[1.25rem] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {{ pendingRequests }}
          </span>
        </button>

        <button @click="go('/docs')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <HelpCircle class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Documents</span>
        </button>

        <button @click="go('/settings')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <Settings class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Settings</span>
        </button>

        <button v-if="authStore.isAdmin" @click="go('/admin')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <ShieldCheck class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Admin</span>
        </button>

        <div class="border-t border-border my-1"></div>

        <button @click.stop="themeStore.toggleTheme" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center justify-between">
          <span class="flex items-center gap-3">
            <Sun v-if="themeStore.isDark" class="w-[18px] h-[18px] text-muted-foreground" />
            <Moon v-else class="w-[18px] h-[18px] text-muted-foreground" />
            <span>{{ themeStore.isDark ? 'Light Mode' : 'Dark Mode' }}</span>
          </span>
        </button>

        <div class="border-t border-border my-1"></div>

        <button @click="logout" class="w-full h-11 px-3.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition flex items-center gap-3">
          <LogOut class="w-[18px] h-[18px]" />
          <span>Log out</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { ChevronDown, HelpCircle, ListOrdered, Settings, ShieldCheck, Sun, Moon, LogOut, Download, Inbox } from 'lucide-vue-next';
import api from '../api/client';

const props = defineProps({
  showLabel: { type: Boolean, default: true },
  labelClass: { type: String, default: 'hidden sm:inline' },
  // Where the popover should anchor relative to the trigger button
  placement: { type: String, default: 'bottom-end' } // 'bottom-end' | 'top-start'
});

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();

const open = ref(false);
const rootEl = ref(null);
const avatarLoadFailed = ref(false);

// Admins and editors see how many requests are waiting, refreshed each time the menu opens.
const pendingRequests = ref(0);
watch(open, async (isOpen) => {
  if (!isOpen || !authStore.isEditor) return;
  try {
    const res = await api.get('/requests/pending-count');
    pendingRequests.value = res.data.count || 0;
  } catch (e) {
    // Badge only — ignore.
  }
});

watch(() => authStore.user?.avatar, () => {
  avatarLoadFailed.value = false;
});

const initials = computed(() => {
  const name = authStore.user?.username || '?';
  return name.slice(0, 2);
});

const expirationLabel = computed(() => {
  const expiresAt = authStore.user?.expires_at;
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    return `${hours}h left`;
  }
  return `${days}d left`;
});

const popoverClass = computed(() => {
  return props.placement === 'top-start'
    ? 'bottom-full left-0 mb-2'
    : 'top-full right-0 mt-2';
});

function go(path) {
  open.value = false;
  router.push(path);
}

function logout() {
  open.value = false;
  authStore.logout();
}

function handleClickOutside(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => document.removeEventListener('click', handleClickOutside));
</script>
