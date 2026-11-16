import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import { useThemeStore } from './stores/theme';
import { useCustomizationStore } from './stores/customization';
import { useAuthStore } from './stores/auth';
import { getMediaToken } from './utils/mediaToken';
import i18n, { applyLanguage, languageChoice } from './i18n';
import I18nT from './i18n/I18nT.vue';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);
app.use(i18n);
app.component('I18nT', I18nT);

const themeStore = useThemeStore();
themeStore.initTheme();

const customizationStore = useCustomizationStore();
const customizationLoaded = customizationStore.fetchCustomization();

// Without a media token every cover would 401, so get one before the first render.
const authStore = useAuthStore();
const ready = authStore.token && !getMediaToken() ? authStore.refreshSession() : Promise.resolve();
// Language loads before the first paint so nothing flashes up in English.
Promise.all([ready, customizationLoaded])
  .then(() => applyLanguage(languageChoice(authStore.user, customizationStore.defaultLanguage)))
  .finally(() => app.mount('#app'));

// Registered from the bundle so the CSP can forbid inline script.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW registration failed: ', err));
  });
}
