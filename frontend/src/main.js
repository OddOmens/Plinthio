import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import { useThemeStore } from './stores/theme';
import { useCustomizationStore } from './stores/customization';

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

app.mount('#app');
