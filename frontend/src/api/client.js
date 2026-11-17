import axios from 'axios';
import { queueProgress, flushProgressQueue } from '../utils/offlineQueue';
import { translateServerMessage } from '../i18n/serverErrors';
import { clearAccountDeviceData, tokenHasExpired, deviceDataOwner, setDeviceDataOwner } from '../utils/accountDeviceData';

const api = axios.create({
  baseURL: '/api',
  // Only bounds JSON calls (media streams use direct URLs). The setup check runs in the
  // router guard, so a hung request would otherwise freeze routing.
  timeout: 15000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('plinthio_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Confirmations some screens show as they are ("Password reset successfully").
    const data = response.data;
    if (data && typeof data === 'object' && typeof data.message === 'string') {
      data.message = translateServerMessage(data.message);
    }
    return response;
  },
  (error) => {
    // Fold message, admin-only `detail` and the P### code into the one `error` string screens show:
    //   "The media folder could not be read (I/O error): EIO: i/o error, scandir '/media' (P201)"
    const data = error.response?.data;
    if (data && typeof data === 'object' && !data._formatted) {
      // `errorEnglish` keeps the server's original text for code that matches on it.
      data.errorEnglish = data.error;
      data.error = translateServerMessage(data.error, data.code);
      if (data.detail && data.detail !== data.error) {
        data.error = data.error ? `${data.error}: ${data.detail}` : data.detail;
      }
      if (data.code && data.error) {
        data.error = `${data.error} (${data.code})`;
      }
      data._formatted = true;
    }
    // A progress save with no response (offline) is queued for later; see utils/offlineQueue.js.
    const cfg = error.config;
    if (!error.response && cfg && !cfg._fromQueue && cfg.method === 'post' && /^\/?progress\/[^/]+$/.test(cfg.url || '')) {
      let data = cfg.data;
      try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { /* keep raw */ }
      queueProgress(cfg.url.startsWith('/') ? cfg.url : `/${cfg.url}`, data);
      return Promise.resolve({ data: { queued: true }, status: 202, config: cfg });
    }
    // Only a 401 about the session signs out; a wrong password or 2FA code (P107, P111, P113) doesn't.
    const code = error.response?.data?.code;
    const sessionProblem = !code || ['P100', 'P101', 'P102'].includes(code);
    if (error.response && error.response.status === 401 && sessionProblem) {
      // A session the server ended early (password change, sign out everywhere, account
      // removed) clears this device's cached media and downloads, like Sign out. One that
      // merely expired keeps its downloads for the same person signing back in.
      const stored = localStorage.getItem('plinthio_token');
      if (stored && code !== 'P102' && !tokenHasExpired(stored)) {
        clearAccountDeviceData();
      } else if (!deviceDataOwner()) {
        // Record whose downloads they are, so a different account signing in clears them first.
        try {
          const user = JSON.parse(localStorage.getItem('plinthio_user') || 'null');
          if (user?.id) setDeviceDataOwner(user.id);
        } catch (e) { /* unreadable: no owner, so the next sign-in clears */ }
      }
      localStorage.removeItem('plinthio_token');
      localStorage.removeItem('plinthio_user');
      localStorage.removeItem('plinthio_media_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushProgressQueue(api));
  setTimeout(() => flushProgressQueue(api), 3000);
}

export default api;
