import { defineStore } from 'pinia';
import api from '../api/client';

export const useCustomizationStore = defineStore('customization', {
  state: () => ({
    serverName: 'Plinthio',
    customCss: '',
    accentTheme: 'zinc',
    loginMessage: '',
    layoutMode: 'topnav',
    // full | contained
    pageWidth: 'full',
    // Which personalizations users may change.
    userCustomization: {
      enabled: true,
      accentColor: true,
      layoutMode: true,
      pageWidth: true,
      pauseScreen: true
    },
    ratings: { showPersonal: true, showCommunity: true, showExternal: true },
    // Collections also list films the library doesn't have.
    showMissingFilms: true,
    partyModeEnabled: false,
    // liveChannelCount: channels this account may watch; the nav hides Live TV at 0.
    liveTvEnabled: false,
    liveChannelCount: 0,
    liveStatusFor: null,
    // simple | details | cinematic | bedtime
    pauseScreen: 'details',
    // 'auto' (browser) or a language code.
    defaultLanguage: 'auto',
    // Whether subtitles start switched on, and in which language ('auto': the viewer's own).
    subtitles: { on: false, language: 'auto' },
    // Opening sequence before movies/episodes. introVersion changes per upload to bust caches.
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
    // A person's own choice (Settings → Appearance) wins; otherwise the server's default.
    effectiveSubtitles: (state) => (user) => {
      const own = user?.preferences?.subtitles;
      const server = state.subtitles || { on: false, language: 'auto' };
      if (own?.mode !== 'on' && own?.mode !== 'off') return { on: !!server.on, language: server.language || 'auto' };
      return { on: own.mode === 'on', language: own.language || 'auto' };
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
          if (res.data.subtitles) this.subtitles = { ...this.subtitles, ...res.data.subtitles };
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
          if (res.data.subtitles) this.subtitles = { ...this.subtitles, ...res.data.subtitles };
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
      this.liveStatusFor = null;
      if (!enabled) this.liveChannelCount = 0;
    },

    // Once per app load and account; `userId` keys the answer so another sign-in asks again.
    async loadLiveStatus(userId, { force = false } = {}) {
      if (!this.liveTvEnabled || !userId) return;
      if (!force && this.liveStatusFor === userId) return;
      this.liveStatusFor = userId;
      try {
        const res = await api.get('/live/status');
        this.liveChannelCount = res.data?.enabled === false ? 0 : Number(res.data?.channelCount) || 0;
      } catch (err) {
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

    // Never for extras or when resuming; callers also skip it for autoplay and watch parties.
    playsIntroBefore(item) {
      if (!this.introEnabled || !this.introVersion || !item || item.extra_type) return false;
      // Same resume test as VideoPlayer onLoadedMetadata.
      const saved = item.current_time || 0;
      const nearEnd = item.duration > 0 && saved / item.duration >= 0.98;
      if (saved > 10 && !nearEnd) return false;
      if (item.media_type === 'movie') return this.introMovies;
      if (item.media_type === 'show' || item.media_type === 'anime') return this.introShows;
      return false;
    },

    applyToDom() {
      if (this.serverName && this.serverName.trim()) {
        document.title = `${this.serverName} | Media Server`;
      }
      if (this.accentTheme) {
        document.documentElement.setAttribute('data-accent', this.accentTheme);
      }
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
