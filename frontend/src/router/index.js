import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';

// Shelf and login ship in the main bundle; everything else loads on first visit.
const AdminView = () => import('../views/AdminView.vue');
const SettingsView = () => import('../views/SettingsView.vue');
const DocsView = () => import('../views/DocsView.vue');
const SetupView = () => import('../views/SetupView.vue');
const TitleView = () => import('../views/TitleView.vue');
const ListsView = () => import('../views/ListsView.vue');
const RequestsView = () => import('../views/RequestsView.vue');
const DownloadsView = () => import('../views/DownloadsView.vue');
const PartyView = () => import('../views/PartyView.vue');
const LiveView = () => import('../views/LiveView.vue');
const LivePlayerView = () => import('../views/LivePlayerView.vue');
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { requiresAuth: true }
  },
  // A series page, or a title's own page when it isn't part of a series.
  {
    path: '/series/:seriesName',
    name: 'series',
    component: TitleView,
    meta: { requiresAuth: true }
  },
  {
    path: '/title/:id',
    name: 'title',
    component: TitleView,
    meta: { requiresAuth: true }
  },
  {
    // Watch-party invite link.
    path: '/party/:code',
    name: 'Party',
    component: PartyView,
    meta: { requiresAuth: true }
  },
  // Legacy manga-only URLs (bookmarks, history).
  { path: '/manga/series/:seriesName', redirect: (to) => ({ path: `/series/${encodeURIComponent(to.params.seriesName)}`, query: to.query }) },
  { path: '/manga/:id', redirect: (to) => ({ path: `/title/${to.params.id}`, query: to.query }) },
  {
    path: '/login',
    name: 'login',
    component: LoginView
  },
  {
    path: '/setup',
    name: 'setup',
    component: SetupView
  },
  {
    path: '/docs',
    name: 'docs',
    component: DocsView
  },
  {
    path: '/lists',
    name: 'lists',
    component: ListsView,
    meta: { requiresAuth: true }
  },
  {
    // Legacy Read Lists URL.
    path: '/read-lists',
    redirect: { path: '/lists', query: { category: 'read' } }
  },
  {
    path: '/requests',
    name: 'requests',
    component: RequestsView,
    meta: { requiresAuth: true }
  },
  {
    path: '/downloads',
    name: 'downloads',
    component: DownloadsView,
    meta: { requiresAuth: true }
  },
  {
    // Channel list and guide (?view=guide).
    path: '/live',
    name: 'live',
    component: LiveView,
    meta: { requiresAuth: true }
  },
  {
    path: '/live/:id',
    name: 'live-channel',
    component: LivePlayerView,
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView,
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // Setup only ever goes from "not set up" to "set up", so it's checked once per session.
  if (!authStore.setupChecked) {
    await authStore.checkSetupStatus();
  }

  if (to.path !== '/setup' && to.path !== '/docs' && !authStore.isSetup) {
    return next('/setup');
  }

  if (to.path === '/setup' && authStore.isSetup) {
    return next('/login');
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // Come back here after signing in — a watch-party invite link, say.
    next(to.fullPath === '/' ? '/login' : { path: '/login', query: { redirect: to.fullPath } });
  } else if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next('/');
  } else {
    next();
  }
});

export default router;
