<template>
  <!-- Shown once per server, before the first public list is added: what public channels
       are, and that adding them is the admin's call. Confirming is remembered on the server. -->
  <div class="flex flex-col gap-3">
    <div class="p-4 rounded-xl border border-border bg-muted/30 flex flex-col gap-2.5">
      <p class="text-xs font-semibold text-foreground flex items-center gap-2">
        <ShieldAlert class="w-4 h-4 text-primary flex-shrink-0" />
        {{ $t('admin.liveTv.acknowledge.title') }}
      </p>
      <ul class="text-[12px] text-muted-foreground leading-relaxed list-disc pl-4 space-y-1.5">
        <li v-for="key in ['links', 'licensing', 'yourCall', 'adult']" :key="key">{{ $t(`admin.liveTv.acknowledge.points.${key}`) }}</li>
      </ul>
    </div>

    <label class="flex items-center gap-3 min-h-11 px-3 rounded-lg border border-border cursor-pointer select-none text-xs font-medium text-foreground hover:bg-muted/40" :class="understood ? 'border-primary/50 bg-primary/[0.06]' : ''">
      <input v-model="understood" type="checkbox" class="rounded border-border accent-primary h-5 w-5 flex-shrink-0" />
      <span>{{ $t('admin.liveTv.acknowledge.understand') }}</span>
    </label>

    <button type="button" @click="confirm" :disabled="!understood || busy" class="btn btn-primary h-10 justify-center">
      <Loader2 v-if="busy" class="w-3.5 h-3.5 animate-spin" />
      {{ $t('admin.liveTv.acknowledge.continue') }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ShieldAlert, Loader2 } from '@lucide/vue';
import api from '../../../api/client';
import { useDialogStore } from '../../../stores/dialog';
import { t } from '../../../i18n';

const emit = defineEmits(['done']);
const dialog = useDialogStore();

const understood = ref(false);
const busy = ref(false);

async function confirm() {
  busy.value = true;
  try {
    await api.post('/live/admin/acknowledge');
    emit('done');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.acknowledge.couldNotSave'));
  } finally {
    busy.value = false;
  }
}
</script>
