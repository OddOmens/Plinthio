<template>
  <!-- Admin → Live TV → Line-ups: the admin's own sets of channels (News, Sport, For the
       kids…), each in its own order. Viewers get one tab per line-up, in this order. -->
  <SettingsCard :title="$t('admin.liveTv.lineups.title')" :description="$t('admin.liveTv.lineups.desc')" flush>
    <template #actions>
      <SaveStatus :status="save.status.value" :message="save.message.value" />
      <button type="button" @click="openCreate" class="btn btn-primary">
        <Plus class="w-3.5 h-3.5" /> {{ $t('admin.liveTv.lineups.create') }}
      </button>
    </template>

    <div v-if="!lineups.length" class="py-10 px-6 text-center text-xs flex flex-col items-center gap-3" :class="loadError ? 'text-destructive' : 'text-muted-foreground'">
      <template v-if="loading">{{ $t('common.loading') }}</template>
      <template v-else-if="loadError">
        <span>{{ loadError }}</span>
        <button type="button" @click="load" class="btn btn-secondary">{{ $t('common.retry') }}</button>
      </template>
      <template v-else>{{ $t('admin.liveTv.lineups.empty') }}</template>
    </div>
    <ul v-else class="divide-y divide-border">
      <li v-for="(lineup, i) in lineups" :key="lineup.id" class="pl-4 sm:pl-5 pr-2 sm:pr-3 py-2 flex items-center gap-3">
        <!-- The row opens the line-up -->
        <button type="button" @click="editing = lineup" class="min-w-0 flex-1 flex items-center gap-3 text-left py-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-label="$t('admin.liveTv.lineups.openAria', { name: lineup.name })">
          <span class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <ListOrdered class="w-5 h-5 text-muted-foreground" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-semibold text-foreground truncate">{{ lineup.name }}</span>
            <span class="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span class="truncate">{{ $t('admin.liveTv.channelCount', { count: lineup.channelCount || 0, number: $n(lineup.channelCount || 0) }) }}</span>
              <span v-if="lineup.kidsAllowed" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-500 flex-shrink-0">
                <Baby class="w-2.5 h-2.5" /> {{ $t('admin.liveTv.channels.badges.kids') }}
              </span>
            </span>
          </span>
        </button>
        <div class="flex items-center flex-shrink-0">
          <button type="button" @click="move(i, -1)" :disabled="i === 0" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.lineups.moveUpAria', { name: lineup.name })" :title="$t('admin.liveTv.lineups.moveUp')">
            <ChevronUp class="w-4 h-4" />
          </button>
          <button type="button" @click="move(i, 1)" :disabled="i === lineups.length - 1" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.lineups.moveDownAria', { name: lineup.name })" :title="$t('admin.liveTv.lineups.moveDown')">
            <ChevronDown class="w-4 h-4" />
          </button>
          <button type="button" @click="editing = lineup" class="btn btn-ghost btn-icon" :aria-label="$t('admin.liveTv.lineups.openAria', { name: lineup.name })" :title="$t('common.edit')">
            <Pencil class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>
    <template v-if="lineups.length" #footer>
      <p class="text-[12px] text-muted-foreground flex items-start gap-1.5">
        <Info class="w-3.5 h-3.5 mt-px flex-shrink-0" />
        {{ $t('admin.liveTv.lineups.footer') }}
      </p>
    </template>
  </SettingsCard>

  <!-- Naming a new line-up -->
  <SettingsDialog :open="creating" :title="$t('admin.liveTv.lineups.createTitle')" @close="creating = false">
    <form id="create-live-lineup-form" @submit.prevent="create" class="flex flex-col gap-4">
      <div>
        <label for="new-live-lineup-name" class="field-label">{{ $t('admin.liveTv.lineups.name') }}</label>
        <input id="new-live-lineup-name" ref="newNameInput" v-model.trim="newName" required maxlength="60" :placeholder="$t('admin.liveTv.lineups.namePlaceholder')" class="field" />
        <p class="field-hint">{{ $t('admin.liveTv.lineups.nameHint') }}</p>
      </div>
    </form>
    <template #footer>
      <button type="button" @click="creating = false" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button type="submit" form="create-live-lineup-form" :disabled="savingNew || !newName" class="btn btn-primary">{{ savingNew ? $t('common.saving') : $t('common.create') }}</button>
    </template>
  </SettingsDialog>

  <LiveLineupEditor :lineup="editing" @close="closeEditor" @changed="onChanged" @deleted="onDeleted" />
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { Plus, ListOrdered, ChevronUp, ChevronDown, Pencil, Baby, Info } from '@lucide/vue';
import api from '../../../api/client';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { useDialogStore } from '../../../stores/dialog';
import SettingsCard from '../../settings/SettingsCard.vue';
import SettingsDialog from '../../settings/SettingsDialog.vue';
import SaveStatus from '../../settings/SaveStatus.vue';
import LiveLineupEditor from './LiveLineupEditor.vue';
import { t } from '../../../i18n';

const props = defineProps({
  // Changes when line-ups may have changed elsewhere (channels added from the channel manager).
  version: { type: Number, default: 0 }
});
// update:lineups: the list, for the channel manager's "Add to line-up".
// changed: a line-up's channels or kids choice changed, so who may watch what may have too.
const emit = defineEmits(['update:lineups', 'changed']);
const dialog = useDialogStore();
const save = useSaveStatus();

const lineups = ref([]);
const loading = ref(true);
const loadError = ref('');
const editing = ref(null);
let dirty = false;

watch(lineups, (list) => emit('update:lineups', list), { deep: true });

async function load() {
  try {
    const res = await api.get('/live/admin/lineups');
    const list = res.data.lineups || [];
    // Keep the open line-up's object, so the editor stays on it.
    if (editing.value) {
      const fresh = list.find((l) => l.id === editing.value.id);
      if (fresh) Object.assign(editing.value, fresh);
      lineups.value = list.map((l) => (l.id === editing.value.id ? editing.value : l));
    } else {
      lineups.value = list;
    }
    loadError.value = '';
  } catch (err) {
    if (!lineups.value.length) loadError.value = err.response?.data?.error || t('admin.liveTv.lineups.couldNotLoad');
  } finally {
    loading.value = false;
  }
}
watch(() => props.version, load);
onMounted(load);

// ─── Creating ──────────────────────────────────────────────────────────────
const creating = ref(false);
const newName = ref('');
const savingNew = ref(false);
const newNameInput = ref(null);

function openCreate() {
  newName.value = '';
  creating.value = true;
  nextTick(() => newNameInput.value?.focus());
}

async function create() {
  if (!newName.value) return;
  savingNew.value = true;
  try {
    const res = await api.post('/live/admin/lineups', { name: newName.value });
    const lineup = { channelCount: 0, kidsAllowed: false, ...(res.data.lineup || {}) };
    if (lineup.id) {
      lineups.value = [...lineups.value, lineup];
      creating.value = false;
      // Straight on to filling it.
      editing.value = lineup;
    } else {
      creating.value = false;
      load();
    }
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.liveTv.lineups.couldNotCreate'));
  } finally {
    savingNew.value = false;
  }
}

// ─── Order ─────────────────────────────────────────────────────────────────
async function move(index, by) {
  const to = index + by;
  if (to < 0 || to >= lineups.value.length) return;
  const before = lineups.value;
  const next = [...before];
  [next[index], next[to]] = [next[to], next[index]];
  lineups.value = next;
  const { ok } = await save.run(() => api.put('/live/admin/lineups/order', { ids: next.map((l) => l.id) }));
  if (!ok) lineups.value = before;
}

// ─── The editor's changes ──────────────────────────────────────────────────
function onChanged(patch) {
  const lineup = lineups.value.find((l) => l.id === patch?.id);
  if (lineup) Object.assign(lineup, patch);
  if (patch && ('channelCount' in patch || 'kidsAllowed' in patch)) dirty = true;
}

function onDeleted(id) {
  lineups.value = lineups.value.filter((l) => l.id !== id);
  dirty = true;
}

// Told once, when the editor closes, rather than on every channel added.
function closeEditor() {
  editing.value = null;
  if (dirty) {
    dirty = false;
    emit('changed');
    load();
  }
}
</script>
