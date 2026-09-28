<template>
  <!-- What you can do about a film in a collection that the server doesn't have: request it,
       see where a request is at, or — for one not out yet — when it's coming. -->
  <span v-if="part.upcoming" class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" :class="compact ? '' : 'h-8'">
    <CalendarClock class="w-3.5 h-3.5" />
    {{ comingLabel }}
  </span>
  <span v-else-if="status && status !== 'rejected'" class="inline-flex items-center gap-1.5 text-xs font-semibold" :class="[statusClass, compact ? '' : 'h-8']">
    <CheckCircle2 class="w-3.5 h-3.5" />
    {{ statusLabel }}
  </span>
  <button
    v-else
    type="button"
    @click.prevent.stop="request"
    :disabled="sending"
    class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold transition disabled:opacity-50"
    :class="compact ? 'h-7 px-2' : 'h-8 px-3'"
  >
    <Loader2 v-if="sending" class="w-3.5 h-3.5 animate-spin" />
    <Plus v-else class="w-3.5 h-3.5" />
    {{ status === 'rejected' ? 'Request again' : 'Request' }}
  </button>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { CalendarClock, CheckCircle2, Loader2, Plus } from '@lucide/vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';

// `part`: one film of a TMDB collection, as GET /items/:id/collection returns it.
const props = defineProps({
  part: { type: Object, required: true },
  compact: { type: Boolean, default: false }
});

const dialog = useDialogStore();
const status = ref(props.part.requestStatus || null);
const sending = ref(false);
watch(() => props.part.requestStatus, (s) => { status.value = s || null; });

const comingLabel = computed(() => {
  const year = props.part.releaseDate?.slice(0, 4);
  return year ? `Coming ${year}` : 'Announced';
});

const statusLabel = computed(() => ({
  pending: 'Requested',
  accepted_pending: 'Request approved',
  accepted_added: 'Added soon'
}[status.value] || 'Requested'));

const statusClass = computed(() => (status.value === 'pending' ? 'text-sky-500' : 'text-emerald-500'));

async function request() {
  sending.value = true;
  try {
    await api.post('/requests', {
      mediaType: 'movie',
      source: 'tmdb',
      externalId: props.part.tmdbId,
      title: props.part.title,
      releaseDate: props.part.releaseDate,
      overview: props.part.overview,
      coverUrl: props.part.posterUrl
    });
    status.value = 'pending';
  } catch (err) {
    // Someone else already asked for it — show where that request is at.
    if (err.response?.status === 409 && err.response.data?.status) {
      status.value = err.response.data.status;
    } else {
      dialog.alert(err.response?.data?.error || 'Could not send that request.');
    }
  } finally {
    sending.value = false;
  }
}
</script>
