import { defineStore } from 'pinia';
import api from '../api/client';
import { setMediaToken } from '../utils/mediaToken';

// Asks the service worker to drop cached covers and comic pages. Cached art is keyed by
// path with the token stripped, so it must not outlive the session that fetched it.
function clearOfflineMediaCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-media-cache' });
  } catch (e) {
    // No service worker (unsupported browser, or a plain HTTP origin) — nothing cached.
  }
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('plinthio_user') || 'null');
  } catch (e) {
    // Malformed/corrupted localStorage value — treat as logged out rather than crashing
    // the whole app before it can even render the login screen.
    return null;
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('plinthio_token') || null,
    user: loadStoredUser(),
    isSetup: true,
    setupChecked: false,
    loading: false
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user && state.user.role === 'admin',
    // Editors can edit shared library metadata; Admins implicitly have every Editor right.
    isEditor: (state) => state.user && (state.user.role === 'admin' || state.user.role === 'editor')
  },

  actions: {
    async checkSetupStatus() {
      try {
        const res = await api.get('/auth/setup-status');
        this.isSetup = res.data.isSetup;
        this.setupChecked = true;
        return this.isSetup;
      } catch (err) {
        console.error('Error checking setup status:', err);
        return true;
      }
    },

    async setup(payloadOrUsername, maybePassword) {
      this.loading = true;
      try {
        const body = typeof payloadOrUsername === 'object' 
          ? payloadOrUsername 
          : { username: payloadOrUsername, password: maybePassword };
        const res = await api.post('/auth/setup', body);
        this.token = res.data.token;
        this.user = res.data.user;
        setMediaToken(res.data.mediaToken);
        this.isSetup = true;
        localStorage.setItem('plinthio_token', this.token);
        localStorage.setItem('plinthio_user', JSON.stringify(this.user));
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    async login(username, password) {
      this.loading = true;
      try {
        const res = await api.post('/auth/login', { username, password });
        this.token = res.data.token;
        this.user = res.data.user;
        setMediaToken(res.data.mediaToken);
        localStorage.setItem('plinthio_token', this.token);
        localStorage.setItem('plinthio_user', JSON.stringify(this.user));
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    // Called once on app start. Slides the expiry forward for anyone who actually uses
    // Plinthio, so the shortened token lifetime only ever bites an idle or stolen session.
    // Failure is silent: an expired or revoked token is already handled by the 401
    // interceptor, and being offline must not sign anyone out.
    async refreshSession() {
      if (!this.token) return;
      try {
        const res = await api.post('/auth/refresh');
        if (res.data.token) {
          this.token = res.data.token;
          localStorage.setItem('plinthio_token', res.data.token);
        }
        if (res.data.mediaToken) setMediaToken(res.data.mediaToken);
        if (res.data.user) {
          this.user = res.data.user;
          localStorage.setItem('plinthio_user', JSON.stringify(res.data.user));
        }
      } catch (err) {
        // Nothing to do — either the network is down or the 401 path already took over.
      }
    },

    // Media tokens last a day; an installed PWA can stay open far longer than that, so
    // refresh on a timer well inside the window (and whenever the tab comes back to view).
    keepMediaTokenFresh() {
      if (this._mediaTimer) return;
      const refresh = async () => {
        if (!this.token) return;
        try {
          const res = await api.post('/auth/media-token');
          setMediaToken(res.data.mediaToken);
        } catch (err) {
          // Offline or signed out — the next tick or the 401 path will handle it.
        }
      };
      this._mediaTimer = setInterval(refresh, 4 * 60 * 60 * 1000);
      let hiddenAt = 0;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > 60 * 60 * 1000) refresh();
      });
    },

    async signOutEverywhere() {
      await api.post('/auth/sign-out-everywhere');
      this.logout();
    },

    async uploadAvatar(file) {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await api.post('/users/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.user) {
        this.user = { ...this.user, ...res.data.user };
        localStorage.setItem('plinthio_user', JSON.stringify(this.user));
      }
      return res.data;
    },

    async removeAvatar() {
      const res = await api.delete('/users/avatar');
      if (res.data.user) {
        this.user = { ...this.user, ...res.data.user };
        localStorage.setItem('plinthio_user', JSON.stringify(this.user));
      }
      return res.data;
    },

    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('plinthio_token');
      localStorage.removeItem('plinthio_user');
      setMediaToken(null);
      clearOfflineMediaCache();
      // Downloads belong to the account that made them; the worker deletes the files.
      try { localStorage.removeItem('plinthio_downloads'); } catch (e) { /* ignore */ }
      try { localStorage.removeItem('plinthio_progress_queue'); } catch (e) { /* ignore */ }
      window.location.href = '/login';
    }
  }
});
