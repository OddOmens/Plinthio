<template>
  <!-- One provider's API key: where it comes from, a field to save or replace it (checked
       with the provider first), and where to get one. Strings live under `i18nKey`. -->
  <SettingsCard :title="$t(`${i18nKey}.title`)" :description="$t(`${i18nKey}.description`)">
    <template #actions>
      <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', source ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
        {{ $t(`${i18nKey}.sources.${source || 'notSet'}`) }}
      </span>
    </template>
    <form @submit.prevent="put(keyInput.trim())" class="flex flex-col sm:flex-row gap-2">
      <label :for="inputId" class="sr-only">{{ $t(`${i18nKey}.keyLabel`) }}</label>
      <input
        :id="inputId"
        v-model="keyInput"
        type="password"
        autocomplete="off"
        :placeholder="source === 'custom' ? $t(`${i18nKey}.placeholderReplace`) : $t(`${i18nKey}.placeholder`)"
        class="field flex-1 min-w-0"
      />
      <button type="submit" :disabled="saving || !keyInput" class="btn btn-primary">{{ saving ? $t('common.saving') : $t(`${i18nKey}.saveKey`) }}</button>
      <button v-if="source === 'custom'" type="button" @click="put('')" :disabled="saving" class="btn btn-ghost">{{ $t('common.remove') }}</button>
    </form>
    <p class="field-hint">
      <I18nT :keypath="`${i18nKey}.getOne`">
        <template #link><a :href="getOneUrl" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">{{ $t(`${i18nKey}.getOneLink`) }}</a></template>
      </I18nT>
      <SaveStatus :status="save.status.value" :message="save.message.value" class="inline-flex ml-1" />
    </p>
  </SettingsCard>
</template>

<script setup>
import { ref, useId } from 'vue';
import api from '../../api/client';
import { useSaveStatus } from '../../composables/useSaveStatus';
import SettingsCard from '../settings/SettingsCard.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import I18nT from '../../i18n/I18nT.vue';

const props = defineProps({
  i18nKey: { type: String, required: true },
  // PUT here with { apiKey }; '' removes the saved key.
  endpoint: { type: String, required: true },
  // "custom" (saved here), "environment", or null for none.
  source: { type: String, default: null },
  getOneUrl: { type: String, required: true }
});
// Emits the server's status after a save, for the parent to read its new source.
const emit = defineEmits(['saved']);

const inputId = useId();
const save = useSaveStatus();
const keyInput = ref('');
const saving = ref(false);

async function put(apiKey) {
  saving.value = true;
  const { ok, data } = await save.run(() => api.put(props.endpoint, { apiKey }));
  if (ok) {
    emit('saved', data.data);
    keyInput.value = '';
    // "…saved and verified" says more than "Saved".
    save.message.value = data.data.message || '';
  }
  saving.value = false;
}
</script>
