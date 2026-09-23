<template>
  <div class="min-h-screen bg-background text-foreground font-sans antialiased selection:bg-primary selection:text-primary-foreground">
    <router-view />
    <AudioPlayer />
    <GlobalDialog />
    <OnboardingFlow v-if="showOnboarding" @done="onboardingDone = true" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import AudioPlayer from './components/AudioPlayer.vue';
import GlobalDialog from './components/GlobalDialog.vue';
import OnboardingFlow from './components/OnboardingFlow.vue';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const authStore = useAuthStore();
const onboardingDone = ref(false);

// Runs once per account, for everyone — the admin straight after the setup wizard, and any
// user an admin adds later (who otherwise lands on a shelf configured by someone else's
// taste). Kept off the login/setup screens so it can't cover the forms that create the
// account in the first place.
const showOnboarding = computed(() => {
  if (onboardingDone.value || !authStore.isAuthenticated) return false;
  if (['/login', '/setup'].includes(route.path)) return false;
  return authStore.user?.preferences?.onboardingComplete !== true;
});
</script>
