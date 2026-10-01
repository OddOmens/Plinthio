<template>
  <!-- A reader's side panel: a popover under the toolbar on a wide screen, a sheet from the
       bottom on a phone. Tapping outside it closes it either way. -->
  <Teleport to="body">
    <Transition :name="isPhone ? 'sheet' : 'panel-slide'" :duration="isPhone ? 260 : 150">
      <div
        v-if="open"
        class="fixed inset-0 z-[70]"
        :class="isPhone ? 'bg-black/40 flex items-end' : ''"
        @click.self="$emit('close')"
        @keydown.esc.stop="$emit('close')"
      >
        <div
          ref="panelEl"
          role="dialog"
          :aria-label="title"
          tabindex="-1"
          class="bg-popover text-popover-foreground border-border shadow-2xl flex flex-col focus:outline-none"
          :class="isPhone
            ? 'sheet-panel w-full max-h-[85dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]'
            : ['panel-slide-panel absolute top-[calc(3.5rem+env(safe-area-inset-top))] w-[22rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] rounded-xl border',
               side === 'left' ? 'left-[max(1rem,env(safe-area-inset-left))]' : 'right-[max(1rem,env(safe-area-inset-right))]']"
        >
          <div v-if="isPhone" class="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 flex-shrink-0" aria-hidden="true" />
          <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2 flex-shrink-0">
            <span class="text-sm font-semibold text-foreground">{{ title }}</span>
            <button
              type="button"
              :aria-label="`Close ${title.toLowerCase()}`"
              @click="$emit('close')"
              class="w-8 h-8 -mr-1.5 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
          <slot name="header" />
          <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { X } from '@lucide/vue';
import { useIsPhone } from '../composables/useIsPhone';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  side: { type: String, default: 'right' } // 'left' | 'right', wide screens only
});
defineEmits(['close']);

const isPhone = useIsPhone();
const panelEl = ref(null);

// Focus moves into the panel so Escape and screen readers land in it.
watch(() => props.open, (open) => {
  if (open) nextTick(() => panelEl.value?.focus());
});
</script>
