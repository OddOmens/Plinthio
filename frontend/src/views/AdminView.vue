<template>
  <SettingsLayout ref="layout" title="Admin" :groups="groups" :aliases="aliases">
    <template #nav-footer>
      <router-link
        to="/settings"
        class="flex items-center gap-3 px-3.5 md:px-2.5 h-12 md:h-9 rounded-xl md:rounded-lg border border-border md:border-0 bg-card md:bg-transparent text-sm md:text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
      >
        <UserRound class="w-4 h-4" />
        <span class="flex-1">Your settings</span>
        <ArrowRight class="w-3.5 h-3.5" />
      </router-link>
    </template>

    <template #default="{ section }">
      <OverviewSection v-if="section === 'overview'" />
      <LibrariesSection v-else-if="section === 'libraries'" :libraries="libraries" @changed="loadLibraries" />
      <LibraryHealth v-else-if="section === 'health'" @open-metadata="layout?.openSection('metadata')" />
      <MetadataSection v-else-if="section === 'metadata'" :libraries="libraries" />
      <KidsSection v-else-if="section === 'kids'" :libraries="libraries" />
      <UsersSection v-else-if="section === 'users'" :users="users" @changed="loadUsers" />
      <ActivitySection v-else-if="section === 'activity'" :users="users" />
      <AppearanceSection v-else-if="section === 'appearance'" />
      <FeaturesSection v-else-if="section === 'features'" />
      <PlaybackSection v-else-if="section === 'playback'" />
      <NetworkSettings v-else-if="section === 'network'" />
      <BackupsSection v-else-if="section === 'backups'" />
      <LogsSection v-else-if="section === 'logs'" />
    </template>
  </SettingsLayout>
</template>

<script setup>
import { ref, onMounted, defineAsyncComponent } from 'vue';
import {
  LayoutDashboard, Folder, HeartPulse, Sparkles, Baby, Users, History, Palette, ToggleRight,
  MonitorPlay, Globe, DatabaseBackup, ScrollText, UserRound, ArrowRight
} from '@lucide/vue';
import api from '../api/client';
import SettingsLayout from '../components/settings/SettingsLayout.vue';
import OverviewSection from '../components/admin/OverviewSection.vue';
import LibrariesSection from '../components/admin/LibrariesSection.vue';
import KidsSection from '../components/admin/KidsSection.vue';
import UsersSection from '../components/admin/UsersSection.vue';
import ActivitySection from '../components/admin/ActivitySection.vue';
import AppearanceSection from '../components/admin/AppearanceSection.vue';
import FeaturesSection from '../components/admin/FeaturesSection.vue';
import PlaybackSection from '../components/admin/PlaybackSection.vue';
import BackupsSection from '../components/admin/BackupsSection.vue';
import LogsSection from '../components/admin/LogsSection.vue';
const LibraryHealth = defineAsyncComponent(() => import('../components/LibraryHealth.vue'));
const NetworkSettings = defineAsyncComponent(() => import('../components/NetworkSettings.vue'));
const MetadataSection = defineAsyncComponent(() => import('../components/admin/MetadataSection.vue'));

const layout = ref(null);

const groups = [
  {
    label: 'Server',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, desc: 'Version, updates and what\'s in it' }
    ]
  },
  {
    label: 'Library',
    items: [
      { id: 'libraries', label: 'Libraries', icon: Folder, desc: 'Folders and automatic scanning' },
      { id: 'health', label: 'Health', icon: HeartPulse, desc: 'Missing files and what needs fixing' },
      { id: 'metadata', label: 'Metadata', icon: Sparkles, desc: 'TMDB key and matching titles' },
      { id: 'kids', label: 'Kids Mode', icon: Baby, desc: 'What kids accounts can see' }
    ]
  },
  {
    label: 'People',
    items: [
      { id: 'users', label: 'Users', icon: Users, desc: 'Accounts, roles, limits' },
      { id: 'activity', label: 'Activity', icon: History, desc: 'Sign-ins and what\'s being played' }
    ]
  },
  {
    label: 'Settings',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Defaults, name, custom CSS' },
      { id: 'features', label: 'Features', icon: ToggleRight, desc: 'Shelf views, ratings, watch parties' },
      { id: 'playback', label: 'Playback', icon: MonitorPlay, desc: 'Hardware acceleration, opening clip' },
      { id: 'network', label: 'Network', icon: Globe, desc: 'Away from home, Tailscale, two-factor' },
      { id: 'backups', label: 'Backups', icon: DatabaseBackup, desc: 'Schedule, second copy, restore points' }
    ]
  },
  {
    label: 'System',
    items: [
      { id: 'logs', label: 'Logs', icon: ScrollText, desc: 'What the server has been doing' }
    ]
  }
];

// Tab names from before the redesign, still in links and docs. Server Config was split
// into Appearance, Features, Playback and Backups; it opens on the first.
const aliases = { stats: 'overview', settings: 'appearance', config: 'appearance' };

const libraries = ref([]);
const users = ref([]);

async function loadLibraries() {
  try {
    const res = await api.get('/libraries');
    libraries.value = res.data.libraries || [];
  } catch (err) {
    console.error('Could not load libraries:', err);
  }
}

async function loadUsers() {
  try {
    const res = await api.get('/users');
    users.value = res.data.users || [];
  } catch (err) {
    console.error('Could not load users:', err);
  }
}

onMounted(() => {
  loadLibraries();
  loadUsers();
});
</script>
