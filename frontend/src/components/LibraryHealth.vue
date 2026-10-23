<template>
  <div class="flex flex-col gap-5">
    <SectionHeader :title="$t('admin.health.title')">
      <template #description>
        {{ $t('admin.health.description') }}
        <span v-if="report">{{ $t('admin.health.checked', { time: formatTime(report.generatedAt) }) }}</span>
      </template>
      <button type="button" @click="load" :disabled="loading" class="btn btn-secondary">
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
        {{ loading ? $t('admin.health.checking') : $t('admin.health.runCheck') }}
      </button>
    </SectionHeader>

    <p v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{{ error }}</p>

    <div v-if="loading && !report" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <div v-for="n in 6" :key="n" class="h-20 rounded-xl bg-muted/50 animate-pulse" />
    </div>

    <template v-if="report">
      <!-- Summary tiles: each one jumps to its section -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <a
          v-for="tile in tiles"
          :key="tile.key"
          :href="`#health-${tile.key}`"
          class="rounded-xl border p-3 flex flex-col gap-1 transition hover:bg-muted/40"
          :class="tile.count > 0 ? tile.tone : 'border-border bg-card'"
        >
          <span class="text-[12px] font-medium text-muted-foreground">{{ tile.label }}</span>
          <span class="text-xl font-semibold tabular-nums" :class="tile.count > 0 ? '' : 'text-muted-foreground'">{{ $n(tile.count) }}</span>
        </a>
      </div>

      <p v-if="allClear" class="text-sm text-emerald-500 flex items-center gap-2">
        <CheckCircle2 class="w-4 h-4" /> {{ $t('admin.health.allClear') }}
      </p>

      <!-- Libraries -->
      <section id="health-libraries" class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('admin.health.libraries') }}</h3>
          <span class="text-[12px] text-muted-foreground">{{ $t('admin.health.itemsTotal', { count: report.summary.totalItems, number: $n(report.summary.totalItems) }) }}</span>
        </header>
        <ul class="divide-y divide-border">
          <li v-for="lib in report.libraries" :key="lib.id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <component :is="lib.path_exists ? CheckCircle2 : AlertTriangle" class="w-4 h-4 flex-shrink-0" :class="lib.path_exists ? 'text-emerald-500' : 'text-destructive'" />
            <div class="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
              <p class="text-sm font-medium text-foreground truncate">{{ lib.name }}</p>
              <p class="text-[12px] text-muted-foreground truncate font-mono" :title="lib.path">{{ lib.path }}</p>
            </div>
            <div class="text-[12px] text-muted-foreground flex flex-col items-start sm:items-end flex-1 sm:flex-none pl-7 sm:pl-0">
              <span>{{ $t('admin.health.items', { count: lib.item_count, number: $n(lib.item_count) }) }}</span>
              <span>{{ lib.last_scanned_at ? $t('admin.health.scanned', { time: formatTime(lib.last_scanned_at + 'Z') }) : $t('admin.health.neverScanned') }}</span>
            </div>
            <p v-if="!lib.path_exists" class="basis-full text-[12px] text-destructive">
              {{ $t('admin.health.unreachable') }}
            </p>
            <button
              v-else
              type="button"
              @click="rescan(lib)"
              :disabled="scanningId === lib.id"
              class="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="scanningId === lib.id ? 'animate-spin' : ''" />
              {{ $t('admin.health.rescan') }}
            </button>
          </li>
          <li v-if="report.libraries.length === 0" class="px-4 py-6 text-center text-xs text-muted-foreground">{{ $t('admin.health.noLibraries') }}</li>
        </ul>
      </section>

      <!-- Missing files -->
      <HealthSection
        id="health-missing"
        :title="$t('admin.health.missing.title')"
        :count="report.summary.missingFiles"
        :hint="$t('admin.health.missing.hint')"
      >
        <template #action>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              @click="offloadGroups(report.missingGroups)"
              :disabled="busy"
              class="h-8 px-3 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <Archive class="w-3.5 h-3.5" /> {{ $t('admin.health.missing.keepAll') }}
            </button>
            <button
              type="button"
              @click="removeMissing"
              :disabled="busy"
              class="h-8 px-3 rounded-lg border border-destructive/40 text-destructive text-xs font-medium hover:bg-destructive/10 transition disabled:opacity-50"
            >
              {{ removingMissing ? $t('admin.health.missing.removing') : $t('admin.health.missing.removeAll') }}
            </button>
          </div>
        </template>
        <GroupRow v-for="group in report.missingGroups" :key="group.key" :group="group">
          <button type="button" @click="offloadGroups([group])" :disabled="busy" class="h-7 px-2.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[12px] font-medium transition disabled:opacity-50 flex items-center gap-1">
            <Archive class="w-3.5 h-3.5" /> {{ $t('admin.health.keepAsHistory') }}
          </button>
          <button type="button" @click="removeGroup(group)" :disabled="busy" class="h-7 px-2.5 rounded-lg text-destructive hover:bg-destructive/10 text-[12px] font-medium transition disabled:opacity-50">
            Remove for good
          </button>
        </GroupRow>
      </HealthSection>

      <!-- Offloaded -->
      <HealthSection
        id="health-offloaded"
        :title="$t('admin.health.offloaded.title')"
        :count="report.summary.offloaded || 0"
        tone="info"
        :hint="$t('admin.health.offloaded.hint')"
      >
        <GroupRow v-for="group in report.offloadedGroups" :key="group.key" :group="group" offloaded>
          <button type="button" @click="unoffloadGroup(group)" :disabled="busy" class="h-7 px-2.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[12px] font-medium transition disabled:opacity-50 flex items-center gap-1">
            <Undo2 class="w-3.5 h-3.5" /> {{ $t('admin.health.offloaded.undo') }}
          </button>
          <button v-if="!group.awaitingDeletion" type="button" @click="removeGroup(group)" :disabled="busy" class="h-7 px-2.5 rounded-lg text-destructive hover:bg-destructive/10 text-[12px] font-medium transition disabled:opacity-50">
            Remove for good
          </button>
        </GroupRow>
      </HealthSection>

      <!-- Duplicates -->
      <HealthSection
        id="health-duplicates"
        :title="$t('admin.health.duplicates.title')"
        :count="report.summary.duplicateGroups"
        :hint="$t('admin.health.duplicates.hint')"
      >
        <div v-for="(group, idx) in report.duplicates" :key="idx" class="py-2">
          <p class="px-4 text-[12px] font-semibold text-muted-foreground">{{ $t('admin.health.duplicates.copies', { count: group.copies }) }}</p>
          <ItemRow v-for="item in group.items" :key="item.id" :item="item" show-path />
        </div>
      </HealthSection>

      <!-- Volume clashes -->
      <HealthSection
        id="health-clashes"
        :title="$t('admin.health.clashes.title')"
        :count="report.summary.volumeClashes"
        :hint="$t('admin.health.clashes.hint')"
      >
        <div v-for="clash in report.volumeClashes" :key="`${clash.library_id}-${clash.series}-${clash.volume}`" class="py-2">
          <p class="px-4 text-[12px] font-semibold text-muted-foreground">{{ clash.series }} · #{{ clash.volume }} · {{ clash.library_name }}</p>
          <ItemRow v-for="item in clash.items" :key="item.id" :item="item" show-path />
        </div>
      </HealthSection>

      <!-- Missing metadata -->
      <HealthSection
        id="health-metadata"
        :title="$t('admin.health.metadata.title')"
        :count="report.summary.noCover + report.summary.noAuthor"
        :hint="$t('admin.health.metadata.hint', { noCover: $n(report.summary.noCover || 0), noAuthor: $n(report.summary.noAuthor || 0), noDescription: $n(report.summary.noDescription || 0) })"
      >
        <template #action>
          <button type="button" @click="$emit('open-metadata')" class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition active:scale-95">
            {{ $t('admin.health.metadata.open') }}
          </button>
        </template>
        <ItemRow v-for="item in report.noCover" :key="item.id" :item="item" :note="$t('admin.health.metadata.noCover')" />
        <ItemRow v-for="item in report.noAuthor" :key="`a-${item.id}`" :item="item" :note="$t('admin.health.metadata.noAuthor')" />
      </HealthSection>

      <!-- Unrated -->
      <HealthSection
        id="health-unrated"
        :title="$t('admin.health.unrated.title')"
        :count="report.summary.unrated"
        tone="info"
        :hint="$t('admin.health.unrated.hint')"
      />

      <!-- Transcode failures -->
      <HealthSection
        id="health-transcode"
        :title="$t('admin.health.transcode.title')"
        :count="report.summary.transcodeFailures"
        :hint="$t('admin.health.transcode.hint')"
      >
        <div v-for="(entry, idx) in report.transcodeFailures" :key="idx" class="px-4 py-2 text-[12px]">
          <p class="text-muted-foreground">{{ formatTime(entry.timestamp) }}</p>
          <p class="font-mono text-foreground break-all">{{ entry.message }}</p>
        </div>
      </HealthSection>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h, defineComponent } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import SectionHeader from './settings/SectionHeader.vue';
import { t, n, d } from '../i18n';
import { RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, Archive, Undo2 } from '@lucide/vue';

defineEmits(['open-metadata']);

const dialog = useDialogStore();
const report = ref(null);
const loading = ref(false);
const error = ref('');
const scanningId = ref(null);

const tiles = computed(() => {
  const s = report.value?.summary || {};
  const warn = 'border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400';
  const bad = 'border-destructive/40 bg-destructive/5 text-destructive';
  return [
    { key: 'libraries', label: t('admin.health.tiles.libraries'), count: s.unreachableLibraries || 0, tone: bad },
    { key: 'missing', label: t('admin.health.tiles.missing'), count: s.missingFiles || 0, tone: bad },
    { key: 'duplicates', label: t('admin.health.tiles.duplicates'), count: s.duplicateGroups || 0, tone: warn },
    { key: 'clashes', label: t('admin.health.tiles.clashes'), count: s.volumeClashes || 0, tone: warn },
    { key: 'metadata', label: t('admin.health.tiles.metadata'), count: s.noCover || 0, tone: warn },
    { key: 'transcode', label: t('admin.health.tiles.transcode'), count: s.transcodeFailures || 0, tone: bad }
  ];
});

const allClear = computed(() => tiles.value.every((tile) => tile.count === 0));

function formatTime(value) {
  if (!value) return '';
  return d(value, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }) || String(value);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/admin/health', { timeout: 120000 });
    report.value = res.data;
  } catch (err) {
    error.value = err.response?.data?.error || t('admin.health.couldNotRun');
  } finally {
    loading.value = false;
  }
}

const removingMissing = ref(false);
const working = ref(false);
const busy = computed(() => working.value || removingMissing.value);

function groupLabel(group) {
  return group.season != null ? t('admin.health.groupSeason', { name: group.name, season: group.season }) : group.name;
}

async function offloadGroups(groups) {
  const ids = groups.flatMap((g) => g.ids);
  if (!ids.length) return;
  // One group reads as "it", several as "they" — chosen by the plural form.
  const label = groups.length === 1 ? groupLabel(groups[0]) : t('admin.health.titlesCount', { count: groups.length });
  const ok = await dialog.confirm({
    title: t('admin.health.keepTitle'),
    message: t('admin.health.keepMessage', { count: groups.length, label }),
    confirmText: t('admin.health.keepAsHistory')
  });
  if (!ok) return;
  working.value = true;
  try {
    await api.post('/admin/health/offload', { itemIds: ids });
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.health.couldNotKeep'));
  } finally {
    working.value = false;
  }
}

async function unoffloadGroup(group) {
  working.value = true;
  try {
    await api.post('/admin/health/unoffload', { itemIds: group.ids });
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.health.couldNotUndo'));
  } finally {
    working.value = false;
  }
}

async function removeGroup(group) {
  const ok = await dialog.confirm({
    title: t('admin.health.removeTitle'),
    message: t('admin.health.removeMessage', { name: groupLabel(group) }),
    confirmText: t('common.remove'),
    danger: true
  });
  if (!ok) return;
  working.value = true;
  try {
    const res = await api.post('/admin/health/remove-missing', { itemIds: group.ids });
    if (res.data.skipped) dialog.alert(t('admin.health.skipped', { count: res.data.skipped }));
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.health.couldNotRemove'));
  } finally {
    working.value = false;
  }
}

async function removeMissing() {
  const count = report.value?.summary?.missingFiles || 0;
  const ok = await dialog.confirm({
    title: t('admin.health.removeMissingTitle'),
    message: t('admin.health.removeMissingMessage', { count }),
    confirmText: t('common.remove'),
    danger: true
  });
  if (!ok) return;
  removingMissing.value = true;
  try {
    const res = await api.post('/admin/health/remove-missing', {});
    dialog.alert(res.data.skipped
      ? t('admin.health.removedSkipped', { count: res.data.removed, skipped: res.data.skipped })
      : t('admin.health.removed', { count: res.data.removed }));
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.health.couldNotRemoveMissing'));
  } finally {
    removingMissing.value = false;
  }
}

async function rescan(lib) {
  scanningId.value = lib.id;
  try {
    const res = await api.post(`/libraries/${lib.id}/scan`, null, { timeout: 600000 });
    const { added = 0, updated = 0, removed = 0 } = res.data || {};
    dialog.alert(t('admin.health.scanComplete', { name: lib.name, added, updated, removed }));
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.health.scanFailed'));
  } finally {
    scanningId.value = null;
  }
}

// A collapsible card for one report section. Sections with nothing to report stay
// collapsed with a green check, so a healthy library reads at a glance.
const HealthSection = defineComponent({
  props: { title: String, count: Number, hint: String, tone: { type: String, default: 'warn' } },
  setup(props, { slots }) {
    const open = ref(false);
    return () => {
      const hasItems = props.count > 0;
      const badgeClass = !hasItems
        ? 'bg-emerald-500/15 text-emerald-500'
        : props.tone === 'info' ? 'bg-sky-500/15 text-sky-500' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
      const expandable = hasItems && !!slots.default;
      return h('section', { class: 'rounded-xl border border-border bg-card scroll-mt-24' }, [
        h('header', { class: 'px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2' }, [
          h('button', {
            type: 'button',
            class: 'flex items-center gap-2 min-w-0 flex-1 text-left',
            disabled: !expandable,
            'aria-expanded': expandable ? String(open.value) : undefined,
            onClick: () => { if (expandable) open.value = !open.value; }
          }, [
            h('span', { class: `text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-md ${badgeClass}` },
              hasItems ? n(props.count) : '✓'),
            h('h3', { class: 'text-sm font-semibold text-foreground truncate' }, props.title),
            expandable ? h(ChevronDown, { class: `w-4 h-4 text-muted-foreground transition-transform ${open.value ? 'rotate-180' : ''}` }) : null
          ]),
          slots.action && hasItems ? slots.action() : null,
          props.hint ? h('p', { class: 'basis-full text-[12px] text-muted-foreground leading-relaxed' }, props.hint) : null
        ]),
        expandable && open.value
          ? h('div', { class: 'border-t border-border divide-y divide-border/60 max-h-[60dvh] overflow-y-auto' }, slots.default())
          : null
      ]);
    };
  }
});

const ItemRow = defineComponent({
  props: { item: Object, showPath: Boolean, note: String },
  setup(props) {
    return () => h('div', { class: 'px-4 py-2 flex items-start gap-3' }, [
      h('div', { class: 'min-w-0 flex-1' }, [
        h('p', { class: 'text-xs font-medium text-foreground truncate' }, [
          props.item.title,
          props.item.series ? h('span', { class: 'text-muted-foreground font-normal' }, ` · ${props.item.series}${props.item.volume != null ? ` #${props.item.volume}` : ''}`) : null
        ]),
        props.showPath
          ? h('p', { class: 'text-[11px] font-mono text-muted-foreground break-all' }, props.item.path)
          : h('p', { class: 'text-[11px] text-muted-foreground' }, `${props.item.library_name} · ${mediaTypeWord(props.item.media_type)}`)
      ]),
      props.note ? h('span', { class: 'text-[11px] text-muted-foreground flex-shrink-0' }, props.note) : null
    ]);
  }
});

// One film, book, series or season in the missing or offloaded list, with its actions.
function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `${n(gb, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
    : `${n(Math.max(1, Math.round(bytes / 1024 ** 2)))} MB`;
}
// The raw media type ("book") in the reader's language, lower case like the rest of the line.
function mediaTypeWord(type) {
  return ['movie', 'show', 'anime', 'manga', 'book', 'audiobook'].includes(type) ? t(`admin.health.mediaTypes.${type}`) : type;
}
const GroupRow = defineComponent({
  props: { group: Object, offloaded: Boolean },
  setup(props, { slots }) {
    return () => {
      const g = props.group;
      const unit = ['show', 'anime'].includes(g.media_type) ? 'episodes' : 'files';
      const facts = [
        t(`admin.health.${unit}`, { count: g.count }),
        props.offloaded ? null : formatSize(g.size),
        g.library_name
      ].filter(Boolean).join(' · ');
      return h('div', { class: 'px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5' }, [
        h('div', { class: 'min-w-0 flex-1 basis-[12rem]' }, [
          h('p', { class: 'text-xs font-medium text-foreground truncate' }, groupLabel(g)),
          h('p', { class: 'text-[11px] text-muted-foreground' }, facts),
          props.offloaded && g.awaitingDeletion
            ? h('p', { class: 'text-[11px] text-amber-600 dark:text-amber-400' }, t('admin.health.stillOnDisk', { count: g.awaitingDeletion }))
            : null
        ]),
        h('div', { class: 'flex items-center gap-1.5 flex-shrink-0' }, slots.default ? slots.default() : [])
      ]);
    };
  }
});

onMounted(load);
</script>
