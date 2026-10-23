<template>
  <SectionHeader :title="$t('settings.apps.title')" :description="$t('settings.apps.description')" />

  <SettingsCard :title="$t('settings.apps.reading.title')">
    <template #description>
      <I18nT keypath="settings.apps.reading.desc" tag="">
        <template #username><span class="font-mono text-foreground">{{ authStore.user?.username }}</span></template>
      </I18nT>
    </template>
    <div class="divide-y divide-border">
      <div v-for="app in readingApps" :key="app.id" class="py-3 first:pt-0 last:pb-0 flex flex-col gap-2">
        <div>
          <p class="text-xs font-semibold text-foreground">{{ app.name }}</p>
          <p class="text-[12px] text-muted-foreground leading-relaxed mt-0.5">{{ app.how }}</p>
        </div>
        <div class="flex gap-2">
          <input :value="app.url" readonly :aria-label="$t('settings.apps.reading.address', { app: app.name })" class="field font-mono flex-1 min-w-0" @focus="$event.target.select()" />
          <button @click="copy(app.url, app.id)" class="btn btn-secondary flex-shrink-0">
            <Check v-if="copiedId === app.id" class="w-3.5 h-3.5 text-emerald-500" />
            <Copy v-else class="w-3.5 h-3.5" />
            {{ copiedId === app.id ? $t('common.copied') : $t('common.copy') }}
          </button>
        </div>
      </div>
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('settings.apps.keys.title')" flush>
    <template #description>
      <I18nT keypath="settings.apps.keys.desc" tag="">
        <template #header><code class="font-mono text-[12px] bg-muted px-1 py-0.5 rounded">X-API-Key</code></template>
      </I18nT>
    </template>

    <div class="px-4 sm:px-5 py-4 border-b border-border flex flex-col gap-3">
      <form @submit.prevent="generateKey" class="flex flex-col sm:flex-row gap-2 max-w-lg">
        <label for="new-key-name" class="sr-only">{{ $t('settings.apps.keys.name') }}</label>
        <input id="new-key-name" v-model="newKeyName" :placeholder="$t('settings.apps.keys.namePlaceholder')" required class="field flex-1" />
        <button type="submit" :disabled="generating" class="btn btn-primary">
          <Plus class="w-3.5 h-3.5" /> {{ $t('settings.apps.keys.make') }}
        </button>
      </form>

      <div v-if="newGeneratedKey" class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{{ $t('settings.apps.keys.copyNow') }}</span>
          <button @click="copy(newGeneratedKey, 'new-key')" class="btn btn-secondary h-8">
            <Copy class="w-3.5 h-3.5" /> {{ copiedId === 'new-key' ? $t('common.copied') : $t('settings.apps.keys.copyKey') }}
          </button>
        </div>
        <code class="text-xs font-mono bg-background border border-border p-2.5 rounded-lg text-foreground break-all select-all">{{ newGeneratedKey }}</code>
      </div>
    </div>

    <p v-if="!apiKeys.length" class="py-8 text-center text-xs text-muted-foreground">{{ $t('settings.apps.keys.empty') }}</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="k in apiKeys" :key="k.id" class="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0 flex items-center gap-3">
          <KeyRound class="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div class="min-w-0">
            <p class="text-xs font-semibold text-foreground truncate">{{ k.name }}</p>
            <p class="text-[12px] text-muted-foreground"><span class="font-mono">••••{{ k.last4 }}</span> · {{ $t('settings.apps.keys.made', { date: formatDate(k.created_at) }) }}</p>
          </div>
        </div>
        <button @click="deleteKey(k)" class="btn btn-ghost btn-icon hover:text-destructive" :aria-label="$t('settings.apps.keys.revokeNamed', { name: k.name })" :title="$t('settings.apps.keys.revokeKey')">
          <Trash2 class="w-4 h-4" />
        </button>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Copy, Check, Plus, KeyRound, Trash2 } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useDialogStore } from '../../../stores/dialog';
import { formatDate } from '../../../utils/settingsFormat';
import { t } from '../../../i18n';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';

const authStore = useAuthStore();
const dialog = useDialogStore();

const origin = window.location.origin;
// App and device names stay as they are; the steps follow the reader's language.
const readingApps = computed(() => [
  {
    id: 'mihon',
    name: 'Mihon (Android)',
    how: t('settings.apps.reading.mihon'),
    url: origin
  },
  {
    id: 'koreader',
    name: 'KOReader (Kobo, Kindle, PocketBook, Android)',
    how: t('settings.apps.reading.koreader'),
    url: `${origin}/api/kosync`
  },
  {
    id: 'opds',
    name: t('settings.apps.reading.opdsName'),
    how: t('settings.apps.reading.opds'),
    url: `${origin}/api/opds`
  }
]);

const copiedId = ref('');
let copiedTimer = null;
async function copy(text, id) {
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedId.value = ''; }, 2000);
  } catch (err) {
    console.warn('Could not copy:', err);
  }
}

const apiKeys = ref([]);
const newKeyName = ref('');
const newGeneratedKey = ref('');
const generating = ref(false);

async function loadKeys() {
  const res = await api.get('/keys');
  apiKeys.value = res.data.keys || [];
}
onMounted(() => loadKeys().catch((err) => console.warn('Could not load API keys:', err)));

async function generateKey() {
  generating.value = true;
  try {
    const res = await api.post('/keys', { name: newKeyName.value });
    newGeneratedKey.value = res.data.key.key;
    newKeyName.value = '';
    await loadKeys();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.apps.keys.makeFailed'));
  } finally {
    generating.value = false;
  }
}

async function deleteKey(key) {
  const confirmed = await dialog.confirm({
    title: t('settings.apps.keys.revokeTitle'),
    message: t('settings.apps.keys.revokeMessage', { name: key.name }),
    confirmText: t('settings.apps.keys.revoke'),
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete(`/keys/${key.id}`);
    apiKeys.value = apiKeys.value.filter((k) => k.id !== key.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.apps.keys.revokeFailed'));
  }
}
</script>
