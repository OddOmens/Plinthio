<template>
  <!-- The frame shared by Settings and Admin: grouped sections in a sidebar beside the open
       one on wider screens; on a phone, the section list first and each section full-screen
       with a back button, like a phone's own settings. The open section is ?tab=<id>. -->
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0 pb-24">
      <header class="bg-background/95 backdrop-blur-xl border-b border-border sticky top-0 z-30 safe-top transition-colors">
        <div class="page-width mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center gap-2.5">
          <button
            v-if="activeId"
            type="button"
            @click="closeSection"
            class="md:hidden w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
            :aria-label="`Back to ${title}`"
          >
            <ArrowLeft class="w-4 h-4" />
          </button>
          <router-link
            to="/"
            :class="[activeId ? 'hidden md:flex' : 'flex', 'w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 items-center justify-center transition active:scale-95 flex-shrink-0']"
            aria-label="Back to shelves"
            title="Back to shelves"
          >
            <ArrowLeft class="w-4 h-4" />
          </router-link>
          <h1 class="text-sm font-semibold text-foreground tracking-tight truncate min-w-0">
            <span :class="activeId ? 'hidden md:inline' : ''">{{ title }}</span>
            <span v-if="activeId" class="md:hidden">{{ current?.label }}</span>
          </h1>
          <div class="ml-auto flex items-center gap-2 flex-shrink-0">
            <slot name="header" />
          </div>
        </div>
      </header>

      <div class="page-width mx-auto w-full px-4 sm:px-6 lg:px-8 pt-5 md:pt-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] md:gap-8 lg:gap-12">
        <!-- Section list: the whole screen on a phone until one is opened; a sticky sidebar
             from md up. -->
        <nav :class="[activeId ? 'hidden md:block' : 'block', 'min-w-0']" :aria-label="`${title} sections`">
          <div class="md:sticky md:top-[84px] flex flex-col gap-5 md:gap-6">
            <div v-for="group in groups" :key="group.label" class="flex flex-col gap-1.5">
              <p class="px-1 md:px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{{ group.label }}</p>
              <div class="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden md:bg-transparent md:border-0 md:rounded-none md:divide-y-0 md:overflow-visible md:flex md:flex-col md:gap-0.5">
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  @click="openSection(item.id)"
                  :aria-current="shownId === item.id ? 'page' : undefined"
                  :class="[
                    'w-full flex items-center gap-3 text-left transition px-3.5 py-3 md:px-2.5 md:py-0 md:h-9 md:rounded-lg',
                    shownId === item.id
                      ? 'md:bg-muted md:text-foreground md:font-semibold'
                      : 'hover:bg-muted/50 md:text-muted-foreground md:hover:text-foreground'
                  ]"
                >
                  <span class="w-8 h-8 md:w-auto md:h-auto rounded-lg bg-muted md:bg-transparent flex items-center justify-center flex-shrink-0">
                    <component :is="item.icon" class="w-4 h-4" :class="shownId === item.id ? 'md:text-primary' : ''" />
                  </span>
                  <span class="flex-1 min-w-0">
                    <span class="block text-sm md:text-xs font-medium text-foreground md:text-current truncate" :class="shownId === item.id ? 'md:font-semibold' : ''">{{ item.label }}</span>
                    <span v-if="item.desc" class="block md:hidden text-[12px] text-muted-foreground truncate">{{ item.desc }}</span>
                  </span>
                  <span v-if="item.badge" class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary flex-shrink-0">{{ item.badge }}</span>
                  <ChevronRight class="w-4 h-4 text-muted-foreground md:hidden flex-shrink-0" />
                </button>
              </div>
            </div>
            <slot name="nav-footer" />
          </div>
        </nav>

        <main v-if="activeId || isWide" :class="[activeId ? 'flex' : 'hidden md:flex', 'min-w-0 flex-col gap-6']">
          <slot :section="shownId" />
        </main>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ChevronRight } from '@lucide/vue';
import Sidebar from '../Sidebar.vue';
import { useAuthStore } from '../../stores/auth';
import { useCustomizationStore } from '../../stores/customization';

const props = defineProps({
  title: { type: String, required: true },
  // [{ label, items: [{ id, label, icon, desc?, badge? }] }]
  groups: { type: Array, required: true },
  // Older ?tab= names that now live in another section: { old: 'new' }.
  aliases: { type: Object, default: () => ({}) }
});

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const customizationStore = useCustomizationStore();
const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}

const items = computed(() => props.groups.flatMap((g) => g.items));

// The section in the address bar, if any (old names mapped to where they went).
const activeId = computed(() => {
  const tab = props.aliases[route.query.tab] || route.query.tab;
  return items.value.some((i) => i.id === tab) ? tab : null;
});
const current = computed(() => items.value.find((i) => i.id === activeId.value));

// Wide screens always show a section beside the list: the first, until one is picked.
const wideQuery = window.matchMedia('(min-width: 768px)');
const isWide = ref(wideQuery.matches);
const onWide = (e) => { isWide.value = e.matches; };
wideQuery.addEventListener('change', onWide);
onUnmounted(() => wideQuery.removeEventListener('change', onWide));
const shownId = computed(() => activeId.value || (isWide.value ? items.value[0]?.id : null));

function openSection(id) {
  const to = { query: { ...route.query, tab: id } };
  // From the phone's list, a real step (the system back gesture returns to the list);
  // between sections, a swap.
  if (activeId.value) router.replace(to);
  else router.push(to);
  window.scrollTo({ top: 0 });
}

function closeSection() {
  const { tab, ...rest } = route.query;
  router.replace({ query: rest });
}

defineExpose({ openSection });
</script>
