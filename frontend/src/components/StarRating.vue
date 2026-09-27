<template>
  <!-- Interactive when `readonly` is false: click a star to set it, click the current value
       again to clear. Read-only mode renders fractional averages with a partial last star. -->
  <div
    class="inline-flex items-center"
    :class="gapClass"
    :role="readonly ? 'img' : 'radiogroup'"
    :aria-label="readonly ? `${displayValue} out of 5 stars` : 'Your rating'"
    @mouseleave="hover = 0"
  >
    <component
      :is="readonly ? 'span' : 'button'"
      v-for="n in 5"
      :key="n"
      :type="readonly ? undefined : 'button'"
      :role="readonly ? undefined : 'radio'"
      :aria-checked="readonly ? undefined : modelValue === n"
      :aria-label="readonly ? undefined : `${n} star${n === 1 ? '' : 's'}`"
      :title="readonly ? undefined : (modelValue === n ? 'Clear rating' : `${n} star${n === 1 ? '' : 's'}`)"
      class="relative inline-flex"
      :class="readonly ? '' : 'rounded transition active:scale-90 hover:scale-110 disabled:opacity-50 disabled:pointer-events-none'"
      :disabled="readonly ? undefined : disabled"
      @mouseenter="!readonly && (hover = n)"
      @click="!readonly && select(n)"
    >
      <Star :class="[sizeClass, 'text-muted-foreground/40']" />
      <span class="absolute inset-y-0 left-0 flex overflow-hidden" :style="{ width: fillWidth(n) }">
        <Star :class="[sizeClass, 'text-amber-400 fill-amber-400 flex-shrink-0']" />
      </span>
    </component>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Star } from 'lucide-vue-next';

const props = defineProps({
  modelValue: { type: Number, default: null },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' } // 'xs' | 'sm' | 'md' | 'lg'
});

const emit = defineEmits(['update:modelValue']);

const hover = ref(0);

const sizeClass = computed(() => ({
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-7 h-7'
}[props.size] || 'w-5 h-5'));

// Interactive stars get wider gaps so each one is a comfortable touch target.
const gapClass = computed(() => {
  if (props.size === 'xs') return 'gap-px';
  return props.readonly ? 'gap-0.5' : 'gap-1.5';
});

const displayValue = computed(() => (hover.value || props.modelValue || 0));

function fillWidth(n) {
  const value = displayValue.value;
  if (value >= n) return '100%';
  if (value <= n - 1) return '0%';
  // Partial star for averages (e.g. 3.6 fills 60% of the 4th star).
  return `${Math.round((value - (n - 1)) * 100)}%`;
}

function select(n) {
  hover.value = 0;
  emit('update:modelValue', props.modelValue === n ? null : n);
}
</script>
