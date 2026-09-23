import { defineStore } from 'pinia';

export const useThemeStore = defineStore('theme', {
  state: () => ({
    isDark: localStorage.getItem('plinthio_theme') === 'light' ? false : true
  }),

  actions: {
    initTheme() {
      this.applyTheme();
    },

    toggleTheme() {
      this.isDark = !this.isDark;
      localStorage.setItem('plinthio_theme', this.isDark ? 'dark' : 'light');
      this.applyTheme();
    },

    applyTheme() {
      if (this.isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }
});
