<template>
  <SectionHeader :title="$t('admin.features.title')" :description="$t('admin.features.description')">
    <SaveStatus :status="setting.status.value" :message="setting.message.value" />
  </SectionHeader>

  <SettingsCard :title="$t('admin.features.shelfViews.title')" :description="$t('admin.features.shelfViews.desc')">
    <template #actions><SaveStatus :status="filterSave.status.value" :message="filterSave.message.value" /></template>
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="mode in folderModes"
        :key="mode.id"
        :label="mode.label"
        :description="mode.desc"
        :model-value="allowedFilters.includes(mode.id)"
        @update:model-value="setFolderMode(mode.id, $event)"
      />
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.features.ratings.title')" :description="$t('admin.features.ratings.desc')">
    <div class="divide-y divide-border">
      <ToggleRow
        v-for="opt in ratingOptions"
        :key="opt.id"
        :label="opt.label"
        :description="opt.desc"
        :model-value="store.ratings?.[opt.id] !== false"
        @update:model-value="setting.set({ ratings: { [opt.id]: $event } })"
      />
    </div>
  </SettingsCard>

  <SettingsCard :title="$t('admin.features.movies.title')">
    <div class="divide-y divide-border">
      <ToggleRow
        :label="$t('admin.features.movies.missingFilms.label')"
        :description="$t('admin.features.movies.missingFilms.desc')"
        :model-value="store.showMissingFilms"
        @update:model-value="setting.set({ showMissingFilms: $event })"
      />
      <ToggleRow
        :label="$t('admin.features.movies.watchParties.label')"
        :description="$t('admin.features.movies.watchParties.desc')"
        :model-value="store.partyModeEnabled"
        @update:model-value="setting.set({ partyModeEnabled: $event })"
      />
    </div>
  </SettingsCard>

  <!-- Requests: who skips the review queue, and passing accepted ones on to a Seerr server
       (its key is write-only). A request is also marked as added by a scan that finds it. -->
  <SettingsCard :title="$t('admin.features.requests.title')">
    <template #actions><SaveStatus :status="autoAcceptSave.status.value" :message="autoAcceptSave.message.value" /></template>
    <h4 class="text-xs font-semibold text-foreground">{{ $t('admin.features.requests.autoAccept.label') }}</h4>
    <p class="text-[12px] text-muted-foreground mt-0.5 mb-3">{{ $t('admin.features.requests.autoAccept.desc') }}</p>
    <OptionTiles
      :label="$t('admin.features.requests.autoAccept.label')"
      :options="autoAcceptOptions"
      :model-value="autoAccept"
      @update:model-value="setAutoAccept"
      grid-class="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
    />
    <p class="field-hint mt-3">{{ $t('admin.features.requests.autoAccept.hint') }}</p>

    <div class="mt-4 pt-4 border-t border-border flex items-start justify-between gap-3 mb-3">
      <div class="min-w-0">
        <h4 class="text-xs font-semibold text-foreground">{{ $t('admin.features.requests.seerrTitle') }}</h4>
        <p class="text-[12px] text-muted-foreground mt-0.5">{{ $t('admin.features.requests.desc') }}</p>
      </div>
      <span :class="['flex-shrink-0 text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', seerr.enabled ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground border-border bg-muted/40']">
        {{ seerr.enabled ? $t('admin.features.requests.badge.on') : (seerr.hasKey ? $t('admin.features.requests.badge.off') : $t('admin.features.requests.badge.notSet')) }}
      </span>
    </div>
    <form @submit.prevent="saveSeerr()" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label for="seerr-url" class="field-label">{{ $t('admin.features.requests.address') }}</label>
        <input id="seerr-url" v-model="seerrUrl" type="url" inputmode="url" autocomplete="off" placeholder="http://seerr:5055" class="field" />
      </div>
      <div>
        <label for="seerr-key" class="field-label">{{ $t('admin.features.requests.apiKey') }}</label>
        <input
          id="seerr-key"
          v-model="seerrKey"
          type="password"
          autocomplete="off"
          :placeholder="seerr.hasKey ? $t('admin.features.requests.apiKeySaved') : ''"
          class="field"
        />
      </div>
      <div class="sm:col-span-2 flex flex-wrap items-center gap-2">
        <button type="submit" :disabled="seerrBusy || !seerrUrl.trim() || (!seerrKey && !seerr.hasKey)" class="btn btn-primary">
          {{ seerrBusy ? $t('admin.features.requests.checking') : $t('admin.features.requests.save') }}
        </button>
        <button v-if="seerr.url" type="button" @click="removeSeerr" :disabled="seerrBusy" class="btn btn-ghost">{{ $t('common.remove') }}</button>
        <SaveStatus :status="seerrSave.status.value" :message="seerrSave.message.value" />
      </div>
    </form>
    <div v-if="seerr.url" class="mt-3 pt-3 border-t border-border">
      <ToggleRow
        :label="$t('admin.features.requests.send.label')"
        :description="$t('admin.features.requests.send.desc')"
        :model-value="seerr.enabled"
        :disabled="seerrBusy"
        @update:model-value="saveSeerr($event)"
      />
    </div>
    <p class="field-hint mt-3">{{ $t('admin.features.requests.hint') }}</p>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client';
import { useCustomizationStore } from '../../stores/customization';
import { useServerSetting } from '../../composables/useServerSetting';
import { useSaveStatus } from '../../composables/useSaveStatus';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import OptionTiles from '../OptionTiles.vue';
import { t, te } from '../../i18n';

const store = useCustomizationStore();
const setting = useServerSetting();
const filterSave = useSaveStatus();

// Whose requests are accepted as they're made: 'off' | 'staff' | 'all'.
const autoAccept = ref('off');
const autoAcceptSave = useSaveStatus();
const autoAcceptOptions = computed(() => ['off', 'staff', 'all'].map((id) => ({
  id,
  label: t(`admin.features.requests.autoAccept.${id}.label`),
  desc: t(`admin.features.requests.autoAccept.${id}.desc`)
})));

async function setAutoAccept(mode) {
  const before = autoAccept.value;
  autoAccept.value = mode;
  const result = await autoAcceptSave.run(() => api.put('/settings/requests', { autoAccept: mode }));
  // The newest choice stands; an older save that failed only undoes itself.
  if (!result.ok && autoAccept.value === mode) autoAccept.value = before;
}

// Seerr: the server checks the address and key before saving, and never sends the key back.
const seerr = ref({ url: '', hasKey: false, enabled: false });
const seerrUrl = ref('');
const seerrKey = ref('');
const seerrBusy = ref(false);
const seerrSave = useSaveStatus();

function seerrFailed(result) {
  const reason = result.error?.response?.data?.reason;
  const detail = result.error?.response?.data?.detail;
  if (reason && te(`admin.features.requests.errors.${reason}`)) {
    seerrSave.message.value = t(`admin.features.requests.errors.${reason}`) + (detail ? ` (${detail})` : '');
  }
}

// `enabled` given: the switch. Left out: the form, which keeps the switch as it is (on for a first save).
async function saveSeerr(enabled) {
  seerrBusy.value = true;
  const body = { url: seerrUrl.value.trim() || seerr.value.url, enabled: enabled ?? (seerr.value.url ? seerr.value.enabled : true) };
  if (seerrKey.value.trim()) body.apiKey = seerrKey.value.trim();
  const result = await seerrSave.run(() => api.put('/settings/seerr', body));
  if (result.ok) {
    const { version, ...status } = result.data.data;
    seerr.value = status;
    seerrUrl.value = status.url;
    seerrKey.value = '';
    if (status.enabled) seerrSave.message.value = version ? t('admin.features.requests.connectedVersion', { version }) : t('admin.features.requests.connected');
  } else {
    seerrFailed(result);
  }
  seerrBusy.value = false;
}

async function removeSeerr() {
  seerrBusy.value = true;
  const result = await seerrSave.run(() => api.put('/settings/seerr', { url: '' }));
  if (result.ok) {
    seerr.value = result.data.data;
    seerrUrl.value = '';
    seerrKey.value = '';
  }
  seerrBusy.value = false;
}

const folderModes = computed(() => [
  { id: 'disk_folder', label: t('admin.features.folderModes.diskFolder.label'), desc: t('admin.features.folderModes.diskFolder.desc') },
  { id: 'custom_folder', label: t('admin.features.folderModes.customFolder.label'), desc: t('admin.features.folderModes.customFolder.desc') }
]);
const allowedFilters = ref(['series', 'creator', 'disk_folder', 'custom_folder']);
// Each save sends the whole list, so only the newest one's answer (or failure) counts.
let filterRequest = 0;

async function setFolderMode(id, on) {
  const request = ++filterRequest;
  const before = allowedFilters.value;
  allowedFilters.value = on ? [...new Set([...before, id])] : before.filter((m) => m !== id);
  const { ok, data } = await filterSave.run(() => api.patch('/settings/filters', { allowedGroupingModes: allowedFilters.value }));
  if (request !== filterRequest) return;
  if (ok) allowedFilters.value = data.data.allowedGroupingModes || allowedFilters.value;
  else allowedFilters.value = before;
}

const ratingOptions = computed(() => [
  { id: 'showPersonal', label: t('admin.features.ratings.personal.label'), desc: t('admin.features.ratings.personal.desc') },
  {
    id: 'showCommunity',
    label: t('admin.features.ratings.community.label', { name: store.serverName || 'Plinthio' }),
    desc: t('admin.features.ratings.community.desc')
  },
  { id: 'showExternal', label: t('admin.features.ratings.external.label'), desc: t('admin.features.ratings.external.desc') }
]);

onMounted(async () => {
  store.fetchCustomization();
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) allowedFilters.value = res.data.allowedGroupingModes;
  } catch (err) {
    console.warn('Could not load shelf views:', err);
  }
  try {
    autoAccept.value = (await api.get('/settings/requests')).data.autoAccept || 'off';
  } catch (err) {
    console.warn('Could not load how requests are accepted:', err);
  }
  try {
    seerr.value = (await api.get('/settings/seerr')).data;
    seerrUrl.value = seerr.value.url;
  } catch (err) {
    console.warn('Could not load the Seerr connection:', err);
  }
});
</script>
