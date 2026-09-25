<template>
  <div v-if="player.currentItem" class="fixed bottom-0 inset-x-0 z-50 transition-all safe-bottom">
    <div class="mx-auto max-w-4xl px-3 sm:px-6 pb-3">
      <div class="bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-2xl p-3 flex flex-col gap-2 transition-colors">
        <!-- Top Track Info & Controls Row -->
        <div class="flex items-center justify-between gap-3">
          <!-- Left: Cover & Title (Click to open Fullscreen Now Playing) -->
          <div @click="showNowPlaying = true" class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group" title="Open Now Playing">
            <div class="w-11 h-11 rounded-lg overflow-hidden bg-muted flex-shrink-0 border border-border group-hover:ring-2 ring-primary/40 transition">
              <img :src="coverUrl" :alt="`Cover of ${player.currentItem.title}`" class="w-full h-full object-cover" />
            </div>
            <div class="min-w-0">
              <h4 class="text-xs sm:text-sm font-semibold text-foreground truncate group-hover:text-primary transition">
                {{ player.currentItem.title }}
              </h4>
              <p class="text-[11px] text-muted-foreground truncate">
                {{ player.currentItem.author || 'Unknown Author' }}
              </p>
            </div>
          </div>

          <!-- Center Controls -->
          <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <button aria-label="Skip back 15s"
              @click="player.skip(-15)"
              class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition active:scale-95"
              title="Skip back 15s"
            >
              <RotateCcw class="w-4 h-4" />
            </button>

            <button :aria-label="player.isPlaying ? 'Pause' : 'Play'"
              @click="player.togglePlay"
              class="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md active:scale-95 transition"
            >
              <Pause v-if="player.isPlaying" class="w-4 h-4 fill-current" />
              <Play v-else class="w-4 h-4 fill-current ml-0.5" />
            </button>

            <button aria-label="Skip forward 15s"
              @click="player.skip(15)"
              class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition active:scale-95"
              title="Skip forward 15s"
            >
              <RotateCw class="w-4 h-4" />
            </button>
          </div>

          <!-- Mobile Close Button -->
          <button aria-label="Close player"
            @click="player.stop()"
            class="sm:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition active:scale-95 flex-shrink-0"
            title="Close player"
          >
            <X class="w-4 h-4" />
          </button>

          <!-- Right Controls: Speed, Sleep, Expand, Close -->
          <div class="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <button aria-label="Fullscreen Now Playing"
              @click="showNowPlaying = true"
              class="p-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs transition flex items-center gap-1 border border-border"
              title="Fullscreen Now Playing"
            >
              <Maximize2 class="w-3.5 h-3.5" />
            </button>

            <button
              @click="cycleSpeed"
              class="px-2 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-mono font-medium border border-border transition"
              title="Playback speed"
            >
              {{ player.playbackRate }}x
            </button>

            <button
              @click="cycleSleepTimer"
              :class="[
                'p-2 rounded-md border text-xs transition flex items-center gap-1',
                player.sleepTimerMinutes
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border-border'
              ]"
              :title="player.sleepTimerMinutes ? sleepLabel : 'Sleep timer'"
            >
              <Moon class="w-3.5 h-3.5" />
              <span v-if="player.sleepTimerMinutes" class="text-[10px] font-bold font-mono tabular-nums">
                {{ sleepLabel }}
              </span>
            </button>

            <button aria-label="Close player"
              @click="player.stop()"
              class="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition"
              title="Close player"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Scrubber Bar & Timestamps -->
        <div class="flex items-center gap-2 px-1">
          <span class="text-[10px] text-muted-foreground tabular-nums font-mono w-10 text-right">
            {{ formatTime(player.currentTime) }}
          </span>
          <div class="relative flex-1 flex items-center h-4 cursor-pointer">
            <input
              type="range"
              min="0"
              :max="player.duration || 100"
              step="1"
              :value="player.currentTime"
              @input="onSeek"
              class="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
            />
          </div>
          <span class="text-[10px] text-muted-foreground tabular-nums font-mono w-10">
            {{ formatTime(player.duration) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Fullscreen Spotify/Apple Music Style Now Playing Modal -->
    <NowPlayingModal
      :isOpen="showNowPlaying"
      @close="showNowPlaying = false"
    />
  </div>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, computed } from 'vue';
import { usePlayerStore, PLAYBACK_SPEEDS } from '../stores/player';
import NowPlayingModal from './NowPlayingModal.vue';
import { Play, Pause, RotateCcw, RotateCw, Moon, X, Maximize2 } from 'lucide-vue-next';
import { coverUrl as buildCoverUrl } from '../utils/cover';

const player = usePlayerStore();
const token = getMediaToken() || '';
const showNowPlaying = ref(false);

const coverUrl = computed(() => {
  if (!player.currentItem) return '';
  return buildCoverUrl(player.currentItem, { width: 180 });
});

function onSeek(e) {
  player.seek(parseFloat(e.target.value));
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function cycleSpeed() {
  const currentIndex = PLAYBACK_SPEEDS.indexOf(player.playbackRate);
  const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
  player.setPlaybackRate(PLAYBACK_SPEEDS[nextIndex]);
}

function cycleSleepTimer() {
  const options = player.chapters.length ? [null, 'chapter', 15, 30, 45, 60] : [null, 15, 30, 45, 60];
  const currentIndex = options.indexOf(player.sleepTimerMinutes);
  const nextIndex = (currentIndex + 1) % options.length;
  player.setSleepTimer(options[nextIndex]);
}

const sleepLabel = computed(() => {
  if (player.sleepTimerMinutes === 'chapter') return 'Ch.';
  const secs = player.sleepRemaining;
  return secs >= 60 ? `${Math.ceil(secs / 60)}m` : `${secs}s`;
});
</script>
