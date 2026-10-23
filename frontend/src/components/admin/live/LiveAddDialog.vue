<template>
  <!-- Admin → Live TV → Add channels: ready-made public lists (by country, language or
       category, several at once), or any M3U playlist address. -->
  <SettingsDialog :open="open" :title="$t('admin.liveTv.addDialog.title')" width="sm:max-w-lg" @close="$emit('close')">
    <div class="grid grid-cols-2 p-0.5 rounded-lg bg-muted/60 border border-border text-xs flex-shrink-0" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="String(mode === tab.id)"
        @click="mode = tab.id"
        :class="['h-8 rounded-md font-medium transition flex items-center justify-center gap-1.5', mode === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
      >
        <component :is="tab.icon" class="w-3.5 h-3.5" /> {{ tab.label }}
      </button>
    </div>

    <!-- Ready-made public lists -->
    <div v-if="mode === 'public'" class="flex flex-col gap-3 min-h-0">
      <p class="text-[12px] text-muted-foreground leading-relaxed">{{ $t('admin.liveTv.addDialog.public.intro') }}</p>

      <div class="flex items-center gap-1 overflow-x-auto no-scrollbar" role="tablist" :aria-label="$t('admin.liveTv.addDialog.public.listBy')">
        <button
          v-for="kind in presetKinds"
          :key="kind.id"
          type="button"
          role="tab"
          :aria-selected="String(presetKind === kind.id)"
          @click="presetKind = kind.id; query = ''"
          :class="['h-8 px-3 rounded-lg text-xs font-medium transition flex-shrink-0', presetKind === kind.id ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground']"
        >{{ kind.label }}</button>
      </div>

      <div class="relative">
        <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          v-model="query"
          type="search"
          :placeholder="$t(`admin.liveTv.addDialog.public.search.${presetKind}`)"
          :aria-label="$t(`admin.liveTv.addDialog.public.search.${presetKind}`)"
          class="field pl-8"
        />
      </div>

      <div class="border border-border rounded-lg overflow-y-auto max-h-[min(18rem,40dvh)]">
        <p v-if="loadingPresets" class="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 class="w-3.5 h-3.5 animate-spin" /> {{ $t('common.loading') }}
        </p>
        <div v-else-if="presetsError" class="py-6 px-4 text-center text-xs text-destructive flex flex-col items-center gap-2">
          <span>{{ presetsError }}</span>
          <button type="button" @click="loadPresets" class="btn btn-secondary">{{ $t('common.retry') }}</button>
        </div>
        <p v-else-if="!visiblePresets.length" class="py-8 text-center text-xs text-muted-foreground">{{ $t('admin.liveTv.addDialog.public.noMatches') }}</p>
        <ul v-else class="divide-y divide-border">
          <li v-for="p in visiblePresets" :key="p.key">
            <label
              :class="[
                'px-3 py-2 flex items-center gap-2.5 text-xs transition select-none',
                p.added ? 'opacity-60 cursor-default' : 'cursor-pointer hover:bg-muted/40',
                picked.has(p.key) ? 'bg-primary/[0.06]' : ''
              ]"
            >
              <input
                type="checkbox"
                :checked="p.added || picked.has(p.key)"
                :disabled="p.added"
                @change="togglePick(p.key)"
                class="rounded border-border accent-primary h-4 w-4 flex-shrink-0"
              />
              <span v-if="presetKind === 'countries'" class="w-5 text-base leading-none text-center flex-shrink-0" aria-hidden="true">{{ p.flag || '🏳️' }}</span>
              <span class="flex-1 min-w-0 truncate text-foreground">{{ p.name }}</span>
              <span v-if="p.added" class="text-[11px] text-muted-foreground flex-shrink-0">{{ $t('admin.liveTv.addDialog.public.added') }}</span>
              <span v-else class="text-[11px] font-mono text-muted-foreground uppercase flex-shrink-0">{{ p.code }}</span>
            </label>
          </li>
        </ul>
      </div>

      <p class="text-[12px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <Info class="w-3.5 h-3.5 mt-px flex-shrink-0" />
        {{ $t('admin.liveTv.addDialog.public.note') }}
      </p>
    </div>

    <!-- Your own playlist -->
    <form v-else id="add-live-playlist-form" @submit.prevent="submit" class="flex flex-col gap-4">
      <div>
        <label for="live-playlist-name" class="field-label">{{ $t('admin.liveTv.addDialog.own.name') }}</label>
        <input id="live-playlist-name" v-model.trim="own.name" required maxlength="100" :placeholder="$t('admin.liveTv.addDialog.own.namePlaceholder')" class="field" />
      </div>
      <div>
        <label for="live-playlist-url" class="field-label">{{ $t('admin.liveTv.addDialog.own.playlistUrl') }}</label>
        <input id="live-playlist-url" v-model.trim="own.playlistUrl" required type="url" inputmode="url" placeholder="https://…/playlist.m3u" class="field font-mono" />
        <p class="field-hint">{{ $t('admin.liveTv.addDialog.own.playlistHint') }}</p>
      </div>
      <div>
        <label for="live-guide-url" class="field-label">{{ $t('admin.liveTv.addDialog.own.guideUrl') }}</label>
        <input id="live-guide-url" v-model.trim="own.guideUrl" type="url" inputmode="url" :placeholder="$t('admin.liveTv.addDialog.own.guidePlaceholder')" class="field font-mono" />
        <p class="field-hint">{{ $t('admin.liveTv.addDialog.own.guideHint') }}</p>
      </div>
    </form>

    <template #footer>
      <span v-if="mode === 'public' && picked.size" class="text-xs text-muted-foreground">{{ $t('admin.liveTv.addDialog.public.selected', { count: picked.size, number: $n(picked.size) }) }}</span>
      <button type="button" @click="$emit('close')" class="btn btn-secondary ml-auto">{{ $t('common.cancel') }}</button>
      <button
        v-if="mode === 'public'"
        type="button"
        @click="submit"
        :disabled="adding || !picked.size"
        class="btn btn-primary"
      >{{ adding ? $t('admin.liveTv.addDialog.adding') : $t('admin.liveTv.addDialog.public.addLists', { count: picked.size || 1, number: $n(picked.size || 1) }) }}</button>
      <button v-else type="submit" form="add-live-playlist-form" :disabled="adding" class="btn btn-primary">
        {{ adding ? $t('admin.liveTv.addDialog.adding') : $t('admin.liveTv.addDialog.own.add') }}
      </button>
    </template>
  </SettingsDialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Search, Loader2, Info, Globe, Link } from '@lucide/vue';
import api from '../../../api/client';
import { useDialogStore } from '../../../stores/dialog';
import SettingsDialog from '../../settings/SettingsDialog.vue';
import { t } from '../../../i18n';

const props = defineProps({
  open: { type: Boolean, default: false },
  // The sources already added, so their lists show as added.
  sources: { type: Array, default: () => [] }
});
const emit = defineEmits(['close', 'added']);
const dialog = useDialogStore();

const tabs = computed(() => [
  { id: 'public', icon: Globe, label: t('admin.liveTv.addDialog.tabs.public') },
  { id: 'own', icon: Link, label: t('admin.liveTv.addDialog.tabs.own') }
]);
const presetKinds = computed(() => [
  { id: 'countries', label: t('admin.liveTv.addDialog.public.kinds.countries') },
  { id: 'languages', label: t('admin.liveTv.addDialog.public.kinds.languages') },
  { id: 'categories', label: t('admin.liveTv.addDialog.public.kinds.categories') }
]);

const mode = ref('public');
const presetKind = ref('countries');
const query = ref('');
const picked = ref(new Set());
const own = ref({ name: '', playlistUrl: '', guideUrl: '' });
const adding = ref(false);

// ─── The public lists (fetched once per visit; the server caches them for a day) ──
const presets = ref(null);
const loadingPresets = ref(false);
const presetsError = ref('');

async function loadPresets() {
  loadingPresets.value = true;
  presetsError.value = '';
  try {
    const res = await api.get('/live/admin/presets');
    presets.value = res.data;
  } catch (err) {
    presetsError.value = err.response?.data?.error || t('admin.liveTv.addDialog.public.couldNotLoad');
  } finally {
    loadingPresets.value = false;
  }
}

watch(() => props.open, (open) => {
  if (!open) return;
  mode.value = 'public';
  query.value = '';
  picked.value = new Set();
  own.value = { name: '', playlistUrl: '', guideUrl: '' };
  if (!presets.value) loadPresets();
});

const addedPresets = computed(() => new Set(props.sources.map((s) => s.preset).filter(Boolean)));

// One list's entries as { key: 'countries/us', code, name, flag?, added }, sorted by name
// and narrowed by the search. Adult categories never appear (the server refuses them too).
const visiblePresets = computed(() => {
  const kind = presetKind.value;
  const rows = (presets.value?.[kind] || [])
    .map((p) => {
      const code = String(p.code ?? p.id ?? '').toLowerCase();
      return { key: `${kind}/${code}`, code, name: p.name || code, flag: p.flag, added: addedPresets.value.has(`${kind}/${code}`) };
    })
    .filter((p) => p.code && !(kind === 'categories' && p.code === 'xxx'));
  const q = query.value.trim().toLowerCase();
  const matches = q ? rows.filter((p) => p.name.toLowerCase().includes(q) || p.code === q) : rows;
  return matches.sort((a, b) => a.name.localeCompare(b.name));
});

function togglePick(key) {
  const next = new Set(picked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  picked.value = next;
}

// ─── Adding ────────────────────────────────────────────────────────────────
async function submit() {
  adding.value = true;
  const added = [];
  try {
    if (mode.value === 'public') {
      // One at a time, so a list that fails doesn't lose the ones before it.
      const remaining = new Set(picked.value);
      for (const preset of picked.value) {
        try {
          const res = await api.post('/live/admin/sources', { kind: 'iptv-org', preset });
          if (res.data.source) added.push(res.data.source);
          remaining.delete(preset);
        } catch (err) {
          dialog.alert(err.response?.data?.error || t('admin.liveTv.addDialog.couldNotAdd'));
          break;
        }
      }
      picked.value = remaining;
      if (added.length) emit('added', added);
      if (!picked.value.size) emit('close');
    } else {
      const body = { kind: 'm3u', name: own.value.name, playlistUrl: own.value.playlistUrl };
      if (own.value.guideUrl) body.guideUrl = own.value.guideUrl;
      try {
        const res = await api.post('/live/admin/sources', body);
        if (res.data.source) emit('added', [res.data.source]);
        emit('close');
      } catch (err) {
        dialog.alert(err.response?.data?.error || t('admin.liveTv.addDialog.couldNotAdd'));
      }
    }
  } finally {
    adding.value = false;
  }
}
</script>
