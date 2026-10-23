<template>
  <!-- Home: what's on the viewer's favourite channels right now. One request when Home
       opens; the progress bars move on their own. Gone when Live TV isn't offered, there
       are no favourites, or the viewer hid the row. -->
  <section v-if="show" class="shelf-fade-in flex flex-col gap-3" :aria-label="$t('live.home.title')">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
        {{ $t('live.home.title') }}
      </h2>
      <div class="flex items-center gap-1">
        <router-link
          to="/live"
          class="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition flex items-center gap-1"
        >
          {{ $t('live.home.allChannels') }}
          <ChevronRight class="w-3.5 h-3.5" />
        </router-link>
        <button
          type="button"
          @click="hideRow"
          :aria-label="$t('live.home.hideRow')"
          :title="$t('live.home.hideRowHint')"
          class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
        >
          <EyeOff class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <ul class="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 sm:scroll-px-0 pb-1">
      <li v-for="ch in channels" :key="ch.id" class="snap-start flex-shrink-0 w-[16.5rem] sm:w-72">
        <router-link
          :to="{ name: 'live-channel', params: { id: ch.id }, query: { tab: 'favourites' } }"
          :aria-label="$t('live.watchChannel', { channel: ch.name })"
          class="h-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-foreground/15 transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChannelLogo :logo="ch.logo" :name="ch.name" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-[11px] font-mono text-muted-foreground tabular-nums flex-shrink-0">{{ ch.number }}</span>
              <h3 class="text-sm font-semibold text-foreground truncate">{{ ch.name }}</h3>
            </div>
            <template v-if="airingNow(ch, now)">
              <p class="text-xs text-foreground/90 truncate mt-0.5">{{ airingNow(ch, now).title }}</p>
              <div class="h-1 mt-2 bg-muted rounded-full overflow-hidden">
                <div class="h-full bg-primary rounded-full transition-[width] duration-500" :style="{ width: `${progressPercent(now, airingNow(ch, now).start, airingNow(ch, now).stop)}%` }" />
              </div>
            </template>
            <p v-else class="text-xs text-muted-foreground mt-0.5 truncate">{{ $t('live.noGuideInfo') }}</p>
          </div>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useCustomizationStore } from '../../stores/customization';
import { useLiveStore } from '../../stores/live';
import ChannelLogo from './ChannelLogo.vue';
import { progressPercent, airingNow, useNow } from './liveFormat';
import { ChevronRight, EyeOff } from '@lucide/vue';

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const liveStore = useLiveStore();
const now = useNow(30000);

const channels = ref([]);
const wanted = computed(() => customizationStore.showLiveTv && liveStore.prefs.showOnHome && !!authStore.user);
const show = computed(() => wanted.value && channels.value.length > 0);

let asked = false;
async function load() {
  asked = true;
  try {
    const res = await api.get('/live/now', { params: { limit: 20 } });
    channels.value = (res.data?.channels || []).filter((ch) => !liveStore.isHiddenForMe(ch));
    liveStore.learn(channels.value);
  } catch (err) {
    // No row this time.
    channels.value = [];
  }
}

// Asked once, as soon as the nav knows Live TV is on for this account.
watch(wanted, (yes) => { if (yes && !asked) load(); }, { immediate: true });

function hideRow() {
  liveStore.setShowOnHome(false).catch(() => { /* the row comes back */ });
}
</script>
