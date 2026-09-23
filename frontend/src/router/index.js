import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import AdminView from '../views/AdminView.vue';
import SettingsView from '../views/SettingsView.vue';
import DocsView from '../views/DocsView.vue';
import SetupView from '../views/SetupView.vue';
import MangaView from '../views/MangaView.vue';
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { requiresAuth: true }
  },
  {
    path: '/manga/series/:seriesName',
    name: 'manga-series',
    component: MangaView,
    meta: { requiresAuth: true }
  },
  {
    path: '/manga/:id',
    name: 'manga-detail',
    component: MangaView,
    meta: { requiresAuth: true }
  },
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
