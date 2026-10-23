import { defineStore } from 'pinia';
import api from '../api/client';

export const useCustomizationStore = defineStore('customization', {
  state: () => ({
    serverName: 'Plinthio',
    customCss: '',
    accentTheme: 'zinc',
    loginMessage: '',
    layoutMode: 'topnav',
    // Server default page width: full | contained
    pageWidth: 'full',
    // Granular permissions for user personalizations:
    userCustomization: {
      enabled: true,
      accentColor: true,
      layoutMode: true,
      pageWidth: true,
      pauseScreen: true
    },
    // Admin display switches for the rating UI — mirrored from the server, all on by default.
    ratings: { showPersonal: true, showCommunity: true, showExternal: true },
    // Movie collections also list the films the library doesn't have (greyed, requestable).
    showMissingFilms: true,
    // Watch parties — off until an admin turns them on.
    partyModeEnabled: false,
    // Live TV — off until an admin turns it on. liveChannelCount is how many channels this
    // account may watch (GET /api/live/status), asked once per app load while it's on, so the
    // nav only offers Live TV when there's something to watch.
    liveTvEnabled: false,
    liveChannelCount: 0,
    liveStatusFor: null,
    // What the video player shows while paused: simple | details | cinematic | bedtime.
    pauseScreen: 'details',
    // The language for anyone who hasn't picked one: 'auto' (their browser's) or a code.
    defaultLanguage: 'auto',
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
    showLiveTv: (state) => state.liveTvEnabled && state.liveChannelCount > 0,
    ratingsEnabled: (state) => state.ratings.showPersonal || state.ratings.showCommunity || state.ratings.showExternal,
    isCustomizationAllowed: (state) => (feature) => {
      if (!state.userCustomization || state.userCustomization.enabled === false) return false;
      return state.userCustomization[feature] !== false;
    },
    effectiveAccentTheme: (state) => (user) => {
      if (state.userCustomization?.enabled !== false && state.userCustomization?.accentColor !== false && user?.preferences?.accentTheme) {
        return user.preferences.accentTheme;
      }
      return state.accentTheme || 'zinc';
    },
    effectiveLayoutMode: (state) => (user) => {
      if (state.userCustomization?.enabled !== false && state.userCustomization?.layoutMode !== false && user?.preferences?.layoutMode) {
        return user.preferences.layoutMode;
      }
      return state.layoutMode || 'topnav';
    },
    effectivePageWidth: (state) => (user) => {
      if (state.userCustomization?.enabled !== false && state.userCustomization?.pageWidth !== false && user?.preferences?.pageWidth) {
        return user.preferences.pageWidth;
      }
      return state.pageWidth || 'full';
    },
    effectivePauseScreen: (state) => (user) => {
      if (state.userCustomization?.enabled !== false && state.userCustomization?.pauseScreen !== false && user?.preferences?.pauseScreen) {
        return user.preferences.pauseScreen;
      }
      return state.pauseScreen || 'details';
    }
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
          if (res.data.pageWidth) this.pageWidth = res.data.pageWidth;
          if (res.data.userCustomization) {
            this.userCustomization = { ...this.userCustomization, ...res.data.userCustomization };
          }
          if (res.data.ratings) this.ratings = { ...this.ratings, ...res.data.ratings };
          if (typeof res.data.showMissingFilms === 'boolean') this.showMissingFilms = res.data.showMissingFilms;
          if (typeof res.data.partyModeEnabled === 'boolean') this.partyModeEnabled = res.data.partyModeEnabled;
          if (typeof res.data.liveTvEnabled === 'boolean') this.setLiveTvEnabled(res.data.liveTvEnabled);
          if (res.data.pauseScreen) this.pauseScreen = res.data.pauseScreen;
          if (res.data.defaultLanguage) this.defaultLanguage = res.data.defaultLanguage;
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
          if (res.data.pageWidth) this.pageWidth = res.data.pageWidth;
          if (res.data.userCustomization) {
            this.userCustomization = { ...this.userCustomization, ...res.data.userCustomization };
          }
          if (res.data.ratings) this.ratings = { ...this.ratings, ...res.data.ratings };
          if (typeof res.data.showMissingFilms === 'boolean') this.showMissingFilms = res.data.showMissingFilms;
          if (typeof res.data.partyModeEnabled === 'boolean') this.partyModeEnabled = res.data.partyModeEnabled;
          if (typeof res.data.liveTvEnabled === 'boolean') this.setLiveTvEnabled(res.data.liveTvEnabled);
          if (res.data.pauseScreen) this.pauseScreen = res.data.pauseScreen;
          if (res.data.defaultLanguage) this.defaultLanguage = res.data.defaultLanguage;
          this.applyIntro(res.data);
          this.applyToDom();
        }
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    setLiveTvEnabled(enabled) {
      if (enabled === this.liveTvEnabled) return;
      this.liveTvEnabled = enabled;
      // Switched on or off: the channel count has to be asked again.
      this.liveStatusFor = null;
      if (!enabled) this.liveChannelCount = 0;
    },

    // Asks the server how many Live TV channels this account can watch — once per app load
    // and account (a kids account may have none). `userId` keys the answer so signing in as
    // someone else asks again.
    async loadLiveStatus(userId, { force = false } = {}) {
      if (!this.liveTvEnabled || !userId) return;
      if (!force && this.liveStatusFor === userId) return;
      this.liveStatusFor = userId;
      try {
        const res = await api.get('/live/status');
        this.liveChannelCount = res.data?.enabled === false ? 0 : Number(res.data?.channelCount) || 0;
      } catch (err) {
        // Off on the server (P700) or unreachable: no Live TV in the nav this time.
        this.liveChannelCount = 0;
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
    // (a trailer) or when resuming partway through (Resume / Continue Watching), and the
    // caller leaves it out of autoplayed next episodes and watch parties.
    playsIntroBefore(item) {
      if (!this.introEnabled || !this.introVersion || !item || item.extra_type) return false;
      // The same test the player uses to decide whether to resume (VideoPlayer onLoadedMetadata).
      const saved = item.current_time || 0;
      const nearEnd = item.duration > 0 && saved / item.duration >= 0.98;
      if (saved > 10 && !nearEnd) return false;
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
