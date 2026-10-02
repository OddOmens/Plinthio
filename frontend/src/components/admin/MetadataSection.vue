<template>
  <SectionHeader title="Metadata" description="Where posters, descriptions, cast and ratings come from, and tidying titles that came in from file names." />

  <SettingsCard title="TMDB key" description="Movies, shows and anime get their details from TMDB, which needs a free key. Manga (MangaDex) and books (Google Books, Open Library) need nothing.">
    <template #actions>
      <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', tmdbConfigured ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
        {{ tmdbConfigured ? 'Set' : 'Not set' }}
      </span>
    </template>
    <form @submit.prevent="saveTmdbKey" class="flex flex-col sm:flex-row gap-2">
      <label for="tmdb-key" class="sr-only">TMDB API key</label>
      <input
        id="tmdb-key"
        v-model="tmdbKeyInput"
        type="password"
        autocomplete="off"
        :placeholder="tmdbConfigured ? 'Paste a new key to replace it' : 'Paste your TMDB API Read Access Token'"
        class="field flex-1 min-w-0"
      />
      <button type="submit" :disabled="saving || !tmdbKeyInput" class="btn btn-primary">{{ saving ? 'Saving…' : 'Save key' }}</button>
      <button v-if="tmdbConfigured" type="button" @click="clearTmdbKey" :disabled="saving" class="btn btn-ghost">Remove</button>
    </form>
    <p class="field-hint">
      Get one free at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">themoviedb.org → Settings → API</a>.
      <SaveStatus :status="save.status.value" :message="save.message.value" class="inline-flex ml-1" />
    </p>
  </SettingsCard>

  <AdminMetadataManager :libraries="libraries" />
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import AdminMetadataManager from '../AdminMetadataManager.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SaveStatus from '../settings/SaveStatus.vue';

defineProps({
  libraries: { type: Array, default: () => [] }
});
const dialog = useDialogStore();
const save = useSaveStatus();

const tmdbConfigured = ref(false);
const tmdbKeyInput = ref('');
const saving = ref(false);

onMounted(async () => {
  try {
    const res = await api.get('/settings/metadata-providers');
    tmdbConfigured.value = !!res.data.tmdbConfigured;
  } catch (err) {
    console.warn('Could not load metadata providers:', err);
  }
});

async function putKey(apiKey) {
  saving.value = true;
  const { ok, data } = await save.run(() => api.put('/settings/metadata-providers/tmdb-key', { apiKey }));
  if (ok) {
    tmdbConfigured.value = !!data.data.tmdbConfigured;
    tmdbKeyInput.value = '';
    // "…saved and verified" says more than "Saved".
    save.message.value = data.data.message || '';
  }
  saving.value = false;
}

const saveTmdbKey = () => putKey(tmdbKeyInput.value.trim());

async function clearTmdbKey() {
  const confirmed = await dialog.confirm({
    title: 'Remove the TMDB key',
    message: 'Movies, shows and anime stop getting new posters, details and world ratings until a key is added again.',
    confirmText: 'Remove',
    danger: true
  });
  if (confirmed) putKey('');
}
</script>
