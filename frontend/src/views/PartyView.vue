<template>
  <div class="min-h-screen bg-black text-white">
    <!-- Joining / can't join / ended -->
    <div v-if="!item" class="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <template v-if="problem">
        <div class="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
          <PartyPopper v-if="problem.ended" class="w-7 h-7" />
          <AlertCircle v-else class="w-7 h-7 text-rose-400" />
        </div>
        <h1 class="text-xl font-bold">{{ problem.title }}</h1>
        <p class="text-sm text-white/70 max-w-sm">{{ problem.message }}</p>
        <button @click="goHome" class="mt-2 h-10 px-5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition">
          Back to {{ customizationStore.serverName || 'Plinthio' }}
        </button>
      </template>
      <template v-else>
        <Loader2 class="w-8 h-8 animate-spin text-white/70" />
        <p class="text-sm text-white/70">Joining the watch party…</p>
      </template>
    </div>

    <template v-else>
      <VideoPlayer
        ref="player"
        :key="item.id"
        :item="item"
        party-mode
        :can-control="canControl"
        @close="leave"
        @play-next="onPlayNext"
      >
        <template #header-actions>
          <button
            @click="panelOpen = !panelOpen"
            class="h-11 px-3 rounded-xl bg-black/50 hover:bg-black/70 text-white flex items-center gap-2 transition active:scale-95 flex-shrink-0 backdrop-blur-sm"
            :aria-label="panelOpen ? 'Hide watch party' : 'Show watch party'"
            title="Watch party"
          >
            <Users class="w-5 h-5" />
            <span class="text-sm font-semibold">{{ members.length }}</span>
            <span v-if="unread" class="w-2 h-2 rounded-full bg-primary" />
          </button>
        </template>
      </VideoPlayer>

      <!-- Notices over the video: waiting on someone, locked controls, reconnecting -->
      <div class="fixed top-20 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        <div v-if="reconnecting" class="notice"><Loader2 class="w-4 h-4 animate-spin" /> Reconnecting…</div>
        <div v-else-if="waitingFor.length" class="notice">
          <Loader2 class="w-4 h-4 animate-spin" />
          Waiting for {{ waitingFor.join(', ') }}…
        </div>
        <div v-if="toast" class="notice">{{ toast }}</div>
      </div>

      <!-- The party panel -->
      <aside
        v-if="panelOpen"
        class="fixed z-[60] inset-y-0 right-0 w-full sm:w-80 bg-zinc-950/95 backdrop-blur border-l border-white/10 flex flex-col pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div class="px-4 pb-3 flex items-center justify-between gap-2 border-b border-white/10">
          <div class="min-w-0">
            <h2 class="text-base font-bold flex items-center gap-2"><PartyPopper class="w-4 h-4" /> Watch party</h2>
            <p class="text-xs text-white/60 truncate">{{ item.series ? `${item.series} · ` : '' }}{{ item.title }}</p>
          </div>
          <button @click="panelOpen = false" class="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center" aria-label="Close panel">
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Invite -->
        <div class="px-4 py-3 border-b border-white/10 flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-white/50">Invite</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 min-w-0 truncate text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-2">{{ inviteLink }}</code>
            <button @click="copyInvite" class="h-8 px-3 rounded-lg bg-white text-black text-xs font-semibold hover:bg-white/90 transition flex items-center gap-1.5 flex-shrink-0">
              <Check v-if="copied" class="w-3.5 h-3.5" />
              <Copy v-else class="w-3.5 h-3.5" />
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
          <p class="text-[12px] text-white/50">Anyone with an account on this server can join with the link or code <strong class="text-white/80 font-mono">{{ code }}</strong>.</p>
        </div>

        <!-- Who's here -->
        <div class="px-4 py-3 border-b border-white/10 flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-white/50">Watching ({{ members.length }})</p>
          <ul class="flex flex-col gap-1.5">
            <li v-for="m in members" :key="m.userId" class="flex items-center gap-2 text-sm">
              <span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold uppercase">{{ m.name.slice(0, 2) }}</span>
              <span class="flex-1 min-w-0 truncate">{{ m.name }}<span v-if="m.userId === me" class="text-white/50"> (you)</span></span>
              <Loader2 v-if="m.buffering" class="w-3.5 h-3.5 animate-spin text-white/60" title="Loading" />
              <span v-if="m.userId === hostId" class="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">Host</span>
            </li>
          </ul>
        </div>

        <!-- Host controls -->
        <div v-if="isHost" class="px-4 py-3 border-b border-white/10 flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-white/50">Who can play, pause and skip</p>
          <div class="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
            <button
              v-for="opt in [{ id: 'host', label: 'Only me' }, { id: 'everyone', label: 'Everyone' }]"
              :key="opt.id"
              @click="setControlMode(opt.id)"
              class="h-8 rounded-md text-xs font-semibold transition"
              :class="controlMode === opt.id ? 'bg-white text-black' : 'text-white/70 hover:text-white'"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Chat -->
        <div ref="chatEl" class="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          <p v-if="!chat.length" class="text-xs text-white/40 text-center mt-4">Say hi — messages go to everyone watching.</p>
          <div v-for="msg in chat" :key="msg.id" class="text-sm leading-snug">
            <span class="font-semibold mr-1.5" :class="msg.userId === me ? 'text-primary' : 'text-white'">{{ msg.name }}</span>
            <span class="text-white/85 break-words">{{ msg.text }}</span>
          </div>
        </div>
        <form @submit.prevent="sendChat" class="px-4 pt-2 flex items-center gap-2">
          <input
            v-model="chatText"
            maxlength="500"
            placeholder="Message"
            class="flex-1 min-w-0 h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
          <button type="submit" :disabled="!chatText.trim()" class="w-9 h-9 rounded-lg bg-white text-black flex items-center justify-center disabled:opacity-40" aria-label="Send">
            <Send class="w-4 h-4" />
          </button>
        </form>

        <div class="px-4 pt-3 flex gap-2">
          <button @click="leave" class="flex-1 h-9 rounded-lg border border-white/15 hover:bg-white/10 text-sm font-medium transition">Leave</button>
          <button v-if="isHost" @click="endParty" class="flex-1 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-semibold transition">End for everyone</button>
        </div>
      </aside>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertCircle, Check, Copy, Loader2, PartyPopper, Send, Users, X } from 'lucide-vue-next';
import api from '../api/client';
import { useCustomizationStore } from '../stores/customization';
import { useDialogStore } from '../stores/dialog';
import { PartyConnection, livePosition, serverNow } from '../utils/party';
import { detailRoute } from '../utils/mediaVocab';

const VideoPlayer = defineAsyncComponent(() => import('../components/VideoPlayer.vue'));

const route = useRoute();
const router = useRouter();
const customizationStore = useCustomizationStore();
const dialog = useDialogStore();

const code = String(route.params.code || '').toUpperCase();
const inviteLink = `${window.location.origin}/party/${code}`;

// Party state, as the server last told it.
const me = ref(null);
const hostId = ref(null);
const controlMode = ref('host');
const members = ref([]);
const chat = ref([]);
const partyState = ref(null);
const held = ref(false);
const itemId = ref(null);
const item = ref(null);

const problem = ref(null);
const reconnecting = ref(false);
const panelOpen = ref(window.matchMedia?.('(min-width: 1024px)').matches ?? false);
const unread = ref(false);
const toast = ref('');
const copied = ref(false);
const chatText = ref('');
const chatEl = ref(null);
const player = ref(null);

const isHost = computed(() => me.value && hostId.value === me.value);
const canControl = computed(() => isHost.value || controlMode.value === 'everyone');
const waitingFor = computed(() => members.value.filter((m) => m.buffering && m.userId !== me.value).map((m) => m.name));

const PROBLEMS = {
  P600: { title: 'Watch parties are off', message: 'An admin has to turn on watch parties for this server first.' },
  P601: { title: 'This party has ended', message: 'The host ended it, or everyone left. Ask for a new invite link.' },
  P603: { title: 'Not available to you', message: 'This party is watching something your account can\'t open.' },
  P605: { title: 'This party is full', message: 'A watch party holds up to 20 people. Try again when someone leaves.' }
};

let conn = null;
let toastTimer = null;

function showToast(text) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2500);
}

// ─── Events from the party ──────────────────────────────────────────────────
function onEvent(event) {
  switch (event.type) {
    case 'snapshot': {
      const p = event.party;
      me.value = event.you.userId;
      hostId.value = p.hostId;
      controlMode.value = p.controlMode;
      members.value = p.members;
      chat.value = p.chat;
      partyState.value = p.state;
      held.value = p.held;
      reconnecting.value = false;
      if (p.itemId !== itemId.value) loadItem(p.itemId);
      else applyState();
      break;
    }
    case 'presence':
      members.value = event.members;
      hostId.value = event.hostId;
      controlMode.value = event.controlMode;
      break;
    case 'state':
      partyState.value = event.state;
      held.value = event.held;
      if (event.by !== conn.clientId) applyState();
      break;
    case 'heartbeat':
      if (event.by !== conn.clientId) partyState.value = event.state;
      break;
    case 'item':
      partyState.value = event.state;
      held.value = event.held;
      loadItem(event.itemId);
      break;
    case 'chat':
      chat.value = [...chat.value, event.message].slice(-50);
      if (!panelOpen.value) unread.value = true;
      nextTick(() => { if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight; });
      break;
    case 'ended':
      problem.value = event.reason === 'disabled'
        ? { ended: true, title: 'Watch parties were turned off', message: 'An admin turned off watch parties, which ended this one.' }
        : { ended: true, title: 'The party is over', message: 'The host ended the watch party. Thanks for watching!' };
      item.value = null;
      break;
    case 'reconnecting':
      reconnecting.value = true;
      break;
    case 'error':
      problem.value = PROBLEMS[event.code] || { title: 'Couldn\'t join', message: event.message || 'Something went wrong joining this party.' };
      item.value = null;
      break;
    default:
  }
}

async function loadItem(id) {
  itemId.value = id;
  try {
    const res = await api.get(`/items/${id}`);
    if (itemId.value === id) item.value = res.data.item;
  } catch (err) {
    problem.value = { title: 'Couldn\'t load the video', message: err.response?.data?.error || 'Try reopening the invite link.' };
  }
}

// ─── Keeping the <video> in step ────────────────────────────────────────────
// A play/pause/seek that disagrees with the party's state came from this viewer. With
// control it goes to the party; without, the player snaps back. Anything that agrees —
// including what applyState itself does — is ignored, so no echo loops.
let ready = false;
let detach = null;

function video() {
  return player.value?.videoEl || null;
}

function applyState() {
  const v = video();
  const state = partyState.value;
  if (!v || !state || !ready) return;
  const target = livePosition(state);
  if (Math.abs(v.currentTime - target) > 1) v.currentTime = target;
  v.playbackRate = 1;
  if (state.playing && v.paused) v.play().catch(() => showToast('Tap play to join in'));
  else if (!state.playing && !v.paused) v.pause();
}

function onUserAction(type) {
  const v = video();
  const state = partyState.value;
  if (!v || !state || !ready) return;
  const target = livePosition(state);
  const agrees =
    (type === 'play' && state.playing) ||
    (type === 'pause' && (!state.playing || v.ended)) ||
    (type === 'seek' && Math.abs(v.currentTime - target) < 1.5);
  if (agrees) return;

  if (!canControl.value) {
    showToast('The host is in control of playback');
    applyState();
    return;
  }
  // Record it here straight away, so the play that often follows a seek isn't sent twice.
  const playing = type === 'play' ? true : type === 'pause' ? false : state.playing;
  partyState.value = { playing: playing && !held.value, position: v.currentTime, at: serverNow() };
  conn.action(type, v.currentTime).catch((err) => {
    showToast(err.response?.data?.error || 'Couldn\'t reach the party');
  });
}

function attachVideo(v) {
  detach?.();
  ready = false;
  const handlers = {
    play: () => onUserAction('play'),
    pause: () => onUserAction('pause'),
    // 'seeking', not 'seeked': the jump has to reach the party before the 'waiting' that
    // loading the new spot sets off, or the hold would pin everyone to the old position.
    seeking: () => onUserAction('seek'),
    // Loading — at the start, after a seek, or mid-stream — holds the party for us.
    loadstart: () => conn.buffering(true),
    waiting: () => conn.buffering(true),
    canplay: () => {
      conn.buffering(false);
      if (!ready) {
        ready = true;
        applyState();
      }
    },
    playing: () => conn.buffering(false)
  };
  for (const [name, fn] of Object.entries(handlers)) v.addEventListener(name, fn);
  detach = () => { for (const [name, fn] of Object.entries(handlers)) v.removeEventListener(name, fn); };
}

// The player mounts (and re-mounts per movie/episode) asynchronously; hook in when its
// <video> exists.
watch(() => video(), (v) => { if (v) attachVideo(v); });

// Drift: whoever isn't the clock nudges their speed, or jumps if they're far off. The host
// is the clock and reports its position every couple of seconds instead.
let driftTimer = null;
let heartbeatTimer = null;
function tick() {
  const v = video();
  const state = partyState.value;
  if (!v || !state || !ready || v.paused || !state.playing || held.value || v.seeking) return;
  if (isHost.value) return;
  const diff = v.currentTime - livePosition(state);
  if (Math.abs(diff) > 2) v.currentTime = livePosition(state);
  else if (Math.abs(diff) > 0.3) v.playbackRate = diff > 0 ? 0.95 : 1.05;
  else v.playbackRate = 1;
}
function heartbeat() {
  const v = video();
  if (!isHost.value || !v || !ready || v.paused || v.seeking || !partyState.value?.playing || held.value) return;
  conn.action('heartbeat', v.currentTime).catch(() => {});
}

// ─── Actions ────────────────────────────────────────────────────────────────
function onPlayNext(next) {
  conn.changeItem(next.id, true).catch((err) => dialog.alert(err.response?.data?.error || 'Couldn\'t move the party on'));
}

function setControlMode(mode) {
  conn.setControlMode(mode).catch(() => {});
}

async function sendChat() {
  const text = chatText.value.trim();
  if (!text) return;
  chatText.value = '';
  try {
    await conn.chat(text);
  } catch (err) {
    chatText.value = text;
    showToast('Message not sent');
  }
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteLink);
  } catch (e) {
    window.prompt('Copy this invite link:', inviteLink);
  }
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

async function endParty() {
  const ok = await dialog.confirm({
    title: 'End the watch party?',
    message: 'This stops the party for everyone watching.',
    confirmText: 'End party',
    danger: true
  });
  if (!ok) return;
  await conn.end().catch(() => {});
}

function goHome() {
  router.push('/');
}

function leave() {
  const it = item.value;
  conn?.close();
  router.push(it ? detailRoute(it) : '/');
}

watch(panelOpen, (open) => { if (open) unread.value = false; });

onMounted(() => {
  conn = new PartyConnection(code, onEvent);
  conn.connect();
  driftTimer = setInterval(tick, 1000);
  heartbeatTimer = setInterval(heartbeat, 2000);
});

onUnmounted(() => {
  conn?.close();
  detach?.();
  clearInterval(driftTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(toastTimer);
});
</script>

<style scoped>
.notice {
  @apply px-3.5 py-2 rounded-full bg-black/80 backdrop-blur border border-white/10 text-sm font-medium text-white flex items-center gap-2 shadow-lg;
}
</style>
