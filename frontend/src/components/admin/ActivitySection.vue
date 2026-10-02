<template>
  <SectionHeader title="Activity" description="Sign-ins, and what's being read, watched and listened to, on every account.">
    <label for="activity-user" class="sr-only">Show</label>
    <select id="activity-user" v-model="userFilter" class="field w-auto">
      <option value="">Everyone</option>
      <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
    </select>
    <button @click="load" class="btn btn-secondary btn-icon" aria-label="Refresh" title="Refresh">
      <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
    </button>
  </SectionHeader>

  <SettingsCard flush>
    <ActivityList :entries="activity" :loading="loading" show-user />
  </SettingsCard>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { RefreshCw } from '@lucide/vue';
import api from '../../api/client';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ActivityList from '../settings/ActivityList.vue';

defineProps({
  users: { type: Array, default: () => [] }
});

const activity = ref([]);
const userFilter = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const params = { limit: 150 };
    if (userFilter.value) params.userId = userFilter.value;
    const res = await api.get('/activity/admin', { params });
    activity.value = res.data.activity || [];
  } catch (err) {
    console.warn('Could not load activity:', err);
  } finally {
    loading.value = false;
  }
}

watch(userFilter, load);
onMounted(load);
</script>
