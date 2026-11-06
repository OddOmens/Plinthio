<template>
  <!-- A card's menu: a dropdown beside its button, or on a phone a sheet from the bottom of
       the screen (a dropdown from a left-column card ran off the screen's left edge). Place it
       in the `relative` box that holds the button toggling `open`. The slot gets `itemClass`
       for its buttons. -->
  <Teleport to="body" :disabled="!isPhone">
    <Transition :name="isPhone ? 'sheet' : ''" :duration="isPhone ? 260 : 0">
      <div
        v-if="open"
        :class="isPhone ? 'fixed inset-0 z-[60] bg-black/50 flex items-end' : 'contents'"
        @click.self="close"
      >
        <div
          v-click-outside="() => { if (!isPhone) close(); }"
          @click.stop
          @keydown.esc="onEscape"
          :role="isPhone ? 'dialog' : 'menu'"
          :aria-label="label"
          :class="isPhone
            ? 'sheet-panel w-full rounded-t-2xl border-t border-border bg-card shadow-2xl px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm text-foreground'
            : `absolute right-0 ${dropdownClass} z-30 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-2xl py-1.5 text-xs text-foreground divide-y divide-border/40`"
        >
          <template v-if="isPhone">
            <div class="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />
            <p class="px-2 pb-2 text-sm font-semibold truncate border-b border-border/60">{{ title }}</p>
          </template>
          <slot :item-class="itemClass" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';
import { useIsPhone } from '../composables/useIsPhone';
import { vClickOutside } from '../utils/clickOutside';

const props = defineProps({
  open: { type: Boolean, default: false },
  // The sheet's heading on a phone (the item's name).
  title: { type: String, default: '' },
  label: { type: String, default: '' },
  // Where the desktop dropdown sits below its button, and how wide it is.
  dropdownClass: { type: String, default: 'top-8 w-48' },
  closeOnEscape: { type: Boolean, default: false }
});
const emit = defineEmits(['update:open']);

const isPhone = useIsPhone();
const itemClass = computed(() => isPhone.value
  ? 'sheet-item'
  : 'w-full text-left px-3.5 py-2 hover:bg-muted/70 transition flex items-center gap-2.5');

function close() {
  emit('update:open', false);
}

function onEscape() {
  if (props.closeOnEscape) close();
}
</script>
