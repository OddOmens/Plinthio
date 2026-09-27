<template>
  <!-- Desktop Sidebar -->
  <aside class="hidden md:flex md:flex-col w-64 flex-shrink-0 h-screen sticky top-0 border-r border-border bg-background/95 backdrop-blur-md transition-colors">
    <!-- Logo -->
    <router-link to="/" class="flex items-center gap-3 px-4 h-[68px] border-b border-border flex-shrink-0 group">
      <div class="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm flex-shrink-0">
        <BookOpen class="w-5 h-5" />
      </div>
      <span class="text-lg font-semibold tracking-tight text-foreground truncate">
        {{ customizationStore.serverName || 'Plinthio' }}
      </span>
    </router-link>

    <!-- Search -->
    <div class="p-3 border-b border-border">
      <div class="relative">
        <Search class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          :value="searchQuery"
          @input="$emit('update:searchQuery', $event.target.value)"
          placeholder="Search library..."
          class="w-full h-11 bg-muted/50 border border-border rounded-xl pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-background transition"
        />
        <button aria-label="Clear search"
          v-if="searchQuery"
          @click="$emit('update:searchQuery', '')"
          class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Media Type Nav (vertical) -->
    <nav class="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-1.5">
      <button
        v-for="tab in visibleMediaTabs"
        :key="tab.value"
        @click="$emit('filter-type', tab.value)"
        :class="[
          'h-11 px-3.5 rounded-xl text-sm font-medium transition-all flex items-center gap-3 text-left',
          activeType === tab.value
            ? 'bg-muted text-foreground shadow-sm font-semibold'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        ]"
      >
        <component :is="tab.icon" class="w-5 h-5 flex-shrink-0" />
        <span class="truncate">{{ tab.label }}</span>
      </button>
    </nav>

    <!-- Account -->
    <div class="p-3 border-t border-border flex-shrink-0">
      <UserMenu placement="top-start" :show-label="true" label-class="inline" />
    </div>
  </aside>

  <!-- Mobile Top Bar + Drawer -->
  <header class="md:hidden sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border safe-top transition-colors">
    <div class="px-4 h-[56px] sm:h-[60px] flex items-center justify-between gap-3">
      <button aria-label="Open menu"
        @click="mobileOpen = true"
        class="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition flex-shrink-0"
        title="Open menu"
      >
        <Menu class="w-5 h-5 sm:w-6 sm:h-6" />
      </button>

      <router-link to="/" class="flex items-center gap-2.5 flex-1 min-w-0 justify-center group">
        <div class="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm flex-shrink-0">
          <BookOpen class="w-4 h-4" />
        </div>
        <span class="text-base font-semibold tracking-tight text-foreground truncate">
          {{ customizationStore.serverName || 'Plinthio' }}
        </span>
      </router-link>

      <UserMenu placement="bottom-end" :show-label="false" />
    </div>

    <!-- Mobile Search Bar -->
    <div class="px-4 pt-0.5 pb-2">
      <div class="relative w-full flex items-center">
        <Search class="w-4 h-4 absolute left-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          :value="searchQuery"
          @input="$emit('update:searchQuery', $event.target.value)"
          placeholder="Search titles, authors, series..."
          class="w-full h-9.5 bg-muted/60 dark:bg-muted/30 border border-border/80 rounded-xl pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-background transition shadow-xs"
        />
        <button aria-label="Clear search"
          v-if="searchQuery"
          @click="$emit('update:searchQuery', '')"
          type="button"
          class="absolute right-2.5 w-6 h-6 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
          title="Clear search"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Mobile Category Pills -->
    <div class="px-4 pb-2.5 sm:pb-2 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
      <button
        v-for="tab in visibleMediaTabs"
        :key="tab.value"
        @click="$emit('filter-type', tab.value)"
        :class="[
          'h-8.5 sm:h-9 px-3 sm:px-3.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 sm:gap-2 flex-shrink-0 active:scale-95',
          activeType === tab.value
            ? 'bg-foreground text-background font-semibold shadow-sm'
            : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted border border-border/50'
        ]"
      >
        <component :is="tab.icon" class="w-3.5 h-3.5" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
  </header>

  <!-- Mobile Drawer Overlay -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mobileOpen"
      class="md:hidden fixed inset-0 z-50 bg-black/50"
      @click="mobileOpen = false"
    />
  </Transition>

  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="-translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="-translate-x-full"
  >
    <aside
      v-if="mobileOpen"
      class="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-background border-r border-border flex flex-col safe-top safe-bottom"
    >
      <div class="flex items-center justify-between px-4 h-[56px] sm:h-[60px] border-b border-border flex-shrink-0">
        <router-link to="/" @click="mobileOpen = false" class="flex items-center gap-2.5 group">
          <div class="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <BookOpen class="w-4 h-4" />
          </div>
          <span class="text-base font-semibold tracking-tight text-foreground truncate">
            {{ customizationStore.serverName || 'Plinthio' }}
          </span>
        </router-link>
        <button aria-label="Close menu"
          @click="mobileOpen = false"
          class="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <nav class="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-1.5">
        <button
          v-for="tab in visibleMediaTabs"
          :key="tab.value"
          @click="$emit('filter-type', tab.value); mobileOpen = false"
          :class="[
            'h-12 px-3.5 rounded-xl text-base font-medium transition-all flex items-center gap-3 text-left',
            activeType === tab.value
              ? 'bg-muted text-foreground shadow-sm font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          ]"
        >
          <component :is="tab.icon" class="w-5 h-5 flex-shrink-0" />
          <span class="truncate">{{ tab.label }}</span>
        </button>
      </nav>

      <div class="p-3 border-t border-border flex-shrink-0">
        <UserMenu placement="top-start" :show-label="true" label-class="inline" />
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { useCustomizationStore } from '../stores/customization';
import UserMenu from './UserMenu.vue';
import {
  BookOpen,
  Headphones,
  FileImage,
  Book,
  Search,
  Layers,
  X,
  Menu,
  Tv,
  Film,
  Sparkles
} from 'lucide-vue-next';

defineProps({
  activeType: { type: String, default: 'all' },
  searchQuery: { type: String, default: '' }
});

defineEmits(['filter-type', 'update:searchQuery', 'open-preferences']);

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();

const mobileOpen = ref(false);

const allTabs = [
  { label: 'All', value: 'all', icon: Layers },
  { label: 'Audiobooks', value: 'audiobook', icon: Headphones },
  { label: 'Manga', value: 'manga', icon: FileImage },
  { label: 'Books', value: 'book', icon: Book },
  { label: 'Shows', value: 'show', icon: Tv },
  { label: 'Movies', value: 'movie', icon: Film },
  { label: 'Anime', value: 'anime', icon: Sparkles }
];

const visibleMediaTabs = computed(() => {
  const enabled = authStore.user?.preferences?.enabledMediaTypes || ALL_MEDIA_TYPES;
  return allTabs.filter(tab => tab.value === 'all' || enabled.includes(tab.value));
});
</script>

<style scoped>
.safe-top {
  padding-top: max(0rem, env(safe-area-inset-top));
}
</style>
