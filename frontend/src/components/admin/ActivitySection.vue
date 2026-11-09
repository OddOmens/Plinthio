<template>
  <SectionHeader :title="$t('admin.activity.title')" :description="$t('admin.activity.description')">
    <label for="activity-user" class="sr-only">{{ $t('admin.activity.show') }}</label>
    <select id="activity-user" v-model="userFilter" class="field w-auto">
      <option value="">{{ $t('admin.activity.everyone') }}</option>
      <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
    </select>
    <button @click="load" class="btn btn-secondary btn-icon" :aria-label="$t('common.refresh')" :title="$t('common.refresh')">
      <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
    </button>
  </SectionHeader>

  <SettingsCard flush>
    <ActivityList :entries="activity" :loading="loading" :failed="failed" show-user />
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
const failed = ref(false);
// Only the newest request's answer is shown, so switching person fast can't leave the wrong list up.
let requestId = 0;

async function load() {
  const id = ++requestId;
  loading.value = true;
  failed.value = false;
  try {
    const params = { limit: 150 };
    if (userFilter.value) params.userId = userFilter.value;
    const res = await api.get('/activity/admin', { params });
    if (id !== requestId) return;
    activity.value = res.data.activity || [];
  } catch (err) {
    if (id !== requestId) return;
    console.warn('Could not load activity:', err);
    // Not the last person's list under this one's name.
    activity.value = [];
    failed.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch(userFilter, load);
onMounted(load);
</script>
