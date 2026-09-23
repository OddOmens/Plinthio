import { defineStore } from 'pinia';
import api from '../api/client';

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
        localStorage.setItem('plinthio_token', this.token);
        localStorage.setItem('plinthio_user', JSON.stringify(this.user));
        return res.data;
      } finally {
        this.loading = false;
      }
    },

    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('plinthio_token');
      localStorage.removeItem('plinthio_user');
      window.location.href = '/login';
    }
  }
});
