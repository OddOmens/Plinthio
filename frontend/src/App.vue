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
import { ref, computed, watch, watchEffect, onMounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import AudioPlayer from './components/AudioPlayer.vue';
import GlobalDialog from './components/GlobalDialog.vue';
import UpdateBanner from './components/UpdateBanner.vue';
// Shown once per account, so it's fetched only when needed.
const OnboardingFlow = defineAsyncComponent(() => import('./components/OnboardingFlow.vue'));
import { useAuthStore } from './stores/auth';
import { useCustomizationStore } from './stores/customization';
import { applyLanguage, languageChoice } from './i18n';

const route = useRoute();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const onboardingDone = ref(false);

// One refresh per app load keeps an active session alive under the short token lifetime.
onMounted(() => {
  authStore.refreshSession();
  authStore.keepMediaTokenFresh();
});

// User's accent and page width when the admin allows it, else the server defaults.
watchEffect(() => {
  const accent = customizationStore.effectiveAccentTheme(authStore.user);
  if (accent) {
    document.documentElement.setAttribute('data-accent', accent);
  }
  const width = customizationStore.effectivePageWidth(authStore.user);
  document.documentElement.classList.toggle('page-contained', width === 'contained');
});

// Signing in brings the account's language along; an admin changing the server's default
// reaches everyone who hasn't chosen their own.
watch(() => languageChoice(authStore.user, customizationStore.defaultLanguage), (choice) => applyLanguage(choice));

// Once per account; never over the login/setup forms.
const showOnboarding = computed(() => {
  if (onboardingDone.value || !authStore.isAuthenticated) return false;
  if (['/login', '/setup'].includes(route.path)) return false;
  return authStore.user?.preferences?.onboardingComplete !== true;
});
</script>
