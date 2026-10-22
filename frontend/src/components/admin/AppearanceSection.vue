<template>
  <SectionHeader :title="$t('admin.appearance.title')" :description="$t('admin.appearance.description')">
    <SaveStatus :status="setting.status.value" :message="setting.message.value" />
  </SectionHeader>

  <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
    <div class="order-2 xl:order-1 flex flex-col gap-5 min-w-0">
      <SettingsCard>
        <ToggleRow
          :label="$t('admin.appearance.personalize.label')"
          :description="$t('admin.appearance.personalize.desc')"
          :model-value="personalizationOn"
          @update:model-value="setUserCustomization('enabled', $event)"
        />
      </SettingsCard>

      <SettingsCard
        v-for="card in personalCards"
        :key="card.key"
        :title="card.title"
        :description="card.desc"
        @focusin="previewView = card.preview"
        @click="previewView = card.preview"
      >
        <template v-if="personalizationOn" #actions>
          <ToggleRow
            :label="$t('admin.appearance.usersCanChange')"
            :model-value="store.userCustomization?.[card.key] !== false"
            @update:model-value="setUserCustomization(card.key, $event)"
          />
        </template>
        <OptionTiles
          :label="card.title"
          :options="card.options"
          :model-value="store[card.field]"
          @update:model-value="setting.set({ [card.field]: $event })"
          @hover="hoverDefault(card, $event)"
          :swatches="card.swatches"
          :grid-class="card.grid"
        />
      </SettingsCard>

      <SettingsCard :title="$t('admin.appearance.branding.title')" :description="$t('admin.appearance.branding.desc')" @focusin="previewView = 'login'" @click="previewView = 'login'">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="server-name" class="field-label">{{ $t('admin.appearance.branding.serverName') }}</label>
            <input id="server-name" v-model="branding.serverName" @input="scheduleBrandingSave" @blur="saveBranding" type="text" class="field" placeholder="Plinthio" />
          </div>
          <div>
            <label for="login-message" class="field-label">{{ $t('admin.appearance.branding.notice') }}</label>
            <div class="relative">
              <input id="login-message" v-model="branding.loginMessage" @input="scheduleBrandingSave" @blur="saveBranding" type="text" class="field pr-9" :placeholder="$t('common.none')" />
              <button
                v-if="branding.loginMessage"
                type="button"
                @click="branding.loginMessage = ''; saveBranding()"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition"
                :aria-label="$t('admin.appearance.branding.removeNotice')"
              ><X class="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard :title="$t('admin.appearance.css.title')" :description="$t('admin.appearance.css.desc')">
        <template #actions>
          <router-link to="/docs" class="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
            {{ $t('admin.appearance.css.cheatsheet') }} <ExternalLink class="w-3.5 h-3.5" />
          </router-link>
        </template>
        <label for="custom-css" class="sr-only">{{ $t('admin.appearance.css.title') }}</label>
        <textarea
          id="custom-css"
          v-model="customCss"
          rows="8"
          spellcheck="false"
          class="field font-mono"
          :placeholder="`${$t('admin.appearance.css.example')}\n.group img { border-radius: 1rem !important; }`"
        ></textarea>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <button type="button" :disabled="savingCss || customCss === store.customCss" @click="saveCss" class="btn btn-primary">
            {{ savingCss ? $t('common.saving') : $t('admin.appearance.css.save') }}
          </button>
          <button type="button" @click="tryCss" class="btn btn-secondary">{{ $t('admin.appearance.css.tryIt') }}</button>
          <span v-if="customCss !== store.customCss" class="text-[12px] text-muted-foreground">{{ $t('admin.appearance.css.notSaved') }}</span>
        </div>
      </SettingsCard>
    </div>

    <div class="order-1 xl:order-2 xl:sticky xl:top-[84px] min-w-0">
      <CustomizationPreview v-model:view="previewView" :settings="previewSettings" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { X, ExternalLink } from '@lucide/vue';
import { useCustomizationStore } from '../../stores/customization';
import { useDialogStore } from '../../stores/dialog';
import { useServerSetting } from '../../composables/useServerSetting';
import { ACCENT_OPTIONS, LAYOUT_OPTIONS, PAGE_WIDTH_OPTIONS, PAUSE_SCREEN_OPTIONS } from '../../constants/appearance';
import OptionTiles from '../OptionTiles.vue';
import CustomizationPreview from '../CustomizationPreview.vue';
import SectionHeader from '../settings/SectionHeader.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import ToggleRow from '../settings/ToggleRow.vue';
import SaveStatus from '../settings/SaveStatus.vue';
import { t } from '../../i18n';

const store = useCustomizationStore();
const dialog = useDialogStore();
const setting = useServerSetting();

// The server's default for each thing people can also choose for themselves, and whether
// they may (userCustomization[key]).
const personalizationOn = computed(() => store.userCustomization?.enabled !== false);
const personalCards = computed(() => [
  {
    key: 'accentColor', field: 'accentTheme', title: t('appearance.cards.accent.title'), preview: 'shelf',
    desc: t('admin.appearance.cards.accent'),
    options: ACCENT_OPTIONS, swatches: true, grid: 'grid grid-cols-4 sm:grid-cols-8 xl:grid-cols-4 2xl:grid-cols-8 gap-2.5'
  },
  { key: 'layoutMode', field: 'layoutMode', title: t('appearance.cards.layout.title'), preview: 'shelf', desc: t('appearance.cards.layout.desc'), options: LAYOUT_OPTIONS },
  { key: 'pageWidth', field: 'pageWidth', title: t('appearance.cards.pageWidth.title'), preview: 'shelf', desc: t('admin.appearance.cards.pageWidth'), options: PAGE_WIDTH_OPTIONS },
  {
    key: 'pauseScreen', field: 'pauseScreen', title: t('appearance.cards.pauseScreen.title'), preview: 'pause',
    desc: t('admin.appearance.cards.pauseScreen'),
    options: PAUSE_SCREEN_OPTIONS
  }
]);

function setUserCustomization(key, value) {
  setting.set({ userCustomization: { [key]: value } });
}

// ─── Preview ──────────────────────────────────────────────────────────────
const previewView = ref('shelf');
const hoverDefaults = ref({});
const previewSettings = computed(() => ({
  serverName: branding.value.serverName,
  loginMessage: branding.value.loginMessage,
  accentTheme: store.accentTheme,
  layoutMode: store.layoutMode,
  pageWidth: store.pageWidth,
  pauseScreen: store.pauseScreen,
  ratings: store.ratings,
  showMissingFilms: store.showMissingFilms,
  partyModeEnabled: store.partyModeEnabled,
  ...hoverDefaults.value
}));
function hoverDefault(card, id) {
  const next = { ...hoverDefaults.value };
  if (id === undefined) delete next[card.field];
  else {
    next[card.field] = id;
    previewView.value = card.preview;
  }
  hoverDefaults.value = next;
}

// ─── Name and notice: save a moment after typing stops, or on leaving the field ──
const branding = ref({ serverName: store.serverName, loginMessage: store.loginMessage });
let brandingSaved = { ...branding.value };
let brandingTimer = null;
function scheduleBrandingSave() {
  clearTimeout(brandingTimer);
  brandingTimer = setTimeout(saveBranding, 800);
}
async function saveBranding() {
  clearTimeout(brandingTimer);
  const serverName = (branding.value.serverName || '').trim();
  const loginMessage = (branding.value.loginMessage || '').trim();
  if (serverName === brandingSaved.serverName && loginMessage === brandingSaved.loginMessage) return;
  const { ok } = await setting.set({ serverName, loginMessage });
  if (ok) brandingSaved = { serverName, loginMessage };
}

// ─── Custom CSS: half-typed CSS shouldn't go live for everyone, so it has a Save button ──
const customCss = ref(store.customCss || '');
const savingCss = ref(false);
function tryCss() {
  let tag = document.getElementById('plinthio-custom-css');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'plinthio-custom-css';
    document.head.appendChild(tag);
  }
  tag.textContent = customCss.value || '';
}
async function saveCss() {
  savingCss.value = true;
  try {
    await store.updateCustomization({ customCss: customCss.value });
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('admin.appearance.css.couldNotSave'));
  } finally {
    savingCss.value = false;
  }
}

onMounted(async () => {
  await store.fetchCustomization();
  branding.value = { serverName: store.serverName, loginMessage: store.loginMessage };
  brandingSaved = { ...branding.value };
  customCss.value = store.customCss || '';
});
</script>
