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
    // Movie collections also list the films the library doesn't have (greyed, requestable).
    showMissingFilms: true,
    // Watch parties — off until an admin turns them on.
    partyModeEnabled: false,
    // What the video player shows while paused: simple | details | cinematic | bedtime.
    pauseScreen: 'details',
    // The opening sequence played before movies/episodes: the built-in clip unless an admin
    // uploads one (introCustom). introVersion changes with each upload so the new clip isn't
    // cached over.
    introEnabled: false,
    introMovies: true,
    introShows: true,
    introCustom: false,
    introVersion: null,
    introDuration: null,
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
          if (typeof res.data.showMissingFilms === 'boolean') this.showMissingFilms = res.data.showMissingFilms;
          if (typeof res.data.partyModeEnabled === 'boolean') this.partyModeEnabled = res.data.partyModeEnabled;
          if (res.data.pauseScreen) this.pauseScreen = res.data.pauseScreen;
          this.applyIntro(res.data);
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
          if (typeof res.data.showMissingFilms === 'boolean') this.showMissingFilms = res.data.showMissingFilms;
          if (typeof res.data.partyModeEnabled === 'boolean') this.partyModeEnabled = res.data.partyModeEnabled;
          if (res.data.pauseScreen) this.pauseScreen = res.data.pauseScreen;
          this.applyIntro(res.data);
          this.applyToDom();
        }
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    applyIntro(data) {
      if (!data || !('introVersion' in data)) return;
      this.introEnabled = !!data.introEnabled;
      this.introMovies = data.introMovies !== false;
      this.introShows = data.introShows !== false;
      this.introCustom = !!data.introCustom;
      this.introVersion = data.introVersion || null;
      this.introDuration = data.introDuration || null;
    },

    // Whether pressing Play on this title shows the opening sequence first. Never for extras
    // (a trailer), and the caller leaves it out of autoplayed next episodes and watch parties.
    playsIntroBefore(item) {
      if (!this.introEnabled || !this.introVersion || !item || item.extra_type) return false;
      if (item.media_type === 'movie') return this.introMovies;
      if (item.media_type === 'show' || item.media_type === 'anime') return this.introShows;
      return false;
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
