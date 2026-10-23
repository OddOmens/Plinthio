<template>
  <!-- One channel's own number, name and logo. Each is optional: left empty, the channel
       keeps what its list gives it (and a number after the ones you've chosen). -->
  <SettingsDialog :open="!!channel" :title="$t('admin.liveTv.editChannel.title')" :subtitle="channel?.name || ''" @close="$emit('close')">
    <form v-if="channel" id="edit-live-channel-form" @submit.prevent="submit" class="flex flex-col gap-4">
      <!-- What it looks like now -->
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img v-if="channel.logo && !logoBroken" :src="logoUrl(channel.logo)" alt="" referrerpolicy="no-referrer" class="w-full h-full object-contain p-1" @error="logoBroken = true" />
          <Tv v-else class="w-5 h-5 text-muted-foreground" />
        </div>
        <div class="min-w-0">
          <p class="text-xs font-semibold text-foreground truncate">
            <span v-if="channel.number" class="font-mono text-muted-foreground mr-1">{{ channel.number }}</span>{{ channel.customName || channel.name }}
          </p>
          <p class="text-[12px] text-muted-foreground truncate">{{ healthLine }}</p>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2">
          <label for="live-channel-number" class="field-label">{{ $t('admin.liveTv.editChannel.number') }}</label>
          <button v-if="form.number !== ''" type="button" @click="form.number = ''" class="text-[12px] text-primary hover:underline">{{ $t('admin.liveTv.editChannel.useAutomatic') }}</button>
        </div>
        <input
          id="live-channel-number"
          v-model.trim="form.number"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="4"
          :placeholder="$t('admin.liveTv.editChannel.automatic')"
          class="field font-mono w-32"
        />
        <p class="field-hint" :class="numberInvalid ? 'text-destructive' : ''">{{ $t(numberInvalid ? 'admin.liveTv.editChannel.numberInvalid' : 'admin.liveTv.editChannel.numberHint') }}</p>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2">
          <label for="live-channel-name" class="field-label">{{ $t('admin.liveTv.editChannel.name') }}</label>
          <button v-if="form.name !== ''" type="button" @click="form.name = ''" class="text-[12px] text-primary hover:underline">{{ $t('admin.liveTv.editChannel.useOriginal') }}</button>
        </div>
        <input id="live-channel-name" v-model="form.name" maxlength="100" :placeholder="channel.name" class="field" />
        <p class="field-hint">{{ $t('admin.liveTv.editChannel.nameHint', { name: channel.name }) }}</p>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2">
          <label for="live-channel-logo" class="field-label">{{ $t('admin.liveTv.editChannel.logo') }}</label>
          <button v-if="form.logo !== ''" type="button" @click="form.logo = ''" class="text-[12px] text-primary hover:underline">{{ $t('admin.liveTv.editChannel.useOriginalLogo') }}</button>
        </div>
        <input id="live-channel-logo" v-model.trim="form.logo" type="url" inputmode="url" maxlength="2000" placeholder="https://…/logo.png" class="field font-mono" />
        <p class="field-hint">{{ $t('admin.liveTv.editChannel.logoHint') }}</p>
      </div>

      <!-- Whether it plays: checked now on request -->
      <div class="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p v-if="!checkResult" class="text-[12px] text-muted-foreground flex-1 min-w-[10rem]">{{ $t('admin.liveTv.editChannel.checkHint') }}</p>
        <p v-else class="text-[12px] flex-1 min-w-[10rem] break-words" :class="checkResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" role="status">
          {{ checkResult.ok ? $t('admin.liveTv.editChannel.checkOk') : checkResult.error ? $t('admin.liveTv.editChannel.checkFailed', { error: checkResult.error }) : $t('admin.liveTv.editChannel.checkFailedNoReason') }}
        </p>
        <button type="button" @click="check" :disabled="checking" class="btn btn-secondary h-9">
          <Loader2 v-if="checking" class="w-3.5 h-3.5 animate-spin" />
          <Activity v-else class="w-3.5 h-3.5" />
          {{ checking ? $t('admin.liveTv.channels.checking') : $t('admin.liveTv.channels.checkNow') }}
        </button>
      </div>
    </form>
    <template #footer>
      <button type="button" @click="$emit('close')" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="edit-live-channel-form" :disabled="saving || numberInvalid" class="btn btn-primary">{{ saving ? $t('common.saving') : $t('common.save') }}</button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Tv, Activity, Loader2 } from '@lucide/vue';
import api from '../../../api/client';
import { useDialogStore } from '../../../stores/dialog';
import { formatDateTime } from '../../../utils/settingsFormat';
import SettingsDialog from '../../settings/SettingsDialog.vue';
import { logoUrl } from '../../live/liveFormat';
import { t } from '../../../i18n';

const props = defineProps({
  // The admin channel item being edited; null when closed.
  channel: { type: Object, default: null }
});
// saved: the channel's number, name or logo changed. checked: { health, checkedAt } from "Check now".
const emit = defineEmits(['close', 'saved', 'checked']);
const dialog = useDialogStore();

const form = ref({ number: '', name: '', logo: '' });
const saving = ref(false);
const checking = ref(false);
const logoBroken = ref(false);
// How "Check now" went this time: { ok, error }. One failure alone doesn't mark a channel offline.
const checkResult = ref(null);

watch(() => props.channel, (ch) => {
  if (!ch) return;
  form.value = {
    number: ch.number != null ? String(ch.number) : '',
    name: ch.customName || '',
    logo: ch.customLogo || ''
  };
  logoBroken.value = false;
  checkResult.value = null;
}, { immediate: true });

const numberInvalid = computed(() => {
  const v = form.value.number;
  if (v === '') return false;
  const num = Number(v);
  return !/^\d+$/.test(v) || num < 1 || num > 9999;
});

const healthLine = computed(() => {
  const ch = props.channel;
  if (!ch) return '';
  const when = ch.healthCheckedAt ? formatDateTime(ch.healthCheckedAt) : '';
  if (ch.health === 'offline') return t('admin.liveTv.editChannel.health.offline', { date: when });
  if (ch.health === 'ok') return t('admin.liveTv.editChannel.health.ok', { date: when });
  return t('admin.liveTv.editChannel.health.unchecked');
});

async function submit() {
  if (numberInvalid.value) return;
  const ch = props.channel;
  const name = form.value.name.trim();
  // Only what changed; an empty field goes back to the list's own (null).
  const body = {};
  const number = form.value.number === '' ? null : Number(form.value.number);
  if (number !== (ch.number ?? null)) body.number = number;
  if ((name || null) !== (ch.customName || null)) body.name = name || null;
  if ((form.value.logo || null) !== (ch.customLogo || null)) body.logo = form.value.logo || null;
  if (!Object.keys(body).length) {
    emit('close');
    return;
  }
  saving.value = true;
  try {
    const res = await api.patch(`/live/admin/channels/${ch.id}`, body);
    emit('saved', res.data?.channel || null);
    emit('close');
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.editChannel.couldNotSave'));
  } finally {
    saving.value = false;
  }
}

// A check follows the playlist a few hops and waits up to 10 s on each, so longer than
// the usual request timeout.
async function check() {
  checking.value = true;
  try {
    const res = await api.post(`/live/admin/channels/${props.channel.id}/check`, null, { timeout: 60000 });
    const result = res.data || {};
    checkResult.value = { ok: result.health === 'ok' && !result.error, error: result.error || '' };
    emit('checked', result);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.channels.couldNotCheck'));
  } finally {
    checking.value = false;
  }
}
</script>
