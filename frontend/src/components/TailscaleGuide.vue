<template>
  <!-- Step-by-step Tailscale setup, with the exact lines to paste. Used in the setup wizard
       and in Admin → Network. `funnel` adds the steps for a public link (Tailscale Funnel).
       Plinthio never sees a Tailscale key: the .env lines hold a placeholder to fill in. -->
  <div class="flex flex-col gap-4 text-sm">
    <!-- What you get -->
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        @click="setFunnel(false)"
        class="h-9 px-3 rounded-lg border text-xs font-medium transition"
        :class="!funnel ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40'"
      >
        {{ $t('network.guide.private') }}
      </button>
      <button
        type="button"
        @click="setFunnel(true)"
        class="h-9 px-3 rounded-lg border text-xs font-medium transition"
        :class="funnel ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40'"
      >
        {{ $t('network.guide.funnel') }}
      </button>
    </div>
    <p class="text-xs text-muted-foreground leading-relaxed">
      <I18nT v-if="!funnel" keypath="network.guide.privateText">
        <template #address><code class="text-foreground bg-muted px-1 rounded break-all">https://{{ name }}.your-tailnet.ts.net</code></template>
      </I18nT>
      <template v-else>{{ $t('network.guide.funnelText') }}</template>
    </p>

    <ol class="flex flex-col gap-3">
      <li class="flex gap-3">
        <StepNumber n="1" :done="done.account" @toggle="done.account = !done.account" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ $t('network.guide.account.title') }}</p>
          <a href="https://login.tailscale.com/start" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            login.tailscale.com/start <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="2" :done="done.dns" @toggle="done.dns = !done.dns" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ $t('network.guide.dns.title') }}</p>
          <p class="text-xs text-muted-foreground">{{ $t('network.guide.dns.text') }}</p>
          <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            {{ $t('network.guide.dns.link') }} <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="3" :done="done.key" @toggle="done.key = !done.key" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ $t('network.guide.key.title') }}</p>
          <p class="text-xs text-muted-foreground">{{ $t('network.guide.key.text') }}</p>
          <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            {{ $t('network.guide.key.link') }} <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="4" :done="done.server" @toggle="done.server = !done.server" />
        <div class="min-w-0 flex-1 flex flex-col gap-2">
          <p class="font-medium text-foreground">{{ $t('network.guide.server.title') }}</p>
          <label class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {{ $t('network.guide.server.name') }}
            <input v-model="nameInput" type="text" maxlength="40" class="h-8 w-40 px-2 rounded-md bg-background border border-border font-mono text-xs text-foreground" />
          </label>

          <I18nT keypath="network.guide.server.download" tag="p" class="text-xs text-muted-foreground">
            <template #file><code class="font-mono text-foreground">docker-compose.yml</code></template>
          </I18nT>
          <CopyBlock :text="downloadCmd" />
          <I18nT keypath="network.guide.server.env" tag="p" class="text-xs text-muted-foreground">
            <template #env><code class="font-mono text-foreground">.env</code></template>
            <template #key><code class="font-mono text-foreground">tskey-auth-…</code></template>
          </I18nT>
          <CopyBlock :text="envLines" />
          <I18nT keypath="network.guide.server.start" tag="p" class="text-xs text-muted-foreground">
            <template #flag><code class="font-mono text-foreground">--force-recreate</code></template>
          </I18nT>
          <CopyBlock text="docker compose up -d --force-recreate" />
          <details class="text-xs text-muted-foreground">
            <summary class="cursor-pointer hover:text-foreground">{{ $t('network.guide.server.noDocker') }}</summary>
            <div class="mt-2 flex flex-col gap-2">
              <p>{{ $t('network.guide.server.runThis') }}</p>
              <CopyBlock :text="funnel ? 'sudo tailscale funnel --bg 8088' : 'sudo tailscale serve --bg 8088'" />
              <I18nT keypath="network.guide.server.trustProxy" tag="p">
                <template #setting><code class="font-mono text-foreground">TRUST_PROXY=loopback</code></template>
              </I18nT>
            </div>
          </details>
        </div>
      </li>

      <li v-if="funnel" class="flex gap-3">
        <StepNumber n="5" :done="done.funnel" @toggle="done.funnel = !done.funnel" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ $t('network.guide.funnelStep.title') }}</p>
          <I18nT
            keypath="network.guide.funnelStep.text"
            tag="p"
            class="text-xs text-muted-foreground"
            :params="{ where: context === 'setup' ? $t('network.guide.funnelStep.whereSetup') : $t('network.guide.funnelStep.whereAdmin') }"
          >
            <template #outsideAccess><strong class="text-foreground">{{ $t('network.guide.funnelStep.outsideAccess') }}</strong></template>
            <template #command><code class="font-mono text-foreground">docker logs plinthio-tailscale</code></template>
          </I18nT>
          <a href="https://login.tailscale.com/admin/acls" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            {{ $t('network.guide.funnelStep.link') }} <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber :n="funnel ? '6' : '5'" :done="done.devices" @toggle="done.devices = !done.devices" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ funnel ? $t('network.guide.devices.funnelTitle') : $t('network.guide.devices.title') }}</p>
          <p class="text-xs text-muted-foreground">
            <I18nT v-if="!funnel" keypath="network.guide.devices.text">
              <template #address><code class="font-mono text-foreground break-all">https://{{ name }}.your-tailnet.ts.net</code></template>
            </I18nT>
            <template v-else>{{ $t('network.guide.devices.funnelText') }}</template>
          </p>
        </div>
      </li>
    </ol>

    <I18nT keypath="network.guide.moreDetail" tag="p" class="text-xs text-muted-foreground">
      <template #file><code class="font-mono">docs/remote-access.md</code></template>
    </I18nT>
  </div>
</template>

<script setup>
import { ref, reactive, computed, h } from 'vue';
import { Check, Copy, ExternalLink } from '@lucide/vue';
import { t } from '../i18n';

const props = defineProps({
  // 'setup' (the wizard, before the server exists) or 'admin' (Admin → Network)
  context: { type: String, default: 'admin' },
  funnel: { type: Boolean, default: false }
});
const emit = defineEmits(['update:funnel']);

function setFunnel(value) {
  emit('update:funnel', value);
}

// Ticked steps are just for the person following along; nothing is saved.
const done = reactive({ account: false, dns: false, key: false, server: false, funnel: false, devices: false });

const nameInput = ref('plinthio');
// Tailscale machine names: lower-case letters, digits and dashes.
const name = computed(() => nameInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'plinthio');

const downloadCmd = 'curl -fsSLO https://raw.githubusercontent.com/OddOmens/Plinthio/main/docker/docker-compose.tailscale.yml';
const envLines = computed(() => [
  'TS_AUTHKEY=tskey-auth-…',
  ...(name.value !== 'plinthio' ? [`TS_HOSTNAME=${name.value}`] : []),
  ...(props.funnel ? ['TS_FUNNEL=true'] : []),
  'COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml'
].join('\n'));

// A step's number, which doubles as a "done" tick.
const StepNumber = (p, { emit: e }) => h('button', {
  type: 'button',
  onClick: () => e('toggle'),
  title: p.done ? t('common.done') : t('network.guide.markDone'),
  class: ['w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition',
    p.done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70']
}, p.done ? [h(Check, { class: 'w-4 h-4' })] : p.n);
StepNumber.props = ['n', 'done'];
StepNumber.emits = ['toggle'];

// Text to paste, with a copy button.
const CopyBlock = {
  props: { text: String },
  setup(p) {
    const copied = ref(false);
    async function copy() {
      try {
        await navigator.clipboard.writeText(p.text);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1800);
      } catch {
        // Clipboard blocked (plain http): the text is selectable anyway.
      }
    }
    return () => h('div', { class: 'relative group' }, [
      h('pre', { class: 'text-xs font-mono bg-muted/60 border border-border rounded-lg p-2.5 pr-20 overflow-x-auto whitespace-pre text-foreground select-all' }, p.text),
      h('button', {
        type: 'button',
        onClick: copy,
        class: 'absolute top-1.5 right-1.5 h-7 px-2 rounded-md bg-background border border-border text-[11px] font-medium flex items-center gap-1 hover:bg-muted'
      }, [h(copied.value ? Check : Copy, { class: 'w-3 h-3' }), copied.value ? t('common.copied') : t('common.copy')])
    ]);
  }
};
</script>
