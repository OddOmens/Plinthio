<template>
  <!-- One channel in the list: the whole card opens the player; a star and a small menu
       (favourite, hide for me) sit at its right edge, outside the link. -->
  <div class="group relative h-full">
    <router-link
      :to="to"
      class="h-full flex items-start gap-3 p-3 pr-12 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-foreground/15 transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ChannelLogo :logo="channel.logo" :name="channel.name" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[11px] font-mono text-muted-foreground tabular-nums flex-shrink-0">{{ channel.number }}</span>
          <h3 class="text-sm font-semibold text-foreground truncate">{{ channel.name }}</h3>
          <span
            v-if="channel.geoBlocked"
            class="ml-auto flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400"
            :title="$t('live.geoBlockedHint')"
          >{{ $t('live.geoBlocked') }}</span>
        </div>
        <template v-if="airing">
          <p class="text-xs text-foreground/90 truncate mt-0.5">{{ airing.title }}</p>
          <div class="flex items-center gap-2 mt-1.5">
            <div class="h-1 flex-1 bg-muted rounded-full overflow-hidden">
              <div class="h-full bg-primary rounded-full transition-[width] duration-500" :style="{ width: `${progressPercent(now, airing.start, airing.stop)}%` }" />
            </div>
            <span class="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
              {{ $t('live.minutesLeft', { count: minutesLeft(now, airing.stop) }) }}
            </span>
          </div>
        </template>
        <p v-else class="text-xs text-muted-foreground mt-0.5">{{ $t('live.noGuideInfo') }}</p>
        <p v-if="upNext" class="text-[11px] text-muted-foreground truncate mt-1">
          {{ $t('live.nextAt', { time: clock(upNext.start), title: upNext.title }) }}
        </p>
      </div>
    </router-link>

    <div class="absolute top-1.5 right-1.5 flex flex-col items-center gap-0.5">
      <button
        type="button"
        @click="toggleFavourite"
        :aria-pressed="String(favourite)"
        :aria-label="favourite ? $t('live.favourites.remove', { channel: channel.name }) : $t('live.favourites.add', { channel: channel.name })"
        :title="favourite ? $t('live.favourites.removeShort') : $t('live.favourites.addShort')"
        class="w-9 h-9 rounded-lg flex items-center justify-center transition active:scale-90 hover:bg-muted/70"
        :class="favourite ? 'text-amber-500' : 'text-muted-foreground/70 hover:text-foreground'"
      >
        <Star class="w-4 h-4" :class="favourite ? 'fill-current' : ''" />
      </button>

      <div class="relative">
        <button
          type="button"
          @click.stop="showMenu = !showMenu"
          :aria-expanded="String(showMenu)"
          :aria-label="$t('live.menu.optionsFor', { channel: channel.name })"
          :title="$t('live.menu.options')"
          class="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition active:scale-90 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          :class="showMenu ? '[@media(hover:hover)]:!opacity-100 bg-muted/70' : ''"
        >
          <MoreVertical class="w-4 h-4" />
        </button>

        <!-- A dropdown beside the button, or on a phone a sheet from the bottom of the screen
             (as the shelf cards' menu). -->
        <Teleport to="body" :disabled="!isPhone">
          <Transition :name="isPhone ? 'sheet' : ''" :duration="isPhone ? 260 : 0">
            <div
              v-if="showMenu"
              :class="isPhone ? 'fixed inset-0 z-[60] bg-black/50 flex items-end' : 'contents'"
              @click.self="showMenu = false"
            >
              <div
                v-click-outside="() => { if (!isPhone) showMenu = false; }"
                @click.stop
                @keydown.esc="showMenu = false"
                :role="isPhone ? 'dialog' : 'menu'"
                :aria-label="$t('live.menu.optionsFor', { channel: channel.name })"
                :class="isPhone
                  ? 'sheet-panel w-full rounded-t-2xl border-t border-border bg-card shadow-2xl px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm text-foreground'
                  : 'absolute right-0 top-9 z-30 w-60 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-2xl py-1.5 text-xs text-foreground divide-y divide-border/40'"
              >
                <template v-if="isPhone">
                  <div class="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />
                  <p class="px-2 pb-2 text-sm font-semibold truncate border-b border-border/60">{{ channel.name }}</p>
                </template>
                <div class="pb-1">
                  <button type="button" role="menuitem" @click="toggleFavourite(); showMenu = false" :class="menuItemClass">
                    <Star class="w-4 h-4" :class="favourite ? 'text-amber-500 fill-current' : 'text-muted-foreground'" />
                    <span>{{ favourite ? $t('live.favourites.removeShort') : $t('live.favourites.addShort') }}</span>
                  </button>
                </div>
                <div class="pt-1">
                  <button type="button" role="menuitem" @click="hide('channel', channel.id)" :class="menuItemClass">
                    <EyeOff class="w-4 h-4 text-muted-foreground" />
                    <span>{{ $t('live.menu.hideChannel') }}</span>
                  </button>
                  <button
                    v-for="g in hideableGroups"
                    :key="g"
                    type="button"
                    role="menuitem"
                    @click="hide('group', g)"
                    :class="menuItemClass"
                  >
                    <EyeOff class="w-4 h-4 text-muted-foreground" />
                    <span class="truncate">{{ $t('live.menu.hideGroup', { group: g }) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useIsPhone } from '../../composables/useIsPhone';
import { useLiveStore } from '../../stores/live';
import ChannelLogo from './ChannelLogo.vue';
import { clock, progressPercent, minutesLeft, airingNow, upNextAfter } from './liveFormat';
import { vClickOutside } from './clickOutside';
import { Star, MoreVertical, EyeOff } from '@lucide/vue';

const props = defineProps({
  channel: { type: Object, required: true },
  to: { type: [Object, String], required: true },
  now: { type: Number, required: true }
});
// hide: { type: 'channel' | 'group', value, channel } — the list hides it and offers Undo.
const emit = defineEmits(['hide']);

const liveStore = useLiveStore();
const isPhone = useIsPhone();
const showMenu = ref(false);
const menuItemClass = computed(() => isPhone.value
  ? 'sheet-item'
  : 'w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5');

const favourite = computed(() => liveStore.isFavourite(props.channel));
const airing = computed(() => airingNow(props.channel, props.now));
const upNext = computed(() => upNextAfter(props.channel, props.now));
// "Hide all of News for me" — for the channel's own groups (most have one).
const hideableGroups = computed(() => (props.channel.groups || []).slice(0, 3));

function toggleFavourite() {
  liveStore.toggleFavourite(props.channel).catch(() => { /* the star went back */ });
}

function hide(type, value) {
  showMenu.value = false;
  emit('hide', { type, value, channel: props.channel });
}
</script>
