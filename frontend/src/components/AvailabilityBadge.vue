<template>
  <!-- Why a title can't be played, told apart at a glance:
       offloaded — the server had it and it was removed to free space; your history is kept.
                   Artwork stays in colour, dimmed (.art-offloaded), with a solid dark badge.
       not-owned — the server never had it (a film missing from a collection, a list entry).
                   Artwork goes grey (.art-not-owned), with a dashed-outline badge. -->
  <span
    class="inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap leading-none"
    :class="[kind === 'offloaded' ? 'bg-black/75 text-white' : 'bg-background/90 text-muted-foreground border border-dashed border-muted-foreground/60', small ? 'text-[10px] px-1.5 py-1' : 'text-[11px] px-2 py-1']"
    :title="kind === 'offloaded' ? offloadedTitle : 'Not on this server'"
  >
    <Archive v-if="kind === 'offloaded'" :class="small ? 'w-2.5 h-2.5' : 'w-3 h-3'" />
    <CircleDashed v-else :class="small ? 'w-2.5 h-2.5' : 'w-3 h-3'" />
    {{ kind === 'offloaded' ? 'Offloaded' : 'Not in library' }}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { Archive, CircleDashed } from '@lucide/vue';

const props = defineProps({
  kind: { type: String, required: true }, // 'offloaded' | 'not-owned'
  since: { type: String, default: null },
  small: { type: Boolean, default: false }
});

const offloadedTitle = computed(() => {
  const date = props.since ? new Date(props.since.replace(' ', 'T') + (props.since.endsWith('Z') ? '' : 'Z')) : null;
  const when = date && !Number.isNaN(date.getTime()) ? ` on ${date.toLocaleDateString()}` : '';
  return `Removed from the server${when} to free space. Your history is kept; it comes back if the file does.`;
});
</script>
