<template>
  <!-- The viewer's own Live TV choices: the Home row, and what they've hidden for
       themselves (channels and whole groups), each with a way back. -->
  <SettingsDialog :open="open" :title="$t('live.mine.title')" :subtitle="$t('live.mine.subtitle')" @close="$emit('close')">
    <div class="rounded-xl border border-border bg-muted/20 px-4 py-3">
      <ToggleRow
        :model-value="liveStore.prefs.showOnHome"
        :label="$t('live.mine.showOnHome')"
        :description="$t('live.mine.showOnHomeHint')"
        :icon="Home"
        :disabled="savingHome"
        @update:model-value="setShowOnHome"
      />
    </div>

    <div class="flex flex-col gap-2">
      <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <EyeOff class="w-3.5 h-3.5" />
        {{ $t('live.mine.hiddenTitle') }}
      </h4>

      <div v-if="loading && !loaded" class="flex flex-col gap-2">
        <div v-for="i in 3" :key="i" class="h-12 rounded-lg bg-muted/40 animate-pulse" />
      </div>
      <p v-else-if="loadError" class="text-xs text-destructive">{{ loadError }}</p>
      <p v-else-if="!channels.length && !groups.length" class="text-sm text-muted-foreground py-2">{{ $t('live.mine.nothingHidden') }}</p>

      <template v-else>
        <ul v-if="groups.length" class="rounded-xl border border-border divide-y divide-border/60">
          <li v-for="g in groups" :key="`g-${g}`" class="flex items-center gap-3 px-3 py-2">
            <div class="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center flex-shrink-0">
              <Layers class="w-4 h-4" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground truncate">{{ g }}</p>
              <p class="text-[11px] text-muted-foreground">{{ $t('live.mine.wholeGroup') }}</p>
            </div>
            <button type="button" @click="showGroup(g)" :disabled="busy" :class="showBtnClass">{{ $t('live.mine.show') }}</button>
          </li>
        </ul>
        <ul v-if="channels.length" class="rounded-xl border border-border divide-y divide-border/60">
          <li v-for="ch in channels" :key="ch.id" class="flex items-center gap-3 px-3 py-2">
            <ChannelLogo :logo="ch.logo" :name="ch.name" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground truncate">{{ ch.name }}</p>
              <p v-if="ch.number" class="text-[11px] font-mono text-muted-foreground tabular-nums">{{ ch.number }}</p>
            </div>
            <button type="button" @click="showChannel(ch.id)" :disabled="busy" :class="showBtnClass">{{ $t('live.mine.show') }}</button>
          </li>
        </ul>
      </template>
      <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
    </div>

    <template #footer>
      <button
        v-if="channels.length + groups.length > 1"
        type="button"
        @click="showEverything"
        :disabled="busy"
        class="h-10 px-4 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition disabled:opacity-50"
      >
        {{ $t('live.mine.showAll') }}
      </button>
      <button type="button" @click="$emit('close')" class="ml-auto h-10 px-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition">
        {{ $t('common.done') }}
      </button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import api from '../../api/client';
import { useLiveStore } from '../../stores/live';
import SettingsDialog from '../settings/SettingsDialog.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import ChannelLogo from './ChannelLogo.vue';
import { t } from '../../i18n';
import { EyeOff, Layers, Home } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false }
});
defineEmits(['close']);

const liveStore = useLiveStore();
const showBtnClass = 'h-9 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition active:scale-95 disabled:opacity-50 flex-shrink-0';

const channels = ref([]);
const groups = ref([]);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref('');
const saveError = ref('');
const busy = ref(false);
const savingHome = ref(false);

// Hidden channels no longer come back in any list, so their current names come from here.
async function load() {
  loading.value = true;
  try {
    const res = await api.get('/live/me/hidden');
    channels.value = res.data?.channels || [];
    groups.value = res.data?.groups || [];
    loadError.value = '';
    loaded.value = true;
  } catch (err) {
    loadError.value = err.response?.data?.error || t('live.errors.unreachable');
  } finally {
    loading.value = false;
  }
}

watch(() => props.open, (open) => {
  if (!open) return;
  saveError.value = '';
  load();
}, { immediate: true });

async function run(action, undo) {
  busy.value = true;
  saveError.value = '';
  try {
    await action();
  } catch (err) {
    undo();
    saveError.value = t('live.mine.saveFailed');
  } finally {
    busy.value = false;
  }
}

function showChannel(id) {
  const before = channels.value;
  channels.value = before.filter((ch) => ch.id !== id);
  run(() => liveStore.showChannel(id), () => { channels.value = before; });
}

function showGroup(name) {
  const before = groups.value;
  groups.value = before.filter((g) => g !== name);
  run(() => liveStore.showGroup(name), () => { groups.value = before; });
}

function showEverything() {
  const before = { channels: channels.value, groups: groups.value };
  channels.value = [];
  groups.value = [];
  run(() => liveStore.showEverything(), () => {
    channels.value = before.channels;
    groups.value = before.groups;
  });
}

async function setShowOnHome(value) {
  savingHome.value = true;
  try {
    await liveStore.setShowOnHome(value);
  } catch (err) {
    saveError.value = t('live.mine.saveFailed');
  } finally {
    savingHome.value = false;
  }
}
</script>
