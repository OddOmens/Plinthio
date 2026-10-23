<template>
  <!-- A channel's logo on a neutral tile (logos come in every colour, often transparent),
       or its initials when there's no logo or it won't load. -->
  <div
    class="relative flex-shrink-0 rounded-lg border border-border bg-muted/60 dark:bg-white/90 flex items-center justify-center overflow-hidden"
    :class="sizeClass"
    :title="name"
  >
    <img
      v-if="src && !failed"
      :src="src"
      :alt="name"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="w-full h-full object-contain p-1"
      @error="failed = true"
    />
    <span
      v-else
      class="w-full h-full flex items-center justify-center font-semibold tracking-tight text-muted-foreground bg-muted dark:bg-muted"
      :class="textClass"
      aria-hidden="true"
    >{{ letters }}</span>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { initials, logoUrl } from './liveFormat';

const props = defineProps({
  logo: { type: String, default: '' },
  name: { type: String, default: '' },
  // sm (guide rows), md (channel list), lg (player)
  size: { type: String, default: 'md' }
});

const failed = ref(false);
const src = computed(() => logoUrl(props.logo));
const letters = computed(() => initials(props.name));
watch(() => props.logo, () => { failed.value = false; });

const sizeClass = computed(() => ({
  sm: 'w-9 h-9',
  md: 'w-12 h-12 sm:w-14 sm:h-14',
  lg: 'w-11 h-11 sm:w-12 sm:h-12'
}[props.size] || 'w-12 h-12'));
const textClass = computed(() => (props.size === 'sm' ? 'text-[11px]' : 'text-sm'));
</script>
