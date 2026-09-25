<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
          <HeartPulse class="w-4.5 h-4.5 text-primary" />
          Library Health
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">
          What needs attention across your libraries.
          <span v-if="report">Checked {{ formatTime(report.generatedAt) }}.</span>
        </p>
      </div>
      <button
        type="button"
        @click="load"
        :disabled="loading"
        class="h-9 px-3.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
        {{ loading ? 'Checking…' : 'Run check' }}
      </button>
    </div>

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
          <span class="text-[11px] font-medium text-muted-foreground">{{ tile.label }}</span>
          <span class="text-xl font-semibold tabular-nums" :class="tile.count > 0 ? '' : 'text-muted-foreground'">{{ tile.count.toLocaleString() }}</span>
        </a>
      </div>

      <p v-if="allClear" class="text-sm text-emerald-500 flex items-center gap-2">
        <CheckCircle2 class="w-4 h-4" /> Everything looks healthy.
      </p>

      <!-- Libraries -->
      <section id="health-libraries" class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-foreground">Libraries</h3>
          <span class="text-[11px] text-muted-foreground">{{ report.summary.totalItems.toLocaleString() }} items total</span>
        </header>
        <ul class="divide-y divide-border">
          <li v-for="lib in report.libraries" :key="lib.id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <component :is="lib.path_exists ? CheckCircle2 : AlertTriangle" class="w-4 h-4 flex-shrink-0" :class="lib.path_exists ? 'text-emerald-500' : 'text-destructive'" />
            <div class="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
              <p class="text-sm font-medium text-foreground truncate">{{ lib.name }}</p>
              <p class="text-[11px] text-muted-foreground truncate font-mono" :title="lib.path">{{ lib.path }}</p>
            </div>
            <div class="text-[11px] text-muted-foreground flex flex-col items-start sm:items-end flex-1 sm:flex-none pl-7 sm:pl-0">
              <span>{{ lib.item_count.toLocaleString() }} items</span>
              <span>{{ lib.last_scanned_at ? `Scanned ${formatTime(lib.last_scanned_at + 'Z')}` : 'Never scanned' }}</span>
            </div>
            <p v-if="!lib.path_exists" class="basis-full text-[11px] text-destructive">
              Folder not reachable — check the drive is mounted and the Docker volume is mapped. Items stay in the catalog until it's back.
            </p>
            <button
              v-else
              type="button"
              @click="rescan(lib)"
              :disabled="scanningId === lib.id"
              class="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="scanningId === lib.id ? 'animate-spin' : ''" />
              Rescan
            </button>
          </li>
          <li v-if="report.libraries.length === 0" class="px-4 py-6 text-center text-xs text-muted-foreground">No libraries yet.</li>
        </ul>
      </section>

      <!-- Missing files -->
      <HealthSection
        id="health-missing"
        title="Missing files"
        :count="report.summary.missingFiles"
        hint="In the catalog but gone from disk. A rescan of the library removes them (reading progress re-attaches if the file comes back)."
      >
        <ItemRow v-for="item in report.missingFiles" :key="item.id" :item="item" show-path />
      </HealthSection>

      <!-- Duplicates -->
      <HealthSection
        id="health-duplicates"
        title="Likely duplicates"
        :count="report.summary.duplicateGroups"
        hint="Same title and exact same file size — usually the same file in two folders or libraries."
      >
        <div v-for="(group, idx) in report.duplicates" :key="idx" class="py-2">
          <p class="px-4 text-[11px] font-semibold text-muted-foreground">{{ group.copies }} copies</p>
          <ItemRow v-for="item in group.items" :key="item.id" :item="item" show-path />
        </div>
      </HealthSection>

      <!-- Volume clashes -->
      <HealthSection
        id="health-clashes"
        title="Volume / episode clashes"
        :count="report.summary.volumeClashes"
        hint="Different files that both claim the same volume or episode number in a series. Usually a misnamed file."
      >
        <div v-for="clash in report.volumeClashes" :key="`${clash.library_id}-${clash.series}-${clash.volume}`" class="py-2">
          <p class="px-4 text-[11px] font-semibold text-muted-foreground">{{ clash.series }} · #{{ clash.volume }} · {{ clash.library_name }}</p>
          <ItemRow v-for="item in clash.items" :key="item.id" :item="item" show-path />
        </div>
      </HealthSection>

      <!-- Missing metadata -->
      <HealthSection
        id="health-metadata"
        title="Missing artwork or metadata"
        :count="report.summary.noCover + report.summary.noAuthor"
        :hint="`${report.summary.noCover} without cover art, ${report.summary.noAuthor} books/manga/audiobooks without an author, ${report.summary.noDescription} without a description. Fix them in the Metadata tab.`"
      >
        <template #action>
          <button type="button" @click="$emit('open-metadata')" class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition active:scale-95">
            Open Metadata
          </button>
        </template>
        <ItemRow v-for="item in report.noCover" :key="item.id" :item="item" note="No cover" />
        <ItemRow v-for="item in report.noAuthor" :key="`a-${item.id}`" :item="item" note="No author" />
      </HealthSection>

      <!-- Unrated -->
      <HealthSection
        id="health-unrated"
        title="Unrated titles"
        :count="report.summary.unrated"
        tone="info"
        hint="Titles with no age rating on themselves or their series. Only matters if you use content limits for some users — rate series from their series sheet, single titles from the metadata editor."
      />

      <!-- Transcode failures -->
      <HealthSection
        id="health-transcode"
        title="Recent playback encode failures"
        :count="report.summary.transcodeFailures"
        hint="ffmpeg errors while preparing video. Often a hardware-acceleration driver problem — try Server Config → Transcoding → Test."
      >
        <div v-for="(entry, idx) in report.transcodeFailures" :key="idx" class="px-4 py-2 text-[11px]">
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
import { HeartPulse, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-vue-next';

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
    { key: 'libraries', label: 'Unreachable libraries', count: s.unreachableLibraries || 0, tone: bad },
    { key: 'missing', label: 'Missing files', count: s.missingFiles || 0, tone: bad },
    { key: 'duplicates', label: 'Duplicates', count: s.duplicateGroups || 0, tone: warn },
    { key: 'clashes', label: 'Volume clashes', count: s.volumeClashes || 0, tone: warn },
    { key: 'metadata', label: 'No cover art', count: s.noCover || 0, tone: warn },
    { key: 'transcode', label: 'Encode failures', count: s.transcodeFailures || 0, tone: bad }
  ];
});

const allClear = computed(() => tiles.value.every((t) => t.count === 0));

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/admin/health', { timeout: 120000 });
    report.value = res.data;
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not run the health check';
  } finally {
    loading.value = false;
  }
}

async function rescan(lib) {
  scanningId.value = lib.id;
  try {
    const res = await api.post(`/libraries/${lib.id}/scan`, null, { timeout: 600000 });
    const { added = 0, updated = 0, removed = 0 } = res.data || {};
    dialog.alert(`Scan of "${lib.name}" complete: ${added} added, ${updated} updated, ${removed} removed.`);
    await load();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Scan failed');
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
            h('span', { class: `text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-md ${badgeClass}` },
              hasItems ? props.count.toLocaleString() : '✓'),
            h('h3', { class: 'text-sm font-semibold text-foreground truncate' }, props.title),
            expandable ? h(ChevronDown, { class: `w-4 h-4 text-muted-foreground transition-transform ${open.value ? 'rotate-180' : ''}` }) : null
          ]),
          slots.action && hasItems ? slots.action() : null,
          props.hint ? h('p', { class: 'basis-full text-[11px] text-muted-foreground leading-relaxed' }, props.hint) : null
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
          ? h('p', { class: 'text-[10px] font-mono text-muted-foreground break-all' }, props.item.path)
          : h('p', { class: 'text-[10px] text-muted-foreground' }, `${props.item.library_name} · ${props.item.media_type}`)
      ]),
      props.note ? h('span', { class: 'text-[10px] text-muted-foreground flex-shrink-0' }, props.note) : null
    ]);
  }
});

onMounted(load);
</script>
