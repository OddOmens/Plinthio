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
          <button aria-label="Series settings"
            v-if="canEdit"
            @click="toggleEditor"
            class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition flex-shrink-0"
            title="Series settings"
          >
            <Settings class="w-5 h-5" />
          </button>
          <button aria-label="Close"
            @click="$emit('close')"
            class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition flex-shrink-0"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Series settings: reading direction and age rating apply to every volume, so
             they live here rather than in the reader's per-session controls. -->
        <div v-if="editorOpen" class="px-4 py-3 border-b border-border space-y-3 bg-muted/30">
          <div>
            <label class="text-xs font-semibold text-muted-foreground">Series name</label>
            <input
              v-model="form.titleOverride"
              type="text"
              :placeholder="series.name"
              class="mt-1 w-full h-9 px-3 rounded-lg bg-background border border-border text-sm text-foreground"
            />
          </div>

          <div>
            <label class="text-xs font-semibold text-muted-foreground">Reading direction</label>
            <div class="mt-1 flex gap-1.5">
              <button
                v-for="dir in readingDirections"
                :key="dir.id"
                @click="form.readingDirection = dir.id"
                :class="[
                  'flex-1 h-9 rounded-lg text-xs font-medium border transition',
                  form.readingDirection === dir.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-muted'
                ]"
              >
                {{ dir.label }}
              </button>
            </div>
          </div>

          <div>
            <label class="text-xs font-semibold text-muted-foreground">Age rating</label>
            <select
              v-model="form.ageRating"
              class="mt-1 w-full h-9 px-2 rounded-lg bg-background border border-border text-sm text-foreground"
            >
              <option :value="null">Not set</option>
              <option v-for="rating in ageRatings" :key="rating" :value="rating">{{ rating }}</option>
            </select>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              @click="saveSettings"
              :disabled="saving"
              class="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60 transition"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
            <button
              @click="editorOpen = false"
              class="h-9 px-4 rounded-lg border border-border text-sm text-foreground hover:bg-muted transition"
            >
              Cancel
            </button>
          </div>
          <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
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
import { ref, reactive, computed, watch } from 'vue';
import { X, Book, BookOpen, Play, BookCheck, Settings } from 'lucide-vue-next';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { coverUrl as buildCoverUrl } from '../utils/cover';

const props = defineProps({
  isOpen: Boolean,
  series: {
    type: Object,
    default: () => ({ name: '', author: null, volumes: [] })
  }
});

const emit = defineEmits(['close', 'open-volume', 'updated']);

const auth = useAuthStore();
const canEdit = computed(() => auth.isEditor);

const readingDirections = [
  { id: 'rtl', label: 'RTL' },
  { id: 'ltr', label: 'LTR' },
  { id: 'webtoon', label: 'Webtoon' }
];
const ageRatings = ['Everyone', 'Teen', 'Mature', 'Explicit'];

const editorOpen = ref(false);
const saving = ref(false);
const saveError = ref('');
const form = reactive({ titleOverride: '', readingDirection: null, ageRating: null });

// Settings are keyed by (library, series name), so they're only addressable once we know
// which library the volumes came from.
const libraryId = computed(() => props.series.volumes?.[0]?.library_id || null);

async function toggleEditor() {
  editorOpen.value = !editorOpen.value;
  if (!editorOpen.value) return;

  saveError.value = '';
  if (!libraryId.value) return;

  try {
    const res = await api.get(`/series/${libraryId.value}/${encodeURIComponent(props.series.name)}/settings`);
    const settings = res.data?.settings || {};
    form.titleOverride = settings.titleOverride || '';
    form.readingDirection = settings.readingDirection || null;
    form.ageRating = settings.ageRating || null;
  } catch (err) {
    saveError.value = 'Could not load current settings.';
  }
}

async function saveSettings() {
  if (!libraryId.value) {
    saveError.value = 'This series has no library to save against.';
    return;
  }

  saving.value = true;
  saveError.value = '';
  try {
    await api.put(`/series/${libraryId.value}/${encodeURIComponent(props.series.name)}/settings`, {
      readingDirection: form.readingDirection,
      ageRating: form.ageRating,
      titleOverride: form.titleOverride?.trim() || null
    });
    editorOpen.value = false;
    emit('updated');
  } catch (err) {
    saveError.value = err.response?.data?.error || 'Could not save settings.';
  } finally {
    saving.value = false;
  }
}

// Reopening the sheet on a different series shouldn't show the previous one's form.
watch(() => props.series?.name, () => {
  editorOpen.value = false;
});

function coverUrl(vol) {
  if (vol.cover_path) return buildCoverUrl(vol, { width: 360 });
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
