<template>
  <!-- The compact language switch for screens before sign-in (sign-in page, setup wizard).
       The choice is remembered on this device; once signed in it lives on the account. -->
  <label class="relative inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
    <Languages class="w-3.5 h-3.5" aria-hidden="true" />
    <span class="sr-only">{{ $t('common.language') }}</span>
    <select
      :value="choice"
      @change="choose($event.target.value)"
      class="appearance-none bg-transparent pr-1 cursor-pointer focus:outline-none focus-visible:underline"
    >
      <option value="auto">{{ $t('appearance.language.auto') }}</option>
      <option v-for="lang in LANGUAGES" :key="lang.code" :value="lang.code" :lang="lang.code">{{ lang.name }}</option>
    </select>
  </label>
</template>

<script setup>
import { ref } from 'vue';
import { Languages } from '@lucide/vue';
import { LANGUAGES, setLanguage, storedLanguageChoice } from '../i18n';

const choice = ref(storedLanguageChoice());

function choose(value) {
  choice.value = value;
  setLanguage(value);
}
</script>
