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
        Private: my devices and people I add
      </button>
      <button
        type="button"
        @click="setFunnel(true)"
        class="h-9 px-3 rounded-lg border text-xs font-medium transition"
        :class="funnel ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40'"
      >
        Also a link for friends without Tailscale (Funnel)
      </button>
    </div>
    <p class="text-xs text-muted-foreground leading-relaxed">
      <template v-if="!funnel">
        Plinthio gets <code class="text-foreground bg-muted px-1 rounded break-all">https://{{ name }}.your-tailnet.ts.net</code>,
        trusted on every device signed in to your Tailscale. Nothing is opened to the internet.
      </template>
      <template v-else>
        The same address also opens in anyone's browser, with no Tailscale, domain or router changes. Tailscale limits
        Funnel's bandwidth: reading and listening are fine, video may buffer.
      </template>
    </p>

    <ol class="flex flex-col gap-3">
      <li class="flex gap-3">
        <StepNumber n="1" :done="done.account" @toggle="done.account = !done.account" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">Make a free Tailscale account</p>
          <a href="https://login.tailscale.com/start" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            login.tailscale.com/start <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="2" :done="done.dns" @toggle="done.dns = !done.dns" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">Turn on MagicDNS and HTTPS Certificates</p>
          <p class="text-xs text-muted-foreground">On the DNS page of the admin console. Both are switches.</p>
          <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Open the DNS page <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="3" :done="done.key" @toggle="done.key = !done.key" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">Make an auth key</p>
          <p class="text-xs text-muted-foreground">Settings → Keys → Generate auth key. Keep the page open; you'll paste it in the next step. (Optional: without one, the server prints a sign-in link instead.)</p>
          <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Open Keys <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber n="4" :done="done.server" @toggle="done.server = !done.server" />
        <div class="min-w-0 flex-1 flex flex-col gap-2">
          <p class="font-medium text-foreground">Add Tailscale to Plinthio</p>
          <label class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Name on your tailnet
            <input v-model="nameInput" type="text" maxlength="40" class="h-8 w-40 px-2 rounded-md bg-background border border-border font-mono text-xs text-foreground" />
          </label>

          <p class="text-xs text-muted-foreground">
            On the server, in the folder with <code class="font-mono text-foreground">docker-compose.yml</code>, download the add-on:
          </p>
          <CopyBlock :text="downloadCmd" />
          <p class="text-xs text-muted-foreground">
            Add these lines to the <code class="font-mono text-foreground">.env</code> file in that folder (make one if there isn't),
            with your key in place of <code class="font-mono text-foreground">tskey-auth-…</code>:
          </p>
          <CopyBlock :text="envLines" />
          <p class="text-xs text-muted-foreground">Then start it. <code class="font-mono text-foreground">--force-recreate</code> makes a changed setting take effect; Plinthio restarts for a few seconds:</p>
          <CopyBlock text="docker compose up -d --force-recreate" />
          <details class="text-xs text-muted-foreground">
            <summary class="cursor-pointer hover:text-foreground">Not using Docker, or Tailscale is already on the server?</summary>
            <div class="mt-2 flex flex-col gap-2">
              <p>Run this on the server (8088 being Plinthio's port):</p>
              <CopyBlock :text="funnel ? 'sudo tailscale funnel --bg 8088' : 'sudo tailscale serve --bg 8088'" />
              <p>Without Docker, also set <code class="font-mono text-foreground">TRUST_PROXY=loopback</code> for Plinthio. With Docker and Tailscale on the host, use the add-on instead so Plinthio can tell devices apart.</p>
            </div>
          </details>
        </div>
      </li>

      <li v-if="funnel" class="flex gap-3">
        <StepNumber n="5" :done="done.funnel" @toggle="done.funnel = !done.funnel" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">Let the internet in</p>
          <p class="text-xs text-muted-foreground">
            Funnel visitors come from the internet, so Plinthio needs <strong class="text-foreground">outside access</strong> on
            ({{ context === 'setup' ? 'this setup step does that for you' : 'Admin → Network, above' }}). Consider requiring two-factor away from home too.
            The first time, Tailscale may ask you to allow Funnel for your tailnet: if
            <code class="font-mono text-foreground">docker logs plinthio-tailscale</code> says so, follow its link or allow it under Access controls.
          </p>
          <a href="https://login.tailscale.com/admin/acls" target="_blank" rel="noopener" class="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Open Access controls <ExternalLink class="w-3 h-3" />
          </a>
        </div>
      </li>

      <li class="flex gap-3">
        <StepNumber :n="funnel ? '6' : '5'" :done="done.devices" @toggle="done.devices = !done.devices" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-foreground">{{ funnel ? 'Try it, and send friends the link' : 'Install Tailscale on your phones and computers' }}</p>
          <p class="text-xs text-muted-foreground">
            <template v-if="!funnel">
              Sign in with the same account, then open <code class="font-mono text-foreground break-all">https://{{ name }}.your-tailnet.ts.net</code>
              (the admin console lists the exact address under Machines) and add it to your home screen from there.
            </template>
            <template v-else>
              On a phone with Wi-Fi off and Tailscale not running, open the address. You should get the sign-in page. Then make
              your friends accounts (Admin → Users) and send them the link.
            </template>
          </p>
        </div>
      </li>
    </ol>

    <p class="text-xs text-muted-foreground">
      Everything in more detail, with troubleshooting: <code class="font-mono">docs/remote-access.md</code> on GitHub.
    </p>
  </div>
</template>

<script setup>
import { ref, reactive, computed, h } from 'vue';
import { Check, Copy, ExternalLink } from '@lucide/vue';

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
  title: p.done ? 'Done' : 'Mark as done',
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
      }, [h(copied.value ? Check : Copy, { class: 'w-3 h-3' }), copied.value ? 'Copied' : 'Copy'])
    ]);
  }
};
</script>
