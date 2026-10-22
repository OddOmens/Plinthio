<template>
  <SectionHeader :title="$t('admin.metadata.title')" :description="$t('admin.metadata.description')" />

  <SettingsCard :title="$t('admin.metadata.tmdb.title')" :description="tmdbBuiltIn ? $t('admin.metadata.tmdb.descBuiltIn') : $t('admin.metadata.tmdb.descNeedsKey')">
    <template #actions>
      <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', tmdbConfigured ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
        {{ sourceLabel }}
      </span>
    </template>
    <form @submit.prevent="saveTmdbKey" class="flex flex-col sm:flex-row gap-2">
      <label for="tmdb-key" class="sr-only">{{ $t('admin.metadata.tmdb.keyLabel') }}</label>
      <input
        id="tmdb-key"
        v-model="tmdbKeyInput"
        type="password"
        autocomplete="off"
        :placeholder="tmdbSource === 'custom' ? $t('admin.metadata.tmdb.placeholderReplace') : tmdbBuiltIn ? $t('admin.metadata.tmdb.placeholderOptional') : $t('admin.metadata.tmdb.placeholderToken')"
        class="field flex-1 min-w-0"
      />
      <button type="submit" :disabled="saving || !tmdbKeyInput" class="btn btn-primary">{{ saving ? $t('common.saving') : $t('admin.metadata.tmdb.saveKey') }}</button>
      <button v-if="tmdbSource === 'custom'" type="button" @click="clearTmdbKey" :disabled="saving" class="btn btn-ghost">{{ tmdbBuiltIn ? $t('admin.metadata.tmdb.useBuiltIn') : $t('common.remove') }}</button>
    </form>
    <p class="field-hint">
      <I18nT keypath="admin.metadata.tmdb.getOne">
        <template #link><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">{{ $t('admin.metadata.tmdb.getOneLink') }}</a></template>
      </I18nT>
      <SaveStatus :status="save.status.value" :message="save.message.value" class="inline-flex ml-1" />
    </p>
    <p class="field-hint">{{ $t('admin.metadata.tmdb.attribution') }}</p>
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
import I18nT from '../../i18n/I18nT.vue';
import { t } from '../../i18n';

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

const sourceLabel = computed(() => (['custom', 'environment', 'builtin'].includes(tmdbSource.value)
  ? t(`admin.metadata.tmdb.sources.${tmdbSource.value}`)
  : t(tmdbConfigured.value ? 'admin.metadata.tmdb.sources.set' : 'admin.metadata.tmdb.sources.notSet')));

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
    title: t('admin.metadata.tmdb.removeTitle'),
    message: t('admin.metadata.tmdb.removeMessage'),
    confirmText: t('common.remove'),
    danger: true
  });
  if (confirmed) putKey('');
}
</script>
