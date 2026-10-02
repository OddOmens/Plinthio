<template>
  <SectionHeader title="Logs" description="Scans, errors and what the server has been doing, newest first.">
    <button
      @click="autoRefresh = !autoRefresh"
      :class="['btn', autoRefresh ? 'bg-primary/10 text-primary border border-primary/20' : 'btn-secondary']"
      :aria-pressed="String(autoRefresh)"
    >
      <span class="w-2 h-2 rounded-full" :class="autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'"></span>
      {{ autoRefresh ? 'Live' : 'Paused' }}
    </button>
    <button @click="load" class="btn btn-secondary btn-icon" aria-label="Refresh now" title="Refresh now">
      <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
    </button>
    <button @click="clearLogs" class="btn btn-danger">
      <Trash2 class="w-3.5 h-3.5" /> Clear
    </button>
  </SectionHeader>

  <div class="flex flex-col sm:flex-row gap-2">
    <div class="relative flex-1">
      <Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input v-model="search" @input="scheduleLoad" placeholder="Search messages and categories" aria-label="Search logs" class="field pl-8" />
    </div>
    <div class="flex items-center gap-1 bg-card border border-border rounded-lg p-1" role="radiogroup" aria-label="Level">
      <button
        v-for="lvl in ['all', 'info', 'warn', 'error']"
        :key="lvl"
        role="radio"
        :aria-checked="level === lvl"
        @click="level = lvl; load()"
        :class="['h-7 px-2.5 rounded-md text-[12px] font-medium capitalize transition', level === lvl ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground']"
      >{{ lvl }}</button>
    </div>
  </div>

  <div class="bg-zinc-950 text-zinc-100 border border-border rounded-xl p-2 sm:p-3 font-mono text-[12px] leading-relaxed max-h-[65vh] overflow-y-auto shadow-inner flex flex-col gap-0.5 select-text">
    <div v-if="!logs.length" class="py-12 text-center text-zinc-500 font-sans text-xs">
      {{ loading ? 'Loading…' : 'Nothing matches.' }}
    </div>
    <div v-for="log in logs" :key="log.id" class="flex flex-wrap sm:flex-nowrap items-start gap-x-2 gap-y-0.5 hover:bg-white/5 px-2 py-1 rounded transition-colors">
      <span class="text-zinc-500 whitespace-nowrap select-none text-[11px]">{{ formatLogTime(log.timestamp) }}</span>
      <span
        :class="[
          'px-1.5 rounded text-[10px] uppercase font-bold tracking-wider whitespace-nowrap select-none border',
          log.level === 'error' ? 'bg-rose-950 text-rose-300 border-rose-800' :
          log.level === 'warn' ? 'bg-amber-950 text-amber-300 border-amber-800' :
          'bg-zinc-800 text-zinc-300 border-zinc-700'
        ]"
      >{{ log.level }}</span>
      <span v-if="log.category" class="text-zinc-400 select-none text-[11px] whitespace-nowrap">[{{ log.category }}]</span>
      <span class="text-zinc-200 flex-1 min-w-0 break-words basis-full sm:basis-auto">{{ log.message }}</span>
      <span v-if="log.details" class="text-zinc-500 text-[11px] truncate max-w-[200px]" :title="log.details">{{ log.details }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { RefreshCw, Trash2, Search } from '@lucide/vue';
import api from '../../api/client';
import { useDialogStore } from '../../stores/dialog';
import SectionHeader from '../settings/SectionHeader.vue';

const dialog = useDialogStore();
const logs = ref([]);
const search = ref('');
const level = ref('all');
const loading = ref(false);
const autoRefresh = ref(true);

async function load() {
  loading.value = true;
  try {
    const params = { limit: 100 };
    if (level.value !== 'all') params.level = level.value;
    if (search.value.trim()) params.search = search.value.trim();
    const res = await api.get('/admin/logs', { params });
    logs.value = res.data.logs || [];
  } catch (err) {
    console.warn('Could not load logs:', err);
  } finally {
    loading.value = false;
  }
}

let searchTimer = null;
function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
}

// Live: every 3 seconds while the page is visible.
let poll = null;
function startPolling() {
  stopPolling();
  poll = setInterval(() => { if (!document.hidden) load(); }, 3000);
}
function stopPolling() {
  clearInterval(poll);
  poll = null;
}
watch(autoRefresh, (on) => (on ? startPolling() : stopPolling()));

function formatLogTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

async function clearLogs() {
  const confirmed = await dialog.confirm({
    title: 'Clear logs',
    message: 'Delete every log entry from the database?',
    confirmText: 'Clear logs',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api.delete('/admin/logs');
    logs.value = [];
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Could not clear the logs');
  }
}

onMounted(() => {
  load();
  startPolling();
});
onUnmounted(() => {
  stopPolling();
  clearTimeout(searchTimer);
});
</script>
