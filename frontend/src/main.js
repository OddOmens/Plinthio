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

// Initialize theme (dark or light)
const themeStore = useThemeStore();
themeStore.initTheme();

// Initialize server customization (CSS, title, accent theme)
const customizationStore = useCustomizationStore();
const customizationLoaded = customizationStore.fetchCustomization();

// A session from before media tokens existed (or one whose media token was cleared) has
// nothing to put in cover/stream URLs yet — fetch one before the first shelf renders so
// every image doesn't 401. Normal loads skip this and refresh in the background instead.
const authStore = useAuthStore();
const ready = authStore.token && !getMediaToken() ? authStore.refreshSession() : Promise.resolve();
// The language (the account's, this device's, or the server's default) is loaded before the
// first paint so nothing flashes up in English first.
Promise.all([ready, customizationLoaded])
  .then(() => applyLanguage(languageChoice(authStore.user, customizationStore.defaultLanguage)))
  .finally(() => app.mount('#app'));

// Registered from the bundle rather than an inline <script>, so the Content-Security-Policy
// can forbid inline script outright.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW registration failed: ', err));
  });
}
