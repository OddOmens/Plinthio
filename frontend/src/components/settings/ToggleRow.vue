<template>
  <!-- One on/off setting: what it is, a line about it, and a switch. Rows stack inside a
       card with `divide-y` between them. -->
  <div class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0" :class="disabled ? 'opacity-60' : ''">
    <div class="min-w-0 flex-1">
      <p :id="labelId" class="text-xs font-semibold text-foreground flex items-center gap-1.5">
        <component v-if="icon" :is="icon" class="w-3.5 h-3.5 text-muted-foreground" />
        {{ label }}
      </p>
      <p v-if="description || $slots.default" class="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
        <slot>{{ description }}</slot>
      </p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="String(!!modelValue)"
      :aria-labelledby="labelId"
      :disabled="disabled"
      @click="$emit('update:modelValue', !modelValue)"
      :class="[
        'relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed',
        modelValue ? 'bg-primary' : 'bg-muted-foreground/30'
      ]"
    >
      <span
        class="inline-block h-5 w-5 rounded-full shadow-sm transition-transform"
        :class="modelValue ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-0.5 bg-white'"
      />
    </button>
  </div>
</template>

<script setup>
import { useId } from 'vue';

defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  disabled: { type: Boolean, default: false }
});
defineEmits(['update:modelValue']);
const labelId = useId();
</script>
