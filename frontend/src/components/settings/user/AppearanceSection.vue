<template>
  <SectionHeader :title="$t('appearance.section.title')" :description="$t('appearance.section.description')">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <div v-if="!personalizationOn" class="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
    <Lock class="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
    <p class="text-xs text-muted-foreground leading-relaxed">
      {{ $t('appearance.section.locked') }}
    </p>
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
    <div class="order-2 xl:order-1 flex flex-col gap-5 min-w-0">
      <!-- Language is always the person's own: the admin can't lock what someone can read. -->
      <SettingsCard :title="$t('common.language')" :description="$t('appearance.language.desc')">
        <OptionTiles
          :label="$t('common.language')"
          :options="languageOptions"
          :model-value="languageChoice"
          @update:model-value="setPersonalLanguage"
          grid-class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4 gap-2.5"
        />
      </SettingsCard>
      <SettingsCard
        v-for="card in appearanceCards"
        :key="card.field"
        :title="card.title"
        :description="card.desc"
        @focusin="previewView = card.preview"
        @click="previewView = card.preview"
      >
        <template v-if="!card.allowed" #actions>
          <span class="text-[11px] text-muted-foreground font-medium flex items-center gap-1 px-2 h-6 rounded-md bg-muted">
            <Lock class="w-3 h-3" /> {{ $t('common.setByAdmin') }}
          </span>
        </template>
        <OptionTiles
          :label="card.title"
          :options="card.options"
          :model-value="card.allowed ? card.value : card.serverValue"
          @update:model-value="setPersonal(card.field, $event)"
          @hover="hoverAppearance(card, $event)"
          :disabled="!card.allowed"
          :swatches="card.swatches"
          :grid-class="card.grid"
        />
      </SettingsCard>
    </div>
    <div class="order-1 xl:order-2 xl:sticky xl:top-[84px] min-w-0">
      <CustomizationPreview v-model:view="previewView" :settings="previewSettings" :only="['shelf', 'pause']" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Lock } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useCustomizationStore } from '../../../stores/customization';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { ACCENT_OPTIONS, LAYOUT_OPTIONS, PAGE_WIDTH_OPTIONS, PAUSE_SCREEN_OPTIONS } from '../../../constants/appearance';
import OptionTiles from '../../OptionTiles.vue';
import CustomizationPreview from '../../CustomizationPreview.vue';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import SaveStatus from '../SaveStatus.vue';
import { t, LANGUAGES, setLanguage, languageChoice as currentLanguageChoice } from '../../../i18n';

const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const save = useSaveStatus();

// Each setting is the person's own when the admin allows it, otherwise the server's (shown,
// locked).
const personalizationOn = computed(() => customizationStore.userCustomization?.enabled !== false);
const previewView = ref('shelf');
const hoverPreview = ref({});

const appearanceCards = computed(() => {
  const prefsNow = authStore.user?.preferences || {};
  const cards = [
    {
      field: 'accentTheme', key: 'accentColor', title: t('appearance.cards.accent.title'), preview: 'shelf',
      desc: t('appearance.cards.accent.desc'),
      serverValue: customizationStore.accentTheme || 'zinc',
      options: ACCENT_OPTIONS,
      swatches: true, grid: 'grid grid-cols-4 sm:grid-cols-8 xl:grid-cols-4 2xl:grid-cols-8 gap-2.5'
    },
    {
      field: 'layoutMode', key: 'layoutMode', title: t('appearance.cards.layout.title'), preview: 'shelf',
      desc: t('appearance.cards.layout.desc'),
      serverValue: customizationStore.layoutMode || 'topnav',
      options: LAYOUT_OPTIONS
    },
    {
      field: 'pageWidth', key: 'pageWidth', title: t('appearance.cards.pageWidth.title'), preview: 'shelf',
      desc: t('appearance.cards.pageWidth.desc'),
      serverValue: customizationStore.pageWidth || 'full',
      options: PAGE_WIDTH_OPTIONS
    },
    {
      field: 'pauseScreen', key: 'pauseScreen', title: t('appearance.cards.pauseScreen.title'), preview: 'pause',
      desc: t('appearance.cards.pauseScreen.desc'),
      serverValue: customizationStore.pauseScreen || 'details',
      options: PAUSE_SCREEN_OPTIONS
    }
  ];
  return cards.map((card) => ({
    ...card,
    allowed: customizationStore.isCustomizationAllowed(card.key),
    value: prefsNow[card.field] || card.serverValue
  }));
});

// 'auto' follows the browser; the names are each language's own, so anyone can find theirs.
const languageOptions = computed(() => [
  { id: 'auto', label: t('appearance.language.auto') },
  ...LANGUAGES.map((lang) => ({ id: lang.code, label: lang.name }))
]);
const languageChoice = computed(() => currentLanguageChoice(authStore.user, customizationStore.defaultLanguage));

async function setPersonalLanguage(value) {
  await setLanguage(value);
  await setPersonal('language', value);
}

// What the preview shows: the effective look, or the option under the pointer.
const previewSettings = computed(() => {
  const user = authStore.user;
  const pick = (field, effective) => hoverPreview.value[field] ?? effective;
  return {
    serverName: customizationStore.serverName,
    loginMessage: customizationStore.loginMessage,
    ratings: customizationStore.ratings,
    showMissingFilms: customizationStore.showMissingFilms,
    partyModeEnabled: customizationStore.partyModeEnabled,
    accentTheme: pick('accentTheme', customizationStore.effectiveAccentTheme(user)),
    layoutMode: pick('layoutMode', customizationStore.effectiveLayoutMode(user)),
    pageWidth: pick('pageWidth', customizationStore.effectivePageWidth(user)),
    pauseScreen: pick('pauseScreen', customizationStore.effectivePauseScreen(user))
  };
});

function hoverAppearance(card, id) {
  if (!card.allowed) return;
  hoverPreview.value = { ...hoverPreview.value, [card.field]: id };
  if (id !== undefined) previewView.value = card.preview;
}

async function setPersonal(field, value) {
  if (!authStore.user) return;
  const previous = authStore.user.preferences || {};
  authStore.user.preferences = { ...previous, [field]: value };
  const { ok, data } = await save.run(() => api.patch('/users/preferences', { [field]: value }));
  if (!ok) {
    authStore.user.preferences = previous;
    return;
  }
  authStore.user.preferences = data.data.preferences || authStore.user.preferences;
  localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
}
</script>
