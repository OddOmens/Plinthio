<template>
  <!-- The page fills the screen. The top bar and the scrubber come and go with a tap in the
       middle of the page; the chapter and progress line along the bottom always stays. The
       whole reader takes the page theme's colours (see themeTokens). -->
  <div
    class="fixed inset-0 z-50 bg-background text-foreground select-none"
    :style="themeStyle"
  >
    <!-- Top bar -->
    <header
      class="absolute top-0 inset-x-0 z-30 h-[calc(3.25rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] flex items-center gap-1 bg-background border-b border-border transition-opacity duration-200"
      :class="chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'"
    >
      <button aria-label="Close book" title="Close book" @click="closeReader" class="reader-btn">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="min-w-0 flex-1 px-1">
        <h2 class="text-sm font-semibold truncate leading-tight">{{ item.title }}</h2>
        <p v-if="item.author" class="text-xs text-muted-foreground truncate leading-tight">{{ item.author }}</p>
      </div>
      <button aria-label="Contents, bookmarks and highlights" title="Contents & notebook" @click="togglePanel('notebook')" :class="['reader-btn', openPanel === 'notebook' ? 'bg-muted' : '']">
        <BookMarked class="w-5 h-5" />
      </button>
      <button aria-label="Search in book" title="Search (Ctrl+F)" @click="togglePanel('search')" :class="['reader-btn', openPanel === 'search' ? 'bg-muted' : '']">
        <Search class="w-5 h-5" />
      </button>
      <button aria-label="Display settings" title="Display settings" @click="togglePanel('display')" :class="['reader-btn', openPanel === 'display' ? 'bg-muted' : '']">
        <span class="text-[15px] font-semibold leading-none tracking-tight" aria-hidden="true">Aa</span>
      </button>
      <button
        :aria-label="pageBookmark ? 'Remove bookmark from this page' : 'Bookmark this page'"
        :aria-pressed="String(!!pageBookmark)"
        :title="pageBookmark ? 'Remove bookmark' : 'Bookmark this page'"
        @click="togglePageBookmark"
        class="reader-btn"
      >
        <Bookmark class="w-5 h-5 transition" :class="pageBookmark ? 'fill-primary text-primary' : ''" />
      </button>
    </header>

    <!-- The page -->
    <div
      class="absolute inset-x-0 top-[calc(3.25rem+env(safe-area-inset-top))] bottom-[calc(2rem+env(safe-area-inset-bottom))]"
    >
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-background">
        <div class="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 class="w-7 h-7 animate-spin" />
          <span class="text-sm">Opening book…</span>
        </div>
      </div>
      <div v-if="loadError" class="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {{ loadError }}
      </div>
      <div ref="viewerEl" class="w-full h-full" />

      <!-- Bookmark ribbon on a bookmarked page -->
      <div
        v-if="pageBookmark && !chromeVisible"
        class="absolute top-0 right-[max(1.25rem,env(safe-area-inset-right))] z-20 w-5 h-7 bg-primary pointer-events-none [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]"
        aria-hidden="true"
      />
    </div>

    <!-- Scrubber + rating, with the top bar -->
    <div
      v-if="!loading && !loadError"
      class="absolute inset-x-0 z-30 bottom-[calc(2rem+env(safe-area-inset-bottom))] px-[max(1rem,env(safe-area-inset-left))] py-3 bg-background border-t border-border flex flex-col gap-2 transition-all duration-200"
      :class="chromeVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'"
    >
      <div class="flex items-center gap-3">
        <span class="text-xs tabular-nums text-muted-foreground w-10 text-right">{{ Math.round(scrubValue) }}%</span>
        <input
          type="range" min="0" max="100" step="0.1"
          :value="scrubValue"
          :disabled="!locationsReady"
          @input="scrubValue = Number($event.target.value)"
          @change="goToPercent(Number($event.target.value))"
          class="flex-1 accent-primary disabled:opacity-40"
          :aria-label="locationsReady ? 'Position in book' : 'Position in book (still measuring the book)'"
        />
        <span class="text-xs text-muted-foreground w-10">{{ locationsReady ? '' : '…' }}</span>
      </div>
      <RatingBar :item="item" :tone="theme.dark ? 'dark' : 'default'" compact class="self-center" />
    </div>

    <!-- Always-on line: chapter, and progress (tap to change what it shows) -->
    <footer class="absolute bottom-0 inset-x-0 z-30 h-[calc(2rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] flex items-center justify-between gap-3 text-[12px] text-muted-foreground bg-background">
      <span class="truncate">{{ chapterTitle }}</span>
      <button
        v-if="!loading"
        type="button"
        @click="cycleProgressDisplay"
        class="flex-shrink-0 tabular-nums h-full px-1 hover:text-foreground transition"
        :title="`Showing: ${progressOptionLabel}. Tap to change.`"
      >{{ progressLabel || '·' }}</button>
    </footer>

    <!-- Selection toolbar: highlight in a colour, add a note, copy -->
    <div
      v-if="selection"
      class="fixed z-[60] flex items-center gap-1 rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl p-1.5"
      :style="popupStyle(selection)"
      role="toolbar"
      aria-label="Highlight"
      @mousedown.prevent
    >
      <button
        v-for="c in HIGHLIGHT_COLORS"
        :key="c.id"
        type="button"
        @click="createHighlight(c.id)"
        class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition"
        :aria-label="`Highlight ${c.label.toLowerCase()}`"
        :title="`Highlight ${c.label.toLowerCase()}`"
      >
        <span class="w-6 h-6 rounded-full ring-1 ring-black/10" :style="{ background: c.fill }" />
      </button>
      <span class="w-px h-6 bg-border mx-0.5" aria-hidden="true" />
      <button type="button" @click="createHighlight('yellow', true)" class="popup-btn" aria-label="Highlight and add a note" title="Add a note">
        <StickyNote class="w-4 h-4" />
      </button>
      <button type="button" @click="copyText(selection.text)" class="popup-btn" aria-label="Copy" title="Copy">
        <Copy class="w-4 h-4" />
      </button>
    </div>

    <!-- A tapped highlight: recolour, note, copy, remove -->
    <div
      v-if="activeHighlight"
      class="fixed z-[60] flex items-center gap-1 rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl p-1.5"
      :style="popupStyle(activeHighlight)"
      role="toolbar"
      aria-label="Edit highlight"
    >
      <button
        v-for="c in HIGHLIGHT_COLORS"
        :key="c.id"
        type="button"
        @click="recolorHighlight(activeHighlight.hl, c.id)"
        class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition"
        :aria-label="`Make it ${c.label.toLowerCase()}`"
        :aria-pressed="String(activeHighlight.hl.color === c.id)"
      >
        <span class="w-6 h-6 rounded-full ring-1 ring-black/10 flex items-center justify-center" :style="{ background: c.fill }">
          <Check v-if="activeHighlight.hl.color === c.id" class="w-3.5 h-3.5 text-black/70 stroke-[3]" />
        </span>
      </button>
      <span class="w-px h-6 bg-border mx-0.5" aria-hidden="true" />
      <button type="button" @click="openNoteEditor(activeHighlight.hl)" class="popup-btn" :aria-label="activeHighlight.hl.note ? 'Edit note' : 'Add a note'" :title="activeHighlight.hl.note ? 'Edit note' : 'Add a note'">
        <StickyNote class="w-4 h-4" />
      </button>
      <button type="button" @click="copyText(activeHighlight.hl.text)" class="popup-btn" aria-label="Copy" title="Copy">
        <Copy class="w-4 h-4" />
      </button>
      <button type="button" @click="deleteHighlight(activeHighlight.hl)" class="popup-btn hover:!text-destructive" aria-label="Remove highlight" title="Remove highlight">
        <Trash2 class="w-4 h-4" />
      </button>
    </div>

    <!-- Copied toast -->
    <Transition enter-active-class="transition duration-150" enter-from-class="opacity-0" leave-active-class="transition duration-300" leave-to-class="opacity-0">
      <div v-if="toast" class="fixed z-[80] left-1/2 -translate-x-1/2 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium shadow-lg" role="status">
        {{ toast }}
      </div>
    </Transition>

    <!-- Display settings ("Aa") -->
    <ReaderPanel :open="openPanel === 'display'" title="Display" @close="openPanel = null">
      <div class="flex flex-col gap-5 text-sm">
        <section class="flex flex-col gap-2">
          <h3 class="reader-label">Page colour</h3>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="t in THEME_OPTIONS"
              :key="t.id"
              type="button"
              @click="prefs.theme = t.id"
              :aria-pressed="String(prefs.theme === t.id)"
              :aria-label="`${t.label} page`"
              class="flex flex-col items-center gap-1 text-[11px] text-muted-foreground"
            >
              <span
                class="w-10 h-10 rounded-full border flex items-center justify-center text-xs font-semibold transition"
                :class="prefs.theme === t.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-popover border-transparent' : 'border-border'"
                :style="swatchStyle(t.id)"
              >Aa</span>
              <span :class="prefs.theme === t.id ? 'text-foreground font-medium' : ''">{{ t.label }}</span>
            </button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="reader-label">Font</h3>
          <div class="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            <button
              v-for="f in FONT_OPTIONS"
              :key="f.id"
              type="button"
              @click="prefs.font = f.id"
              :aria-pressed="String(prefs.font === f.id)"
              :class="['reader-choice', prefs.font === f.id ? 'reader-choice-on' : '']"
              :style="f.css ? { fontFamily: f.css } : {}"
            >{{ f.label }}</button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="reader-label">Text size</h3>
            <span class="text-xs tabular-nums text-muted-foreground">{{ prefs.fontSize }}px</span>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" aria-label="Smaller text" @click="prefs.fontSize = Math.max(FONT_SIZE_MIN, prefs.fontSize - 1)" class="reader-step text-xs">A</button>
            <input type="range" :min="FONT_SIZE_MIN" :max="FONT_SIZE_MAX" step="1" v-model.number="prefs.fontSize" class="flex-1 accent-primary" aria-label="Text size" />
            <button type="button" aria-label="Larger text" @click="prefs.fontSize = Math.min(FONT_SIZE_MAX, prefs.fontSize + 1)" class="reader-step text-lg">A</button>
          </div>
        </section>

        <section class="grid grid-cols-1 gap-4">
          <div class="flex flex-col gap-2">
            <h3 class="reader-label">Line spacing</h3>
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="o in LINE_HEIGHT_OPTIONS" :key="o.id" type="button" @click="prefs.lineHeight = o.id" :aria-pressed="String(prefs.lineHeight === o.id)" :class="['reader-choice', prefs.lineHeight === o.id ? 'reader-choice-on' : '']">{{ o.label }}</button>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h3 class="reader-label">Margins</h3>
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="o in MARGIN_OPTIONS" :key="o.id" type="button" @click="prefs.margins = o.id" :aria-pressed="String(prefs.margins === o.id)" :class="['reader-choice', prefs.margins === o.id ? 'reader-choice-on' : '']">{{ o.label }}</button>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h3 class="reader-label">Alignment</h3>
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="o in ALIGN_OPTIONS" :key="o.id" type="button" @click="prefs.align = o.id" :aria-pressed="String(prefs.align === o.id)" :class="['reader-choice', prefs.align === o.id ? 'reader-choice-on' : '']">{{ o.label }}</button>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="reader-label">Layout</h3>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" @click="prefs.layout = 'paged'" :aria-pressed="String(prefs.layout === 'paged')" :class="['reader-choice flex items-center justify-center gap-1.5', prefs.layout === 'paged' ? 'reader-choice-on' : '']">
              <BookOpen class="w-4 h-4" /> Pages
            </button>
            <button type="button" @click="prefs.layout = 'scrolled'" :aria-pressed="String(prefs.layout === 'scrolled')" :class="['reader-choice flex items-center justify-center gap-1.5', prefs.layout === 'scrolled' ? 'reader-choice-on' : '']">
              <ScrollText class="w-4 h-4" /> Scroll
            </button>
          </div>
          <div v-if="prefs.layout === 'paged'" class="grid grid-cols-2 gap-1.5">
            <button type="button" @click="prefs.columns = 'auto'" :aria-pressed="String(prefs.columns === 'auto')" :class="['reader-choice flex items-center justify-center gap-1.5', prefs.columns === 'auto' ? 'reader-choice-on' : '']">
              <Columns2 class="w-4 h-4" /> Two on wide screens
            </button>
            <button type="button" @click="prefs.columns = 'single'" :aria-pressed="String(prefs.columns === 'single')" :class="['reader-choice flex items-center justify-center gap-1.5', prefs.columns === 'single' ? 'reader-choice-on' : '']">
              <Square class="w-4 h-4" /> Always one
            </button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="reader-label">Bottom corner shows</h3>
          <div class="grid grid-cols-2 gap-1.5">
            <button v-for="o in PROGRESS_OPTIONS" :key="o.id" type="button" @click="prefs.progress = o.id" :aria-pressed="String(prefs.progress === o.id)" :class="['reader-choice', prefs.progress === o.id ? 'reader-choice-on' : '']">{{ o.label }}</button>
          </div>
        </section>

        <div class="flex items-center justify-between gap-3 pt-1 border-t border-border">
          <p class="text-xs text-muted-foreground pt-3">Applies to every book you read, on all your devices.</p>
          <button type="button" @click="resetPrefs" class="text-xs font-medium text-primary hover:underline pt-3 flex-shrink-0">Reset</button>
        </div>
      </div>
    </ReaderPanel>

    <!-- Notebook: contents, bookmarks, highlights -->
    <ReaderPanel :open="openPanel === 'notebook'" title="Notebook" side="left" @close="openPanel = null">
      <template #header>
        <div class="px-4 pb-3 flex-shrink-0">
          <div class="grid grid-cols-3 p-0.5 rounded-lg bg-muted/60 border border-border text-xs" role="tablist">
            <button
              v-for="tab in notebookTabs"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="String(notebookTab === tab.id)"
              @click="notebookTab = tab.id"
              :class="['h-8 rounded-md font-medium transition', notebookTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']"
            >{{ tab.label }}<span v-if="tab.count" class="ml-1 opacity-60 tabular-nums">{{ tab.count }}</span></button>
          </div>
        </div>
      </template>

      <!-- Contents -->
      <ul v-if="notebookTab === 'contents'" class="flex flex-col">
        <li v-for="entry in tocEntries" :key="entry.key">
          <button
            type="button"
            @click="goToHref(entry.href)"
            class="w-full text-left py-2.5 pr-2 rounded-lg text-sm hover:bg-muted/60 transition flex items-center gap-2"
            :style="{ paddingLeft: `${0.5 + entry.depth * 1}rem` }"
            :class="entry.label === chapterTitle ? 'text-primary font-semibold' : 'text-foreground'"
          >
            <span class="flex-1 min-w-0 truncate">{{ entry.label }}</span>
          </button>
        </li>
        <li v-if="!tocEntries.length" class="py-6 text-center text-xs text-muted-foreground">This book has no table of contents.</li>
      </ul>

      <!-- Bookmarks -->
      <div v-else-if="notebookTab === 'bookmarks'" class="flex flex-col gap-1">
        <button
          type="button"
          @click="togglePageBookmark"
          class="mb-2 h-10 rounded-lg border border-dashed border-border text-sm font-medium hover:bg-muted/60 transition flex items-center justify-center gap-2"
        >
          <Bookmark class="w-4 h-4" :class="pageBookmark ? 'fill-primary text-primary' : ''" />
          {{ pageBookmark ? 'Remove bookmark from this page' : 'Bookmark this page' }}
        </button>
        <div v-for="bm in sortedBookmarks" :key="bm.id" class="group flex items-start gap-2 rounded-lg hover:bg-muted/60 transition">
          <button type="button" @click="goToCfi(bm.cfi)" class="flex-1 min-w-0 text-left px-2 py-2.5 flex items-start gap-2.5">
            <Bookmark class="w-4 h-4 mt-0.5 flex-shrink-0 fill-primary text-primary" />
            <span class="min-w-0">
              <span class="block text-sm text-foreground truncate">{{ bm.title || 'Bookmark' }}</span>
              <span class="block text-xs text-muted-foreground tabular-nums">{{ Math.round(bm.position) }}% · {{ formatDate(bm.created_at) }}</span>
              <span v-if="bm.notes" class="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{{ bm.notes }}</span>
            </span>
          </button>
          <button type="button" :aria-label="`Delete bookmark ${bm.title || ''}`" @click="deleteBookmark(bm)" class="w-9 h-9 mt-1 flex-shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive transition">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
        <p v-if="!bookmarks.length" class="py-6 text-center text-xs text-muted-foreground">
          No bookmarks yet. Tap the ribbon at the top right to bookmark a page.
        </p>
      </div>

      <!-- Highlights -->
      <div v-else class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            @click="highlightFilter = null"
            :aria-pressed="String(highlightFilter === null)"
            :class="['h-8 px-3 rounded-full border text-xs font-medium transition', highlightFilter === null ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground']"
          >All</button>
          <button
            v-for="c in HIGHLIGHT_COLORS"
            :key="c.id"
            type="button"
            @click="highlightFilter = highlightFilter === c.id ? null : c.id"
            :aria-pressed="String(highlightFilter === c.id)"
            :aria-label="`Only ${c.label.toLowerCase()} highlights`"
            :class="['w-8 h-8 rounded-full border flex items-center justify-center transition', highlightFilter === c.id ? 'border-foreground' : 'border-transparent']"
          >
            <span class="w-5 h-5 rounded-full ring-1 ring-black/10" :style="{ background: c.fill }" />
          </button>
        </div>
        <article
          v-for="hl in filteredHighlights"
          :key="hl.id"
          class="rounded-lg border border-border overflow-hidden flex"
        >
          <span class="w-1.5 flex-shrink-0" :style="{ background: highlightFill(hl.color) }" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <button type="button" @click="goToCfi(hl.cfi_range)" class="w-full text-left px-3 pt-2.5 pb-1.5 hover:bg-muted/50 transition">
              <p class="text-sm text-foreground leading-snug line-clamp-4">“{{ hl.text }}”</p>
              <p v-if="hl.note" class="mt-1.5 text-xs text-foreground/80 italic flex gap-1.5"><StickyNote class="w-3.5 h-3.5 flex-shrink-0 mt-px not-italic" />{{ hl.note }}</p>
            </button>
            <div class="flex items-center gap-1 px-2 pb-1.5">
              <span class="flex-1 min-w-0 truncate text-[11px] text-muted-foreground px-1">
                {{ [hl.chapter, hl.progress != null ? `${Math.round(hl.progress)}%` : null].filter(Boolean).join(' · ') }}
              </span>
              <button type="button" @click="openNoteEditor(hl)" class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition" :aria-label="hl.note ? 'Edit note' : 'Add a note'">
                <StickyNote class="w-4 h-4" />
              </button>
              <button type="button" @click="deleteHighlight(hl)" class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition" aria-label="Remove highlight">
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </article>
        <p v-if="!highlights.length" class="py-6 text-center text-xs text-muted-foreground">
          No highlights yet. Select some text to highlight it in a colour, or add a note.
        </p>
        <p v-else-if="!filteredHighlights.length" class="py-6 text-center text-xs text-muted-foreground">No highlights in this colour.</p>
      </div>
    </ReaderPanel>

    <!-- Search -->
    <ReaderPanel :open="openPanel === 'search'" title="Search" @close="openPanel = null">
      <form @submit.prevent="runSearch" class="flex items-center gap-2">
        <div class="relative flex-1">
          <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref="searchInputEl"
            v-model="bookSearch"
            type="search"
            placeholder="Search this book…"
            class="w-full h-10 bg-background border border-border rounded-lg pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button type="submit" :disabled="searching || bookSearch.trim().length < 2" class="h-10 px-3.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
          <Loader2 v-if="searching" class="w-3.5 h-3.5 animate-spin" />
          <span v-else>Find</span>
        </button>
      </form>
      <p v-if="searchDone" class="mt-3 text-[12px] text-muted-foreground">
        {{ searchResults.length ? `${searchResults.length}${searchResults.length >= SEARCH_LIMIT ? '+' : ''} match${searchResults.length === 1 ? '' : 'es'}` : 'No matches' }}
      </p>
      <ul class="mt-2 -mx-2 divide-y divide-border/60">
        <li v-for="(result, idx) in searchResults" :key="idx">
          <button @click="goToResult(result)" class="w-full text-left px-2 py-2.5 rounded-lg hover:bg-muted/60 transition">
            <p class="text-[12px] text-muted-foreground mb-0.5">{{ result.chapter }}</p>
            <p class="text-xs text-foreground leading-snug">{{ result.excerpt }}</p>
          </button>
        </li>
      </ul>
    </ReaderPanel>

    <!-- Note on a highlight -->
    <ReaderPanel :open="!!noteEditor" title="Note" @close="noteEditor = null">
      <template v-if="noteEditor">
        <blockquote class="text-sm text-muted-foreground border-l-4 pl-3 py-0.5 mb-3 line-clamp-4" :style="{ borderColor: highlightFill(noteEditor.hl.color) }">
          {{ noteEditor.hl.text }}
        </blockquote>
        <textarea
          ref="noteInputEl"
          v-model="noteEditor.text"
          rows="5"
          placeholder="Your note…"
          class="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y"
          @keydown.meta.enter="saveNote"
          @keydown.ctrl.enter="saveNote"
        />
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" @click="noteEditor = null" class="h-10 px-4 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium">Cancel</button>
          <button type="button" @click="saveNote" class="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Save note</button>
        </div>
      </template>
    </ReaderPanel>
  </div>
</template>

<script setup>
import { getMediaToken } from '../utils/mediaToken';
import { ref, shallowRef, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import {
  ArrowLeft, Bookmark, BookMarked, Loader2, Trash2, BookOpen, ScrollText, Search,
  Columns2, Square, StickyNote, Copy, Check
} from '@lucide/vue';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useDialogStore } from '../stores/dialog';
import { useViewSession } from '../composables/useViewSession';
import RatingBar from './RatingBar.vue';
import ReaderPanel from './ReaderPanel.vue';
import {
  EBOOK_DEFAULTS, FONT_SIZE_MIN, FONT_SIZE_MAX, THEME_OPTIONS, FONT_OPTIONS,
  LINE_HEIGHT_OPTIONS, MARGINS, MARGIN_OPTIONS, ALIGN_OPTIONS, PROGRESS_OPTIONS, HIGHLIGHT_COLORS,
  highlightFill, normalizeEbookPrefs, readerStylesheet, resolveTheme, themeTokens
} from '../utils/ebookReader';

const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['close']);

const authStore = useAuthStore();
const dialog = useDialogStore();
const viewSession = useViewSession();

const viewerEl = ref(null);
const loading = ref(true);
const loadError = ref('');

let book = null;
let rendition = null;
// epub.js's CFI class, once the library has loaded. A shallowRef so anything computed from
// it (is this page bookmarked?) re-runs when it arrives.
const EpubCFI = shallowRef(null);

// ─── Settings (per person, every book) ───────────────────────────────────────
const prefs = reactive(normalizeEbookPrefs(authStore.user?.preferences?.ebookReader));
const theme = computed(() => resolveTheme(prefs.theme));
const themeStyle = computed(() => themeTokens(theme.value));

// Saved a moment after the last change, so dragging the size slider is one save, not twenty.
let savePrefsTimer = null;
let prefsDirty = false;
async function persistPrefs() {
  clearTimeout(savePrefsTimer);
  prefsDirty = false;
  const ebookReader = { ...prefs };
  if (!authStore.user) return;
  authStore.user.preferences = { ...(authStore.user.preferences || {}), ebookReader };
  try {
    localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
    await api.patch('/users/preferences', { ebookReader });
  } catch (err) {
    console.warn('Could not save reader settings:', err.message);
  }
}
function savePrefs() {
  prefsDirty = true;
  clearTimeout(savePrefsTimer);
  savePrefsTimer = setTimeout(persistPrefs, 600);
}

function resetPrefs() {
  Object.assign(prefs, EBOOK_DEFAULTS);
}

function swatchStyle(id) {
  const t = resolveTheme(id);
  return { background: t.bg, color: t.fg };
}

// What changed decides how much has to happen: page geometry needs the book laid out
// again; everything else is a stylesheet swap on the chapters already showing.
let appliedPrefs = { ...prefs };
watch(prefs, () => {
  const before = appliedPrefs;
  appliedPrefs = { ...prefs };
  savePrefs();
  if (!rendition) return;
  const anchor = currentCfi.value;
  if (before.layout !== prefs.layout || before.margins !== prefs.margins || before.columns !== prefs.columns) {
    rebuildRendition(anchor);
    return;
  }
  applyStylesEverywhere();
  if (before.theme !== prefs.theme) redrawHighlights();
  // A new size or spacing reflows the chapter; go back to the same spot in the text.
  if (anchor && (before.fontSize !== prefs.fontSize || before.font !== prefs.font || before.lineHeight !== prefs.lineHeight || before.align !== prefs.align)) {
    clearTimeout(reanchorTimer);
    reanchorTimer = setTimeout(() => rendition?.display(anchor), 150);
  }
});
let reanchorTimer = null;

function injectStyles(contents) {
  const doc = contents?.document;
  if (!doc?.head) return;
  let el = doc.getElementById('plinthio-reader-style');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'plinthio-reader-style';
    doc.head.appendChild(el);
  }
  el.textContent = readerStylesheet(prefs);
}

function applyStylesEverywhere() {
  rendition?.getContents().forEach(injectStyles);
}

// ─── Where we are ────────────────────────────────────────────────────────────
const currentCfi = ref(null);
const pageStartCfi = ref(null);
const pageEndCfi = ref(null);
const chapterTitle = ref('');
const percent = ref(0);
const scrubValue = ref(0);
const chapterPages = ref(null); // { page, total } within the current chapter
const locationsReady = ref(false);
const locationIndex = ref(0);
const chromeVisible = ref(true);

const progressLabel = computed(() => {
  switch (prefs.progress) {
    case 'none': return '';
    case 'chapter': {
      const cp = chapterPages.value;
      if (!cp || prefs.layout !== 'paged' || !cp.total) return `${Math.round(percent.value)}%`;
      const left = cp.total - cp.page;
      return left <= 0 ? 'Last page in chapter' : `${left} ${left === 1 ? 'page' : 'pages'} left in chapter`;
    }
    case 'location':
      return locationsReady.value ? `Loc ${locationIndex.value + 1} of ${book.locations.length()}` : `${Math.round(percent.value)}%`;
    default:
      return `${Math.round(percent.value)}%`;
  }
});
const progressOptionLabel = computed(() => PROGRESS_OPTIONS.find((o) => o.id === prefs.progress)?.label || '');

function cycleProgressDisplay() {
  const ids = PROGRESS_OPTIONS.map((o) => o.id);
  prefs.progress = ids[(ids.indexOf(prefs.progress) + 1) % ids.length];
}

function onRelocated(location) {
  currentCfi.value = location.start.cfi;
  pageStartCfi.value = location.start.cfi;
  pageEndCfi.value = location.end?.cfi || location.start.cfi;
  chapterTitle.value = chapterLabel(location.start.href) || chapterTitle.value;
  const displayed = location.start.displayed;
  chapterPages.value = displayed ? { page: displayed.page, total: displayed.total } : null;
  updatePercent();
  queueSaveProgress();
  selection.value = null;
  activeHighlight.value = null;
}

function updatePercent() {
  if (!currentCfi.value) return;
  if (locationsReady.value) {
    percent.value = (book.locations.percentageFromCfi(currentCfi.value) || 0) * 100;
    locationIndex.value = book.locations.locationFromCfi(currentCfi.value) || 0;
  }
  scrubValue.value = percent.value;
}

// Locations (fixed-size chunks of text) are what percentages and "Loc" numbers are
// measured in. Working them out reads the whole book, so it happens after the first page
// is up, and the result is kept on this device for next time.
async function generateLocations() {
  const key = `plinthio_epub_locations_${props.item.id}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) book.locations.load(cached);
  } catch { /* nothing cached */ }
  if (!book.locations.length()) {
    await book.locations.generate(1600);
    try { localStorage.setItem(key, book.locations.save()); } catch { /* storage full */ }
  }
  if (!book) return;
  locationsReady.value = true;
  updatePercent();
}

function goToPercent(p) {
  if (!locationsReady.value || !rendition) return;
  rendition.display(book.locations.cfiFromPercentage(Math.min(0.9999, Math.max(0, p / 100))));
}

// ─── Opening the book ────────────────────────────────────────────────────────
const tocEntries = ref([]);

function chapterLabel(href) {
  const base = (href || '').split('#')[0];
  if (!base) return '';
  const match = tocEntries.value.find((t) => {
    const h = (t.href || '').split('#')[0];
    return h && (h.endsWith(base) || base.endsWith(h));
  });
  return match?.label || '';
}

function startTarget() {
  // A finished book ("Read Again") starts over rather than reopening on its last page. A
  // book last read in KOReader has only a percentage (its positions are XPointers).
  if (props.item.is_finished) return { cfi: null, percent: 0 };
  return { cfi: props.item.current_page_cfi || null, percent: Number(props.item.progress_percent) || 0 };
}

let builtWidth = 0;
async function createRendition(target) {
  const width = viewerEl.value.clientWidth;
  builtWidth = width;
  const paged = prefs.layout === 'paged';
  const gapShare = (MARGINS[prefs.margins] || MARGINS.normal).gap;
  rendition = book.renderTo(viewerEl.value, {
    width: '100%',
    height: '100%',
    flow: paged ? 'paginated' : 'scrolled',
    manager: paged ? 'default' : 'continuous',
    spread: paged && prefs.columns === 'auto' ? 'auto' : 'none',
    minSpreadWidth: 1000,
    gap: paged ? Math.max(16, Math.round((width * gapShare) / 2) * 2) : 0,
    allowScriptedContent: false
  });

  rendition.hooks.content.register((contents) => {
    injectStyles(contents);
    // The toolbar goes when the selection does (a tap elsewhere, or the handles collapsing).
    contents.document.addEventListener('selectionchange', () => {
      const sel = contents.window.getSelection();
      if (selection.value && (!sel || sel.isCollapsed)) selection.value = null;
    });
  });

  rendition.on('relocated', onRelocated);
  rendition.on('selected', onSelected);
  rendition.on('markClicked', onMarkClicked);
  rendition.on('keydown', onKeyDown);
  rendition.on('touchstart', onTouchStart);
  rendition.on('touchend', onTouchEnd);
  rendition.on('click', onClick);

  redrawHighlights();

  if (typeof target === 'string') {
    await rendition.display(target);
  } else if (target?.cfi) {
    await rendition.display(target.cfi);
  } else if (target?.percent > 0 && target.percent < 100) {
    try {
      await generateLocations();
      await rendition.display(book.locations.cfiFromPercentage(target.percent / 100));
    } catch {
      await rendition.display();
    }
  } else {
    await rendition.display();
  }
}

async function rebuildRendition(anchor) {
  rendition?.destroy();
  rendition = null;
  await nextTick();
  await createRendition(anchor || startTarget());
}

async function init() {
  try {
    const ePubModule = await import('epubjs');
    const ePub = ePubModule.default;
    EpubCFI.value = ePubModule.EpubCFI;
    const url = `/api/media/book/${props.item.id}/file?token=${getMediaToken() || ''}`;
    // The file route has no .epub extension, and epub.js decides "zipped book or unpacked
    // folder" from the extension — without openAs it looks for /file/META-INF/container.xml.
    book = ePub(url, { openAs: 'epub' });
    await book.ready;
    const toc = (await book.loaded.navigation)?.toc || [];
    const flat = [];
    const walk = (items, depth) => items?.forEach((t, i) => {
      flat.push({ key: `${depth}-${flat.length}-${i}`, label: (t.label || '').trim(), href: t.href, depth });
      walk(t.subitems, depth + 1);
    });
    walk(toc, 0);
    tocEntries.value = flat;
    await createRendition(startTarget());
    loading.value = false;
    generateLocations().catch((err) => console.warn('Could not measure the book:', err));
  } catch (err) {
    console.error('Failed to open book:', err);
    loadError.value = "This book couldn't be opened.";
    loading.value = false;
  }
}

// ─── Turning pages and taps ──────────────────────────────────────────────────
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;

// On a phone the bars get out of the way once reading starts, like an e-reader; a tap in the
// middle of the page brings them back.
function nextPage() {
  if (isTouch) chromeVisible.value = false;
  rendition?.next();
}
function prevPage() {
  if (isTouch) chromeVisible.value = false;
  rendition?.prev();
}

function hasSelection(contents) {
  const sel = contents?.window?.getSelection();
  return !!sel && !sel.isCollapsed;
}

// Taps arrive from inside the book's frame; positions are converted to the screen so the
// left and right quarters of the page turn back and forward, and the middle shows or
// hides the bars. This replaced invisible tap strips over the page, which blocked
// selecting text near the edges.
function handleTap(clientX, target, contents) {
  if (Date.now() - lastMarkClick < 500) return;
  if (target?.closest?.('a')) return;
  if (selection.value || activeHighlight.value) {
    selection.value = null;
    activeHighlight.value = null;
    return;
  }
  if (openPanel.value) { openPanel.value = null; return; }
  const frame = contents?.document?.defaultView?.frameElement?.getBoundingClientRect();
  const box = viewerEl.value?.getBoundingClientRect();
  if (!frame || !box) return;
  const rel = (frame.left + clientX - box.left) / box.width;
  if (prefs.layout === 'paged' && rel < 0.25) prevPage();
  else if (prefs.layout === 'paged' && rel > 0.75) nextPage();
  else chromeVisible.value = !chromeVisible.value;
}

let touchStart = null;
let lastTouchTap = 0;
function onTouchStart(e) {
  const t = e.changedTouches?.[0];
  if (t) touchStart = { x: t.screenX, y: t.screenY, time: Date.now() };
}
function onTouchEnd(e, contents) {
  const t = e.changedTouches?.[0];
  const start = touchStart;
  touchStart = null;
  if (!t || !start || hasSelection(contents)) return;
  const dx = t.screenX - start.x;
  const dy = t.screenY - start.y;
  const dt = Date.now() - start.time;
  if (prefs.layout === 'paged' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
    lastTouchTap = Date.now();
    if (dx < 0) nextPage(); else prevPage();
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 400) {
    lastTouchTap = Date.now();
    handleTap(t.clientX, e.target, contents);
  }
}
function onClick(e, contents) {
  if (Date.now() - lastTouchTap < 700) return; // the same tap, already handled as a touch
  if (hasSelection(contents)) return;
  handleTap(e.clientX, e.target, contents);
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (selection.value || activeHighlight.value) { selection.value = null; activeHighlight.value = null; return; }
    if (noteEditor.value) { noteEditor.value = null; return; }
    if (openPanel.value) { openPanel.value = null; return; }
    closeReader();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); togglePanel('search'); return; }
  if (openPanel.value || noteEditor.value) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && prefs.layout === 'paged')) { e.preventDefault?.(); nextPage(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault?.(); prevPage(); }
}

// ─── Panels ──────────────────────────────────────────────────────────────────
const openPanel = ref(null); // 'display' | 'notebook' | 'search'
const notebookTab = ref('contents');
const searchInputEl = ref(null);

function togglePanel(name) {
  openPanel.value = openPanel.value === name ? null : name;
  selection.value = null;
  activeHighlight.value = null;
  if (openPanel.value === 'search') nextTick(() => searchInputEl.value?.focus());
}

const notebookTabs = computed(() => [
  { id: 'contents', label: 'Contents', count: 0 },
  { id: 'bookmarks', label: 'Bookmarks', count: bookmarks.value.length },
  { id: 'highlights', label: 'Highlights', count: highlights.value.length }
]);

function closePanelOnPhone() {
  if (window.matchMedia?.('(max-width: 639px)').matches) openPanel.value = null;
}

async function goToHref(href) {
  if (!rendition || !href) return;
  await rendition.display(href);
  closePanelOnPhone();
}

async function goToCfi(cfi) {
  if (!rendition || !cfi) return;
  await rendition.display(cfi);
  closePanelOnPhone();
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────
const bookmarks = ref([]);
const sortedBookmarks = computed(() => [...bookmarks.value].sort((a, b) => (a.position || 0) - (b.position || 0)));

function cfiOnPage(cfi) {
  // Every reactive value is read up front, so the computed below tracks all of them even
  // when it bails out early.
  const start = pageStartCfi.value;
  const end = pageEndCfi.value;
  const CFI = EpubCFI.value;
  if (!cfi || !CFI || !start) return false;
  try {
    const cmp = new CFI();
    return cmp.compare(cfi, start) >= 0 && cmp.compare(cfi, end) <= 0;
  } catch {
    return false;
  }
}

const pageBookmark = computed(() => bookmarks.value.find((bm) => cfiOnPage(bm.cfi)) || null);

async function loadBookmarks() {
  try {
    const res = await api.get(`/bookmarks/${props.item.id}`);
    bookmarks.value = res.data.bookmarks || [];
  } catch { /* offline: no bookmarks shown */ }
}

async function togglePageBookmark() {
  if (pageBookmark.value) {
    await deleteBookmark(pageBookmark.value);
    return;
  }
  if (!currentCfi.value) return;
  try {
    const res = await api.post('/bookmarks', {
      itemId: props.item.id,
      type: 'book',
      position: Math.round(percent.value * 10) / 10,
      title: chapterTitle.value || `${Math.round(percent.value)}% through`,
      cfi: currentCfi.value
    });
    bookmarks.value = [...bookmarks.value, res.data.bookmark];
    showToast('Page bookmarked');
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't save the bookmark");
  }
}

async function deleteBookmark(bm) {
  try {
    await api.delete(`/bookmarks/${bm.id}`);
    bookmarks.value = bookmarks.value.filter((b) => b.id !== bm.id);
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't remove the bookmark");
  }
}

// ─── Highlights ──────────────────────────────────────────────────────────────
const highlights = ref([]);
const highlightFilter = ref(null);
const filteredHighlights = computed(() => highlightFilter.value
  ? highlights.value.filter((h) => h.color === highlightFilter.value)
  : highlights.value);
const selection = ref(null);       // { cfiRange, text, top, bottom, x, contents }
const activeHighlight = ref(null); // { hl, top, bottom, x }
const noteEditor = ref(null);      // { hl, text }
const noteInputEl = ref(null);
let lastMarkClick = 0;

async function loadHighlights() {
  try {
    const res = await api.get(`/highlights/${props.item.id}`);
    highlights.value = res.data.highlights || [];
    redrawHighlights();
  } catch { /* offline: none shown */ }
}

function markStyles(color) {
  // On a light page the colour multiplies with the text like a highlighter pen; on a dark
  // page that would vanish, so it's laid over at partial strength instead.
  return theme.value.dark
    ? { fill: highlightFill(color), 'fill-opacity': '0.4', 'mix-blend-mode': 'normal' }
    : { fill: highlightFill(color), 'fill-opacity': '0.45', 'mix-blend-mode': 'multiply' };
}

function addMark(hl) {
  try {
    rendition?.annotations.highlight(hl.cfi_range, { id: hl.id }, null, 'plinthio-hl', markStyles(hl.color));
  } catch { /* a range from an older edition of the file that no longer resolves */ }
}

function removeMark(hl) {
  try { rendition?.annotations.remove(hl.cfi_range, 'highlight'); } catch { /* already gone */ }
}

function redrawHighlights() {
  if (!rendition) return;
  highlights.value.forEach((hl) => { removeMark(hl); addMark(hl); });
}

function frameRect(contents) {
  return contents?.document?.defaultView?.frameElement?.getBoundingClientRect() || { top: 0, left: 0 };
}

function onSelected(cfiRange, contents) {
  let range;
  try { range = contents.range(cfiRange); } catch { return; }
  const text = range?.toString().trim();
  if (!text) return;
  const rect = range.getBoundingClientRect();
  const frame = frameRect(contents);
  activeHighlight.value = null;
  selection.value = {
    cfiRange,
    text,
    contents,
    top: frame.top + rect.top,
    bottom: frame.top + rect.bottom,
    x: frame.left + rect.left + rect.width / 2
  };
}

function onMarkClicked(cfiRange, data, contents) {
  const now = Date.now();
  if (now - lastMarkClick < 400) return; // touchstart and click both report the same tap
  lastMarkClick = now;
  const hl = highlights.value.find((h) => h.id === data?.id || h.cfi_range === cfiRange);
  if (!hl) return;
  let rect = null;
  try { rect = contents.range(cfiRange).getBoundingClientRect(); } catch { /* fall back below */ }
  const frame = frameRect(contents);
  selection.value = null;
  activeHighlight.value = rect
    ? { hl, top: frame.top + rect.top, bottom: frame.top + rect.bottom, x: frame.left + rect.left + rect.width / 2 }
    : { hl, top: 120, bottom: 120, x: window.innerWidth / 2 };
}

// Above the passage if there's room, otherwise below it. On a phone the toolbar sits at the
// bottom of the screen instead, clear of the system's own copy/paste menu.
function popupStyle(anchor) {
  const width = 330;
  if (window.matchMedia?.('(max-width: 639px)').matches) {
    return { left: '50%', transform: 'translateX(-50%)', bottom: 'calc(2.75rem + env(safe-area-inset-bottom))', maxWidth: 'calc(100vw - 1rem)' };
  }
  const left = Math.min(window.innerWidth - width / 2 - 8, Math.max(width / 2 + 8, anchor.x));
  const above = anchor.top - 60;
  const top = above > 70 ? above : Math.min(window.innerHeight - 120, anchor.bottom + 10);
  return { left: `${left}px`, top: `${top}px`, transform: 'translateX(-50%)' };
}

function clearSelection() {
  try { selection.value?.contents?.window?.getSelection()?.removeAllRanges(); } catch { /* frame gone */ }
  selection.value = null;
}

async function createHighlight(color, withNote = false) {
  const sel = selection.value;
  if (!sel) return;
  const progress = locationsReady.value
    ? (book.locations.percentageFromCfi(sel.cfiRange) || 0) * 100
    : percent.value;
  try {
    const res = await api.post('/highlights', {
      itemId: props.item.id,
      cfiRange: sel.cfiRange,
      text: sel.text,
      color,
      chapter: chapterTitle.value || null,
      progress
    });
    const hl = res.data.highlight;
    highlights.value = [...highlights.value, hl].sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
    addMark(hl);
    clearSelection();
    if (withNote) openNoteEditor(hl);
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't save the highlight");
  }
}

async function recolorHighlight(hl, color) {
  if (hl.color === color) { activeHighlight.value = null; return; }
  try {
    const res = await api.patch(`/highlights/${hl.id}`, { color });
    removeMark(hl);
    Object.assign(hl, res.data.highlight);
    addMark(hl);
    activeHighlight.value = null;
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't change the colour");
  }
}

async function deleteHighlight(hl) {
  try {
    await api.delete(`/highlights/${hl.id}`);
    removeMark(hl);
    highlights.value = highlights.value.filter((h) => h.id !== hl.id);
    activeHighlight.value = null;
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't remove the highlight");
  }
}

function openNoteEditor(hl) {
  activeHighlight.value = null;
  noteEditor.value = { hl, text: hl.note || '' };
  nextTick(() => setTimeout(() => noteInputEl.value?.focus(), 60));
}

async function saveNote() {
  const ed = noteEditor.value;
  if (!ed) return;
  try {
    const res = await api.patch(`/highlights/${ed.hl.id}`, { note: ed.text });
    Object.assign(ed.hl, res.data.highlight);
    highlights.value = [...highlights.value];
    noteEditor.value = null;
  } catch (err) {
    dialog.alert(err.response?.data?.error || "Couldn't save the note");
  }
}

const toast = ref('');
let toastTimer = null;
function showToast(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 1600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch {
    showToast("Couldn't copy here");
  }
  clearSelection();
  activeHighlight.value = null;
}

// ─── Search inside the book ──────────────────────────────────────────────────
const SEARCH_LIMIT = 200;
const bookSearch = ref('');
const searchResults = ref([]);
const searching = ref(false);
const searchDone = ref(false);
let searchHitCfi = null;

// epub.js searches one spine section at a time; each is loaded, searched and unloaded in
// turn so a long book doesn't hold every chapter's DOM in memory at once.
async function runSearch() {
  const query = bookSearch.value.trim();
  if (!book || query.length < 2) return;
  searching.value = true;
  searchDone.value = false;
  searchResults.value = [];
  try {
    const results = [];
    for (const section of book.spine.spineItems) {
      if (results.length >= SEARCH_LIMIT) break;
      try {
        await section.load(book.load.bind(book));
        const found = section.find(query) || [];
        const chapter = chapterLabel(section.href);
        for (const hit of found) {
          results.push({ cfi: hit.cfi, excerpt: hit.excerpt.trim(), chapter });
          if (results.length >= SEARCH_LIMIT) break;
        }
      } finally {
        section.unload();
      }
    }
    searchResults.value = results;
  } catch (err) {
    console.warn('Book search failed:', err);
  } finally {
    searching.value = false;
    searchDone.value = true;
  }
}

async function goToResult(result) {
  if (!rendition) return;
  if (searchHitCfi) {
    try { rendition.annotations.remove(searchHitCfi, 'underline'); } catch { /* gone */ }
  }
  await rendition.display(result.cfi);
  try {
    rendition.annotations.underline(result.cfi, {}, null, 'plinthio-search-hit', { stroke: highlightFill('orange'), 'stroke-opacity': '0.9', 'stroke-width': '2' });
    searchHitCfi = result.cfi;
  } catch { /* cosmetic only */ }
  closePanelOnPhone();
}

// ─── Progress ────────────────────────────────────────────────────────────────
let saveTimer = null;
function queueSaveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgress, 800);
}

async function saveProgress() {
  clearTimeout(saveTimer);
  if (!currentCfi.value) return;
  try {
    await api.post(`/progress/${props.item.id}`, {
      currentPage: Math.round(percent.value),
      totalPages: 100,
      cfi: currentCfi.value
    });
  } catch { /* offline: the next page turn tries again */ }
}

function closeReader() {
  saveProgress();
  rendition?.destroy();
  book?.destroy();
  rendition = null;
  book = null;
  emit('close');
}

// Margins are worked out from the page width when the book is laid out, so a big change
// (a tablet turned sideways, a window maximised) lays it out again; small ones epub.js
// absorbs by itself.
let resizeTimer = null;
function onWindowResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const width = viewerEl.value?.clientWidth || 0;
    if (rendition && builtWidth && Math.abs(width - builtWidth) / builtWidth > 0.2) rebuildRendition(currentCfi.value);
  }, 300);
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize, { passive: true });
  init();
  loadBookmarks();
  loadHighlights();
  window.addEventListener('keydown', onKeyDown);
  viewSession.open(props.item.id);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onWindowResize);
  clearTimeout(resizeTimer);
  clearTimeout(saveTimer);
  clearTimeout(toastTimer);
  clearTimeout(reanchorTimer);
  if (prefsDirty) persistPrefs(); // a change made just before closing
  viewSession.close();
});
</script>

<style scoped>
.reader-btn {
  @apply w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition active:scale-95;
}
.popup-btn {
  @apply w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition;
}
.reader-label {
  @apply text-xs font-medium text-muted-foreground uppercase tracking-wide;
}
.reader-choice {
  @apply h-10 px-2 rounded-lg border border-border text-xs text-foreground hover:border-muted-foreground transition truncate;
}
.reader-choice-on {
  @apply bg-foreground text-background border-foreground font-semibold;
}
.reader-step {
  @apply w-10 h-10 rounded-lg border border-border flex items-center justify-center text-foreground hover:bg-muted transition font-semibold;
}
</style>
