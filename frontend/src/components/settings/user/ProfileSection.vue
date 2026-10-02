<template>
  <SectionHeader title="Profile" description="Your picture and how your account is set up on this server." />

  <SettingsCard>
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
      <div class="relative flex-shrink-0">
        <img
          v-if="authStore.user?.avatar && !avatarLoadError"
          :src="authStore.user.avatar"
          :alt="authStore.user?.username || 'Avatar'"
          class="w-20 h-20 rounded-full object-cover ring-2 ring-border shadow-sm"
          @error="avatarLoadError = true"
        />
        <div
          v-else
          class="w-20 h-20 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-bold uppercase ring-2 ring-border/50 select-none"
        >
          {{ (authStore.user?.username || '?').slice(0, 2) }}
        </div>
      </div>

      <div class="flex flex-col gap-2 flex-1 min-w-0">
        <div>
          <p class="text-base font-semibold text-foreground truncate">{{ authStore.user?.username }}</p>
          <p class="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <component :is="role.icon" class="w-3.5 h-3.5" />
            {{ role.label }} · {{ role.desc }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref="avatarFileInput"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="hidden"
            @change="handleAvatarFileSelected"
          />
          <button type="button" @click="triggerAvatarUpload" :disabled="uploadingAvatar" class="btn btn-secondary">
            <Loader2 v-if="uploadingAvatar" class="w-3.5 h-3.5 animate-spin" />
            <Upload v-else class="w-3.5 h-3.5" />
            {{ authStore.user?.avatar ? 'Change picture' : 'Upload picture' }}
          </button>
          <button v-if="authStore.user?.avatar" type="button" @click="removeAvatar" :disabled="removingAvatar" class="btn btn-ghost">
            Remove
          </button>
        </div>
        <p v-if="avatarError" class="text-xs text-destructive flex items-center gap-1"><AlertCircle class="w-3.5 h-3.5" /> {{ avatarError }}</p>
        <p v-else class="text-[12px] text-muted-foreground">JPG, PNG, WebP or GIF up to 5 MB, cropped to a square.</p>
      </div>
    </div>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Upload, Loader2, AlertCircle, ShieldCheck, PenSquare, Eye } from '@lucide/vue';
import { useAuthStore } from '../../../stores/auth';
import { useDialogStore } from '../../../stores/dialog';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';

const authStore = useAuthStore();
const dialog = useDialogStore();

const ROLES = {
  admin: { label: 'Admin', desc: 'runs this server', icon: ShieldCheck },
  editor: { label: 'Editor', desc: 'can also fix titles, covers and details', icon: PenSquare },
  viewer: { label: 'Viewer', desc: 'browses, reads, watches and listens', icon: Eye }
};
const role = computed(() => ROLES[authStore.user?.role] || ROLES.viewer);

const avatarFileInput = ref(null);
const uploadingAvatar = ref(false);
const removingAvatar = ref(false);
const avatarError = ref('');
const avatarLoadError = ref(false);
watch(() => authStore.user?.avatar, () => { avatarLoadError.value = false; });

function triggerAvatarUpload() {
  avatarError.value = '';
  avatarFileInput.value?.click();
}

async function handleAvatarFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Choose an image file (PNG, JPG, WebP or GIF).';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    avatarError.value = 'That image is over 5 MB.';
    return;
  }
  uploadingAvatar.value = true;
  avatarError.value = '';
  try {
    await authStore.uploadAvatar(file);
  } catch (err) {
    avatarError.value = err.response?.data?.error || 'Could not upload that picture';
  } finally {
    uploadingAvatar.value = false;
    if (avatarFileInput.value) avatarFileInput.value.value = '';
  }
}

async function removeAvatar() {
  const confirmed = await dialog.confirm({
    title: 'Remove picture',
    message: 'Remove your profile picture? Your initials show instead.',
    confirmText: 'Remove',
    danger: true
  });
  if (!confirmed) return;
  removingAvatar.value = true;
  avatarError.value = '';
  try {
    await authStore.removeAvatar();
  } catch (err) {
    avatarError.value = err.response?.data?.error || 'Could not remove the picture';
  } finally {
    removingAvatar.value = false;
  }
}
</script>
