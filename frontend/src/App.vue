<template>
  <div class="min-h-screen bg-background text-foreground font-sans antialiased selection:bg-primary selection:text-primary-foreground">
    <UpdateBanner v-if="!['/login', '/setup'].includes(route.path)" />
    <router-view />
    <AudioPlayer />
    <GlobalDialog />
    <OnboardingFlow v-if="showOnboarding" @done="onboardingDone = true" />
  </div>
</template>

<script setup>
import { ref, computed, watchEffect, onMounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import AudioPlayer from './components/AudioPlayer.vue';
import GlobalDialog from './components/GlobalDialog.vue';
import UpdateBanner from './components/UpdateBanner.vue';
// Shown once per account, so it's fetched only when needed.
const OnboardingFlow = defineAsyncComponent(() => import('./components/OnboardingFlow.vue'));
import { useAuthStore } from './stores/auth';
import { useCustomizationStore } from './stores/customization';

const route = useRoute();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const onboardingDone = ref(false);

// Runs once per account, for everyone — the admin straight after the setup wizard, and any
// user an admin adds later (who otherwise lands on a shelf configured by someone else's
// taste). Kept off the login/setup screens so it can't cover the forms that create the
// account in the first place.
// One refresh per app load keeps an active session alive indefinitely under the shorter
// token lifetime (see POST /api/auth/refresh).
onMounted(() => {
  authStore.refreshSession();
  authStore.keepMediaTokenFresh();
});

// Accent color and page width respect user preferences when permitted by the admin,
// falling back to the admin's global server defaults.
watchEffect(() => {
  const accent = customizationStore.effectiveAccentTheme(authStore.user);
  if (accent) {
    document.documentElement.setAttribute('data-accent', accent);
  }
  const width = customizationStore.effectivePageWidth(authStore.user);
  document.documentElement.classList.toggle('page-contained', width === 'contained');
});

const showOnboarding = computed(() => {
  if (onboardingDone.value || !authStore.isAuthenticated) return false;
  if (['/login', '/setup'].includes(route.path)) return false;
  return authStore.user?.preferences?.onboardingComplete !== true;
});
</script>
