import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';

// The shelf and login are the two first screens anyone sees, so they ship in the main
// bundle; everything else is split out and fetched when first navigated to.
const AdminView = () => import('../views/AdminView.vue');
const SettingsView = () => import('../views/SettingsView.vue');
const DocsView = () => import('../views/DocsView.vue');
const SetupView = () => import('../views/SetupView.vue');
const TitleView = () => import('../views/TitleView.vue');
const ListsView = () => import('../views/ListsView.vue');
const RequestsView = () => import('../views/RequestsView.vue');
const DownloadsView = () => import('../views/DownloadsView.vue');
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { requiresAuth: true }
  },
  // Every title opens a detail page before it plays: a series page (all its volumes or
  // episodes), or the title's own page when it isn't part of a series.
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
  // Earlier links (bookmarks, history) pointed at the manga-only pages.
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
    // Read Lists became the "Read" tab of Lists.
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

  // Setup status can only ever go from "not set up" to "set up", never back — so once
  // confirmed this session, skip re-fetching it on every single route change. Previously
  // this awaited a network round-trip before every navigation (not just app boot), which
  // also had no request timeout: a hung request here would freeze routing entirely.
  if (!authStore.setupChecked) {
    await authStore.checkSetupStatus();
  }

  // If server is not set up and user is trying to go anywhere else (except docs)
  if (to.path !== '/setup' && to.path !== '/docs' && !authStore.isSetup) {
    return next('/setup');
  }

  if (to.path === '/setup' && authStore.isSetup) {
    return next('/login');
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login');
  } else if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next('/');
  } else {
    next();
  }
});

export default router;
