<template>
  <SectionHeader :title="$t('settings.hidden.title')" :description="$t('settings.hidden.description')">
    <SaveStatus :status="save.status.value" :message="save.message.value" />
  </SectionHeader>

  <!-- Whole libraries, and kids content. Switched on = showing. The server leaves these
       out of everything for this account (services/visibility.js), so nothing here needs
       a reload. -->
  <SettingsCard :title="$t('settings.hidden.libraries.title')" :description="$t('settings.hidden.libraries.desc')">
    <div class="divide-y divide-border" data-testid="hidden-libraries">
      <ToggleRow
        v-if="!isKidsAccount"
        :model-value="!hideKids"
        @update:model-value="setHideKids(!$event)"
        :label="$t('settings.hidden.kids.label')"
        :description="$t('settings.hidden.kids.desc')"
      />
      <ToggleRow
        v-for="lib in libraries"
        :key="lib.id"
        :model-value="!hiddenLibraries.includes(lib.id)"
        @update:model-value="setLibraryShown(lib.id, $event)"
        :label="lib.name"
        :description="libraryKind(lib)"
      />
      <p v-if="librariesLoaded && libraries.length === 0" class="py-3 text-xs text-muted-foreground">{{ $t('settings.hidden.libraries.none') }}</p>
    </div>
  </SettingsCard>

  <SettingsCard flush :title="$t('settings.hidden.titles.title')" :description="$t('settings.hidden.titles.desc')">
    <p v-if="loading" class="py-10 text-center text-xs text-muted-foreground">{{ $t('common.loading') }}</p>
    <div v-else-if="hiddenItems.length === 0" class="py-12 px-6 text-center flex flex-col items-center gap-2">
      <EyeOff class="w-6 h-6 text-muted-foreground/60" />
      <p class="text-xs text-muted-foreground">{{ $t('settings.hidden.empty') }}</p>
    </div>
    <ul v-else class="divide-y divide-border">
      <li v-for="item in hiddenItems" :key="item.id" class="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-foreground truncate">{{ item.title }}</p>
          <p class="text-[12px] text-muted-foreground truncate">{{ item.author || $t('common.unknown') }}</p>
        </div>
        <button @click="unhideItem(item)" class="btn btn-secondary flex-shrink-0">
          <Eye class="w-3.5 h-3.5" /> {{ $t('settings.hidden.unhide') }}
        </button>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Eye, EyeOff } from '@lucide/vue';
import api from '../../../api/client';
import { useAuthStore } from '../../../stores/auth';
import { useDialogStore } from '../../../stores/dialog';
import { useSaveStatus } from '../../../composables/useSaveStatus';
import { t } from '../../../i18n';
import SectionHeader from '../SectionHeader.vue';
import SettingsCard from '../SettingsCard.vue';
import ToggleRow from '../ToggleRow.vue';
import SaveStatus from '../SaveStatus.vue';

const authStore = useAuthStore();
const dialog = useDialogStore();
const save = useSaveStatus();
const hiddenItems = ref([]);
const loading = ref(true);
const libraries = ref([]);
const librariesLoaded = ref(false);

// A Kids Mode account only sees kids content, so the server ignores "hide kids content" there.
const isKidsAccount = computed(() => authStore.user?.kids_mode === 1 || authStore.user?.kids_mode === true);
const hiddenLibraries = computed(() => authStore.user?.preferences?.hiddenLibraries || []);
const hideKids = computed(() => authStore.user?.preferences?.hideKids === true);

// Library types are plural ("movies"); the media type labels are keyed singular.
const MEDIA_TYPE_OF = { movies: 'movie', shows: 'show', anime: 'anime', books: 'book', manga: 'manga', audiobooks: 'audiobook' };
function libraryKind(lib) {
  const type = MEDIA_TYPE_OF[lib.type];
  return type ? t(`settings.mediaTypes.${type}.label`) : '';
}

onMounted(async () => {
  api.get('/libraries')
    .then((res) => { libraries.value = res.data.libraries || []; })
    .catch((err) => console.warn('Could not load libraries:', err))
    .finally(() => { librariesLoaded.value = true; });
  try {
    const res = await api.get('/items/hidden');
    hiddenItems.value = res.data.hiddenItems || [];
  } catch (err) {
    console.warn('Could not load hidden titles:', err);
  } finally {
    loading.value = false;
  }
});

// Shown at once, put back if the save fails.
async function setPreference(field, value) {
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

function setLibraryShown(id, shown) {
  const rest = hiddenLibraries.value.filter((libId) => libId !== id);
  setPreference('hiddenLibraries', shown ? rest : [...rest, id]);
}

function setHideKids(value) {
  setPreference('hideKids', value);
}

async function unhideItem(item) {
  try {
    await api.post(`/items/${item.id}/unhide`);
    hiddenItems.value = hiddenItems.value.filter((i) => i.id !== item.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || t('settings.hidden.unhideFailed'));
  }
}
</script>
