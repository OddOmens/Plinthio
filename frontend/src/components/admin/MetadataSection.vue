<template>
  <SectionHeader :title="$t('admin.metadata.title')" :description="$t('admin.metadata.description')" />

  <SettingsCard :title="$t('admin.metadata.providers.title')" :description="$t('admin.metadata.providers.description')">
    <template #actions><SaveStatus :status="providerSave.status.value" :message="providerSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="provider in PROVIDERS"
        :key="provider.id"
        :label="$t(`admin.metadata.providers.${provider.key}.label`)"
        :description="$t(`admin.metadata.providers.${provider.key}.desc`)"
        :badge="$t(`admin.metadata.providers.keys.${keyNeed(provider)}`)"
        :badge-class="keyNeed(provider) === 'missing' ? 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10' : undefined"
        :model-value="providers[provider.id] !== false"
        @update:model-value="setProvider(provider.id, $event)"
      />
    </div>
  </SettingsCard>

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

  <ProviderKeyCard
    i18n-key="admin.metadata.googleBooks"
    endpoint="/settings/metadata-providers/google-books-key"
    :source="googleBooksSource"
    get-one-url="https://console.cloud.google.com/apis/library/books.googleapis.com"
    @saved="readGoogleBooksStatus"
  />

  <ProviderKeyCard
    i18n-key="admin.metadata.comicVine"
    endpoint="/settings/metadata-providers/comicvine-key"
    :source="comicVineSource"
    get-one-url="https://comicvine.gamespot.com/api/"
    @saved="readComicVineStatus"
  />

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
import ToggleRow from '../settings/ToggleRow.vue';
import ProviderKeyCard from './ProviderKeyCard.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t } from '../../i18n';

defineProps({
  libraries: { type: Array, default: () => [] }
});
const dialog = useDialogStore();
const save = useSaveStatus();
const providerSave = useSaveStatus();

// The sources Plinthio asks, each of which an admin can switch off. `key` names its strings;
// `apiKey` says whether it needs one: never, optional, required, or built into release images.
const PROVIDERS = [
  { id: 'tmdb', key: 'tmdb', apiKey: 'builtin' },
  { id: 'tvmaze', key: 'tvmaze', apiKey: 'none' },
  { id: 'anilist', key: 'anilist', apiKey: 'none' },
  { id: 'mangadex', key: 'mangadex', apiKey: 'none' },
  { id: 'comicvine', key: 'comicvine', apiKey: 'required' },
  { id: 'open-library', key: 'openLibrary', apiKey: 'none' },
  { id: 'google-books', key: 'googleBooks', apiKey: 'optional' },
  { id: 'audible', key: 'audible', apiKey: 'none' }
];

// What the badge says: "No key needed", "Optional key", "Key built in", "Key set", or
// "Needs a key" when one is required and missing.
function keyNeed(provider) {
  if (provider.apiKey === 'required') return comicVineSource.value ? 'set' : 'missing';
  if (provider.apiKey === 'builtin') return tmdbConfigured.value ? (tmdbSource.value === 'builtin' ? 'builtin' : 'set') : 'missing';
  if (provider.apiKey === 'optional') return googleBooksSource.value ? 'set' : 'optional';
  return 'none';
}
// { tmdb: true, … }; servers before the switches don't send it, and everything is on.
const providers = ref({});

async function setProvider(provider, enabled) {
  const before = providers.value;
  providers.value = { ...before, [provider]: enabled };
  const { ok, data } = await providerSave.run(() => api.put('/settings/metadata-providers/enabled', { provider, enabled }));
  if (ok) providers.value = data.data.providers || providers.value;
  else providers.value = before;
}

const tmdbConfigured = ref(false);
// "custom" (saved here), "environment" (TMDB_API_KEY), "builtin", or null. Servers before the
// built-in key don't send it.
const tmdbSource = ref(null);
const tmdbBuiltIn = ref(false);
const tmdbKeyInput = ref('');

const sourceLabel = computed(() => (['custom', 'environment', 'builtin'].includes(tmdbSource.value)
  ? t(`admin.metadata.tmdb.sources.${tmdbSource.value}`)
  : t(tmdbConfigured.value ? 'admin.metadata.tmdb.sources.set' : 'admin.metadata.tmdb.sources.notSet')));

// "custom" (saved here), "environment" (GOOGLE_BOOKS_API_KEY), or null for none — books
// then use Open Library and Google's shared keyless quota.
const googleBooksSource = ref(null);
// The same for Comic Vine (COMICVINE_API_KEY), which isn't asked at all without one.
const comicVineSource = ref(null);

function readStatus(data) {
  tmdbConfigured.value = !!data.tmdbConfigured;
  tmdbSource.value = data.tmdbSource || null;
  tmdbBuiltIn.value = !!data.tmdbBuiltIn;
}

function readGoogleBooksStatus(data) {
  googleBooksSource.value = ['custom', 'environment'].includes(data.googleBooksSource) ? data.googleBooksSource : null;
}

function readComicVineStatus(data) {
  comicVineSource.value = ['custom', 'environment'].includes(data.comicVineSource) ? data.comicVineSource : null;
}
const saving = ref(false);

onMounted(async () => {
  try {
    const res = await api.get('/settings/metadata-providers');
    readStatus(res.data);
    readGoogleBooksStatus(res.data);
    readComicVineStatus(res.data);
    providers.value = res.data.providers || {};
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
