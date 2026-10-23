<template>
  <!-- Nothing to list: either the filters match nothing, or there are no channels at all
       (none added yet, or none allowed for a kids account). -->
  <div class="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl bg-card/50 p-8">
    <div class="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center mb-3">
      <SearchX v-if="filtered" class="w-5 h-5" />
      <RadioTower v-else class="w-5 h-5" />
    </div>
    <h3 class="text-sm font-medium text-foreground">
      {{ filtered ? $t('live.empty.noMatchesTitle') : $t('live.empty.noChannelsTitle') }}
    </h3>
    <p class="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
      {{ filtered ? $t('live.empty.noMatches') : authStore.isAdmin ? $t('live.empty.noChannelsAdmin') : $t('live.empty.noChannels') }}
    </p>
    <button
      v-if="filtered"
      type="button"
      @click="$emit('clear')"
      class="px-3.5 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition"
    >
      {{ $t('live.empty.clearFilters') }}
    </button>
    <router-link
      v-else-if="authStore.isAdmin"
      :to="{ path: '/admin', query: { tab: 'liveTv' } }"
      class="px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground transition shadow-sm"
    >
      {{ $t('live.openAdmin') }}
    </router-link>
  </div>
</template>

<script setup>
import { RadioTower, SearchX } from '@lucide/vue';
import { useAuthStore } from '../../stores/auth';

defineProps({
  filtered: { type: Boolean, default: false }
});
defineEmits(['clear']);

const authStore = useAuthStore();
</script>
