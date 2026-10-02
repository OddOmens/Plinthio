<template>
  <SectionHeader title="Playback" description="How video reaches people's screens, and the clip that can play before it." />

  <SettingsCard title="Hardware acceleration" description="Plinthio plays files as they are whenever the browser can, and only converts what it can't. A graphics chip makes converting far cheaper.">
    <template #actions><SaveStatus :status="save.status.value" :message="save.message.value" /></template>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-semibold text-foreground">Found on this machine</span>
        <span :class="['text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', transcoding.detected ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
          {{ transcoding.detected || 'None — using the CPU' }}
        </span>
      </div>
      <div>
        <label for="hwaccel" class="field-label">Use</label>
        <div class="flex gap-2">
          <select id="hwaccel" v-model="transcoding.preference" @change="saveTranscoding" class="field flex-1 min-w-0">
            <option value="auto">Whatever is found (recommended)</option>
            <option value="none">Always the CPU</option>
            <option v-for="method in transcoding.available" :key="method" :value="method">Always {{ method.toUpperCase() }}</option>
          </select>
          <button @click="runHwaccelTest" :disabled="testing || !testableMethod" class="btn btn-secondary flex-shrink-0">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
        </div>
        <p v-if="testResult" :class="['text-xs mt-2 flex items-start gap-1.5', testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive']">
          <CheckCircle v-if="testResult.ok" class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <AlertTriangle v-else class="w-3.5 h-3.5 mt-px flex-shrink-0" />
          {{ testResult.ok ? `${testableMethod.toUpperCase()} works on this machine.` : `${testableMethod.toUpperCase()} didn't work: ${testResult.error}` }}
        </p>
        <p v-else class="field-hint">Test runs a short real conversion: ffmpeg listing an encoder doesn't prove the driver under it works.</p>
      </div>

      <details class="group rounded-lg bg-muted/40 border border-border">
        <summary class="px-3 py-2 text-xs font-medium text-foreground cursor-pointer select-none flex items-center gap-1.5">
          <ChevronRight class="w-3.5 h-3.5 transition-transform group-open:rotate-90" /> How playback works, and setting up a graphics chip
        </summary>
        <ul class="list-disc pl-8 pr-3 pb-3 space-y-1.5 text-[12px] text-muted-foreground leading-relaxed">
          <li><strong class="text-foreground">Direct play and direct stream:</strong> video the browser can decode (H.264, or HEVC in Chrome, Edge, Vivaldi and Safari) is sent untouched, up to 4K, even from MKV files. Only audio it can't play (EAC3, Atmos, DTS) is converted, to AAC.</li>
          <li><strong class="text-foreground">The browser's side:</strong> for 4K, check the browser decodes video in hardware (<code class="bg-muted px-1 rounded">chrome://gpu</code> → Video Decode: Hardware accelerated).</li>
          <li><strong class="text-foreground">Intel Quick Sync and VAAPI in Docker:</strong> pass <code class="bg-muted px-1 rounded">/dev/dri</code> through under <code class="bg-muted px-1 rounded">devices</code>, and add the host's <code class="bg-muted px-1 rounded">render</code> group ID under <code class="bg-muted px-1 rounded">group_add</code>.</li>
          <li><strong class="text-foreground">Small machines:</strong> converting on the CPU is held to two threads at the fastest preset, and preview thumbnails are made separately, so a mini PC doesn't overheat.</li>
        </ul>
      </details>
    </div>
  </SettingsCard>

  <SettingsCard title="Opening sequence" description="A short clip played full-screen when someone presses Play on a movie or episode. Never before autoplayed episodes, trailers or watch parties, and anyone can skip it.">
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
          <span class="text-xs font-medium">{{ introBusy ? 'Checking…' : 'Upload a clip' }}</span>
        </button>
      </div>

      <div class="flex-1 min-w-0 flex flex-col gap-3">
        <p class="text-[12px] text-muted-foreground leading-relaxed">
          {{ store.introCustom ? 'Your own clip.' : 'Plinthio\'s built-in clip. Replace it with your own:' }}
          MP4 (H.264), 1–10 seconds, up to 20 MB. 1080p at about 8 Mbps is plenty.
          <template v-if="store.introDuration"> This one is {{ store.introDuration.toFixed(1) }} seconds.</template>
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <input ref="introFileInput" type="file" accept="video/mp4,.mp4" class="hidden" @change="uploadIntro" />
          <button v-if="store.introVersion" type="button" @click="introFileInput?.click()" :disabled="introBusy" class="btn btn-secondary">
            <Loader2 v-if="introBusy" class="w-3.5 h-3.5 animate-spin" />
            <Upload v-else class="w-3.5 h-3.5" />
            Replace
          </button>
          <button v-if="store.introCustom" type="button" @click="removeIntro" :disabled="introBusy" class="btn btn-ghost">
            Use the built-in clip
          </button>
        </div>
        <p v-if="introError" class="text-xs text-destructive">{{ introError }}</p>

        <div class="divide-y divide-border border-t border-border pt-3">
          <ToggleRow
            label="Play the opening sequence"
            :description="store.introVersion ? 'Off until you turn it on.' : 'Upload a clip first.'"
            :disabled="!store.introVersion || introBusy"
            :model-value="store.introEnabled"
            @update:model-value="saveIntro({ introEnabled: $event })"
          />
          <template v-if="store.introEnabled">
            <ToggleRow label="Before movies" :model-value="store.introMovies" @update:model-value="saveIntro({ introMovies: $event })" />
            <ToggleRow label="Before shows and anime" :model-value="store.introShows" @update:model-value="saveIntro({ introShows: $event })" />
          </template>
        </div>
      </div>
    </div>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { CheckCircle, AlertTriangle, ChevronRight, Loader2, Film, Upload } from '@lucide/vue';
import api from '../../api/client';
import { useCustomizationStore } from '../../stores/customization';
import { useDialogStore } from '../../stores/dialog';
import { useSaveStatus } from '../../composables/useSaveStatus';
import { useServerSetting } from '../../composables/useServerSetting';
import { getMediaToken } from '../../utils/mediaToken';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';

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

async function saveTranscoding() {
  testResult.value = null;
  await save.run(() => api.put('/settings/transcoding', { preference: transcoding.value.preference }));
}

async function runHwaccelTest() {
  if (!testableMethod.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    const res = await api.post('/settings/transcoding/test', { method: testableMethod.value });
    testResult.value = res.data;
  } catch (err) {
    testResult.value = { ok: false, error: err.response?.data?.error || 'Test failed' };
  } finally {
    testing.value = false;
  }
}

// ─── Opening sequence ─────────────────────────────────────────────────────
const introSave = useServerSetting();
const saveIntro = (patch) => introSave.set(patch);
const introFileInput = ref(null);
const introBusy = ref(false);
const introError = ref('');
const introPreviewUrl = computed(() => {
  const params = new URLSearchParams({ v: store.introVersion || '1' });
  const token = getMediaToken();
  if (token) params.set('token', token);
  return `/api/media/intro?${params}`;
});

async function uploadIntro(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  introError.value = '';
  if (file.size > 20 * 1024 * 1024) {
    introError.value = 'That file is over 20 MB. Export it shorter or at a lower bitrate.';
    return;
  }
  introBusy.value = true;
  try {
    const form = new FormData();
    form.append('intro', file);
    const res = await api.post('/customization/intro', form);
    store.applyIntro(res.data);
  } catch (err) {
    introError.value = err.response?.data?.error || 'Upload failed';
  } finally {
    introBusy.value = false;
  }
}

async function removeIntro() {
  const confirmed = await dialog.confirm({
    title: 'Remove your clip',
    message: 'Remove your clip and go back to Plinthio\'s built-in opening sequence?',
    confirmText: 'Remove',
    danger: true
  });
  if (!confirmed) return;
  introBusy.value = true;
  introError.value = '';
  try {
    const res = await api.delete('/customization/intro');
    store.applyIntro(res.data);
  } catch (err) {
    introError.value = err.response?.data?.error || 'Could not remove it';
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
});
</script>
