<template>
  <!-- Admin → Network: who can use the server from where, and a live check of how this
       device is seen, so an admin can confirm it from a phone on mobile data. -->
  <div class="flex flex-col gap-5">
    <SectionHeader :title="$t('network.title')" :description="$t('network.description')">
      <button type="button" @click="load" :disabled="loading" class="btn btn-secondary">
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
        {{ $t('network.checkAgain') }}
      </button>
    </SectionHeader>

    <p v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{{ error }}</p>

    <template v-if="report">
      <!-- This device -->
      <div class="rounded-xl border p-4 flex items-start gap-3" :class="whereTone">
        <component :is="whereIcon" class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div class="min-w-0 text-sm">
          <p class="font-semibold text-foreground">{{ $t('network.device.connectingFrom', { where: whereLabel }) }}</p>
          <I18nT keypath="network.device.address" tag="p" class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            <template #ip><code class="font-mono">{{ report.thisDevice.ip || $t('network.device.unknownIp') }}</code></template>
          </I18nT>
        </div>
      </div>

      <!-- Tailscale: is it working, and how to set it up -->
      <section class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold flex items-center gap-2"><Waypoints class="w-4 h-4 text-primary" /> Tailscale</h3>
          <button type="button" @click="showGuide = !showGuide" class="h-8 px-3 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium">
            {{ showGuide ? $t('network.tailscale.hideGuide') : (report.tailscale.host ? $t('network.tailscale.guide') : $t('network.tailscale.setUp')) }}
          </button>
        </header>
        <div class="p-4 flex flex-col gap-2 text-sm">
          <p v-if="report.tailscale.lastSeen" class="flex items-start gap-2 text-foreground">
            <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>
              <I18nT keypath="network.tailscale.working">
                <template #link><a :href="`https://${report.tailscale.host}`" target="_blank" rel="noopener" class="font-mono text-primary hover:underline break-all">https://{{ report.tailscale.host }}</a></template>
              </I18nT>
              <span class="text-xs text-muted-foreground"> · {{ $t('network.tailscale.lastUsed', { time: formatTime(report.tailscale.lastSeen) }) }}</span>
            </span>
          </p>
          <p v-else-if="report.tailscale.host" class="flex items-start gap-2 text-muted-foreground">
            <Waypoints class="w-4 h-4 flex-shrink-0 mt-0.5" />
            <I18nT keypath="network.tailscale.setUpAt">
              <template #address><span class="font-mono break-all">https://{{ report.tailscale.host }}</span></template>
            </I18nT>
          </p>
          <I18nT v-else keypath="network.tailscale.notSetUp" tag="p" class="text-muted-foreground text-xs leading-relaxed">
            <template #address><code class="font-mono">https://….ts.net</code></template>
          </I18nT>

          <p v-if="report.tailscale.funnelLastSeen" class="flex items-start gap-2 text-foreground">
            <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>{{ $t('network.tailscale.funnelWorking', { time: formatTime(report.tailscale.funnelLastSeen) }) }}</span>
          </p>
          <p v-if="(guideFunnel || report.tailscale.funnelLastSeen) && !report.settings.remoteAccess" class="flex flex-wrap items-center gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
            <AlertTriangle class="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span class="flex-1 min-w-[12rem] text-muted-foreground">{{ $t('network.tailscale.funnelNeedsAccess') }}</span>
            <button type="button" @click="save({ remoteAccess: true })" :disabled="saving" class="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">{{ $t('network.tailscale.allowOutside') }}</button>
          </p>

          <div v-if="showGuide" class="pt-3 mt-1 border-t border-border">
            <TailscaleGuide context="admin" v-model:funnel="guideFunnel" />
          </div>
        </div>
      </section>

      <!-- Warnings -->
      <div v-if="report.proxyWithoutTrust" class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm flex items-start gap-3">
        <AlertTriangle class="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div class="text-xs text-muted-foreground leading-relaxed">
          <p class="text-sm font-semibold text-foreground">{{ $t('network.proxy.title') }}</p>
          {{ $t('network.proxy.text', { from: report.proxyWithoutTrust.from || $t('network.proxy.localAddress') }) }}
        </div>
      </div>
      <div v-if="report.settings.remoteAccess && report.accounts.adminsWithoutTwoFactor" class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-xs text-muted-foreground leading-relaxed flex items-start gap-3">
        <ShieldAlert class="w-5 h-5 text-amber-500 flex-shrink-0" />
        <p>
          <span class="text-sm font-semibold text-foreground block">{{ $t('network.adminsWithout2fa.title', { count: report.accounts.adminsWithoutTwoFactor }) }}</span>
          {{ $t('network.adminsWithout2fa.text') }}
        </p>
      </div>

      <!-- Settings -->
      <section :key="rev" class="rounded-xl border border-border bg-card divide-y divide-border">
        <SettingRow
          :checked="report.settings.remoteAccess"
          :disabled="saving"
          :title="$t('network.settings.remoteAccess.title')"
          @toggle="save({ remoteAccess: $event })"
        >
          {{ $t('network.settings.remoteAccess.text') }}
        </SettingRow>
        <SettingRow
          :checked="report.settings.tailscaleIsHome"
          :disabled="saving"
          :title="$t('network.settings.tailscaleIsHome.title')"
          @toggle="save({ tailscaleIsHome: $event })"
        >
          {{ $t('network.settings.tailscaleIsHome.text') }}
        </SettingRow>
        <SettingRow
          :checked="report.settings.require2faOutside"
          :disabled="saving || !report.settings.remoteAccess"
          :title="$t('network.settings.require2fa.title')"
          @toggle="save({ require2faOutside: $event })"
        >
          {{ $t('network.settings.require2fa.text') }}
          <span v-if="!report.settings.remoteAccess" class="block mt-1">{{ $t('network.settings.require2fa.onlyWhenOn') }}</span>
        </SettingRow>
      </section>

      <!-- Accounts -->
      <section class="rounded-xl border border-border bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.total }}</p><p class="text-[12px] text-muted-foreground">{{ $t('network.accounts.total') }}</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.withTwoFactor }}</p><p class="text-[12px] text-muted-foreground">{{ $t('network.accounts.withTwoFactor') }}</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.homeOnly }}</p><p class="text-[12px] text-muted-foreground">{{ $t('network.accounts.homeOnly') }}</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.adminsWithoutTwoFactor }}</p><p class="text-[12px] text-muted-foreground">{{ $t('network.accounts.adminsWithoutTwoFactor') }}</p></div>
        <p class="col-span-2 sm:col-span-4 text-[12px] text-muted-foreground">{{ $t('network.accounts.hint') }}</p>
      </section>

      <!-- Recent outside sign-ins -->
      <section class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border text-sm font-semibold">{{ $t('network.recent.title') }}</header>
        <p v-if="!report.recentOutsideSignIns.length" class="px-4 py-4 text-xs text-muted-foreground">{{ $t('network.recent.none') }}</p>
        <ul v-else class="divide-y divide-border/60">
          <li v-for="(s, i) in report.recentOutsideSignIns" :key="i" class="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span class="font-medium text-foreground">{{ s.username }}</span>
            <span :class="s.success ? 'text-emerald-500' : 'text-destructive'">{{ s.success ? $t('network.recent.signedIn') : $t('network.recent.failed') }}</span>
            <span class="font-mono text-muted-foreground">{{ s.ip_address }}</span>
            <span class="text-muted-foreground ml-auto">{{ formatTime(s.created_at) }}</span>
          </li>
        </ul>
      </section>

      <I18nT keypath="network.docsHint" tag="p" class="text-xs text-muted-foreground leading-relaxed">
        <template #link><router-link to="/docs" class="text-primary hover:underline">{{ $t('network.docsLink') }}</router-link></template>
        <template #file><code class="font-mono">docs/remote-access.md</code></template>
      </I18nT>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { Globe, RefreshCw, AlertTriangle, ShieldAlert, House, Waypoints, Earth, CheckCircle2 } from '@lucide/vue';
import TailscaleGuide from './TailscaleGuide.vue';
import SectionHeader from './settings/SectionHeader.vue';
import { t, d } from '../i18n';

const dialog = useDialogStore();
const report = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
// Redraws the switches when a change is refused or cancelled, so a checkbox never shows a
// state that wasn't saved.
const rev = ref(0);
const showGuide = ref(false);
const guideFunnel = ref(false);

const whereLabel = computed(() => {
  const key = {
    home: 'home',
    tailscale: report.value?.settings.tailscaleIsHome ? 'tailscaleHome' : 'tailscaleOutside',
    outside: 'outside'
  }[report.value?.thisDevice.where] || 'unknown';
  return t(`network.device.where.${key}`);
});
const whereIcon = computed(() => ({ home: House, tailscale: Waypoints, outside: Earth }[report.value?.thisDevice.where] || Globe));
const whereTone = computed(() => (report.value?.thisDevice.away ? 'border-sky-500/40 bg-sky-500/5 text-sky-500' : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    report.value = (await api.get('/admin/network')).data;
  } catch (err) {
    error.value = err.response?.data?.error || t('network.errors.load');
  } finally {
    loading.value = false;
  }
}

async function save(patch) {
  if (patch.remoteAccess === true) {
    const ok = await dialog.confirm({
      title: t('network.confirm.title'),
      message: t('network.confirm.message'),
      confirmText: t('network.confirm.allow')
    });
    if (!ok) {
      rev.value++;
      return;
    }
  }
  saving.value = true;
  error.value = '';
  try {
    report.value = (await api.patch('/admin/network', patch)).data;
  } catch (err) {
    error.value = err.response?.data?.error || t('network.errors.save');
    rev.value++;
  } finally {
    saving.value = false;
  }
}

function formatTime(value) {
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? value : d(date, { dateStyle: 'medium', timeStyle: 'short' });
}

// One on/off setting with its explanation underneath.
const SettingRow = (props, { slots, emit }) => h('label', {
  class: ['flex items-start gap-3 p-4 select-none', props.disabled ? 'opacity-60' : 'cursor-pointer hover:bg-muted/30 transition']
}, [
  h('input', {
    type: 'checkbox',
    checked: props.checked,
    disabled: props.disabled,
    class: 'mt-0.5 rounded border-border text-primary focus:ring-ring',
    onChange: (e) => emit('toggle', e.target.checked)
  }),
  h('div', { class: 'flex flex-col gap-0.5 min-w-0' }, [
    h('span', { class: 'text-sm font-semibold text-foreground' }, props.title),
    h('span', { class: 'text-xs text-muted-foreground leading-relaxed' }, slots.default?.())
  ])
]);
SettingRow.props = ['checked', 'disabled', 'title'];
SettingRow.emits = ['toggle'];

onMounted(load);
</script>
