// A viewer's own Live TV state: favourites (server), channels hidden for me (account
// preferences), channels watched this session, and the last tab open (this device).
import { defineStore } from 'pinia';
import api from '../api/client';
import { useAuthStore } from './auth';

const HISTORY_KEY = 'plinthio_live_history';
const TAB_KEY = 'plinthio_live_tab';
const HISTORY_MAX = 20;
// Played this long before it counts as watched, so flicking past doesn't.
const WATCHED_AFTER_MS = 5000;

function readSession(key, fallback) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writeSession(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* this page only */ }
}

let watchedTimer = null;

export const useLiveStore = defineStore('live', {
  state: () => ({
    // channel id → bool; overrides each list's `favourite` so a toggle shows everywhere.
    favourites: {},
    favouritesFor: null,
    // Channel ids played this session, newest last, and whose they are.
    history: readSession(HISTORY_KEY, { user: null, ids: [] }).ids || [],
    historyFor: readSession(HISTORY_KEY, { user: null }).user || null,
    // Bumped on any change so open lists refetch.
    revision: 0
  }),

  getters: {
    prefs() {
      const stored = useAuthStore().user?.preferences?.liveTv;
      const liveTv = stored && typeof stored === 'object' ? stored : {};
      return {
        hiddenChannels: Array.isArray(liveTv.hiddenChannels) ? liveTv.hiddenChannels : [],
        hiddenGroups: Array.isArray(liveTv.hiddenGroups) ? liveTv.hiddenGroups : [],
        showOnHome: liveTv.showOnHome !== false
      };
    },
    // Favourites this session knows of (from lists loaded so far).
    favouriteCount(state) {
      if (state.favouritesFor !== (useAuthStore().user?.id || null)) return 0;
      return Object.values(state.favourites).filter(Boolean).length;
    },
    hiddenCount() {
      return this.prefs.hiddenChannels.length + this.prefs.hiddenGroups.length;
    },
    // The channel played before the one on now, this session.
    previousChannel: (state) => (currentId) => {
      if (state.historyFor !== (useAuthStore().user?.id || null)) return null;
      for (let i = state.history.length - 1; i >= 0; i -= 1) {
        if (state.history[i] !== currentId) return state.history[i];
      }
      return null;
    }
  },

  actions: {
    // Favourites are per account: reset when someone else signs in.
    ensureUser() {
      const id = useAuthStore().user?.id || null;
      if (this.favouritesFor !== id) {
        this.favouritesFor = id;
        this.favourites = {};
      }
    },

    isFavourite(channel) {
      if (!channel) return false;
      const known = this.favouritesFor === (useAuthStore().user?.id || null) ? this.favourites : {};
      return channel.id in known ? known[channel.id] : !!channel.favourite;
    },

    learn(channels) {
      this.ensureUser();
      for (const ch of channels || []) {
        if (typeof ch.favourite === 'boolean') this.favourites[ch.id] = ch.favourite;
      }
    },

    // Optimistic: the star changes at once and goes back if the server says no.
    async toggleFavourite(channel) {
      if (!channel?.id) return;
      const was = this.isFavourite(channel);
      this.ensureUser();
      this.favourites[channel.id] = !was;
      try {
        const res = was
          ? await api.delete(`/live/favourites/${encodeURIComponent(channel.id)}`)
          : await api.post(`/live/favourites/${encodeURIComponent(channel.id)}`);
        if (typeof res.data?.favourite === 'boolean') this.favourites[channel.id] = res.data.favourite;
        this.revision += 1;
      } catch (err) {
        this.favourites[channel.id] = was;
        throw err;
      }
    },

    // ── Hidden for me ─────────────────────────────────────────────────────────────────
    isHiddenForMe(channel) {
      if (!channel) return false;
      const { hiddenChannels, hiddenGroups } = this.prefs;
      if (hiddenChannels.includes(channel.id)) return true;
      return Array.isArray(channel.groups) && channel.groups.some((g) => hiddenGroups.includes(g));
    },

    // Sends the whole liveTv object: the server merges only top-level keys. Reverts on failure.
    async savePrefs(changes) {
      const authStore = useAuthStore();
      if (!authStore.user) return;
      const before = authStore.user.preferences || {};
      const liveTv = { ...(before.liveTv || {}), ...changes };
      authStore.user = { ...authStore.user, preferences: { ...before, liveTv } };
      try {
        const res = await api.patch('/users/preferences', { liveTv });
        if (res.data?.preferences && authStore.user) {
          authStore.user = { ...authStore.user, preferences: res.data.preferences };
        }
        this.revision += 1;
      } catch (err) {
        if (authStore.user) authStore.user = { ...authStore.user, preferences: before };
        throw err;
      }
    },

    hideChannel(channel) {
      const { hiddenChannels } = this.prefs;
      if (hiddenChannels.includes(channel.id)) return Promise.resolve();
      return this.savePrefs({ hiddenChannels: [...hiddenChannels, channel.id] });
    },

    showChannel(id) {
      return this.savePrefs({ hiddenChannels: this.prefs.hiddenChannels.filter((c) => c !== id) });
    },

    hideGroup(name) {
      const { hiddenGroups } = this.prefs;
      if (hiddenGroups.includes(name)) return Promise.resolve();
      return this.savePrefs({ hiddenGroups: [...hiddenGroups, name] });
    },

    showGroup(name) {
      return this.savePrefs({ hiddenGroups: this.prefs.hiddenGroups.filter((g) => g !== name) });
    },

    showEverything() {
      return this.savePrefs({ hiddenChannels: [], hiddenGroups: [] });
    },

    setShowOnHome(show) {
      return this.savePrefs({ showOnHome: !!show });
    },

    // ── Watching ──────────────────────────────────────────────────────────────────────
    // Joins session history at once; reported to the server's Recent list after WATCHED_AFTER_MS.
    playing(id) {
      if (!id) return;
      const user = useAuthStore().user?.id || null;
      if (this.historyFor !== user) {
        this.historyFor = user;
        this.history = [];
      }
      if (this.history[this.history.length - 1] !== id) {
        this.history = [...this.history.filter((c) => c !== id), id].slice(-HISTORY_MAX);
        writeSession(HISTORY_KEY, { user, ids: this.history });
      }
      clearTimeout(watchedTimer);
      watchedTimer = setTimeout(() => {
        api.post(`/live/channels/${encodeURIComponent(id)}/watched`)
          .then(() => { this.revision += 1; })
          .catch(() => { /* Recent just misses this one */ });
      }, WATCHED_AFTER_MS);
    },

    stopped() {
      clearTimeout(watchedTimer);
    },

    // ── The tab last open in Live TV, on this device ─────────────────────────────────
    lastTab() {
      try { return localStorage.getItem(TAB_KEY) || ''; } catch (e) { return ''; }
    },
    rememberTab(id) {
      try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* this visit only */ }
    }
  }
});
