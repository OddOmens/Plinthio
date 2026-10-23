<template>
  <SectionHeader :title="$t('settings.security.title')" :description="$t('settings.security.description')" />

  <SettingsCard :title="$t('common.password')" :description="$t('settings.security.password.desc')">
    <form @submit.prevent="changePassword" class="flex flex-col gap-3 max-w-sm">
      <div>
        <label for="current-password" class="field-label">{{ $t('settings.security.password.current') }}</label>
        <input id="current-password" v-model="passwords.current" type="password" autocomplete="current-password" required class="field" />
      </div>
      <div>
        <label for="new-password" class="field-label">{{ $t('settings.security.password.new') }}</label>
        <input id="new-password" v-model="passwords.new" type="password" autocomplete="new-password" required minlength="8" class="field" />
        <p class="field-hint">{{ $t('settings.security.password.hint') }}</p>
      </div>
      <button type="submit" :disabled="changing" class="btn btn-primary self-start">
        {{ changing ? $t('settings.security.password.changing') : $t('settings.security.password.change') }}
      </button>
    </form>
  </SettingsCard>

  <SettingsCard id="two-factor" class="scroll-mt-24" :title="$t('settings.security.twoFactor.title')" :description="$t('settings.security.twoFactor.desc')">
    <TwoFactorSetup />
  </SettingsCard>

  <SettingsCard :title="$t('settings.security.devices.title')" :description="$t('settings.security.devices.desc')">
    <button @click="signOutEverywhere" :disabled="signingOutEverywhere" class="btn btn-danger">
      <LogOut class="w-3.5 h-3.5" />
      {{ signingOutEverywhere ? $t('settings.security.devices.signingOut') : $t('settings.security.devices.signOutAll') }}
    </button>
  </SettingsCard>
</template>

<script setup>
import { ref } from 'vue';
import { LogOut } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useDialogStore } from '../../../stores/dialog';
import { t } from '../../../i18n';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import TwoFactorSetup from '../../TwoFactorSetup.vue';

const authStore = useAuthStore();
const dialog = useDialogStore();

const passwords = ref({ current: '', new: '' });
const changing = ref(false);

async function changePassword() {
  changing.value = true;
  try {
    await api.patch('/users/password', {
      currentPassword: passwords.value.current,
      newPassword: passwords.value.new
    });
    passwords.value = { current: '', new: '' };
    // Changing the password invalidates every token, this tab's too: sign out now rather
    // than leave a "session expired" for the next click.
    await dialog.alert(t('settings.security.password.changed'));
    authStore.logout();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.security.password.changeFailed'));
  } finally {
    changing.value = false;
  }
}

const signingOutEverywhere = ref(false);
async function signOutEverywhere() {
  const confirmed = await dialog.confirm({
    title: t('settings.security.devices.confirmTitle'),
    message: t('settings.security.devices.confirmMessage'),
    confirmText: t('settings.security.devices.confirmTitle'),
    danger: true
  });
  if (!confirmed) return;
  signingOutEverywhere.value = true;
  try {
    await authStore.signOutEverywhere();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.security.devices.signOutFailed'));
    signingOutEverywhere.value = false;
  }
}
</script>
