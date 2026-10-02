<template>
  <!-- A group of related settings: a title and a line about it, then the controls.
       `flush` drops the body padding for lists that run edge to edge. -->
  <section class="bg-card border border-border rounded-xl">
    <header v-if="title || $slots.actions" class="px-4 sm:px-5 pt-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2" :class="flush ? 'pb-3 border-b border-border' : 'pb-1'">
      <div class="min-w-0 flex-1 basis-56">
        <h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
          <component v-if="icon" :is="icon" class="w-4 h-4 text-muted-foreground" />
          {{ title }}
        </h3>
        <p v-if="description || $slots.description" class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 flex-shrink-0">
        <slot name="actions" />
      </div>
    </header>
    <div :class="flush ? '' : 'px-4 sm:px-5 pb-4 pt-3'">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="px-4 sm:px-5 py-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  flush: { type: Boolean, default: false }
});
</script>
