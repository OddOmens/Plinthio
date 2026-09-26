<template>
  <div class="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6 safe-top safe-bottom">
    <div class="flex items-center gap-3">
      <router-link
        to="/"
        class="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
        title="Back to Shelves"
      >
        <ArrowLeft class="w-4 h-4" />
      </router-link>
      <div>
        <h1 class="text-xl font-bold text-foreground">Requests</h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          Ask for movies, shows, anime, books and audiobooks the library doesn't have yet.
        </p>
      </div>
    </div>

    <!-- New request -->
    <section class="border border-border rounded-2xl bg-card p-4 flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-foreground flex items-center gap-2">
        <Send class="w-4 h-4 text-primary" />
        New request
      </h2>
      <ExternalTitleSearch :search-types="SEARCH_TYPES">
        <template #action="{ result, mediaType }">
          <span
            v-if="sentStatus(result)"
            class="text-[10px] font-medium px-1.5 py-0.5 rounded"
            :class="REQUEST_STATUSES[sentStatus(result)]?.tone"
          >
            {{ REQUEST_STATUSES[sentStatus(result)]?.label }}
          </span>
          <button
            v-else
            @click="submitRequest(result, mediaType)"
            :disabled="submitting.has(resultKey(result))"
            class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 flex items-center gap-1 transition"
          >
            <Send class="w-3.5 h-3.5" /> Request
          </button>
        </template>
      </ExternalTitleSearch>
    </section>

    <!-- Mine / review queue -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="flex gap-1 p-1 rounded-xl bg-secondary">
          <button
            @click="scope = 'mine'"
            class="h-8 px-3 rounded-lg text-xs font-medium transition"
            :class="scope === 'mine' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          >
            My requests
          </button>
          <button
            v-if="authStore.isEditor"
            @click="scope = 'all'"
            class="h-8 px-3 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            :class="scope === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          >
            Review queue
            <span v-if="pendingCount" class="min-w-[1.25rem] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {{ pendingCount }}
            </span>
          </button>
        </div>
        <div class="flex-1"></div>
        <select
          v-model="statusFilter"
          class="h-9 px-2.5 rounded-xl bg-card border border-border text-xs text-foreground"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option v-for="(s, key) in REQUEST_STATUSES" :key="key" :value="key">{{ s.label }}</option>
        </select>
      </div>

      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

      <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">Loading…</div>

      <div
        v-else-if="requests.length === 0"
        class="py-16 text-center border border-dashed border-border rounded-2xl bg-card/50"
      >
        <Inbox class="w-7 h-7 mx-auto text-muted-foreground" />
        <p class="text-sm font-medium text-foreground mt-3">
          {{ scope === 'all' ? 'No requests to review' : 'You haven\'t requested anything yet' }}
        </p>
        <p v-if="scope === 'mine'" class="text-xs text-muted-foreground mt-1">
          Search above, or use the Request button on a title in one of your Lists.
        </p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <article
          v-for="req in requests"
          :key="req.id"
          class="border border-border rounded-2xl bg-card p-3 sm:p-4 flex gap-3"
        >
          <img
            v-if="req.cover_url"
            :src="req.cover_url"
            :alt="req.title"
            loading="lazy"
            referrerpolicy="no-referrer"
            class="w-14 h-[84px] rounded-md object-cover bg-muted flex-shrink-0 border border-border/60"
          />
          <div v-else class="w-14 h-[84px] rounded-md bg-muted flex items-center justify-center flex-shrink-0 border border-border/60">
            <ImageOff class="w-4 h-4 text-muted-foreground" />
          </div>

          <div class="flex-1 min-w-0 flex flex-col gap-1.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-foreground truncate">{{ req.title }}</p>
                <p class="text-xs text-muted-foreground truncate">
                  {{ [MEDIA_TYPE_LABELS[req.media_type], req.release_date?.slice(0, 4), SOURCE_LABELS[req.source] || req.source].filter(Boolean).join(' · ') }}
                </p>
              </div>
              <span
                class="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap"
                :class="REQUEST_STATUSES[req.status]?.tone"
              >
                {{ REQUEST_STATUSES[req.status]?.label }}
              </span>
            </div>

            <p class="text-[11px] text-muted-foreground">
              <span v-if="scope === 'all'">Requested by <span class="text-foreground font-medium">{{ req.requested_by || 'deleted user' }}</span> · </span>
              {{ formatDate(req.created_at) }}
            </p>
            <p v-if="req.note" class="text-xs text-foreground/90 bg-muted/40 rounded-lg px-2.5 py-1.5">“{{ req.note }}”</p>
            <p v-if="req.response_note || req.handled_by_username" class="text-xs text-muted-foreground">
              <span v-if="req.handled_by_username">{{ req.handled_by_username }}<span v-if="req.response_note">: </span></span>
              <span v-if="req.response_note" class="text-foreground/90">{{ req.response_note }}</span>
            </p>

            <!-- Review actions -->
            <div v-if="scope === 'all'" class="flex flex-col gap-2 mt-1">
              <input
                v-model="responseNotes[req.id]"
                type="text"
                maxlength="1000"
                placeholder="Note to the requester (optional)"
                class="h-8 px-2.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground"
              />
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="action in REVIEW_ACTIONS"
                  :key="action.status"
                  @click="setStatus(req, action.status)"
                  :disabled="req.status === action.status || updating.has(req.id)"
                  class="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-40"
                  :class="action.classes"
                >
                  <component :is="action.icon" class="w-3.5 h-3.5" />
                  {{ action.label }}
                </button>
                <button
                  @click="removeRequest(req)"
                  :disabled="updating.has(req.id)"
                  class="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-muted flex items-center gap-1.5 transition disabled:opacity-40"
                  title="Delete request"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div v-else-if="req.status === 'pending'" class="mt-1">
              <button
                @click="removeRequest(req)"
                :disabled="updating.has(req.id)"
                class="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-muted flex items-center gap-1.5 transition disabled:opacity-40"
              >
                <X class="w-3.5 h-3.5" /> Withdraw
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Send, Inbox, ImageOff, Trash2, X, Clock, CheckCircle2, PackageCheck, Ban } from 'lucide-vue-next';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useDialogStore } from '../stores/dialog';
import { LIST_CATEGORIES, REQUEST_STATUSES, MEDIA_TYPE_LABELS } from '../constants/media';
import { externalTitlePayload, SOURCE_LABELS } from '../utils/externalTitle';
import ExternalTitleSearch from '../components/ExternalTitleSearch.vue';

const SEARCH_TYPES = LIST_CATEGORIES.flatMap((c) => c.searchTypes);

const REVIEW_ACTIONS = [
  { status: 'accepted_pending', label: 'Accept · Pending add', icon: CheckCircle2, classes: 'bg-sky-500/15 text-sky-500 hover:bg-sky-500/25' },
  { status: 'accepted_added', label: 'Accept · Added', icon: PackageCheck, classes: 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25' },
  { status: 'rejected', label: 'Reject', icon: Ban, classes: 'bg-destructive/15 text-destructive hover:bg-destructive/25' },
  { status: 'pending', label: 'Back to pending', icon: Clock, classes: 'bg-secondary text-secondary-foreground hover:bg-secondary/80' }
];

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const dialog = useDialogStore();

const scope = ref(route.query.scope === 'all' && authStore.isEditor ? 'all' : 'mine');
const statusFilter = ref('');
const requests = ref([]);
const loading = ref(true);
const error = ref('');
const pendingCount = ref(0);
const responseNotes = ref({});
const updating = ref(new Set());
const submitting = ref(new Set());
// Statuses of titles requested (or found already requested) from the search this visit.
const sent = ref({});

function resultKey(result) {
  return `${result.source}:${result.externalId}`;
}

function sentStatus(result) {
  return sent.value[resultKey(result)] || null;
}

function formatDate(value) {
  if (!value) return '';
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function withUpdating(id, on) {
  const next = new Set(updating.value);
  on ? next.add(id) : next.delete(id);
  updating.value = next;
}

async function loadRequests() {
  loading.value = true;
  error.value = '';
  try {
    const params = {};
    if (scope.value === 'all') params.scope = 'all';
    if (statusFilter.value) params.status = statusFilter.value;
    const res = await api.get('/requests', { params });
    requests.value = res.data.requests || [];
    responseNotes.value = Object.fromEntries(requests.value.map((r) => [r.id, r.response_note || '']));
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not load requests.';
  } finally {
    loading.value = false;
  }
}

async function loadPendingCount() {
  if (!authStore.isEditor) return;
  try {
    const res = await api.get('/requests/pending-count');
    pendingCount.value = res.data.count || 0;
  } catch (err) {
    // The badge is a nicety — the queue itself still loads without it.
  }
}

watch(scope, (value) => {
  router.replace({ query: { ...route.query, scope: value === 'all' ? 'all' : undefined } });
  loadRequests();
});
watch(statusFilter, loadRequests);

async function submitRequest(result, mediaType) {
  const key = resultKey(result);
  submitting.value = new Set(submitting.value).add(key);
  try {
    await api.post('/requests', externalTitlePayload(result, mediaType));
    sent.value = { ...sent.value, [key]: 'pending' };
    loadPendingCount();
    if (scope.value === 'mine') loadRequests();
  } catch (err) {
    if (err.response?.status === 409 && err.response.data?.status) {
      sent.value = { ...sent.value, [key]: err.response.data.status };
    } else {
      error.value = err.response?.data?.error || 'Could not send that request.';
    }
  } finally {
    const next = new Set(submitting.value);
    next.delete(key);
    submitting.value = next;
  }
}

async function setStatus(req, status) {
  withUpdating(req.id, true);
  try {
    const res = await api.patch(`/requests/${req.id}`, {
      status,
      responseNote: responseNotes.value[req.id] || ''
    });
    Object.assign(req, res.data.request);
    loadPendingCount();
    // Drop it from a filtered view it no longer belongs in.
    if (statusFilter.value && statusFilter.value !== status) {
      requests.value = requests.value.filter((r) => r.id !== req.id);
    }
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not update that request.';
  } finally {
    withUpdating(req.id, false);
  }
}

async function removeRequest(req) {
  const own = scope.value === 'mine';
  const ok = await dialog.confirm({
    title: own ? 'Withdraw request?' : 'Delete request?',
    message: own
      ? `Your request for "${req.title}" will be withdrawn.`
      : `The request for "${req.title}" will be deleted for everyone.`,
    confirmText: own ? 'Withdraw' : 'Delete',
    danger: true
  });
  if (!ok) return;

  withUpdating(req.id, true);
  try {
    await api.delete(`/requests/${req.id}`);
    requests.value = requests.value.filter((r) => r.id !== req.id);
    loadPendingCount();
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not remove that request.';
  } finally {
    withUpdating(req.id, false);
  }
}

onMounted(() => {
  loadRequests();
  loadPendingCount();
});
</script>
