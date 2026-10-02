<template>
  <SettingsLayout title="Settings" :groups="groups" :aliases="aliases">
    <template #header>
      <span class="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground hidden sm:inline">{{ authStore.user?.username }}</span>
    </template>
    <template #nav-footer>
      <router-link
        v-if="authStore.isAdmin"
        to="/admin"
        class="flex items-center gap-3 px-3.5 md:px-2.5 h-12 md:h-9 rounded-xl md:rounded-lg border border-border md:border-0 bg-card md:bg-transparent text-sm md:text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
      >
        <ShieldCheck class="w-4 h-4" />
        <span class="flex-1">Server admin</span>
        <ArrowRight class="w-3.5 h-3.5" />
      </router-link>
    </template>

    <template #default="{ section }">
      <ProfileSection v-if="section === 'profile'" />
      <SecuritySection v-else-if="section === 'security'" />
      <AppearanceSection v-else-if="section === 'appearance'" />
      <ShelvesSection v-else-if="section === 'shelves'" />
      <HiddenSection v-else-if="section === 'hidden'" />
      <ActivitySection v-else-if="section === 'activity'" />
      <AppsSection v-else-if="section === 'apps'" />
    </template>
  </SettingsLayout>
</template>

<script setup>
import { UserRound, Lock, Palette, LayoutGrid, EyeOff, BarChart3, Plug, ShieldCheck, ArrowRight } from '@lucide/vue';
import { useAuthStore } from '../stores/auth';
import SettingsLayout from '../components/settings/SettingsLayout.vue';
import ProfileSection from '../components/settings/user/ProfileSection.vue';
import SecuritySection from '../components/settings/user/SecuritySection.vue';
import AppearanceSection from '../components/settings/user/AppearanceSection.vue';
import ShelvesSection from '../components/settings/user/ShelvesSection.vue';
import HiddenSection from '../components/settings/user/HiddenSection.vue';
import ActivitySection from '../components/settings/user/ActivitySection.vue';
import AppsSection from '../components/settings/user/AppsSection.vue';

const authStore = useAuthStore();

const groups = [
  {
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: UserRound, desc: 'Your picture and role' },
      { id: 'security', label: 'Security', icon: Lock, desc: 'Password, two-factor, devices' }
    ]
  },
  {
    label: 'Your Plinthio',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Colour, navigation, width, pause screen' },
      { id: 'shelves', label: 'Shelves', icon: LayoutGrid, desc: 'Media types, start page, views' },
      { id: 'hidden', label: 'Hidden titles', icon: EyeOff, desc: 'Titles you\'ve hidden' },
      { id: 'activity', label: 'Activity', icon: BarChart3, desc: 'Your stats and sign-ins' }
    ]
  },
  {
    label: 'Connect',
    items: [
      { id: 'apps', label: 'Apps & API keys', icon: Plug, desc: 'Mihon, KOReader, OPDS, scripts' }
    ]
  }
];

// Tab names from before the redesign, still in links and docs.
const aliases = { account: 'security', preferences: 'shelves', stats: 'activity', apikeys: 'apps' };
</script>
