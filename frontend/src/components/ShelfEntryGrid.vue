<template>
  <!-- One group's cards in the grouped shelf views (Creator, Disk Folders, Custom Folders):
       a series card per series, a title card per standalone title — never loose volumes. -->
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 auto-rows-fr gap-3 sm:gap-4">
    <template v-for="entry in entries" :key="entry.key">
      <SeriesCard
        v-if="entry.kind === 'series'"
        class="h-full"
        :series="entry"
        :removable="inCustomFolder"
        @select="$emit('open-series', entry)"
        @remove="$emit('remove-from-folder', entry.volumes)"
      />
      <BookCard
        v-else
        class="h-full"
        :item="entry.item"
        :inCustomFolder="inCustomFolder"
        @select="$emit('select', entry.item)"
        @refresh="$emit('refresh')"
        @add-to-folder="$emit('add-to-folder', $event)"
        @remove-from-folder="$emit('remove-from-folder', [entry.item])"
        @open-bookmarks="$emit('open-bookmarks', $event)"
        @edit-metadata="$emit('edit-metadata', $event)"
      />
    </template>
  </div>
</template>

<script setup>
import SeriesCard from './SeriesCard.vue';
import BookCard from './BookCard.vue';

defineProps({
  entries: { type: Array, required: true },
  inCustomFolder: { type: Boolean, default: false }
});

// remove-from-folder always carries an array of items: a whole series' titles, or one title.
defineEmits(['open-series', 'select', 'refresh', 'add-to-folder', 'remove-from-folder', 'open-bookmarks', 'edit-metadata']);
</script>
