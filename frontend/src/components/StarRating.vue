<template>
  <!-- Interactive when `readonly` is false: click a star's left half for a half star, its
       right half for a whole one, or the current value again to clear; arrow keys step by
       halves. Read-only mode renders fractional averages with a partial last star. -->
  <div
    class="inline-flex items-center"
    :class="gapClass"
    :role="readonly ? 'img' : 'radiogroup'"
    :aria-label="readonly ? $t('title.rating.outOfFive', { value: $n(displayValue) }) : $t('title.rating.yourRating')"
    @mouseleave="hover = 0"
    @keydown="onKeydown"
  >
    <component
      :is="readonly ? 'span' : 'button'"
      v-for="n in 5"
      :key="n"
      :type="readonly ? undefined : 'button'"
      :role="readonly ? undefined : 'radio'"
      :aria-checked="readonly ? undefined : Math.ceil(modelValue || 0) === n"
      :aria-label="readonly ? undefined : $t('title.rating.stars', { count: n })"
      :title="readonly ? undefined : (hover && hover === modelValue ? $t('title.rating.clear') : $t('title.rating.stars', { count: hover || n }))"
      class="inline-flex"
      :class="readonly ? '' : 'p-1 rounded transition active:scale-90 hover:scale-110 disabled:opacity-50 disabled:pointer-events-none'"
      :disabled="readonly ? undefined : disabled"
      @mousemove="!readonly && (hover = pointedValue(n, $event))"
      @click="!readonly && select(pointedValue(n, $event))"
    >
      <span class="relative inline-flex">
        <Star :class="[sizeClass, 'text-muted-foreground/40']" />
        <span class="absolute inset-y-0 left-0 flex overflow-hidden" :style="{ width: fillWidth(n) }">
          <Star :class="[sizeClass, 'text-amber-400 fill-amber-400 flex-shrink-0']" />
        </span>
      </span>
    </component>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Star } from '@lucide/vue';

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

// Interactive stars pad each button out to a comfortable touch target (a bare 20px star
// was hard to hit on a phone), and a negative margin keeps the row lined up with the
// text around it.
const gapClass = computed(() => {
  if (props.size === 'xs') return 'gap-px';
  return props.readonly ? 'gap-0.5' : 'gap-0.5 -m-1';
});

const displayValue = computed(() => (hover.value || props.modelValue || 0));

function fillWidth(n) {
  const value = displayValue.value;
  if (value >= n) return '100%';
  if (value <= n - 1) return '0%';
  // Partial star for averages (e.g. 3.6 fills 60% of the 4th star).
  return `${Math.round((value - (n - 1)) * 100)}%`;
}

// Which value a pointer on star `n` means: its left half is n − ½. A click from the keyboard
// (Enter/Space, detail 0) has no position, so it picks the whole star.
function pointedValue(n, event) {
  if (!event || (event.type === 'click' && event.detail === 0)) return n;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX - rect.left < rect.width / 2 ? n - 0.5 : n;
}

function select(value) {
  hover.value = 0;
  emit('update:modelValue', props.modelValue === value ? null : value);
}

function onKeydown(event) {
  if (props.readonly || props.disabled) return;
  const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[event.key];
  if (!step) return;
  event.preventDefault();
  const next = Math.min(5, Math.max(0, (props.modelValue || 0) + step));
  hover.value = 0;
  emit('update:modelValue', next === 0 ? null : next);
}
</script>
