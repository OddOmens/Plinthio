<template>
  <!-- The opening sequence (Admin → Playback): a short clip played full-screen before a
       movie or episode starts. It can always be skipped, and anything that stops it playing
       (a network hiccup, a browser refusing to play it) goes straight to the title. -->
  <div
    class="fixed inset-0 z-[70] bg-black flex items-center justify-center"
    @click="finish"
    role="dialog"
    aria-label="Opening sequence"
  >
    <video
      ref="videoEl"
      :src="src"
      class="w-full h-full object-contain"
      playsinline
      preload="auto"
      @ended="finish"
      @error="finish"
    />
    <button
      type="button"
      @click.stop="finish"
      class="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] h-10 px-4 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur text-white text-sm font-semibold flex items-center gap-1.5 transition"
    >
      Skip <ChevronsRight class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ChevronsRight } from '@lucide/vue';
import { useCustomizationStore } from '../stores/customization';
import { getMediaToken } from '../utils/mediaToken';

const emit = defineEmits(['done']);
const customizationStore = useCustomizationStore();

const videoEl = ref(null);
const src = computed(() => {
  const params = new URLSearchParams({ v: customizationStore.introVersion || '1' });
  const token = getMediaToken();
  if (token) params.set('token', token);
  return `/api/media/intro?${params}`;
});

let finished = false;
let safety = null;
function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(safety);
  videoEl.value?.pause();
  emit('done');
}

function onKey(e) {
  if (['Escape', 'Enter', ' ', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    finish();
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  // Never hold anyone at the door: if it hasn't ended a few seconds after it should, move on.
  safety = setTimeout(finish, ((customizationStore.introDuration || 10) + 5) * 1000);
  try {
    await videoEl.value.play();
  } catch (e) {
    // A browser that won't autoplay with sound (Safari can be strict) may still play it muted.
    try {
      videoEl.value.muted = true;
      await videoEl.value.play();
    } catch (err) {
      finish();
    }
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  clearTimeout(safety);
});
</script>
