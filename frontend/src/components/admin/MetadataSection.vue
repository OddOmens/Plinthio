<template>
  <SectionHeader title="Metadata" description="Where posters, descriptions, cast and ratings come from, and tidying titles that came in from file names." />

  <SettingsCard title="TMDB key" :description="tmdbBuiltIn
    ? 'Movies, shows and anime get their details from TMDB, using the key built into Plinthio. You can paste your own TMDB key to use it instead. Manga (MangaDex) and books (Google Books, Open Library) need nothing.'
    : 'Movies, shows and anime get their details from TMDB, which needs a free key. Manga (MangaDex) and books (Google Books, Open Library) need nothing.'">
    <template #actions>
      <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', tmdbConfigured ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
        {{ sourceLabel }}
      </span>
    </template>
    <form @submit.prevent="saveTmdbKey" class="flex flex-col sm:flex-row gap-2">
      <label for="tmdb-key" class="sr-only">TMDB API key</label>
      <input
        id="tmdb-key"
        v-model="tmdbKeyInput"
        type="password"
        autocomplete="off"
        :placeholder="tmdbSource === 'custom' ? 'Paste a new key to replace it' : tmdbBuiltIn ? 'Paste your own TMDB key (optional)' : 'Paste your TMDB API Read Access Token'"
        class="field flex-1 min-w-0"
      />
      <button type="submit" :disabled="saving || !tmdbKeyInput" class="btn btn-primary">{{ saving ? 'Saving…' : 'Save key' }}</button>
      <button v-if="tmdbSource === 'custom'" type="button" @click="clearTmdbKey" :disabled="saving" class="btn btn-ghost">{{ tmdbBuiltIn ? 'Use built-in key' : 'Remove' }}</button>
    </form>
    <p class="field-hint">
      Get one free at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">themoviedb.org → Settings → API</a>.
      <SaveStatus :status="save.status.value" :message="save.message.value" class="inline-flex ml-1" />
    </p>
    <p class="field-hint">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </SettingsCard>

  <AdminMetadataManager :libraries="libraries" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
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
// "custom" (saved here), "environment" (TMDB_API_KEY), "builtin", or null. Servers before the
// built-in key don't send it.
const tmdbSource = ref(null);
const tmdbBuiltIn = ref(false);
const tmdbKeyInput = ref('');

const sourceLabel = computed(() => ({
  custom: 'Your own',
  environment: 'From TMDB_API_KEY',
  builtin: 'Built in'
}[tmdbSource.value] || (tmdbConfigured.value ? 'Set' : 'Not set')));

function readStatus(data) {
  tmdbConfigured.value = !!data.tmdbConfigured;
  tmdbSource.value = data.tmdbSource || null;
  tmdbBuiltIn.value = !!data.tmdbBuiltIn;
}
const saving = ref(false);

onMounted(async () => {
  try {
    const res = await api.get('/settings/metadata-providers');
    readStatus(res.data);
  } catch (err) {
    console.warn('Could not load metadata providers:', err);
  }
});

async function putKey(apiKey) {
  saving.value = true;
  const { ok, data } = await save.run(() => api.put('/settings/metadata-providers/tmdb-key', { apiKey }));
  if (ok) {
    readStatus(data.data);
    tmdbKeyInput.value = '';
    // "…saved and verified" says more than "Saved".
    save.message.value = data.data.message || '';
  }
  saving.value = false;
}

const saveTmdbKey = () => putKey(tmdbKeyInput.value.trim());

async function clearTmdbKey() {
  // Going back to the built-in key loses nothing.
  if (tmdbBuiltIn.value) return putKey('');
  const confirmed = await dialog.confirm({
    title: 'Remove the TMDB key',
    message: 'Movies, shows and anime stop getting new posters, details and world ratings until a key is added again.',
    confirmText: 'Remove',
    danger: true
  });
  if (confirmed) putKey('');
}
</script>
