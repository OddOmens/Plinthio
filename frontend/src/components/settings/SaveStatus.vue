<template>
  <!-- "Saving… / Saved / Couldn't save" beside settings that save as they change. -->
  <span
    v-if="status"
    role="status"
    class="text-[12px] font-medium flex items-center gap-1"
    :class="status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
  >
    <Loader2 v-if="status === 'saving'" class="w-3 h-3 animate-spin" />
    <CheckCircle v-else-if="status === 'saved'" class="w-3 h-3 text-emerald-500" />
    <AlertCircle v-else class="w-3 h-3" />
    {{ message || { saving: 'Saving…', saved: 'Saved', error: 'Couldn\'t save' }[status] }}
  </span>
</template>

<script setup>
import { Loader2, CheckCircle, AlertCircle } from '@lucide/vue';

defineProps({
  status: { type: String, default: '' },
  message: { type: String, default: '' }
});
</script>
