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
      <button aria-label="Back to shelf"
        @click="closePlayer"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
        title="Back to shelf"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>

      <div class="min-w-0 flex-1 pt-1.5">
        <h2 class="text-base font-semibold text-white truncate drop-shadow">{{ item.title }}</h2>
        <p v-if="subtitleLine" class="text-sm text-white/70 truncate drop-shadow">{{ subtitleLine }}</p>
        <RatingBar :item="item" tone="dark" compact class="mt-1.5 drop-shadow" />
      </div>

      <button aria-label="Cast to TV"
        v-if="castAvailable"
        @click="startCast"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
        title="Cast to TV"
      >
        <Cast class="w-5 h-5" />
      </button>

      <button aria-label="AirPlay"
        v-if="airplayAvailable"
        @click="startAirplay"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
        title="AirPlay"
      >
        <MonitorSpeaker class="w-5 h-5" />
      </button>

      <button aria-label="Playback settings"
        @click="settingsOpen = !settingsOpen"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
        title="Playback settings"
      >
        <Settings class="w-5 h-5" />
      </button>
    </header>

    <!-- Quality / audio / subtitle picker -->
    <div
      v-if="settingsOpen"
      class="absolute top-20 right-4 z-30 w-60 rounded-xl bg-black/90 backdrop-blur border border-white/10 text-white p-3 space-y-3 max-h-[70vh] overflow-y-auto"
    >
      <div v-if="qualities.length > 1">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">Quality</p>
        <button
          @click="setQuality(-1)"
          :class="menuItemClass(selectedQuality === -1)"
        >
          Auto
        </button>
        <button
          v-for="(quality, index) in qualities"
          :key="quality.name"
          @click="setQuality(index)"
          :class="menuItemClass(selectedQuality === index)"
        >
          {{ quality.name }}
        </button>
      </div>

      <div v-if="audioTracks.length > 1">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">Audio</p>
        <button
          v-for="track in audioTracks"
          :key="track.index"
          @click="setAudioTrack(track.index)"
          :class="menuItemClass(selectedAudioTrack === track.index)"
        >
          {{ audioLabel(track) }}
        </button>
      </div>

      <div v-if="subtitles.length > 0">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">Subtitles</p>
        <button @click="setSubtitle(null)" :class="menuItemClass(selectedSubtitle === null)">
          Off
        </button>
        <button
          v-for="track in subtitles"
          :key="track.id"
          @click="setSubtitle(track.id)"
          :class="menuItemClass(selectedSubtitle === track.id)"
        >
          {{ subtitleLabel(track) }}
        </button>
      </div>

      <p v-if="qualities.length <= 1 && audioTracks.length <= 1 && subtitles.length === 0"
         class="text-xs text-white/60">
        No alternate tracks for this video.
      </p>
    </div>

    <!-- Skip intro / credits -->
    <button
      v-if="activeMarker"
      @click="skipMarker"
      class="absolute bottom-24 right-4 z-30 px-4 py-2.5 rounded-xl bg-white/90 hover:bg-white text-black text-sm font-semibold shadow-lg transition active:scale-95"
    >
      Skip {{ activeMarker.type === 'intro' ? 'Intro' : 'Credits' }}
    </button>

    <!-- Native controls give us fullscreen, PiP, AirPlay, captions and scrubbing for free,
         and behave correctly on iOS where custom controls often don't — so they stay on
         touch devices. On a mouse, they're swapped for the custom bar below, which is the
         only way to show a scrub preview (the native scrubber's geometry isn't addressable). -->
    <video
      ref="videoEl"
      class="w-full h-full bg-black"
      :controls="!useCustomScrubber"
      autoplay
      playsinline
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @play="isPlaying = true"
      @pause="isPlaying = false; saveProgress()"
      @ended="onEnded"
      @error="onError"
      @click="useCustomScrubber && togglePlay()"
    >
      <track
        v-if="activeSubtitleUrl"
        :key="activeSubtitleUrl"
        kind="subtitles"
        :src="activeSubtitleUrl"
        default
      />
    </video>

    <!-- Desktop control bar with scrub preview -->
    <div
      v-if="useCustomScrubber && !errorMessage"
      :class="[
        'absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-4',
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      ]"
    >
      <!-- Scrub preview thumbnail -->
      <div
        v-if="previewVisible && previewStyle"
        class="absolute bottom-20 rounded-lg overflow-hidden border border-white/20 shadow-2xl pointer-events-none"
        :style="{ left: `${previewLeft}px`, ...previewStyle }"
      />
      <p
        v-if="previewVisible"
        class="absolute bottom-16 text-[11px] font-mono text-white bg-black/80 px-1.5 py-0.5 rounded pointer-events-none"
        :style="{ left: `${previewLeft}px` }"
      >
        {{ formatTime(previewTime) }}
      </p>

      <div
        ref="scrubberEl"
        class="relative h-1.5 rounded-full bg-white/25 cursor-pointer group"
        @click="scrubTo"
        @mousemove="onScrubHover"
        @mouseleave="previewVisible = false"
      >
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-primary"
          :style="{ width: `${progressPercent}%` }"
        />
        <div
          class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"
          :style="{ left: `calc(${progressPercent}% - 6px)` }"
        />
      </div>

      <div class="flex items-center gap-3 mt-2.5 text-white">
        <button :aria-label="isPlaying ? 'Pause' : 'Play'" @click="togglePlay" class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition">
          <Pause v-if="isPlaying" class="w-5 h-5" />
          <Play v-else class="w-5 h-5 fill-current" />
        </button>
        <span class="text-xs font-mono tabular-nums">
          {{ formatTime(videoTime) }} / {{ formatTime(totalDuration) }}
        </span>
        <div class="flex-1" />
        <button aria-label="Toggle fullscreen" @click="toggleFullscreen" class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition">
          <Maximize class="w-5 h-5" />
        </button>
      </div>
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
import Hls from 'hls.js';
import api from '../api/client';
import { useViewSession } from '../composables/useViewSession';
import RatingBar from './RatingBar.vue';
import {
  ArrowLeft, AlertCircle, Loader2, Play, Pause, Maximize,
  Settings, Cast, MonitorSpeaker
} from 'lucide-vue-next';

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

// 'direct' plays the file as-is with native range seeking. 'remux'/'transcode' go out as HLS
// (see services/hls.js on the backend) — segmented, so the video element seeks normally
// instead of needing a custom restart-the-encode scrubber.
const playbackMode = ref('direct');
const totalDuration = ref(0);
const preparing = ref(true);
const videoTime = ref(0);
// The <video> element stays unattached until the probe answers, so an HEVC file doesn't
// briefly start a direct stream (and trip the decode error) before we know it needs HLS.
const modeResolved = ref(false);

let hideTimer = null;
let saveTimer = null;
let lastSavedTime = 0;
let hls = null;

const token = localStorage.getItem('plinthio_token') || '';
const isTranscoding = computed(() => playbackMode.value !== 'direct');

// Track menus
const settingsOpen = ref(false);
const qualities = ref([]);
const audioTracks = ref([]);
const subtitles = ref([]);
const selectedQuality = ref(-1); // -1 = let hls.js pick by bandwidth
const selectedAudioTrack = ref(0);
const selectedSubtitle = ref(null);

// Skip intro/credits
const markers = ref([]);

// Scrub preview
const scrubberEl = ref(null);
const trickplay = ref(null);
const previewVisible = ref(false);
const previewLeft = ref(0);
const previewTime = ref(0);
const isPlaying = ref(false);

// Native controls stay on touch devices, where they behave far better than anything custom.
const useCustomScrubber = window.matchMedia?.('(pointer: fine)').matches ?? true;

const isClientHevcSupported = () => {
  return typeof MediaSource !== 'undefined' &&
    (MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
     MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"'));
};

const streamUrl = computed(() => {
  const base = `/api/media/video/${props.item.id}`;
  const hevc = isClientHevcSupported() ? '&clientHevc=1' : '';
  return isTranscoding.value
    ? `${base}/hls/master.m3u8?audio=${selectedAudioTrack.value}&token=${token}${hevc}`
    : `${base}/stream?token=${token}`;
});

const activeSubtitleUrl = computed(() => selectedSubtitle.value
  ? `/api/media/video/${props.item.id}/subtitles/${selectedSubtitle.value}.vtt?token=${token}`
  : null);

const progressPercent = computed(() => totalDuration.value > 0
  ? Math.min(100, (videoTime.value / totalDuration.value) * 100)
  : 0);

// The marker covering the current position, if any — drives the skip button.
const activeMarker = computed(() => markers.value.find(
  (m) => videoTime.value >= m.startSeconds && videoTime.value < m.endSeconds
) || null);

const castReady = ref(!!window.cast?.framework);
const castAvailable = computed(() => castReady.value);
const airplayAvailable = computed(() => typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined');
function onCastReady() { castReady.value = true; }

function menuItemClass(active) {
  return [
    'w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition',
    active ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-white/10'
  ];
}

function audioLabel(track) {
  const parts = [track.language || `Track ${track.index + 1}`];
  if (track.title) parts.push(track.title);
  if (track.channels > 2) parts.push(`${track.channels}ch`);
  return parts.join(' · ');
}

function subtitleLabel(track) {
  const parts = [track.language || `Track ${track.index + 1}`];
  if (track.title) parts.push(track.title);
  if (track.forced) parts.push('forced');
  return parts.join(' · ');
}

// Quality is an hls.js level switch, so it applies without reloading or losing position.
// Safari's native HLS doesn't expose level selection to JS, hence the guard.
function setQuality(index) {
  selectedQuality.value = index;
  if (hls) hls.currentLevel = index;
  settingsOpen.value = false;
}

// Audio track selection changes which stream ffmpeg muxes, so it needs a new master
// playlist — position is restored afterwards so the switch isn't disruptive.
function setAudioTrack(index) {
  if (index === selectedAudioTrack.value) return;
  selectedAudioTrack.value = index;
  settingsOpen.value = false;

  const resumeAt = videoTime.value;
  preparing.value = true;
  attachStream();
  const video = videoEl.value;
  if (!video) return;
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = resumeAt;
    video.play().catch(() => {});
  }, { once: true });
}

function setSubtitle(trackId) {
  selectedSubtitle.value = trackId;
  settingsOpen.value = false;
}

function skipMarker() {
  const marker = activeMarker.value;
  if (marker) seekTo(marker.endSeconds);
}

function togglePlay() {
  const video = videoEl.value;
  if (!video) return;
  video.paused ? video.play().catch(() => {}) : video.pause();
}

function toggleFullscreen() {
  const container = videoEl.value?.parentElement;
  if (!document.fullscreenElement) container?.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}

function scrubTo(event) {
  const rect = scrubberEl.value?.getBoundingClientRect();
  if (!rect || !totalDuration.value) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seekTo(ratio * totalDuration.value);
}

// Positions the preview thumbnail by cropping the right tile out of the right sprite sheet,
// using CSS background offsets rather than slicing images client-side.
function onScrubHover(event) {
  const rect = scrubberEl.value?.getBoundingClientRect();
  if (!rect || !totalDuration.value) return;

  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  previewTime.value = ratio * totalDuration.value;
  previewLeft.value = Math.max(0, Math.min(rect.width - 160, event.clientX - rect.left - 80));
  previewVisible.value = !!trickplay.value;
}

const previewStyle = computed(() => {
  const index = trickplay.value;
  if (!index) return null;

  const tile = Math.min(index.tileCount - 1, Math.floor(previewTime.value / index.interval));
  const sheet = Math.floor(tile / (index.columns * index.rows));
  const withinSheet = tile % (index.columns * index.rows);
  const column = withinSheet % index.columns;
  const row = Math.floor(withinSheet / index.columns);

  return {
    width: `${index.tileWidth}px`,
    height: `${index.tileHeight}px`,
    backgroundImage: `url(/api/media/video/${props.item.id}/trickplay/sheet_${sheet}.jpg?token=${token})`,
    backgroundPosition: `-${column * index.tileWidth}px -${row * index.tileHeight}px`
  };
});

async function loadTrickplay() {
  try {
    const res = await api.get(`/media/video/${props.item.id}/trickplay/index.json`);
    // 202 means generation just started; previews simply stay off for this session.
    if (res.status === 200) trickplay.value = res.data;
  } catch (err) {
    // Previews are a nicety — never block playback on them.
  }
}

async function loadMarkers() {
  try {
    const res = await api.get(`/media/video/${props.item.id}/markers`);
    markers.value = res.data.markers || [];
  } catch (err) {
    markers.value = [];
  }
}

// The Cast receiver fetches the stream itself, so it needs an absolute URL carrying the
// token — it has no access to this browser's session. A direct-play file is handed over as
// its own container; anything else goes over as HLS, which Chromecast plays natively.
async function startCast() {
  if (!window.cast?.framework) return;

  const context = cast.framework.CastContext.getInstance();
  try {
    await context.requestSession();
    const session = context.getCurrentSession();
    if (!session) return;

    const absoluteUrl = new URL(streamUrl.value, window.location.origin).href;
    const contentType = isTranscoding.value ? 'application/vnd.apple.mpegurl' : 'video/mp4';

    const mediaInfo = new chrome.cast.media.MediaInfo(absoluteUrl, contentType);
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = props.item.title;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = videoTime.value;

    await session.loadMedia(request);
    videoEl.value?.pause();
  } catch (err) {
    console.warn('Cast failed:', err);
  }
}

function startAirplay() {
  videoEl.value?.webkitShowPlaybackTargetPicker?.();
}

const virtualTime = computed(() => videoTime.value);

const preparingLabel = computed(() => {
  if (playbackMode.value === 'transcode') return 'Converting for your browser…';
  if (playbackMode.value === 'remux') return 'Direct Streaming…';
  return 'Starting playback…';
});

// Attaches the resolved stream to the <video> element: hls.js for the remux/transcode path
// on browsers without native HLS (everything but Safari), native <video>.src everywhere else
// (direct-play files, and Safari's built-in HLS support).
function attachStream() {
  const video = videoEl.value;
  if (!video) return;
  teardownHls();

  if (isTranscoding.value && Hls.isSupported()) {
    hls = new Hls({
      // Generous buffer for LAN — plenty of bandwidth to fill it, and a bigger buffer
      // means scrubbing forward never hits a gap even mid-encode.
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      xhrSetup: (xhr) => {
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      console.error('[video] hls.js fatal error:', data.type, data.details);
      preparing.value = false;
      errorMessage.value = 'Conversion failed on the server. Check the server logs — ffmpeg may be missing or the file may be corrupt.';
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hls.currentLevel = selectedQuality.value;
    });
    hls.loadSource(streamUrl.value);
    hls.attachMedia(video);
  } else {
    // Either direct-play, or an HLS stream on a browser (Safari/iOS) that plays it natively.
    video.src = streamUrl.value;
  }
}

function teardownHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (props.item?.id) {
    api.post(`/media/video/${props.item.id}/hls/stop`).catch(() => {});
  }
}

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

  // A growing HLS event-playlist can under-report its own duration while ffmpeg is still
  // encoding, so the server-provided probe/scan duration is the reliable total.
  if (!isTranscoding.value) {
    totalDuration.value = video.duration || props.item.duration || 0;
  }

  // Resume where they left off, but not if they were basically at the end — otherwise
  // reopening a finished item drops you on the closing credits with nothing left to watch.
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

// HLS is segmented, so seeking (in either mode) is a normal currentTime jump — no more
// restarting the encode from a new offset.
function seekTo(seconds) {
  const target = Math.max(0, Math.min(seconds, totalDuration.value || seconds));
  if (videoEl.value) videoEl.value.currentTime = target;
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
  // to HLS transcoding once rather than surfacing a dead end.
  if (code === 4 && !isTranscoding.value) {
    console.warn('Direct playback rejected by browser — falling back to HLS transcode.');
    playbackMode.value = 'transcode';
    preparing.value = true;
    attachStream();
    return;
  }

  preparing.value = false;
  errorMessage.value = isTranscoding.value
    ? 'Conversion failed on the server. Check the server logs — ffmpeg may be missing or the file may be corrupt.'
    : 'The video stream stopped unexpectedly. Check the server logs for details.';
}

async function start() {
  try {
    // Probe whether this browser can decode HEVC. MediaSource.isTypeSupported is synchronous
    // and reliable: Vivaldi/Chrome ≥107, Edge, and Safari all return true; Firefox returns
    // false. The result is sent to the server so HEVC files can direct-play without transcoding.
    const clientHevc = (
      typeof MediaSource !== 'undefined' &&
      (MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
       MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"'))
    ) ? '1' : '0';

    const res = await api.get(`/media/video/${props.item.id}/playback-info`, {
      params: { clientHevc }
    });
    const info = res.data || {};
    totalDuration.value = info.itemDuration || info.duration || props.item.duration || 0;
    if (info.mode && info.mode !== 'direct') playbackMode.value = info.mode;

    qualities.value = info.qualities || [];
    audioTracks.value = info.audioTracks || [];
    subtitles.value = info.subtitles || [];

    // Default to a forced track if the file marks one (typically foreign-language signs).
    const forced = subtitles.value.find((track) => track.forced);
    if (forced) selectedSubtitle.value = forced.id;
  } catch (err) {
    // Probe unavailable — just try a direct stream; onError still falls back to HLS.
    console.warn('Playback info unavailable, attempting direct stream:', err.message);
  } finally {
    modeResolved.value = true;
    requestAnimationFrame(() => {
      attachStream();
      videoEl.value?.play?.().catch(() => {});
    });
  }
}

function onKeyDown(e) {
  const video = videoEl.value;
  if (!video) return;
  if (e.key === 'Escape') { closePlayer(); return; }
  if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(virtualTime.value + 10); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(virtualTime.value - 10); }
  revealControls();
}

function closePlayer() {
  saveProgress();
  emit('close');
}

function onBeforeUnload() {
  if (props.item?.id && token) {
    navigator.sendBeacon?.(`/api/media/video/${props.item.id}/hls/stop?token=${encodeURIComponent(token)}`);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', onBeforeUnload);
  revealControls();
  start();
  loadMarkers();
  if (useCustomScrubber) loadTrickplay();
  window.addEventListener('plinthio-cast-ready', onCastReady);
  // Backstop for the timeupdate throttle — covers a tab left paused mid-file.
  saveTimer = setInterval(() => saveProgress(), 15000);
  viewSession.open(props.item.id);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('plinthio-cast-ready', onCastReady);
  if (hideTimer) clearTimeout(hideTimer);
  if (saveTimer) clearInterval(saveTimer);
  stopCountdown();
  teardownHls();
  viewSession.close();
});
</script>

<style scoped>
.pt-safe { padding-top: max(0.5rem, env(safe-area-inset-top)); }
.pb-safe { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
</style>
