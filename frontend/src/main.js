import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import { useThemeStore } from './stores/theme';
import { useCustomizationStore } from './stores/customization';
import { useAuthStore } from './stores/auth';
import { getMediaToken } from './utils/mediaToken';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);

// Initialize theme (dark or light)
const themeStore = useThemeStore();
themeStore.initTheme();

// Initialize server customization (CSS, title, accent theme)
const customizationStore = useCustomizationStore();
customizationStore.fetchCustomization();

// A session from before media tokens existed (or one whose media token was cleared) has
// nothing to put in cover/stream URLs yet — fetch one before the first shelf renders so
// every image doesn't 401. Normal loads skip this and refresh in the background instead.
const authStore = useAuthStore();
const ready = authStore.token && !getMediaToken() ? authStore.refreshSession() : Promise.resolve();
ready.finally(() => app.mount('#app'));

// Registered from the bundle rather than an inline <script>, so the Content-Security-Policy
// can forbid inline script outright.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW registration failed: ', err));
  });
}
