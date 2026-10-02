<template>
  <!-- The top of a Settings or Admin section: its name (the phone's header bar already shows
       it there), what it's for, and its actions on the right. -->
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1 basis-64">
      <h2 class="hidden md:block text-lg font-semibold text-foreground tracking-tight">{{ title }}</h2>
      <p v-if="description || $slots.description" class="text-xs text-muted-foreground md:mt-1 leading-relaxed max-w-2xl">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2 flex-shrink-0">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' }
});
</script>
