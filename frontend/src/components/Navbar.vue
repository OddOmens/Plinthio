<template>
  <header class="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border safe-top transition-colors">
    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-[68px] flex items-center justify-between gap-4">
      <!-- Logo -->
      <router-link to="/" class="flex items-center gap-3 flex-shrink-0 group">
        <div class="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
          <BookOpen class="w-5 h-5" />
        </div>
        <span class="text-lg font-semibold tracking-tight text-foreground">
          {{ customizationStore.serverName || 'Plinthio' }}
        </span>
      </router-link>

      <!-- Center Media Type Filter Tabs (shadcn tabs style) -->
      <nav class="hidden md:flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border">
        <button
          v-for="tab in visibleMediaTabs"
          :key="tab.value"
          @click="$emit('filter-type', tab.value)"
          :class="[
            'h-9 px-3.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
            activeType === tab.value
              ? 'bg-background text-foreground shadow-sm font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          ]"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </nav>

      <!-- Right Section: Search, Theme Toggle, Profile/Preferences, Admin, Logout -->
      <div class="flex items-center gap-1 sm:gap-1.5">
        <!-- Desktop Search input -->
        <div class="relative hidden sm:block w-48 lg:w-64 mr-1">
          <Search class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            :value="searchQuery"
            @input="$emit('update:searchQuery', $event.target.value)"
            placeholder="Search library..."
            class="w-full h-10 bg-muted/50 border border-border rounded-xl pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-background transition"
          />
          <button aria-label="Clear search"
            v-if="searchQuery"
            @click="$emit('update:searchQuery', '')"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- User Account Menu (settings, docs, admin, theme, logout) -->
        <UserMenu placement="bottom-end" :show-label="true" />
      </div>
    </div>

    <!-- Mobile Search Bar (iOS Standard Height & Spacing) -->
    <div class="sm:hidden px-4 pt-0.5 pb-2.5">
      <div class="relative w-full flex items-center">
        <Search class="w-4 h-4 absolute left-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          :value="searchQuery"
          @input="$emit('update:searchQuery', $event.target.value)"
          placeholder="Search titles, authors, series..."
          class="w-full h-10 bg-muted/60 dark:bg-muted/30 border border-border/80 rounded-xl pl-10 pr-9 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-background transition shadow-xs"
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

    <!-- Mobile Category Pills (Horizontally Scrollable iOS Segmented Style) -->
    <div class="md:hidden px-4 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
      <button
        v-for="tab in visibleMediaTabs"
        :key="tab.value"
        @click="$emit('filter-type', tab.value)"
        :class="[
          'h-10 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 flex-shrink-0 active:scale-95',
          activeType === tab.value
            ? 'bg-foreground text-background font-semibold shadow-sm'
            : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted border border-border/50'
        ]"
      >
        <component :is="tab.icon" class="w-4 h-4" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
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
