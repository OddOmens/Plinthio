<template>
  <!-- A form over the page (add a library, add or edit someone): a bottom sheet on a phone,
       a centred dialog elsewhere. The footer holds its buttons. -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div role="dialog" aria-modal="true" :aria-label="title" :class="['bg-card border border-border rounded-t-2xl sm:rounded-xl w-full shadow-xl flex flex-col max-h-[90dvh] sm:max-h-[85dvh]', width]">
        <header class="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-foreground truncate">{{ title }}</h3>
            <p v-if="subtitle" class="text-xs text-muted-foreground mt-0.5 truncate">{{ subtitle }}</p>
          </div>
          <button type="button" aria-label="Close" @click="$emit('close')" class="w-8 h-8 -mr-2 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition">
            <X class="w-4 h-4" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="px-5 py-3 border-t border-border flex flex-wrap items-center gap-2 flex-shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { X } from '@lucide/vue';

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  width: { type: String, default: 'sm:max-w-md' }
});
defineEmits(['close']);
</script>
