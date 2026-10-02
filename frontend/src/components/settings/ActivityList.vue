<template>
  <!-- Sign-ins and viewing sessions, newest first: Settings → Activity (yours) and
       Admin → Activity (everyone's, with names and addresses). -->
  <div v-if="!entries.length" class="py-12 text-center text-xs text-muted-foreground">
    {{ loading ? 'Loading…' : 'No activity recorded yet.' }}
  </div>
  <ul v-else class="divide-y divide-border">
    <li v-for="entry in entries" :key="`${entry.type}-${entry.id}`" class="px-4 sm:px-5 py-3 flex items-center gap-3">
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        :class="entry.type === 'login' ? (entry.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive') : 'bg-muted text-muted-foreground'"
      >
        <LogIn v-if="entry.type === 'login'" class="w-4 h-4" />
        <component v-else :is="mediaTypeIcon(entry.media_type)" class="w-4 h-4" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs text-foreground truncate">
          <template v-if="showUser"><span class="font-semibold">{{ entry.username }}</span>{{ ' ' }}</template>
          <template v-if="entry.type === 'login'">
            {{ entry.success ? (showUser ? 'signed in' : 'Signed in') : (showUser ? 'failed to sign in' : 'Failed sign-in attempt') }}
          </template>
          <template v-else>
            {{ entry.ended_at ? (showUser ? 'viewed' : 'Viewed') : (showUser ? 'is viewing' : 'Viewing') }}
            <span class="italic">{{ entry.item_title || 'a deleted item' }}</span>
          </template>
        </p>
        <p class="text-[12px] text-muted-foreground">
          {{ formatDateTime(entry.timestamp) }}
          <span v-if="showUser && entry.type === 'login' && entry.ip_address"> · {{ entry.ip_address }}</span>
          <span v-if="entry.type === 'view' && entry.duration_seconds"> · {{ formatDurationShort(entry.duration_seconds) }}</span>
        </p>
      </div>
    </li>
  </ul>
</template>

<script setup>
import { LogIn } from '@lucide/vue';
import { mediaTypeIcon, formatDateTime, formatDurationShort } from '../../utils/settingsFormat';

defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  showUser: { type: Boolean, default: false }
});
</script>
