// Whether the nav offers Live TV: an admin has turned it on and this account has at least
// one channel to watch. The channel count is asked for once per app load (see the
// customization store's loadLiveStatus), whichever header mounts first.
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { useCustomizationStore } from '../../stores/customization';

export function useLiveNav() {
  const authStore = useAuthStore();
  const customizationStore = useCustomizationStore();
  const route = useRoute();

  watch(
    () => [customizationStore.liveTvEnabled, authStore.isAuthenticated ? authStore.user?.id : null],
    ([enabled, userId]) => { if (enabled && userId) customizationStore.loadLiveStatus(userId); },
    { immediate: true }
  );

  return {
    showLiveTv: computed(() => customizationStore.showLiveTv),
    onLive: computed(() => route.path === '/live' || route.path.startsWith('/live/'))
  };
}
