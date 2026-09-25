<template>
  <div class="relative" ref="rootEl">
    <button
      @click="open = !open"
      class="h-11 pl-1.5 pr-2.5 rounded-xl flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition"
      :class="open && 'bg-muted/70 text-foreground'"
      title="Account menu"
    >
      <div class="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold uppercase flex-shrink-0">
        {{ initials }}
      </div>
      <span v-if="showLabel" :class="labelClass" class="text-sm font-medium text-foreground max-w-[100px] truncate">
        {{ authStore.user?.username }}
      </span>
      <ChevronDown class="w-4 h-4 transition-transform flex-shrink-0" :class="open ? 'rotate-180' : ''" />
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
        <div class="px-3.5 py-2.5 border-b border-border mb-1">
          <p class="text-sm font-semibold text-foreground truncate">{{ authStore.user?.username }}</p>
          <p class="text-xs text-muted-foreground capitalize">{{ authStore.user?.role }}</p>
        </div>

        <button @click="go('/read-lists')" class="w-full h-11 px-3.5 text-sm font-medium text-foreground hover:bg-muted/70 transition flex items-center gap-3">
          <ListOrdered class="w-[18px] h-[18px] text-muted-foreground" />
          <span>Read Lists</span>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { ChevronDown, HelpCircle, ListOrdered, Settings, ShieldCheck, Sun, Moon, LogOut } from 'lucide-vue-next';

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

const initials = computed(() => {
  const name = authStore.user?.username || '?';
  return name.slice(0, 2);
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
