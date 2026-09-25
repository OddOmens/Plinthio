import axios from 'axios';
import { queueProgress, flushProgressQueue } from '../utils/offlineQueue';

const api = axios.create({
  baseURL: '/api',
  // Media streaming (video/audio/manga pages) uses direct <img>/<video> src URLs with a
  // ?token= query param, never this axios instance, so a timeout here can't cut off a
  // long-running stream — it only bounds normal JSON API calls, one of which (the
  // setup-status check) runs in the router's navigation guard and would otherwise be able
  // to freeze all routing if it ever hung instead of erroring.
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
  (response) => response,
  (error) => {
    // Server errors carry a generic `error` for everyone and the real cause in `detail`
    // for admins only (see backend utils/http.js). Where it's present, it's the message
    // worth showing — e.g. "folder is empty, is the drive mounted?" on a scan.
    const data = error.response?.data;
    if (data && typeof data === 'object' && data.detail) {
      data.error = data.detail;
    }
    // A progress save that never reached the server (no response at all = offline) is
    // queued and replayed later rather than failing — see utils/offlineQueue.js.
    const cfg = error.config;
    if (!error.response && cfg && !cfg._fromQueue && cfg.method === 'post' && /^\/?progress\/[^/]+$/.test(cfg.url || '')) {
      let data = cfg.data;
      try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { /* keep raw */ }
      queueProgress(cfg.url.startsWith('/') ? cfg.url : `/${cfg.url}`, data);
      return Promise.resolve({ data: { queued: true }, status: 202, config: cfg });
    }
    if (error.response && error.response.status === 401) {
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
