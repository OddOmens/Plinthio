import { defineStore } from 'pinia';
import api from '../api/client';

export const useCustomizationStore = defineStore('customization', {
  state: () => ({
    serverName: 'Plinthio',
    customCss: '',
    accentTheme: 'zinc',
    loginMessage: '',
    layoutMode: 'topnav',
    // Admin display switches for the rating UI — mirrored from the server, all on by default.
    ratings: { showPersonal: true, showCommunity: true, showExternal: true },
    loading: false
  }),

  getters: {
    ratingsEnabled: (state) => state.ratings.showPersonal || state.ratings.showCommunity || state.ratings.showExternal
  },

  actions: {
    async fetchCustomization() {
      try {
        const res = await api.get('/customization');
        if (res.data) {
          this.serverName = res.data.serverName || 'Plinthio';
          this.customCss = res.data.customCss || '';
          this.accentTheme = res.data.accentTheme || 'zinc';
          this.loginMessage = res.data.loginMessage || '';
          this.layoutMode = res.data.layoutMode || 'topnav';
          if (res.data.ratings) this.ratings = { ...this.ratings, ...res.data.ratings };
          this.applyToDom();
        }
        return res.data;
      } catch (err) {
        console.warn('Failed to fetch server customizations:', err);
      }
    },

    async updateCustomization(payload) {
      this.loading = true;
      try {
        const res = await api.patch('/customization', payload);
        if (res.data) {
          this.serverName = res.data.serverName || this.serverName;
          this.customCss = res.data.customCss !== undefined ? res.data.customCss : this.customCss;
          this.accentTheme = res.data.accentTheme || this.accentTheme;
          this.loginMessage = res.data.loginMessage !== undefined ? res.data.loginMessage : this.loginMessage;
          this.layoutMode = res.data.layoutMode || this.layoutMode;
          if (res.data.ratings) this.ratings = { ...this.ratings, ...res.data.ratings };
          this.applyToDom();
        }
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    applyToDom() {
      // 1. Update document title
      if (this.serverName && this.serverName.trim()) {
        document.title = `${this.serverName} | Media Server`;
      }

      // 2. Set accent theme on root html
      if (this.accentTheme) {
        document.documentElement.setAttribute('data-accent', this.accentTheme);
      }

      // 3. Inject custom CSS style tag into head
      let styleTag = document.getElementById('plinthio-custom-css');
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'plinthio-custom-css';
        document.head.appendChild(styleTag);
      }
      styleTag.textContent = this.customCss || '';
    }
  }
});
