<template>
  <!-- Backdrop -->
  <Teleport to="body">
    <Transition name="sheet-backdrop">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        @click="$emit('close')"
      />
    </Transition>

    <!-- Bottom Sheet -->
    <Transition name="sheet-slide">
      <div
        v-if="isOpen"
        class="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border rounded-t-2xl shadow-2xl flex flex-col"
        style="max-height: 85dvh"
      >
        <!-- Drag handle -->
        <div class="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div class="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <!-- Header -->
        <div class="flex items-start justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div class="flex-1 min-w-0 pr-3">
            <h2 class="text-base font-bold text-foreground truncate">{{ series.name }}</h2>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ series.volumes.length }} {{ series.volumes.length === 1 ? 'volume' : 'volumes' }}
              <span v-if="series.author" class="before:content-['·'] before:mx-1.5">{{ series.author }}</span>
            </p>
          </div>
          <button
            @click="$emit('close')"
            class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition flex-shrink-0"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Volume List -->
        <div class="overflow-y-auto flex-1 px-4 py-3 space-y-2 pb-safe">
          <button
            v-for="vol in series.volumes"
            :key="vol.id"
            @click="openVolume(vol)"
            class="w-full flex items-center gap-3.5 p-3 rounded-xl bg-card hover:bg-muted/60 border border-border hover:border-muted-foreground/30 transition active:scale-[0.98] text-left group"
          >
            <!-- Cover thumbnail -->
            <div class="relative w-12 h-[72px] rounded-lg overflow-hidden bg-muted flex-shrink-0 border border-border/60">
              <img
                :src="coverUrl(vol)"
                :alt="vol.title"
                loading="lazy"
                class="w-full h-full object-cover"
              />
              <!-- Finished checkmark overlay -->
              <div
                v-if="vol.is_finished"
                class="absolute inset-0 bg-black/40 flex items-center justify-center"
              >
                <BookCheck class="w-5 h-5 text-emerald-400" />
              </div>
            </div>

            <!-- Volume info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span
                  v-if="vol.volume != null"
                  class="text-[10px] font-mono font-bold bg-primary/10 text-primary rounded px-1.5 py-0.5 flex-shrink-0"
                >
                  Vol {{ vol.volume % 1 === 0 ? Math.trunc(vol.volume) : vol.volume }}
                </span>
                <span class="text-sm font-medium text-foreground truncate">{{ vol.title }}</span>
              </div>

              <p class="text-xs text-muted-foreground mt-0.5">
                <span v-if="vol.total_pages">{{ vol.total_pages }} pages</span>
                <span v-if="vol.is_finished" class="text-emerald-500 font-medium ml-1">· Finished</span>
                <span v-else-if="vol.current_page" class="ml-1">· Page {{ vol.current_page }}</span>
              </p>

              <!-- Progress bar -->
              <div v-if="hasProgress(vol)" class="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="vol.is_finished ? 'bg-emerald-500' : 'bg-primary'"
                  :style="{ width: `${vol.is_finished ? 100 : vol.progress_percent}%` }"
                />
              </div>
            </div>

            <!-- Read / Continue button -->
            <div class="flex-shrink-0">
              <div class="w-9 h-9 rounded-full bg-primary/10 group-hover:bg-primary text-primary group-hover:text-primary-foreground flex items-center justify-center transition">
                <Play v-if="vol.current_page && !vol.is_finished" class="w-4 h-4 fill-current" />
                <Book v-else-if="!vol.is_finished" class="w-4 h-4" />
                <BookOpen v-else class="w-4 h-4" />
              </div>
            </div>
          </button>

          <div v-if="series.volumes.length === 0" class="py-10 text-center text-sm text-muted-foreground">
            No volumes found in this series.
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { X, Book, BookOpen, Play, BookCheck } from 'lucide-vue-next';

const props = defineProps({
  isOpen: Boolean,
  series: {
    type: Object,
    default: () => ({ name: '', author: null, volumes: [] })
  }
});

const emit = defineEmits(['close', 'open-volume']);

function coverUrl(vol) {
  if (vol.cover_path) return `/api/media/cover/${vol.id}`;
  return `https://placehold.co/96x144/18181b/52525b?text=${encodeURIComponent(vol.title?.charAt(0) || '?')}`;
}

function hasProgress(vol) {
  return vol.progress_percent != null && vol.progress_percent > 0;
}

function openVolume(vol) {
  emit('open-volume', vol);
}
</script>

<style scoped>
.sheet-backdrop-enter-active,
.sheet-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.sheet-backdrop-enter-from,
.sheet-backdrop-leave-to {
  opacity: 0;
}

.sheet-slide-enter-active,
.sheet-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-slide-enter-from,
.sheet-slide-leave-to {
  transform: translateY(100%);
}

.pb-safe {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
</style>
