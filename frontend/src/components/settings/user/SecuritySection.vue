<template>
  <SectionHeader title="Security" description="Your password, two-factor sign-in, and the devices signed in as you." />

  <SettingsCard title="Password" description="Changing it signs you out everywhere, this browser included.">
    <form @submit.prevent="changePassword" class="flex flex-col gap-3 max-w-sm">
      <div>
        <label for="current-password" class="field-label">Current password</label>
        <input id="current-password" v-model="passwords.current" type="password" autocomplete="current-password" required class="field" />
      </div>
      <div>
        <label for="new-password" class="field-label">New password</label>
        <input id="new-password" v-model="passwords.new" type="password" autocomplete="new-password" required minlength="8" class="field" />
        <p class="field-hint">At least 8 characters.</p>
      </div>
      <button type="submit" :disabled="changing" class="btn btn-primary self-start">
        {{ changing ? 'Changing…' : 'Change password' }}
      </button>
    </form>
  </SettingsCard>

  <SettingsCard id="two-factor" class="scroll-mt-24" title="Two-factor sign-in" description="A code from your phone as well as your password. Worth it if you use Plinthio away from home.">
    <TwoFactorSetup />
  </SettingsCard>

  <SettingsCard title="Signed-in devices" description="Every phone, browser and TV you've signed in on keeps you signed in. If you've signed in somewhere you no longer control, sign out everywhere.">
    <button @click="signOutEverywhere" :disabled="signingOutEverywhere" class="btn btn-danger">
      <LogOut class="w-3.5 h-3.5" />
      {{ signingOutEverywhere ? 'Signing out…' : 'Sign out of all devices' }}
    </button>
  </SettingsCard>
</template>

<script setup>
import { ref } from 'vue';
import { LogOut } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useDialogStore } from '../../../stores/dialog';
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
    await dialog.alert('Password changed. Sign in again with your new password.');
    authStore.logout();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not change your password');
  } finally {
    changing.value = false;
  }
}

const signingOutEverywhere = ref(false);
async function signOutEverywhere() {
  const confirmed = await dialog.confirm({
    title: 'Sign out everywhere',
    message: 'Every device signed in to this account will be signed out straight away, including this one.',
    confirmText: 'Sign out everywhere',
    danger: true
  });
  if (!confirmed) return;
  signingOutEverywhere.value = true;
  try {
    await authStore.signOutEverywhere();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not sign out of all devices');
    signingOutEverywhere.value = false;
  }
}
</script>
