<template>
  <!-- A row of choice tiles (accent colours, layouts, page widths, pause screens), used by
       both Admin → Server Config and Settings → Appearance so they look the same. -->
  <div role="radiogroup" :aria-label="label" :class="gridClass">
    <button
      v-for="opt in options"
      :key="opt.id"
      type="button"
      role="radio"
      :aria-checked="modelValue === opt.id"
      :disabled="disabled"
      @click="choose(opt.id)"
      @pointerenter="$emit('hover', opt.id)"
      @pointerleave="$emit('hover', undefined)"
      :class="[
        'rounded-xl border transition text-left',
        swatches ? 'p-3 flex flex-col items-center gap-2 text-center' : 'p-3.5 flex items-start gap-3',
        modelValue === opt.id ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/20',
        disabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
      ]"
    >
      <span v-if="swatches" class="w-6 h-6 rounded-full border border-black/10 shadow-sm" :class="opt.swatch"></span>

      <!-- Layout diagram -->
      <div v-else-if="opt.diagram" class="w-11 h-9 rounded-md border border-border/70 bg-background flex p-1 flex-shrink-0" :class="opt.diagram === 'sidebar' ? 'gap-0.5' : 'flex-col gap-0.5'">
        <template v-if="opt.diagram === 'sidebar'">
          <div class="w-2.5 h-full rounded-sm bg-muted-foreground/40"></div>
          <div class="flex-1 rounded-sm bg-muted-foreground/15"></div>
        </template>
        <template v-else>
          <div class="h-1.5 w-full rounded-sm bg-muted-foreground/40"></div>
          <div class="flex-1 rounded-sm bg-muted-foreground/15"></div>
        </template>
      </div>

      <component v-else-if="opt.icon" :is="opt.icon" class="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />

      <div class="min-w-0">
        <span class="text-xs text-foreground block" :class="swatches ? '' : 'font-semibold'">{{ opt.label }}</span>
        <span v-if="opt.desc && !swatches" class="text-[12px] text-muted-foreground">{{ opt.desc }}</span>
      </div>
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  // [{ id, label, desc?, swatch?, diagram?, icon? }]
  options: { type: Array, required: true },
  modelValue: { type: String, default: null },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  // Colour dots in a compact grid, rather than tiles with a description.
  swatches: { type: Boolean, default: false },
  gridClass: { type: String, default: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }
});
const emit = defineEmits(['update:modelValue', 'hover']);

function choose(id) {
  if (props.disabled || id === props.modelValue) return;
  emit('update:modelValue', id);
}
</script>
