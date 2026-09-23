<template>
  <div
    class="fixed inset-0 z-50 bg-black flex flex-col select-none"
    @mousemove="revealControls"
    @touchstart="revealControls"
    @touchmove="revealControls"
  >
    <!-- Top bar — auto-hides during playback, like a normal video app -->
    <header
      :class="[
        'absolute top-0 inset-x-0 z-20 transition-opacity duration-300 bg-gradient-to-b from-black/85 to-transparent pt-safe px-4 pb-8 flex items-start gap-3',
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      ]"
    >
      <button
        @click="closePlayer"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
        title="Back to shelf"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>

      <div class="min-w-0 flex-1 pt-1.5">
        <h2 class="text-base font-semibold text-white truncate drop-shadow">{{ item.title }}</h2>
        <p v-if="subtitleLine" class="text-sm text-white/70 truncate drop-shadow">{{ subtitleLine }}</p>
      </div>
    </header>

    <!-- The video itself. Native controls give us fullscreen, PiP, AirPlay, captions and
         scrubbing for free, and behave correctly on iOS where custom controls often don't. -->
    <video
      ref="videoEl"
      :src="modeResolved ? streamUrl : undefined"
      class="w-full h-full bg-black"
      controls
      autoplay
      playsinline
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @pause="saveProgress()"
      @ended="onEnded"
      @error="onError"
    />

    <!-- Transcode mode: the stream is a live ffmpeg pipe with no seekbar of its own, so we
         provide one that restarts the encode at the chosen offset. -->
    <div
      v-if="isTranscoding && !errorMessage"
      :class="[
        'absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-safe',
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      ]"
    >
      <div class="flex items-center gap-3 text-white">
        <span class="text-xs font-mono tabular-nums w-16 text-right">{{ formatTime(virtualTime) }}</span>
        <input
          type="range"
          min="0"
          :max="totalDuration || 0"
          :value="virtualTime"
          step="1"
          @change="seekTo($event.target.valueAsNumber)"
          class="flex-1 accent-primary h-1.5 cursor-pointer"
        />
        <span class="text-xs font-mono tabular-nums w-16">{{ formatTime(totalDuration) }}</span>
      </div>
      <p class="text-[11px] text-white/50 mt-1.5 text-center">
        Converting on the fly — seeking restarts the stream at that point
      </p>
    </div>

    <!-- Preparing spinner while ffmpeg warms up -->
    <div
      v-if="preparing"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 pointer-events-none"
    >
      <Loader2 class="w-8 h-8 animate-spin text-white/80" />
      <p class="text-sm text-white/80">{{ preparingLabel }}</p>
    </div>

    <!-- Resume toast -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200"
      leave-to-class="opacity-0"
    >
      <div
        v-if="resumedFrom > 0 && showResumeToast"
        class="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-sm text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 border border-white/10"
      >
        <span>Resumed from {{ formatTime(resumedFrom) }}</span>
        <button
          @click="restartFromBeginning"
          class="text-primary font-semibold hover:underline whitespace-nowrap"
        >
          Start over
        </button>
      </div>
    </Transition>

    <!-- Up next (TV/anime) -->
    <div
      v-if="nextEpisode"
      class="absolute inset-0 z-30 flex items-center justify-center bg-black/85 backdrop-blur-sm px-6"
    >
      <div class="w-full max-w-sm bg-card border border-border rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</p>
          <h3 class="text-base font-bold text-foreground mt-1 leading-snug">{{ nextEpisode.title }}</h3>
          <p v-if="nextEpisode.series" class="text-sm text-muted-foreground mt-0.5">{{ nextEpisode.series }}</p>
        </div>

        <div class="flex items-center gap-2">
          <button
            @click="playNextEpisode"
            class="flex-1 h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition active:scale-95 flex items-center justify-center gap-2"
          >
            <Play class="w-4 h-4 fill-current" />
            Play now ({{ countdown }})
          </button>
          <button
            @click="cancelNextEpisode"
            class="h-11 px-4 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Playback error -->
    <div
      v-if="errorMessage"
      class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center"
    >
      <div class="w-12 h-12 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
        <AlertCircle class="w-6 h-6" />
      </div>
      <div>
        <h3 class="text-base font-semibold text-white">Can't play this video</h3>
        <p class="text-sm text-white/70 mt-1 max-w-md">{{ errorMessage }}</p>
      </div>
      <button
        @click="closePlayer"
        class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition"
      >
        Back to shelf
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import api from '../api/client';
import { useViewSession } from '../composables/useViewSession';
import { ArrowLeft, AlertCircle, Loader2, Play } from 'lucide-vue-next';

const viewSession = useViewSession();

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['close', 'play-next']);

const nextEpisode = ref(null);
const countdown = ref(0);
let countdownTimer = null;

const videoEl = ref(null);
const controlsVisible = ref(true);
const resumedFrom = ref(0);
const showResumeToast = ref(false);
const errorMessage = ref('');

// 'direct' plays the file as-is with native range seeking. 'transcode'/'remux' pipe through
// ffmpeg, which produces an unseekable live stream — hence the custom scrubber.
const playbackMode = ref('direct');
const transcodeStart = ref(0);
const totalDuration = ref(0);
const preparing = ref(true);
const videoTime = ref(0);
// The <video> src stays unset until the probe answers, so an HEVC file doesn't briefly
// start a direct stream (and trip the decode error) before we know it needs transcoding.
const modeResolved = ref(false);

let hideTimer = null;
let saveTimer = null;
let lastSavedTime = 0;

const token = localStorage.getItem('plinthio_token') || '';
const isTranscoding = computed(() => playbackMode.value !== 'direct');

const streamUrl = computed(() => {
  const base = `/api/media/video/${props.item.id}`;
  return isTranscoding.value
    ? `${base}/transcode?start=${Math.floor(transcodeStart.value)}&token=${token}`
    : `${base}/stream?token=${token}`;
});

// In transcode mode the element's own currentTime restarts at 0 on every seek, so the real
// position is the encode's start offset plus however far into this segment we are.
const virtualTime = computed(() =>
  isTranscoding.value ? transcodeStart.value + videoTime.value : videoTime.value
);

const preparingLabel = computed(() =>
  playbackMode.value === 'transcode' ? 'Converting for your browser…' : 'Preparing…'
);

// Episodes carry a series name and a season/episode-encoded volume; movies just have a year.
const subtitleLine = computed(() => {
  const parts = [];
  if (props.item.series && props.item.series !== props.item.title) parts.push(props.item.series);
  if (props.item.release_date) parts.push(props.item.release_date);
  return parts.join(' · ');
});

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function revealControls() {
  controlsVisible.value = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (videoEl.value && !videoEl.value.paused) controlsVisible.value = false;
  }, 3000);
}

function onLoadedMetadata() {
  const video = videoEl.value;
  if (!video) return;
  preparing.value = false;

  // A transcoded segment reports only its own remaining length, so the real total comes from
  // the probe/scan instead.
  if (!isTranscoding.value) {
    totalDuration.value = video.duration || props.item.duration || 0;
  }

  // Resume where they left off, but not if they were basically at the end — otherwise
  // reopening a finished item drops you on the closing credits with nothing left to watch.
  // Transcode mode resumes via the start offset instead, handled in start().
  if (isTranscoding.value) return;

  const saved = props.item.current_time || 0;
  const nearEnd = totalDuration.value > 0 && saved > 0 && saved / totalDuration.value >= 0.98;

  if (saved > 10 && !nearEnd) {
    video.currentTime = saved;
    resumedFrom.value = saved;
    showResumeToast.value = true;
    setTimeout(() => { showResumeToast.value = false; }, 6000);
  }
}

function onTimeUpdate() {
  const video = videoEl.value;
  if (!video) return;
  videoTime.value = video.currentTime;
  // Throttle: timeupdate fires ~4x/second, we only persist every 5s of playback.
  if (Math.abs(virtualTime.value - lastSavedTime) >= 5) {
    saveProgress();
  }
}

// Transcode seeking = restart ffmpeg at the new offset. The <video> element reloads, so this
// is a real (brief) buffer rather than an instant jump — unavoidable without HLS segmenting.
function seekTo(seconds) {
  const target = Math.max(0, Math.min(seconds, totalDuration.value || seconds));
  if (isTranscoding.value) {
    transcodeStart.value = target;
    videoTime.value = 0;
    preparing.value = true;
    // Changing streamUrl re-renders the src; load()+play() kicks it off immediately.
    requestAnimationFrame(() => {
      const video = videoEl.value;
      if (!video) return;
      video.load();
      video.play().catch(() => {});
    });
  } else if (videoEl.value) {
    videoEl.value.currentTime = target;
  }
  saveProgress();
}

function restartFromBeginning() {
  showResumeToast.value = false;
  seekTo(0);
}

async function saveProgress(isFinished = false) {
  const duration = totalDuration.value;
  if (!duration) return;

  lastSavedTime = virtualTime.value;
  try {
    await api.post(`/progress/${props.item.id}`, {
      currentTime: virtualTime.value,
      duration,
      ...(isFinished ? { isFinished: 1 } : {})
    });
  } catch (err) {
    console.warn('Failed to save video progress:', err.message);
  }
}

async function onEnded() {
  await saveProgress(true);
  await offerNextEpisode();
}

// Episodes carry a season/episode-encoded `volume`, so "next" is simply the next volume up
// within the same series. Movies have no series and are skipped.
async function offerNextEpisode() {
  if (!['show', 'anime'].includes(props.item.media_type) || !props.item.series) return;

  try {
    const res = await api.get('/items', { params: { series: props.item.series } });
    const siblings = (res.data.items || [])
      .filter((i) => i.volume != null)
      .sort((a, b) => a.volume - b.volume);

    const current = props.item.volume;
    const next = siblings.find((i) => i.volume > current);
    if (!next) return;

    nextEpisode.value = next;
    countdown.value = 10;
    countdownTimer = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) playNextEpisode();
    }, 1000);
  } catch (err) {
    console.warn('Could not look up the next episode:', err.message);
  }
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function playNextEpisode() {
  const next = nextEpisode.value;
  stopCountdown();
  nextEpisode.value = null;
  if (next) emit('play-next', next);
}

function cancelNextEpisode() {
  stopCountdown();
  nextEpisode.value = null;
}

function onError() {
  const video = videoEl.value;
  const code = video?.error?.code;

  // Safety net: if the probe said "direct" but the browser still can't decode it, fall back
  // to transcoding once rather than surfacing a dead end.
  if (code === 4 && !isTranscoding.value) {
    console.warn('Direct playback rejected by browser — falling back to transcode.');
    playbackMode.value = 'transcode';
    transcodeStart.value = virtualTime.value || props.item.current_time || 0;
    videoTime.value = 0;
    preparing.value = true;
    requestAnimationFrame(() => {
      const el = videoEl.value;
      if (!el) return;
      el.load();
      el.play().catch(() => {});
    });
    return;
  }

  preparing.value = false;
  errorMessage.value = isTranscoding.value
    ? 'Conversion failed on the server. Check the server logs — ffmpeg may be missing or the file may be corrupt.'
    : 'The video stream stopped unexpectedly. Check the server logs for details.';
}

async function start() {
  try {
    const res = await api.get(`/media/video/${props.item.id}/playback-info`);
    const info = res.data || {};
    totalDuration.value = info.itemDuration || info.duration || props.item.duration || 0;

    if (info.mode && info.mode !== 'direct') {
      playbackMode.value = info.mode;
      // Resume by starting the encode at the saved position rather than seeking afterwards.
      const saved = props.item.current_time || 0;
      const nearEnd = totalDuration.value > 0 && saved / totalDuration.value >= 0.98;
      if (saved > 10 && !nearEnd) {
        transcodeStart.value = saved;
        resumedFrom.value = saved;
        showResumeToast.value = true;
        setTimeout(() => { showResumeToast.value = false; }, 6000);
      }
    }
  } catch (err) {
    // Probe unavailable — just try a direct stream; onError still falls back to transcode.
    console.warn('Playback info unavailable, attempting direct stream:', err.message);
  } finally {
    modeResolved.value = true;
    requestAnimationFrame(() => videoEl.value?.play?.().catch(() => {}));
  }
}

function onKeyDown(e) {
  const video = videoEl.value;
  if (!video) return;
  if (e.key === 'Escape') { closePlayer(); return; }
  if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  // Route through seekTo so transcode mode restarts the encode instead of trying to seek
  // inside an unbuffered live pipe.
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(virtualTime.value + 10); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(virtualTime.value - 10); }
  revealControls();
}

function closePlayer() {
  saveProgress();
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  revealControls();
  start();
  // Backstop for the timeupdate throttle — covers a tab left paused mid-file.
  saveTimer = setInterval(() => saveProgress(), 15000);
  viewSession.open(props.item.id);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  if (hideTimer) clearTimeout(hideTimer);
  if (saveTimer) clearInterval(saveTimer);
  stopCountdown();
  viewSession.close();
});
</script>

<style scoped>
.pt-safe { padding-top: max(0.5rem, env(safe-area-inset-top)); }
.pb-safe { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
</style>
