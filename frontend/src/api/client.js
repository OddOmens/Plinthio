import axios from 'axios';

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
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('plinthio_token');
      localStorage.removeItem('plinthio_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
