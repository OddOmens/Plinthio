<template>
  <!-- Admin → Network: who can use the server from where, and a live check of how this
       device is seen, so an admin can confirm it from a phone on mobile data. -->
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
          <Globe class="w-4.5 h-4.5 text-primary" />
          Network &amp; Access
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">Where Plinthio can be used from, and two-factor away from home.</p>
      </div>
      <button type="button" @click="load" :disabled="loading" class="h-9 px-3.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50">
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
        Check again
      </button>
    </div>

    <p v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{{ error }}</p>

    <template v-if="report">
      <!-- This device -->
      <div class="rounded-xl border p-4 flex items-start gap-3" :class="whereTone">
        <component :is="whereIcon" class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div class="min-w-0 text-sm">
          <p class="font-semibold text-foreground">This device is connecting from {{ whereLabel }}</p>
          <p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Address <code class="font-mono">{{ report.thisDevice.ip || 'unknown' }}</code>.
            To check outside access, open this page on a phone using mobile data (Wi-Fi off). It should say "outside".
          </p>
        </div>
      </div>

      <!-- Tailscale: is it working, and how to set it up -->
      <section class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold flex items-center gap-2"><Waypoints class="w-4 h-4 text-primary" /> Tailscale</h3>
          <button type="button" @click="showGuide = !showGuide" class="h-8 px-3 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium">
            {{ showGuide ? 'Hide setup guide' : (report.tailscale.host ? 'Setup guide' : 'Set up Tailscale') }}
          </button>
        </header>
        <div class="p-4 flex flex-col gap-2 text-sm">
          <p v-if="report.tailscale.lastSeen" class="flex items-start gap-2 text-foreground">
            <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>
              Working at <a :href="`https://${report.tailscale.host}`" target="_blank" rel="noopener" class="font-mono text-primary hover:underline break-all">https://{{ report.tailscale.host }}</a>
              <span class="text-xs text-muted-foreground"> · last used {{ formatTime(report.tailscale.lastSeen) }}</span>
            </span>
          </p>
          <p v-else-if="report.tailscale.host" class="flex items-start gap-2 text-muted-foreground">
            <Waypoints class="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Set up at <span class="font-mono break-all">https://{{ report.tailscale.host }}</span>, not used since Plinthio last started. Open it from a Tailscale device to check.</span>
          </p>
          <p v-else class="text-muted-foreground text-xs leading-relaxed">
            Not set up, as far as Plinthio can tell. Tailscale gives you a trusted <code class="font-mono">https://….ts.net</code> address at home and
            away; with Funnel, it's also a link anyone can open, with no domain. Open the guide to set it up.
          </p>

          <p v-if="report.tailscale.funnelLastSeen" class="flex items-start gap-2 text-foreground">
            <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>Funnel is working: a visitor from the internet, {{ formatTime(report.tailscale.funnelLastSeen) }}.</span>
          </p>
          <p v-if="(guideFunnel || report.tailscale.funnelLastSeen) && !report.settings.remoteAccess" class="flex flex-wrap items-center gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
            <AlertTriangle class="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span class="flex-1 min-w-[12rem] text-muted-foreground">Funnel visitors come from the internet, and outside access is off, so they'll see "available at home only".</span>
            <button type="button" @click="save({ remoteAccess: true })" :disabled="saving" class="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">Allow outside access</button>
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
          <p class="text-sm font-semibold text-foreground">A proxy is in front of Plinthio, but TRUST_PROXY isn't set</p>
          Every visitor looks like they come from the proxy ({{ report.proxyWithoutTrust.from || 'a local address' }}), usually
          a home address, so outside access can't be told apart. The Tailscale and public-address add-ons set it for you.
          For another proxy, see docs/remote-access.md.
        </div>
      </div>
      <div v-if="report.settings.remoteAccess && report.accounts.adminsWithoutTwoFactor" class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-xs text-muted-foreground leading-relaxed flex items-start gap-3">
        <ShieldAlert class="w-5 h-5 text-amber-500 flex-shrink-0" />
        <p>
          <span class="text-sm font-semibold text-foreground block">{{ report.accounts.adminsWithoutTwoFactor }} admin account{{ report.accounts.adminsWithoutTwoFactor === 1 ? '' : 's' }} without two-factor</span>
          The server is open to the internet. Turning on two-factor for admins (Settings → Security) is strongly recommended.
        </p>
      </div>

      <!-- Settings -->
      <section :key="rev" class="rounded-xl border border-border bg-card divide-y divide-border">
        <SettingRow
          :checked="report.settings.remoteAccess"
          :disabled="saving"
          title="Allow access from outside the home network"
          @toggle="save({ remoteAccess: $event })"
        >
          Off: only devices at home (and on Tailscale, below) can sign in or use anything; the internet gets
          "available at home only". On: anyone with an account allowed away from home can sign in from anywhere.
          This only decides who's let in: reaching the server from the internet also needs Tailscale Funnel
          (no domain needed) or a web address (the public-address add-on).
        </SettingRow>
        <SettingRow
          :checked="report.settings.tailscaleIsHome"
          :disabled="saving"
          title="Tailscale devices count as home"
          @toggle="save({ tailscaleIsHome: $event })"
        >
          On (the default): anything on your tailnet is treated like your home network. Turn off if you share the
          server with Tailscale users you'd rather treat as outside.
        </SettingRow>
        <SettingRow
          :checked="report.settings.require2faOutside"
          :disabled="saving || !report.settings.remoteAccess"
          title="Require two-factor away from home"
          @toggle="save({ require2faOutside: $event })"
        >
          Optional. Sign-ins from outside need a code from a phone app. At home a password is still enough, so
          anyone without two-factor can sign in there and set it up (Settings → Security).
          <span v-if="!report.settings.remoteAccess" class="block mt-1">Only applies when outside access is on.</span>
        </SettingRow>
      </section>

      <!-- Accounts -->
      <section class="rounded-xl border border-border bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.total }}</p><p class="text-[12px] text-muted-foreground">Accounts</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.withTwoFactor }}</p><p class="text-[12px] text-muted-foreground">With two-factor</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.homeOnly }}</p><p class="text-[12px] text-muted-foreground">Home only</p></div>
        <div><p class="text-xl font-semibold tabular-nums">{{ report.accounts.adminsWithoutTwoFactor }}</p><p class="text-[12px] text-muted-foreground">Admins without two-factor</p></div>
        <p class="col-span-2 sm:col-span-4 text-[12px] text-muted-foreground">Set who may use Plinthio away from home, and reset someone's two-factor, in the Users tab.</p>
      </section>

      <!-- Recent outside sign-ins -->
      <section class="rounded-xl border border-border bg-card">
        <header class="px-4 py-3 border-b border-border text-sm font-semibold">Recent sign-ins from outside</header>
        <p v-if="!report.recentOutsideSignIns.length" class="px-4 py-4 text-xs text-muted-foreground">None yet.</p>
        <ul v-else class="divide-y divide-border/60">
          <li v-for="(s, i) in report.recentOutsideSignIns" :key="i" class="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span class="font-medium text-foreground">{{ s.username }}</span>
            <span :class="s.success ? 'text-emerald-500' : 'text-destructive'">{{ s.success ? 'signed in' : 'failed' }}</span>
            <span class="font-mono text-muted-foreground">{{ s.ip_address }}</span>
            <span class="text-muted-foreground ml-auto">{{ formatTime(s.created_at) }}</span>
          </li>
        </ul>
      </section>

      <p class="text-xs text-muted-foreground leading-relaxed">
        How to reach Plinthio from outside (Tailscale, or a web address for guests), step by step:
        <router-link to="/docs" class="text-primary hover:underline">Docs → Remote Access &amp; Tailscale</router-link>,
        or <code class="font-mono">docs/remote-access.md</code> on GitHub.
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue';
import api from '../api/client';
import { useDialogStore } from '../stores/dialog';
import { Globe, RefreshCw, AlertTriangle, ShieldAlert, House, Waypoints, Earth, CheckCircle2 } from '@lucide/vue';
import TailscaleGuide from './TailscaleGuide.vue';

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

const whereLabel = computed(() => ({
  home: 'your home network',
  tailscale: report.value?.settings.tailscaleIsHome ? 'Tailscale (counts as home)' : 'Tailscale (counts as outside)',
  outside: 'outside the home network'
}[report.value?.thisDevice.where] || 'somewhere unknown'));
const whereIcon = computed(() => ({ home: House, tailscale: Waypoints, outside: Earth }[report.value?.thisDevice.where] || Globe));
const whereTone = computed(() => (report.value?.thisDevice.away ? 'border-sky-500/40 bg-sky-500/5 text-sky-500' : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    report.value = (await api.get('/admin/network')).data;
  } catch (err) {
    error.value = err.response?.data?.error || 'Could not load network settings';
  } finally {
    loading.value = false;
  }
}

async function save(patch) {
  if (patch.remoteAccess === true) {
    const ok = await dialog.confirm({
      title: 'Allow access from outside?',
      message: "Anyone with an account (that's allowed away from home) will be able to sign in from the internet, once the server has a web address. Use strong passwords, and consider requiring two-factor away from home.",
      confirmText: 'Allow'
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
    error.value = err.response?.data?.error || 'Could not save that';
    rev.value++;
  } finally {
    saving.value = false;
  }
}

function formatTime(value) {
  const d = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
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
