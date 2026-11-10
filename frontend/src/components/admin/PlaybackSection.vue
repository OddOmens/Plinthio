<template>
  <SectionHeader :title="$t('admin.playback.title')" :description="$t('admin.playback.description')" />

  <SettingsCard :title="$t('admin.playback.hwaccel.title')" :description="$t('admin.playback.hwaccel.desc')">
    <template #actions><SaveStatus :status="save.status.value" :message="save.message.value" /></template>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-semibold text-foreground">{{ $t('admin.playback.hwaccel.found') }}</span>
        <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', transcoding.detected ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
          {{ transcoding.detected || $t('admin.playback.hwaccel.noneCpu') }}
        </span>
      </div>
      <div>
        <label for="hwaccel" class="field-label">{{ $t('admin.playback.hwaccel.use') }}</label>
        <div class="flex gap-2">
          <select id="hwaccel" v-model="transcoding.preference" @change="saveTranscoding" class="field flex-1 min-w-0">
            <option value="auto">{{ $t('admin.playback.hwaccel.auto') }}</option>
            <option value="none">{{ $t('admin.playback.hwaccel.cpu') }}</option>
            <option v-for="method in transcoding.available" :key="method" :value="method">{{ $t('admin.playback.hwaccel.always', { method: method.toUpperCase() }) }}</option>
          </select>
          <button @click="runHwaccelTest" :disabled="testing || !testableMethod" class="btn btn-secondary flex-shrink-0">
            {{ testing ? $t('admin.playback.hwaccel.testing') : $t('admin.playback.hwaccel.test') }}
          </button>
        </div>
        <p v-if="testResult" :class="['text-xs mt-2 flex items-start gap-1.5', testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive']">
          <CheckCircle v-if="testResult.ok" class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <AlertTriangle v-else class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          {{ testResult.ok
            ? $t('admin.playback.hwaccel.works', { method: testableMethod.toUpperCase() })
            : $t('admin.playback.hwaccel.failed', { method: testableMethod.toUpperCase(), error: testResult.error }) }}
        </p>
        <p v-else class="field-hint">{{ $t('admin.playback.hwaccel.testHint') }}</p>
      </div>

      <details class="group rounded-lg bg-muted/40 border border-border">
        <summary class="px-3 py-2 text-xs font-medium text-foreground cursor-pointer select-none flex items-center gap-1.5">
          <ChevronRight class="w-3.5 h-3.5 transition-transform group-open:rotate-90" /> {{ $t('admin.playback.hwaccel.howItWorks') }}
        </summary>
        <ul class="list-disc pl-8 pr-3 pb-3 space-y-1.5 text-[12px] text-muted-foreground leading-relaxed">
          <li><strong class="text-foreground">{{ $t('admin.playback.hwaccel.tips.direct.title') }}</strong> {{ $t('admin.playback.hwaccel.tips.direct.text') }}</li>
          <li>
            <strong class="text-foreground">{{ $t('admin.playback.hwaccel.tips.browser.title') }}</strong>
            <I18nT keypath="admin.playback.hwaccel.tips.browser.text">
              <template #page><code class="bg-muted px-1 rounded">chrome://gpu</code></template>
            </I18nT>
          </li>
          <li>
            <strong class="text-foreground">{{ $t('admin.playback.hwaccel.tips.docker.title') }}</strong>
            <I18nT keypath="admin.playback.hwaccel.tips.docker.text">
              <template #dri><code class="bg-muted px-1 rounded">/dev/dri</code></template>
              <template #devices><code class="bg-muted px-1 rounded">devices</code></template>
              <template #render><code class="bg-muted px-1 rounded">render</code></template>
              <template #groupAdd><code class="bg-muted px-1 rounded">group_add</code></template>
            </I18nT>
          </li>
          <li><strong class="text-foreground">{{ $t('admin.playback.hwaccel.tips.small.title') }}</strong> {{ $t('admin.playback.hwaccel.tips.small.text') }}</li>
        </ul>
      </details>
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.playback.copies.title')" :description="$t('admin.playback.copies.desc')">
    <template #actions><SaveStatus :status="copiesSave.status.value" :message="copiesSave.message.value" /></template>
    <div class="flex flex-col gap-4">
      <div>
        <label for="copies-limit" class="field-label">{{ $t('admin.playback.copies.limit') }}</label>
        <input id="copies-limit" v-model.number="copiesLimit" @change="saveCopiesLimit" type="number" min="0" step="1" inputmode="numeric" class="field w-32" />
        <p class="field-hint">{{ $t('admin.playback.copies.limitHint', { used: formatBytes(copies.usedBytes) }) }}</p>
      </div>

      <div>
        <label for="copies-codec" class="field-label">{{ $t('admin.playback.copies.codec') }}</label>
        <select id="copies-codec" :value="copies.codec" @change="saveCopies({ codec: $event.target.value })" class="field w-full sm:w-80">
          <option value="h264">{{ $t('admin.playback.copies.codecH264') }}</option>
          <option value="hevc">{{ $t('admin.playback.copies.codecHevc') }}</option>
        </select>
        <p class="field-hint">{{ $t('admin.playback.copies.codecHint') }}</p>
      </div>

      <div class="divide-y divide-border border-t border-border pt-3">
        <ToggleRow
          :label="$t('admin.playback.copies.allowUsers')"
          :description="$t('admin.playback.copies.allowUsersDesc')"
          :model-value="copies.allowUsers"
          @update:model-value="saveCopies({ allowUsers: $event })"
        />
        <ToggleRow
          :label="$t('admin.playback.copies.replace')"
          :description="$t('admin.playback.copies.replaceDesc')"
          :model-value="copies.replaceOriginal"
          @update:model-value="setReplaceOriginal"
        />
      </div>

      <div class="border-t border-border pt-3">
        <label for="copies-library" class="field-label">{{ $t('admin.playback.copies.convertLabel') }}</label>
        <div class="flex gap-2">
          <select id="copies-library" v-model="copiesLibrary" class="field flex-1 min-w-0">
            <option value="">{{ $t('admin.playback.copies.allLibraries') }}</option>
            <option v-for="lib in videoLibraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
          </select>
          <button @click="queueCopies" :disabled="!!copies.discovery || queueing" class="btn btn-secondary flex-shrink-0">
            <Loader2 v-if="copies.discovery || queueing" class="w-3.5 h-3.5 animate-spin" />
            {{ copies.discovery
              ? $t('admin.playback.copies.searching', { done: $n(copies.discovery.done), total: $n(copies.discovery.total) })
              : $t('admin.playback.copies.convert') }}
          </button>
        </div>
        <p class="field-hint">{{ $t('admin.playback.copies.convertHint') }}</p>
      </div>

      <div class="border-t border-border pt-3">
        <p v-if="!copies.copies.length" class="text-xs text-muted-foreground">{{ $t('admin.playback.copies.empty') }}</p>
        <template v-else>
          <ul class="divide-y divide-border max-h-72 overflow-y-auto">
            <li v-for="copy in copies.copies" :key="copy.itemId" class="flex items-center justify-between gap-3 py-2 first:pt-0">
              <div class="min-w-0">
                <p class="text-xs font-medium text-foreground truncate">{{ copyName(copy) }}</p>
                <p :class="['text-[12px]', copy.status === 'failed' || copy.replaceError ? 'text-destructive' : 'text-muted-foreground']">{{ copyStatus(copy) }}</p>
              </div>
              <button @click="removeCopy(copy)" class="btn btn-ghost flex-shrink-0">
                {{ copy.status === 'queued' || copy.status === 'running' ? $t('common.cancel') : $t('common.remove') }}
              </button>
            </li>
          </ul>
          <div class="flex flex-wrap gap-2 mt-3">
            <button v-if="copies.copies.some((copy) => copy.status === 'failed')" @click="retryFailedCopies" class="btn btn-secondary">{{ $t('admin.playback.copies.retryFailed') }}</button>
            <button @click="removeAllCopies" class="btn btn-secondary">{{ $t('admin.playback.copies.removeAll') }}</button>
          </div>
        </template>
      </div>
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.playback.intro.title')" :description="$t('admin.playback.intro.desc')">
    <template #actions><SaveStatus :status="introSave.status.value" :message="introSave.message.value" /></template>
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="sm:w-64 flex-shrink-0">
        <video
          v-if="store.introVersion"
          :key="store.introVersion"
          :src="introPreviewUrl"
          controls
          playsinline
          preload="metadata"
          class="w-full aspect-video rounded-lg bg-black border border-border"
        />
        <button
          v-else
          type="button"
          @click="introFileInput?.click()"
          :disabled="introBusy"
          class="w-full aspect-video rounded-lg border-2 border-dashed border-border hover:border-muted-foreground/50 hover:bg-muted/30 transition flex flex-col items-center justify-center gap-1.5 text-muted-foreground disabled:opacity-50"
        >
          <Loader2 v-if="introBusy" class="w-5 h-5 animate-spin" />
          <Film v-else class="w-5 h-5" />
          <span class="text-xs font-medium">{{ introBusy ? $t('admin.playback.intro.checking') : $t('admin.playback.intro.upload') }}</span>
        </button>
      </div>

      <div class="flex-1 min-w-0 flex flex-col gap-3">
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          {{ store.introCustom ? $t('admin.playback.intro.custom') : $t('admin.playback.intro.builtIn') }}
          {{ $t('admin.playback.intro.requirements') }}
          <template v-if="store.introDuration"> {{ $t('admin.playback.intro.thisOne', { seconds: $n(store.introDuration, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) }}</template>
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <input ref="introFileInput" type="file" accept="video/mp4,.mp4" class="hidden" @change="uploadIntro" />
          <button v-if="store.introVersion" type="button" @click="introFileInput?.click()" :disabled="introBusy" class="btn btn-secondary">
            <Loader2 v-if="introBusy" class="w-3.5 h-3.5 animate-spin" />
            <Upload v-else class="w-3.5 h-3.5" />
            {{ $t('admin.playback.intro.replace') }}
          </button>
          <button v-if="store.introCustom" type="button" @click="removeIntro" :disabled="introBusy" class="btn btn-ghost">
            {{ $t('admin.playback.intro.useBuiltIn') }}
          </button>
        </div>
        <p v-if="introError" class="text-xs text-destructive">{{ introError }}</p>

        <div class="divide-y divide-border border-t border-border pt-3">
          <ToggleRow
            :label="$t('admin.playback.intro.play')"
            :description="store.introVersion ? $t('admin.playback.intro.offUntil') : $t('admin.playback.intro.uploadFirst')"
            :disabled="!store.introVersion || introBusy"
            :model-value="store.introEnabled"
            @update:model-value="saveIntro({ introEnabled: $event })"
          />
          <template v-if="store.introEnabled">
            <ToggleRow :label="$t('admin.playback.intro.beforeMovies')" :model-value="store.introMovies" @update:model-value="saveIntro({ introMovies: $event })" />
            <ToggleRow :label="$t('admin.playback.intro.beforeShows')" :model-value="store.introShows" @update:model-value="saveIntro({ introShows: $event })" />
          </template>
        </div>
      </div>
    </div>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CheckCircle, AlertTriangle, ChevronRight, Loader2, Film, Upload } from '@lucide/vue';
import api from '../../api/client';
import { useCustomizationStore } from '../../stores/customization';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import { useServerSetting } from '../../composables/useServerSetting';
import { introUrl } from '../../utils/cover';
import { formatBytes } from '../../utils/settingsFormat';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import I18nT from '../../i18n/I18nT.vue';
import { t, n } from '../../i18n';

const store = useCustomizationStore();
const dialog = useDialogStore();

// ─── Hardware acceleration ────────────────────────────────────────────────
const save = useSaveStatus();
const transcoding = ref({ preference: 'auto', detected: null, available: [] });
const testing = ref(false);
const testResult = ref(null);
// "Auto" has nothing to test until something is found.
const testableMethod = computed(() => transcoding.value.preference === 'auto'
  ? transcoding.value.detected
  : (transcoding.value.preference === 'none' ? null : transcoding.value.preference));

// A test still running when the choice changes was of the old method; its result is dropped.
let testRequest = 0;

async function saveTranscoding() {
  testRequest++;
  testResult.value = null;
  await save.run(() => api.put('/settings/transcoding', { preference: transcoding.value.preference }));
}

async function runHwaccelTest() {
  if (!testableMethod.value) return;
  const id = ++testRequest;
  testing.value = true;
  testResult.value = null;
  try {
    const res = await api.post('/settings/transcoding/test', { method: testableMethod.value });
    if (id === testRequest) testResult.value = res.data;
  } catch (err) {
    if (id === testRequest) testResult.value = { ok: false, error: err.response?.data?.error || t('admin.playback.hwaccel.testFailed') };
  } finally {
    testing.value = false;
  }
}

// ─── Converted copies ─────────────────────────────────────────────────────────
const copiesSave = useSaveStatus();
const copies = ref({ maxGb: 50, codec: 'h264', allowUsers: false, replaceOriginal: false, usedBytes: 0, discovery: null, copies: [] });
const copiesLimit = ref(50);
const copiesLibrary = ref('');
const videoLibraries = ref([]);
const queueing = ref(false);
let copiesTimer = null;

function applyCopies(data) {
  copies.value = data;
  // Not while it's being typed in.
  if (document.activeElement?.id !== 'copies-limit') copiesLimit.value = data.maxGb;
}

async function loadCopies() {
  try {
    applyCopies((await api.get('/settings/compat')).data);
  } catch (err) {
    console.warn('Could not load the converted copies:', err);
  }
}

async function saveCopies(patch) {
  const { ok, data } = await copiesSave.run(() => api.put('/settings/compat', patch));
  if (ok) applyCopies(data.data);
  else loadCopies();
}

function saveCopiesLimit() {
  const value = Number(copiesLimit.value);
  if (!Number.isFinite(value) || value < 0) {
    copiesLimit.value = copies.value.maxGb;
    return;
  }
  saveCopies({ maxGb: value });
}

// Deleting people's files is the one thing here that can't be taken back, so it's asked.
async function setReplaceOriginal(on) {
  if (on) {
    const confirmed = await dialog.confirm({
      title: t('admin.playback.copies.replaceConfirmTitle'),
      message: t('admin.playback.copies.replaceConfirmMessage'),
      confirmText: t('admin.playback.copies.replaceConfirm'),
      danger: true
    });
    if (!confirmed) return;
  }
  saveCopies({ replaceOriginal: on });
}

async function queueCopies() {
  queueing.value = true;
  await copiesSave.run(() => api.post('/settings/compat/queue', { libraryId: copiesLibrary.value || null }));
  queueing.value = false;
  loadCopies();
}

async function removeCopy(copy) {
  await copiesSave.run(() => api.delete(`/media/video/${copy.itemId}/compat`));
  loadCopies();
}

async function removeAllCopies() {
  const confirmed = await dialog.confirm({
    title: t('admin.playback.copies.removeAllTitle'),
    message: t('admin.playback.copies.removeAllMessage'),
    confirmText: t('common.remove'),
    danger: true
  });
  if (!confirmed) return;
  const { ok, data } = await copiesSave.run(() => api.delete('/settings/compat/copies'));
  if (ok) applyCopies(data.data);
}

async function retryFailedCopies() {
  const { ok, data } = await copiesSave.run(() => api.post('/settings/compat/retry'));
  if (ok) applyCopies(data.data);
}

function copyName(copy) {
  if (!copy.title) return copy.itemId;
  return copy.series && copy.series !== copy.title ? `${copy.series} · ${copy.title}` : copy.title;
}

const COPY_ERRORS = ['cap', 'missing'];
const REPLACE_ERRORS = ['readonly', 'link', 'exists'];
function copyStatus(copy) {
  if (copy.status === 'queued') return t('admin.playback.copies.status.queued');
  if (copy.status === 'running') {
    return t(`admin.playback.copies.status.${copy.paused ? 'paused' : 'running'}`, { percent: n(copy.progress, { style: 'percent' }) });
  }
  if (copy.status === 'failed') {
    const text = COPY_ERRORS.includes(copy.error)
      ? t(`admin.playback.copies.errors.${copy.error}`)
      : t('admin.playback.copies.status.failed', { error: copy.error || '' });
    // The code is the one to look up in Docs → Error codes; the server log has the same line.
    return copy.errorCode ? `${text} (${copy.errorCode})` : text;
  }
  if (copy.replaceError) {
    return REPLACE_ERRORS.includes(copy.replaceError)
      ? t(`admin.playback.copies.replaceErrors.${copy.replaceError}`)
      : t('admin.playback.copies.replaceErrors.other', { error: copy.replaceError });
  }
  const size = formatBytes(copy.size);
  return t('admin.playback.copies.status.done', { size: copy.codec === 'hevc' ? `HEVC · ${size}` : copy.codec === 'h264' ? `H.264 · ${size}` : size });
}

// ─── Opening sequence ─────────────────────────────────────────────────────
const introSave = useServerSetting();
const saveIntro = (patch) => introSave.set(patch);
const introFileInput = ref(null);
const introBusy = ref(false);
const introError = ref('');
const introPreviewUrl = computed(() => introUrl(store.introVersion));

async function uploadIntro(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  introError.value = '';
  if (file.size > 20 * 1024 * 1024) {
    introError.value = t('admin.playback.intro.tooBig');
    return;
  }
  introBusy.value = true;
  try {
    const form = new FormData();
    form.append('intro', file);
    const res = await api.post('/customization/intro', form);
    store.applyIntro(res.data);
  } catch (err) {
    introError.value = err.response?.data?.error || t('admin.playback.intro.uploadFailed');
  } finally {
    introBusy.value = false;
  }
}

async function removeIntro() {
  const confirmed = await dialog.confirm({
    title: t('admin.playback.intro.removeTitle'),
    message: t('admin.playback.intro.removeMessage'),
    confirmText: t('common.remove'),
    danger: true
  });
  if (!confirmed) return;
  introBusy.value = true;
  introError.value = '';
  try {
    const res = await api.delete('/customization/intro');
    store.applyIntro(res.data);
  } catch (err) {
    introError.value = err.response?.data?.error || t('admin.playback.intro.couldNotRemove');
  } finally {
    introBusy.value = false;
  }
}

onMounted(async () => {
  store.fetchCustomization();
  try {
    const res = await api.get('/settings/transcoding');
    transcoding.value = res.data;
  } catch (err) {
    console.warn('Could not load transcoding settings:', err);
  }
  loadCopies();
  // Conversions move on their own, so the list is kept current while it's on screen.
  copiesTimer = setInterval(() => {
    const { discovery, replaceOriginal, copies: list } = copies.value;
    const moving = list.some((copy) => copy.status === 'queued' || copy.status === 'running' || (replaceOriginal && copy.status === 'done' && !copy.replaceError));
    if (discovery || moving) loadCopies();
  }, 4000);
  try {
    const res = await api.get('/libraries');
    videoLibraries.value = (res.data.libraries || res.data || []).filter((lib) => ['movies', 'shows', 'anime'].includes(lib.type));
  } catch (err) {
    console.warn('Could not load libraries:', err);
  }
});

onUnmounted(() => clearInterval(copiesTimer));
</script>
