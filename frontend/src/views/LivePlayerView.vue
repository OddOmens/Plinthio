<template>
  <div
    ref="rootEl"
    class="fixed inset-0 z-50 bg-black text-white flex flex-col select-none overflow-hidden"
    :class="controlsVisible ? '' : 'cursor-none'"
    @mousemove="onPointerActivity"
    @touchstart.passive="onTouch"
  >
    <video
      ref="videoEl"
      class="absolute inset-0 w-full h-full bg-black"
      playsinline
      autoplay
      :muted="muted"
      @click="onVideoClick"
      @dblclick="finePointer && toggleFullscreen()"
      @playing="onPlaying"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @waiting="buffering = true"
      @canplay="buffering = false"
      @timeupdate="onTimeUpdate"
      @volumechange="onVolumeChange"
      @error="onVideoError"
      @enterpictureinpicture="inPip = true"
      @leavepictureinpicture="inPip = false"
    />

    <!-- Top bar: back, the channel, and the way to the next one -->
    <header
      :class="[
        'absolute top-0 inset-x-0 z-20 transition-opacity duration-300 bg-gradient-to-b from-black/85 to-transparent pt-safe pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-10 flex items-center gap-3',
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      ]"
    >
      <button
        type="button"
        @click="goBack"
        :aria-label="$t('live.player.back')"
        :title="$t('live.player.back')"
        class="w-11 h-11 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <template v-if="channel">
        <ChannelLogo :logo="channel.logo" :name="channel.name" size="lg" class="!border-white/10" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-xs font-mono text-white/60 tabular-nums flex-shrink-0">{{ channel.number }}</span>
            <h1 class="text-base font-semibold truncate drop-shadow">{{ channel.name }}</h1>
          </div>
          <button
            type="button"
            @click="goLive"
            :disabled="!behindLive"
            class="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 transition"
            :class="behindLive ? 'bg-white/15 text-white/80 hover:bg-white/25' : 'bg-red-600 text-white cursor-default'"
            :title="behindLive ? $t('live.player.goLive') : ''"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-current" :class="behindLive ? '' : 'animate-pulse'" aria-hidden="true" />
            {{ behindLive ? $t('live.player.goLive') : $t('live.badge') }}
          </button>
        </div>
      </template>
      <div v-else class="flex-1" />
    </header>

    <!-- Channel switch: the number and name, large, for a moment -->
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0 scale-95"
      leave-active-class="transition duration-300"
      leave-to-class="opacity-0"
    >
      <div
        v-if="osd"
        class="absolute top-20 right-[max(1.25rem,env(safe-area-inset-right))] z-30 rounded-2xl bg-black/70 backdrop-blur px-4 py-3 text-right shadow-xl pointer-events-none"
      >
        <p class="text-3xl font-bold tabular-nums leading-none">{{ osd.number }}</p>
        <p v-if="osd.name" class="text-sm text-white/80 mt-1 max-w-[14rem] truncate">{{ osd.name }}</p>
      </div>
    </Transition>

    <!-- Loading / buffering -->
    <div
      v-if="(loadingChannel || buffering) && !errorState && !needsTap"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 pointer-events-none"
    >
      <Loader2 class="w-9 h-9 animate-spin text-white/80" />
      <p v-if="loadingChannel" class="text-sm text-white/80">{{ $t('live.player.tuning') }}</p>
    </div>

    <!-- Autoplay blocked: one tap starts it -->
    <button
      v-if="needsTap && !errorState"
      type="button"
      @click="playNow"
      :aria-label="$t('common.play')"
      class="absolute inset-0 z-20 m-auto w-20 h-20 rounded-full bg-white/90 hover:bg-white text-black flex items-center justify-center shadow-2xl active:scale-95 transition"
    >
      <Play class="w-8 h-8 fill-current ml-1" />
    </button>

    <!-- Bottom: what's on, and the controls -->
    <div
      v-if="!errorState"
      :class="[
        'absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 bg-gradient-to-t from-black/90 via-black/60 to-transparent pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-16 pb-[max(1rem,env(safe-area-inset-bottom))]',
        controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      ]"
      @mouseenter="hoveringControls = true"
      @mouseleave="hoveringControls = false"
    >
      <!-- Now / next -->
      <div v-if="showInfo && channel" class="max-w-3xl mb-3">
        <template v-if="current.now">
          <div class="flex items-baseline gap-2 min-w-0">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-white/60 flex-shrink-0">{{ $t('live.player.now') }}</span>
            <p class="text-sm sm:text-base font-semibold truncate">{{ current.now.title }}</p>
          </div>
          <p v-if="current.now.subtitle" class="text-xs sm:text-sm text-white/70 truncate mt-0.5">{{ current.now.subtitle }}</p>
          <div class="flex items-center gap-2.5 mt-2">
            <span class="text-[11px] text-white/60 tabular-nums whitespace-nowrap">{{ clock(current.now.start) }}</span>
            <div class="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
              <div class="h-full bg-primary rounded-full transition-[width] duration-500" :style="{ width: `${progressPercent(now, current.now.start, current.now.stop)}%` }" />
            </div>
            <span class="text-[11px] text-white/60 tabular-nums whitespace-nowrap">{{ clock(current.now.stop) }}</span>
          </div>
          <p v-if="current.now.description && !isPhone" class="text-xs text-white/60 mt-2 line-clamp-2">{{ current.now.description }}</p>
        </template>
        <p v-else class="text-sm text-white/60">{{ $t('live.noGuideInfo') }}</p>
        <p v-if="current.next" class="text-xs text-white/70 truncate mt-2">
          {{ $t('live.nextAt', { time: clock(current.next.start), title: current.next.title }) }}
        </p>
      </div>

      <div class="flex items-center gap-1 sm:gap-2">
        <button type="button" :aria-label="isPlaying ? $t('common.pause') : $t('common.play')" :title="isPlaying ? $t('common.pause') : $t('common.play')" @click="togglePlay" :class="ctrlClass">
          <Pause v-if="isPlaying" class="w-5 h-5" />
          <Play v-else class="w-5 h-5 fill-current" />
        </button>
        <button type="button" :aria-label="muted ? $t('live.player.unmute') : $t('live.player.mute')" :title="muted ? $t('live.player.unmute') : $t('live.player.mute')" @click="toggleMute" :class="ctrlClass">
          <VolumeX v-if="muted || volume === 0" class="w-5 h-5" />
          <Volume2 v-else class="w-5 h-5" />
        </button>
        <!-- Phones set the volume with their own buttons; a slider there does nothing on iOS. -->
        <input
          v-if="finePointer"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="muted ? 0 : volume"
          @input="setVolume(Number($event.target.value))"
          :aria-label="$t('live.player.volume')"
          class="w-20 sm:w-24 accent-[hsl(var(--primary))] cursor-pointer"
        />

        <div class="flex-1" />

        <template v-if="channels.length > 1">
          <button type="button" :aria-label="$t('live.player.channelDown')" :title="$t('live.player.channelDownHint')" @click="switchChannel(-1)" :class="ctrlClass">
            <ChevronDown class="w-5 h-5" />
          </button>
          <button type="button" :aria-label="$t('live.player.channelUp')" :title="$t('live.player.channelUpHint')" @click="switchChannel(1)" :class="ctrlClass">
            <ChevronUp class="w-5 h-5" />
          </button>
        </template>
        <button
          type="button"
          :aria-label="$t('live.player.info')"
          :title="$t('live.player.info')"
          :aria-pressed="String(showInfo)"
          @click="showInfo = !showInfo"
          :class="[ctrlClass, showInfo ? 'bg-white/15' : '']"
        >
          <Info class="w-5 h-5" />
        </button>
        <button v-if="pipSupported" type="button" :aria-label="$t('live.player.pip')" :title="$t('live.player.pip')" @click="togglePip" :class="ctrlClass">
          <PictureInPicture2 class="w-5 h-5" />
        </button>
        <button type="button" :aria-label="$t('live.player.fullscreen')" :title="$t('live.player.fullscreen')" @click="toggleFullscreen" :class="ctrlClass">
          <Minimize v-if="isFullscreen" class="w-5 h-5" />
          <Maximize v-else class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Can't play: what the server said, its code, and the ways on -->
    <div
      v-if="errorState"
      class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center"
    >
      <div class="w-12 h-12 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
        <RadioTower v-if="errorState.off" class="w-6 h-6" />
        <AlertCircle v-else class="w-6 h-6" />
      </div>
      <div>
        <h2 class="text-base font-semibold">{{ errorState.title }}</h2>
        <p class="text-sm text-white/70 mt-1 max-w-md">{{ errorState.message }}</p>
        <p v-if="channel?.geoBlocked && !errorState.off" class="text-xs text-amber-300/90 mt-2 max-w-md">{{ $t('live.player.geoBlockedHint') }}</p>
        <a
          v-if="errorState.code"
          :href="`/docs#${errorState.code}`"
          target="_blank"
          rel="noopener"
          class="inline-block mt-2 text-xs font-mono text-white/50 hover:text-white underline underline-offset-2"
        >
          {{ $t('live.player.errorHelp', { code: errorState.code }) }}
        </a>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <button
          v-if="!errorState.off && !errorState.missing"
          type="button"
          @click="retry"
          class="px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 text-sm font-medium transition"
        >
          {{ $t('common.retry') }}
        </button>
        <button
          v-if="!errorState.off && channels.length > 1"
          type="button"
          @click="switchChannel(1)"
          class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition flex items-center gap-1.5"
        >
          {{ $t('live.player.nextChannel') }}
          <ChevronUp class="w-4 h-4" />
        </button>
        <button
          type="button"
          @click="goBack"
          class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition"
        >
          {{ $t('live.player.back') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Hls from 'hls.js';
import api from '../api/client';
import { getMediaToken, setMediaToken } from '../utils/mediaToken';
import { translateServerMessage } from '../i18n/serverErrors';
import { useIsPhone } from '../composables/useIsPhone';
import { useCustomizationStore } from '../stores/customization';
import ChannelLogo from '../components/live/ChannelLogo.vue';
import { clock, progressPercent, nowAndNext, useNow } from '../components/live/liveFormat';
import { t } from '../i18n';
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2,
  ChevronUp, ChevronDown, Info, Loader2, AlertCircle, RadioTower
} from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const isPhone = useIsPhone();
const customizationStore = useCustomizationStore();
const now = useNow(15000);

const rootEl = ref(null);
const videoEl = ref(null);
const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
const ctrlClass = 'w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition flex-shrink-0';

// ── The channel ───────────────────────────────────────────────────────────────────────
const channel = ref(null);
const programmes = ref([]);
const streamPath = ref('');
const loadingChannel = ref(true);
let scheduleLoadedAt = 0;
let loadId = 0;

// Channel up/down walks the list the viewer came from (a group, or every channel).
const channels = ref([]);
const group = computed(() => (typeof route.query.group === 'string' ? route.query.group : ''));

const current = computed(() => {
  const found = nowAndNext(programmes.value, now.value);
  if (found.now || found.next || programmes.value.length) return found;
  // No schedule from the channel's own page: the list's now/next, if still current.
  const ch = channel.value;
  const n = now.value;
  return {
    now: ch?.now && ch.now.start <= n && n < ch.now.stop ? ch.now : null,
    next: ch?.next && ch.next.start > n ? ch.next : null
  };
});

async function loadChannels() {
  try {
    const res = await api.get('/live/channels', { params: group.value ? { group: group.value } : {} });
    channels.value = res.data?.channels || [];
  } catch (err) {
    channels.value = [];
  }
}

async function loadSchedule(id) {
  const res = await api.get(`/live/channels/${id}`);
  if (route.params.id !== id) return null;
  channel.value = res.data?.channel || channel.value;
  programmes.value = res.data?.programmes || [];
  scheduleLoadedAt = Date.now();
  return res.data;
}

async function tune(id) {
  const myLoad = ++loadId;
  teardown();
  errorState.value = null;
  needsTap.value = false;
  loadingChannel.value = true;
  buffering.value = false;
  networkRetries = 0;
  mediaRecoveries = 0;
  tokenRenewed = false;
  // Show what we already know about it (from the list) straight away.
  const known = channels.value.find((ch) => ch.id === id);
  if (known) {
    channel.value = known;
    programmes.value = [];
  }
  try {
    const data = await loadSchedule(id);
    if (myLoad !== loadId || !data) return;
    streamPath.value = data.streamPath || `/api/media/live/${encodeURIComponent(id)}/index.m3u8`;
    if (!getMediaToken()) await renewMediaToken();
    attach();
  } catch (err) {
    if (myLoad !== loadId) return;
    loadingChannel.value = false;
    const code = err.response?.data?.code;
    if (code === 'P700') return showOff();
    if (err.response?.status === 404) {
      return showError(code || '', err.response?.data?.error || t('live.player.errors.notFound'), { missing: true });
    }
    if (!err.response) return showError('P351', t('live.player.errors.offline'));
    showError(code || 'P701', err.response?.data?.error || t('live.player.errors.unavailable'));
  }
}

// ── Playback ──────────────────────────────────────────────────────────────────────────
let hls = null;
const isPlaying = ref(false);
const buffering = ref(false);
const needsTap = ref(false);
const behindLive = ref(false);

const streamUrl = () => {
  const path = streamPath.value;
  return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getMediaToken())}`;
};

// hls.js wherever Media Source Extensions exist; Safari (and iOS) play HLS natively.
function attach() {
  const video = videoEl.value;
  if (!video) return;
  teardown();
  if (Hls.isSupported()) {
    hls = new Hls({
      // Live: stay a few segments behind the edge, keep little behind us, and report
      // an endless duration so nothing offers to seek to "the end".
      liveDurationInfinity: true,
      backBufferLength: 30,
      maxBufferLength: 30
      // No Authorization header: the media token rides in the URL, and the server
      // carries it into every playlist and segment URL it rewrites.
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      console.error('[live] hls.js fatal error:', data.type, data.details);
      handleFatal(data);
    });
    hls.on(Hls.Events.FRAG_LOADED, () => { networkRetries = 0; });
    hls.loadSource(streamUrl());
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl();
  } else {
    loadingChannel.value = false;
    return showError('P350', t('live.player.errors.unsupportedBrowser'));
  }
  play();
}

function teardown() {
  clearTimeout(retryTimer);
  if (hls) {
    hls.destroy();
    hls = null;
  }
  const video = videoEl.value;
  if (video && video.getAttribute('src')) {
    video.removeAttribute('src');
    video.load();
  }
  isPlaying.value = false;
  behindLive.value = false;
}

function play() {
  const video = videoEl.value;
  if (!video) return;
  video.play().then(() => { needsTap.value = false; }).catch((err) => {
    // Autoplay with sound blocked (no tap on this page yet): wait for one.
    if (err?.name === 'NotAllowedError') {
      needsTap.value = true;
      loadingChannel.value = false;
    }
  });
}

function playNow() {
  needsTap.value = false;
  play();
}

function onPlaying() {
  loadingChannel.value = false;
  buffering.value = false;
  networkRetries = 0;
  revealControls();
}

function togglePlay() {
  const video = videoEl.value;
  if (!video) return;
  if (video.paused) play();
  else video.pause();
  revealControls();
}

// Where "live" is: hls.js knows its sync point; native HLS exposes the seekable window.
function liveEdge() {
  const video = videoEl.value;
  if (hls && Number.isFinite(hls.liveSyncPosition)) return hls.liveSyncPosition;
  if (video?.seekable?.length) return video.seekable.end(video.seekable.length - 1) - 3;
  return null;
}

function onTimeUpdate() {
  const edge = liveEdge();
  const video = videoEl.value;
  behindLive.value = edge !== null && !!video && edge - video.currentTime > 20;
}

function goLive() {
  const edge = liveEdge();
  const video = videoEl.value;
  if (edge === null || !video) return;
  video.currentTime = edge;
  play();
}

// ── Volume (remembered on this device) ────────────────────────────────────────────────
const VOLUME_KEY = 'plinthio_live_volume';
const volume = ref(1);
const muted = ref(false);
try {
  const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) || 'null');
  if (saved && typeof saved.volume === 'number') volume.value = Math.min(1, Math.max(0, saved.volume));
  if (saved && typeof saved.muted === 'boolean') muted.value = saved.muted;
} catch (e) { /* defaults */ }

function rememberVolume() {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: volume.value, muted: muted.value }));
  } catch (e) { /* this session only */ }
}

function setVolume(value) {
  const video = videoEl.value;
  volume.value = value;
  muted.value = value === 0;
  if (video) {
    video.volume = value;
    video.muted = muted.value;
  }
  rememberVolume();
}

function toggleMute() {
  const video = videoEl.value;
  muted.value = !muted.value;
  if (!muted.value && volume.value === 0) volume.value = 0.5;
  if (video) {
    video.muted = muted.value;
    video.volume = volume.value;
  }
  rememberVolume();
  revealControls();
}

function onVolumeChange() {
  const video = videoEl.value;
  if (!video) return;
  volume.value = video.volume;
  muted.value = video.muted;
}

// ── Fullscreen and picture-in-picture ─────────────────────────────────────────────────
const isFullscreen = ref(false);
const inPip = ref(false);
const pipSupported = ref(false);

function onFullscreenChange() {
  isFullscreen.value = !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  const root = rootEl.value;
  const video = videoEl.value;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  } else if (root?.requestFullscreen) {
    root.requestFullscreen().catch(() => {});
  } else if (root?.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  } else if (video?.webkitEnterFullscreen) {
    // iPhone: only the video element itself can go fullscreen (with the system's controls).
    video.webkitEnterFullscreen();
  }
  revealControls();
}

async function togglePip() {
  const video = videoEl.value;
  if (!video) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    }
  } catch (err) {
    // Not allowed right now (no video frames yet, say) — nothing to report.
  }
}

// ── Channel up / down ─────────────────────────────────────────────────────────────────
const osd = ref(null);
let osdTimer = null;

function showOsd(ch) {
  if (!ch) return;
  osd.value = { number: ch.number, name: ch.name };
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { osd.value = null; }, 2500);
}

function openChannel(ch) {
  if (!ch || ch.id === route.params.id) return;
  showOsd(ch);
  // A swap, not a step: Back still returns to the list or guide.
  router.replace({ name: 'live-channel', params: { id: ch.id }, query: route.query });
}

// +1 is channel up (the next number), −1 channel down; both wrap around.
function switchChannel(step) {
  const list = channels.value;
  if (list.length < 2) return;
  const i = list.findIndex((ch) => ch.id === route.params.id);
  const next = list[((i < 0 ? 0 : i + step) % list.length + list.length) % list.length];
  openChannel(next);
  revealControls();
}

// Typing a channel number jumps to it, as on a TV remote.
let digits = '';
let digitsTimer = null;
function typeDigit(digit) {
  digits = (digits + digit).slice(-4);
  osd.value = { number: digits, name: '' };
  clearTimeout(osdTimer);
  clearTimeout(digitsTimer);
  digitsTimer = setTimeout(() => {
    const wanted = Number(digits);
    digits = '';
    const ch = channels.value.find((c) => Number(c.number) === wanted);
    if (ch) openChannel(ch);
    else osdTimer = setTimeout(() => { osd.value = null; }, 600);
  }, 1200);
}

// ── Failures ──────────────────────────────────────────────────────────────────────────
// hls.js and the <video> element only say "it failed". The server knows why — its error
// responses carry a Plinthio code (P701 for a channel whose stream couldn't be fetched) —
// so a failure re-requests the URL that failed and shows the server's own message.
const errorState = ref(null);
const NETWORK_RETRIES = 3;
let networkRetries = 0;
let mediaRecoveries = 0;
let tokenRenewed = false;
let retryTimer = null;

function showError(code, message, { missing = false } = {}) {
  teardown();
  loadingChannel.value = false;
  buffering.value = false;
  errorState.value = { code, title: t('live.player.cantPlay'), message: message || t('live.player.errors.unavailable'), missing };
  controlsVisible.value = true;
}

function showOff() {
  teardown();
  loadingChannel.value = false;
  customizationStore.liveChannelCount = 0;
  errorState.value = { off: true, code: '', title: t('live.off.title'), message: t('live.off.viewer') };
}

async function renewMediaToken() {
  if (tokenRenewed) return false;
  tokenRenewed = true;
  try {
    const res = await api.post('/auth/media-token');
    if (!res.data?.mediaToken) return false;
    setMediaToken(res.data.mediaToken);
    return true;
  } catch (e) {
    return false;
  }
}

// Asks the server why `url` failed: { status, code, message }, or null when unreachable.
async function diagnose(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return { status: res.status };
    let body = {};
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, code: body.code, message: translateServerMessage(body.error, body.code) };
  } catch (e) {
    return null;
  }
}

async function explainFailure(url) {
  const found = await diagnose(url || streamUrl());
  if (!found) return showError('P351', t('live.player.errors.offline'));
  if (found.status === 401 && await renewMediaToken()) return attach();
  if (found.status === 401) return showError('P352', t('live.player.errors.tokenExpired'));
  if (found.code === 'P700') return showOff();
  if (found.code) return showError(found.code, found.message);
  showError('P701', t('live.player.errors.unavailable'));
}

async function handleFatal(data) {
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    // hls.js's standard recovery for a decoder hiccup: once as is, once swapping the
    // audio codec, then give up.
    if (hls && mediaRecoveries < 2) {
      if (mediaRecoveries === 1) hls.swapAudioCodec();
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return;
    }
    return showError('P350', t('live.player.errors.decode'));
  }

  const status = data.response?.code;
  if (status === 401 && await renewMediaToken()) return attach();

  // Network trouble is common with live streams: retry a few times, backing off, before
  // asking the server what went wrong. A refusal (4xx) won't change on a retry.
  const refused = status >= 400 && status < 500;
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !refused && networkRetries < NETWORK_RETRIES) {
    networkRetries += 1;
    buffering.value = true;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!hls) return;
      // A playlist that never loaded needs a fresh start; anything later just resumes.
      if (/manifest/i.test(data.details || '')) attach();
      else hls.startLoad();
    }, 1000 * 2 ** (networkRetries - 1));
    return;
  }

  const failedUrl = data.url || data.context?.url || data.frag?.url || streamUrl();
  await explainFailure(failedUrl);
}

let nativeRetried = false;
async function onVideoError() {
  // hls.js reports its own failures (handleFatal).
  if (hls || !streamPath.value || errorState.value) return;
  const code = videoEl.value?.error?.code;
  if (code === 3 || code === 4) {
    // Safari's native HLS: one fresh try before saying why.
    if (!nativeRetried) {
      nativeRetried = true;
      return attach();
    }
  }
  await explainFailure(streamUrl());
}

function retry() {
  networkRetries = 0;
  mediaRecoveries = 0;
  nativeRetried = false;
  tokenRenewed = false;
  tune(route.params.id);
}

// ── Controls visibility ───────────────────────────────────────────────────────────────
const controlsVisible = ref(true);
const hoveringControls = ref(false);
const showInfo = ref(true);
let hideTimer = null;

function revealControls() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (isPlaying.value && !hoveringControls.value && !errorState.value) controlsVisible.value = false;
  }, 3500);
}

function onPointerActivity(e) {
  if (e && e.movementX === 0 && e.movementY === 0) return;
  revealControls();
}

// On touch, a tap on the picture shows the controls, or hides them if they're showing.
let touchedAt = 0;
function onTouch() {
  touchedAt = Date.now();
}
function onVideoClick() {
  if (Date.now() - touchedAt < 600 || !finePointer) {
    if (controlsVisible.value) {
      controlsVisible.value = false;
      clearTimeout(hideTimer);
    } else revealControls();
    return;
  }
  togglePlay();
}

// ── Keyboard ──────────────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target?.closest?.('input, textarea, select')) return;
  const key = e.key;
  if (key === 'Escape') {
    if (!document.fullscreenElement) goBack();
    return;
  }
  if (key === 'ArrowUp' || key === 'PageUp') { e.preventDefault(); switchChannel(1); }
  else if (key === 'ArrowDown' || key === 'PageDown') { e.preventDefault(); switchChannel(-1); }
  else if (key === ' ' || key === 'k') { e.preventDefault(); togglePlay(); }
  else if (key === 'm') toggleMute();
  else if (key === 'f') toggleFullscreen();
  else if (key === 'i') showInfo.value = !showInfo.value;
  else if (key === 'p' && pipSupported.value) togglePip();
  else if (/^[0-9]$/.test(key)) typeDigit(key);
  else return;
  revealControls();
}

function goBack() {
  // Back to the list or guide this channel was opened from, when that's where we came from.
  const back = window.history.state?.back;
  if (typeof back === 'string' && back.startsWith('/live') && !back.startsWith('/live/')) router.back();
  else router.push({ path: '/live', query: group.value ? { group: group.value } : {} });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────
watch(() => route.params.id, (id, old) => {
  if (id && id !== old && route.name === 'live-channel') {
    nativeRetried = false;
    tune(id);
  }
});

// Keep the schedule current: once what's on has run out (or every half hour), fetch the
// channel's programmes again without touching the stream.
watch(now, (n) => {
  if (!channel.value || errorState.value || n - scheduleLoadedAt < 60000) return;
  const stale = !current.value.next || n - scheduleLoadedAt > 30 * 60000;
  if (stale) loadSchedule(route.params.id).catch(() => {});
});

watch(group, loadChannels);

onMounted(async () => {
  const video = videoEl.value;
  if (video) {
    video.volume = volume.value;
    video.muted = muted.value;
    pipSupported.value = !!(document.pictureInPictureEnabled && video.requestPictureInPicture) ||
      !!video.webkitSupportsPresentationMode?.('picture-in-picture');
  }
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  revealControls();
  // The list first (quick), so the channel's name shows while its stream starts.
  await loadChannels();
  const known = channels.value.find((ch) => ch.id === route.params.id);
  if (known) showOsd(known);
  tune(route.params.id);
});

onUnmounted(() => {
  loadId += 1;
  window.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  clearTimeout(hideTimer);
  clearTimeout(osdTimer);
  clearTimeout(digitsTimer);
  teardown();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
});
</script>

<style scoped>
.pt-safe { padding-top: max(0.75rem, env(safe-area-inset-top)); }
</style>
