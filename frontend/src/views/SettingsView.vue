<template>
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <!-- Primary navigation: sidebar layout keeps global nav present on this page too -->
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0 pb-24">
    <!-- Settings Header (Matching AdminView header) -->
    <header class="bg-background/95 backdrop-blur-xl border-b border-border sticky top-0 z-30 safe-top transition-colors">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <div class="flex items-center gap-2.5 min-w-0 flex-shrink-0">
          <router-link
            to="/"
            class="w-9 h-9 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center transition active:scale-95 flex-shrink-0"
            title="Back to Shelves"
          >
            <ArrowLeft class="w-4 h-4" />
          </router-link>
          <div class="flex items-center gap-2 min-w-0">
            <h1 class="text-sm font-semibold text-foreground tracking-tight truncate">Settings</h1>
            <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground hidden sm:inline">
              {{ authStore.user?.username }}
            </span>
          </div>
        </div>

        <!-- Settings Navigation Tabs (Matching AdminView tabs styling) -->
        <nav class="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs flex-shrink-0">
          <button
            @click="switchTab('preferences')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'preferences'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Sliders class="w-4 h-4" />
            <span class="hidden sm:inline">Preferences</span>
          </button>

          <button
            @click="switchTab('stats')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'stats'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <BarChart3 class="w-4 h-4" />
            <span class="hidden sm:inline">My Activity</span>
          </button>

          <button
            @click="switchTab('hidden')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'hidden'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <EyeOff class="w-4 h-4" />
            <span class="hidden sm:inline">Hidden</span>
          </button>

          <button
            @click="switchTab('apikeys')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'apikeys'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Key class="w-4 h-4" />
            <span class="hidden sm:inline">API Keys</span>
          </button>

          <button
            @click="switchTab('account')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'account'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Lock class="w-4 h-4" />
            <span class="hidden sm:inline">Security</span>
          </button>
        </nav>
      </div>
    </header>

    <main class="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 flex flex-col gap-6">
      <!-- TAB 1: PREFERENCES -->
      <section v-if="activeTab === 'preferences'" class="flex flex-col gap-5">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <Sliders class="w-4 h-4 text-muted-foreground" />
            Personal Preferences
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Customize your visible content, layout filters, and startup view</p>
        </div>

        <!-- Visible Media Categories Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Visible Media Categories</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Choose which types of content appear on your personal dashboard.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="audiobook"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Headphones class="w-3.5 h-3.5 text-muted-foreground" /> Audiobooks
                </span>
                <span class="text-[11px] text-muted-foreground">Spoken word, audio dramas, & audio files</span>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="manga"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileImage class="w-3.5 h-3.5 text-muted-foreground" /> Manga & Comics
                </span>
                <span class="text-[11px] text-muted-foreground">CBZ, CBR, & digital graphic novels</span>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="book"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Book class="w-3.5 h-3.5 text-muted-foreground" /> Books & Documents
                </span>
                <span class="text-[11px] text-muted-foreground">EPUB, PDF, and text volumes</span>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="show"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Tv class="w-3.5 h-3.5 text-muted-foreground" /> TV Shows
                  <span class="text-[9px] bg-primary/10 text-primary border border-primary/20 px-1 py-0.2 rounded font-medium">Video</span>
                </span>
                <span class="text-[11px] text-muted-foreground">Episodic series streaming (MP4, MKV)</span>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="movie"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Film class="w-3.5 h-3.5 text-muted-foreground" /> Movies
                  <span class="text-[9px] bg-primary/10 text-primary border border-primary/20 px-1 py-0.2 rounded font-medium">Video</span>
                </span>
                <span class="text-[11px] text-muted-foreground">Feature films & movies</span>
              </div>
            </label>

            <label class="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition cursor-pointer select-none">
              <input
                type="checkbox"
                value="anime"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles class="w-3.5 h-3.5 text-muted-foreground" /> Anime
                  <span class="text-[9px] bg-primary/10 text-primary border border-primary/20 px-1 py-0.2 rounded font-medium">Video</span>
                </span>
                <span class="text-[11px] text-muted-foreground">Anime series & movies</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Shelf Filter Modes Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Shelf Views</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Choose which views appear above your shelf. Series is always there.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              v-for="mode in availableFilterModes"
              :key="mode.id"
              :class="[
                'flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 transition select-none',
                mode.allowed && !mode.always ? 'cursor-pointer hover:bg-muted/40' : (mode.allowed ? '' : 'opacity-40 cursor-not-allowed')
              ]"
            >
              <input
                type="checkbox"
                :value="mode.id"
                v-model="prefs.enabledGroupingModes"
                :disabled="!mode.allowed || mode.always"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground">{{ mode.label }}</span>
                <span v-if="!mode.allowed" class="text-[10px] text-destructive">Turned off by your administrator</span>
                <span v-else class="text-[11px] text-muted-foreground">{{ mode.desc }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Default Startup View Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Default View on Startup</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Select which media category displays automatically when you log in.</p>
          </div>

          <div class="max-w-xs">
            <select
              v-model="prefs.defaultView"
              class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Media (Default)</option>
              <option value="audiobook">Audiobooks Only</option>
              <option value="manga">Manga Only</option>
              <option value="book">Books Only</option>
            </select>
          </div>
        </div>

        <!-- Save Button -->
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">Changes are saved to your user account profile.</span>
          <button
            @click="savePreferences"
            :disabled="savingPrefs"
            class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <CheckCircle v-if="!savingPrefs" class="w-3.5 h-3.5" />
            <span>{{ savingPrefs ? 'Saving...' : 'Save Preferences' }}</span>
          </button>
        </div>
      </section>

      <!-- TAB 2: STATS -->
      <section v-if="activeTab === 'stats'" class="flex flex-col gap-5">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <BarChart3 class="w-4 h-4 text-muted-foreground" />
            Reading & Listening Activity
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Your personal media consumption, finished titles, and progress tracking</p>
        </div>

        <!-- High-level Personal Stats Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
            <span class="text-xs text-muted-foreground flex items-center gap-1.5">
              <Headphones class="w-3.5 h-3.5" /> Time Listened
            </span>
            <span class="text-xl font-bold font-mono text-foreground">{{ formatListenTime(stats.totalSecondsListened) }}</span>
          </div>

          <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
            <span class="text-xs text-muted-foreground flex items-center gap-1.5">
              <BookOpen class="w-3.5 h-3.5" /> Pages Read
            </span>
            <span class="text-xl font-bold font-mono text-foreground">{{ stats.totalPagesRead || 0 }}</span>
          </div>

          <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
            <span class="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle class="w-3.5 h-3.5 text-emerald-500" /> Finished Titles
            </span>
            <span class="text-xl font-bold font-mono text-foreground">{{ stats.completedCount || 0 }}</span>
          </div>

          <div class="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
            <span class="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock class="w-3.5 h-3.5" /> In Progress
            </span>
            <span class="text-xl font-bold font-mono text-foreground">{{ stats.inProgressCount || 0 }}</span>
          </div>
        </div>

        <!-- Library Items Breakdown (Always shows all 3 categories even if 0) -->
        <div v-if="stats.mediaBreakdown" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Library Items by Category</h3>
            <span class="text-xs text-muted-foreground">All formats supported by Plinthio</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              v-for="cat in stats.mediaBreakdown"
              :key="cat.media_type"
              class="bg-card border border-border rounded-xl p-4 flex flex-col gap-2"
            >
              <div class="flex items-center justify-between text-muted-foreground">
                <span class="text-xs font-semibold text-foreground">{{ mediaTypeLabel(cat.media_type) }}</span>
                <component :is="mediaTypeIcon(cat.media_type)" class="w-4 h-4" />
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-2xl font-bold text-foreground font-mono">{{ cat.count || 0 }}</span>
                <span class="text-xs text-muted-foreground">titles available</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Activity: sign-ins and view/listen/read sessions for this account -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Recent Activity</h3>
            <span class="text-xs text-muted-foreground">Your sign-ins and viewing history</span>
          </div>

          <div class="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            <div v-if="myActivity.length === 0" class="py-8 text-center text-xs text-muted-foreground">
              No activity recorded yet.
            </div>
            <div
              v-for="entry in myActivity"
              :key="`${entry.type}-${entry.id}`"
              class="p-3 flex items-center gap-3"
            >
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                :class="entry.type === 'login' ? (entry.success ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive') : 'bg-muted text-muted-foreground'"
              >
                <LogIn v-if="entry.type === 'login'" class="w-3.5 h-3.5" />
                <component v-else :is="mediaTypeIcon(entry.media_type)" class="w-3.5 h-3.5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs text-foreground truncate">
                  <template v-if="entry.type === 'login'">
                    {{ entry.success ? 'Signed in' : 'Failed sign-in attempt' }}
                  </template>
                  <template v-else>
                    {{ entry.ended_at ? 'Viewed ' : 'Currently viewing ' }}<span class="italic">{{ entry.item_title || 'a deleted item' }}</span>
                  </template>
                </p>
                <p class="text-[11px] text-muted-foreground">
                  {{ formatDateTime(entry.timestamp) }}
                  <span v-if="entry.type === 'view' && entry.duration_seconds"> &bull; {{ formatDurationShort(entry.duration_seconds) }}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 3: HIDDEN ITEMS -->
      <section v-if="activeTab === 'hidden'" class="flex flex-col gap-4">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <EyeOff class="w-4 h-4 text-muted-foreground" />
            Hidden Titles
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Manage and restore titles hidden from your personal library</p>
        </div>

        <div v-if="hiddenItems.length === 0" class="text-center py-12 text-xs text-muted-foreground bg-card border border-dashed border-border rounded-xl">
          No items are currently hidden from your shelves.
        </div>

        <div v-else class="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          <div
            v-for="item in hiddenItems"
            :key="item.id"
            class="p-4 flex items-center justify-between gap-3 hover:bg-muted/20 transition"
          >
            <div class="min-w-0">
              <h4 class="text-xs font-semibold text-foreground truncate">{{ item.title }}</h4>
              <p class="text-[11px] text-muted-foreground truncate">{{ item.author || 'Unknown' }}</p>
            </div>
            <button
              @click="unhideItem(item)"
              class="px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-xs font-medium text-secondary-foreground transition flex items-center gap-1.5 border border-border"
            >
              <Eye class="w-3.5 h-3.5" />
              <span>Unhide</span>
            </button>
          </div>
        </div>
      </section>

      <!-- TAB 4: API KEYS -->
      <section v-if="activeTab === 'apikeys'" class="flex flex-col gap-5">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <Key class="w-4 h-4 text-muted-foreground" />
            Developer API Keys
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Generate personal API keys to authenticate scripts, widgets, and 3rd party apps</p>
        </div>

        <!-- OPDS catalog: comic/ebook reader apps authenticate with an API key, so this
             belongs next to where keys are created rather than off in its own tab. -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">OPDS Catalog</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Add this URL to a comics/ebook reader (Chunky, Panels, KyBook, Moon+ Reader) to browse and read your
              library there. Sign in with your Plinthio username and an API key from below as the password.
            </p>
          </div>
          <div class="flex gap-2">
            <input
              :value="opdsUrl"
              readonly
              class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono text-foreground"
            />
            <button
              @click="copyOpdsUrl"
              class="px-3.5 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition"
            >
              {{ opdsCopied ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <!-- Create Key Form Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Generate New Key</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Include with the <code class="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">X-API-Key</code> HTTP header in requests.
            </p>
          </div>

          <form @submit.prevent="generateKey" class="flex flex-col sm:flex-row gap-2 max-w-md">
            <input
              v-model="newKeyName"
              placeholder="Key label (e.g., Homepage Dashboard, Script)"
              required
              class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition whitespace-nowrap shadow-sm"
            >
              Generate Key
            </button>
          </form>

          <!-- Newly Created Key Alert with Copy Button -->
          <div v-if="newGeneratedKey" class="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 flex flex-col gap-2 mt-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-emerald-400">Key Created! Copy it now (it won't be shown again):</span>
              <button
                @click="copyToClipboard(newGeneratedKey)"
                class="px-2.5 py-1 rounded-md bg-emerald-900/60 text-emerald-200 text-xs flex items-center gap-1 hover:bg-emerald-900 transition"
              >
                <Copy class="w-3 h-3" />
                <span>{{ copied ? 'Copied!' : 'Copy Key' }}</span>
              </button>
            </div>
            <code class="text-xs font-mono bg-black/40 p-2.5 rounded-lg text-emerald-300 break-all select-all">{{ newGeneratedKey }}</code>
          </div>
        </div>

        <!-- Active Keys List Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Active API Keys</h3>

          <div v-if="apiKeys.length === 0" class="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
            No active API keys created yet.
          </div>

          <div v-else class="divide-y divide-border border border-border rounded-lg overflow-hidden">
            <div
              v-for="k in apiKeys"
              :key="k.id"
              class="p-3 flex items-center justify-between text-xs hover:bg-muted/20 transition"
            >
              <div>
                <span class="font-medium text-foreground">{{ k.name }}</span>
                <span class="ml-2 font-mono text-muted-foreground">••••{{ k.last4 }}</span>
                <span class="ml-3 text-[10px] text-muted-foreground font-mono">{{ formatDate(k.created_at) }}</span>
              </div>
              <button aria-label="Revoke key"
                @click="deleteKey(k)"
                class="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded transition"
                title="Revoke key"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 5: ACCOUNT & SECURITY -->
      <section v-if="activeTab === 'account'" class="flex flex-col gap-5">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <Lock class="w-4 h-4 text-muted-foreground" />
            Account & Security
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Manage your credentials and view account information</p>
        </div>

        <!-- Profile Details Card with Avatar Management -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Profile Overview</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Customize your profile photo and view account credentials.</p>
          </div>

          <!-- Avatar Section -->
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 py-1">
            <div class="relative flex-shrink-0">
              <img
                v-if="authStore.user?.avatar && !avatarLoadError"
                :src="authStore.user.avatar"
                :alt="authStore.user?.username || 'Avatar'"
                class="w-20 h-20 rounded-full object-cover ring-2 ring-border shadow-sm"
                @error="avatarLoadError = true"
              />
              <div
                v-else
                class="w-20 h-20 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-bold uppercase ring-2 ring-border/50 select-none"
              >
                {{ (authStore.user?.username || '?').slice(0, 2) }}
              </div>
            </div>

            <div class="flex flex-col gap-2 flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  ref="avatarFileInput"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  class="hidden"
                  @change="handleAvatarFileSelected"
                />
                <button
                  type="button"
                  @click="triggerAvatarUpload"
                  :disabled="uploadingAvatar"
                  class="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Upload class="w-3.5 h-3.5" />
                  <span>{{ uploadingAvatar ? 'Uploading...' : 'Upload Avatar' }}</span>
                </button>
                <button
                  v-if="authStore.user?.avatar"
                  type="button"
                  @click="removeAvatar"
                  :disabled="removingAvatar"
                  class="px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                  <span>{{ removingAvatar ? 'Removing...' : 'Remove' }}</span>
                </button>
              </div>
              <p class="text-[11px] text-muted-foreground">
                Supports JPG, PNG, or WebP up to 5MB. Automatically cropped to a square.
              </p>
              <div v-if="avatarSuccess" class="text-xs text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle class="w-3.5 h-3.5" /> {{ avatarSuccess }}
              </div>
              <div v-if="avatarError" class="text-xs text-destructive font-medium flex items-center gap-1">
                <AlertCircle class="w-3.5 h-3.5" /> {{ avatarError }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-border">
            <div class="flex flex-col gap-0.5">
              <span class="text-muted-foreground">Username</span>
              <span class="font-semibold text-foreground font-mono">{{ authStore.user?.username }}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-muted-foreground">Role Privilege</span>
              <span class="font-semibold text-foreground capitalize">{{ authStore.user?.role || 'viewer' }}</span>
            </div>
          </div>
        </div>

        <!-- Admin pointer: server-wide branding/theme/CSS now lives in Admin, not here -->
        <router-link
          v-if="authStore.isAdmin"
          to="/admin?tab=settings"
          class="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3 hover:border-primary/40 hover:bg-muted/20 transition group"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <Palette class="w-4 h-4" />
            </div>
            <div class="min-w-0">
              <h3 class="text-xs font-semibold text-foreground">Server branding, theme & custom CSS</h3>
              <p class="text-[11px] text-muted-foreground">These are server-wide, so they now live in Admin → Server Config.</p>
            </div>
          </div>
          <ExternalLink class="w-4 h-4 text-muted-foreground group-hover:text-primary transition flex-shrink-0" />
        </router-link>

        <!-- Password Change Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Change Password</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Update your password to keep your Plinthio account secure.</p>
          </div>

          <form @submit.prevent="changePassword" class="flex flex-col gap-3 max-w-sm">
            <div>
              <label class="block text-xs font-medium text-foreground mb-1">Current Password</label>
              <input
                v-model="passwords.current"
                type="password"
                required
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-foreground mb-1">New Password</label>
              <input
                v-model="passwords.new"
                type="password"
                required
                minlength="8"
                class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p class="text-[11px] text-muted-foreground mt-1">Must be at least 8 characters long</p>
            </div>

            <button
              type="submit"
              class="self-start mt-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm"
            >
              Update Password
            </button>
          </form>
        </div>

        <!-- Active Sessions Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Sessions</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Signing in stores a token on that device. This revokes every one of them immediately — including
              this browser — so use it if you've signed in somewhere you no longer control.
            </p>
          </div>

          <button
            @click="signOutEverywhere"
            :disabled="signingOutEverywhere"
            class="self-start px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs font-medium transition shadow-sm disabled:opacity-50"
          >
            {{ signingOutEverywhere ? 'Signing out...' : 'Sign out of all devices' }}
          </button>
        </div>
      </section>

    </main>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useCustomizationStore } from '../stores/customization';
import Sidebar from '../components/Sidebar.vue';
import { ALL_MEDIA_TYPES } from '../constants/media';
import { SHELF_MODES, normalizeShelfModes, userShelfModes } from '../utils/shelfModes';
import { useDialogStore } from '../stores/dialog';
import {
  ArrowLeft,
  Sliders,
  BarChart3,
  EyeOff,
  Key,
  Lock,
  Headphones,
  BookOpen,
  FileImage,
  Book,
  CheckCircle,
  AlertCircle,
  Clock,
  Copy,
  Trash2,
  Eye,
  Palette,
  Tv,
  Film,
  Sparkles,
  ExternalLink,
  LogIn,
  Upload
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const customizationStore = useCustomizationStore();
// Global nav layout (topnav vs sidebar) is a server-wide admin setting; these pages keep
// their own header either way, so the sidebar just sits alongside it.
const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}

const authStore = useAuthStore();
const dialog = useDialogStore();

const activeTab = ref(route.query.tab || 'preferences');

function switchTab(tab) {
  activeTab.value = tab;
  router.replace({ query: { ...route.query, tab } });
}

const MEDIA_TYPE_LABELS = {
  audiobook: 'Audiobooks',
  manga: 'Manga & Comics',
  book: 'Books',
  movie: 'Movies',
  show: 'TV Shows',
  anime: 'Anime'
};

const MEDIA_TYPE_ICONS = {
  audiobook: Headphones,
  manga: FileImage,
  book: Book,
  movie: Film,
  show: Tv,
  anime: Sparkles
};

function mediaTypeLabel(type) {
  return MEDIA_TYPE_LABELS[type] || type;
}

function mediaTypeIcon(type) {
  return MEDIA_TYPE_ICONS[type] || Book;
}

const stats = ref({});
const myActivity = ref([]);
const prefs = ref({
  enabledMediaTypes: ALL_MEDIA_TYPES,
  enabledGroupingModes: [...SHELF_MODES],
  defaultView: 'all'
});
const savingPrefs = ref(false);

const allowedFilters = ref([...SHELF_MODES]);

const allFilterModes = [
  { id: 'series', label: 'Series', desc: 'One card per series; open it to see every volume or episode.', always: true },
  { id: 'creator', label: 'Creator', desc: 'Grouped by author, director or studio.' },
  { id: 'disk_folder', label: 'Disk Folders', desc: 'Mirror the folders on the server.' },
  { id: 'custom_folder', label: 'Custom Folders', desc: 'Your own in-app folders, with an Unorganized catch-all.' }
];

const availableFilterModes = computed(() => {
  const serverModes = normalizeShelfModes(allowedFilters.value);
  return allFilterModes.map(m => ({
    ...m,
    allowed: serverModes.includes(m.id)
  }));
});

const hiddenItems = ref([]);
const apiKeys = ref([]);

const opdsUrl = `${window.location.origin}/api/opds`;
const opdsCopied = ref(false);

async function copyOpdsUrl() {
  try {
    await navigator.clipboard.writeText(opdsUrl);
    opdsCopied.value = true;
    setTimeout(() => { opdsCopied.value = false; }, 2000);
  } catch (err) {
    console.warn('Could not copy OPDS URL:', err);
  }
}
const newKeyName = ref('');
const newGeneratedKey = ref('');
const copied = ref(false);

const passwords = ref({ current: '', new: '' });

function formatListenTime(sec) {
  if (!sec) return '0h 0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// SQLite's CURRENT_TIMESTAMP is UTC but stored without a timezone marker
// ("YYYY-MM-DD HH:MM:SS"), which the JS Date constructor otherwise misreads as local time.
function formatDateTime(value) {
  if (!value) return '';
  const iso = value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDurationShort(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = (seconds / 3600).toFixed(1);
  return `${hrs}h`;
}

async function loadData() {
  try {
    const [statsRes, hiddenRes, keysRes, filtersRes, activityRes] = await Promise.all([
      api.get('/stats/me'),
      api.get('/items/hidden'),
      api.get('/keys'),
      api.get('/settings/filters'),
      api.get('/activity/me', { params: { limit: 25 } })
    ]);
    stats.value = statsRes.data.stats || {};
    hiddenItems.value = hiddenRes.data.hiddenItems || [];
    apiKeys.value = keysRes.data.keys || [];
    myActivity.value = activityRes.data.activity || [];

    if (filtersRes.data.allowedGroupingModes) {
      allowedFilters.value = filtersRes.data.allowedGroupingModes;
    }

    if (authStore.user?.preferences) {
      prefs.value = {
        enabledMediaTypes: authStore.user.preferences.enabledMediaTypes || ALL_MEDIA_TYPES,
        enabledGroupingModes: userShelfModes(authStore.user.preferences.enabledGroupingModes),
        defaultView: authStore.user.preferences.defaultView || 'all'
      };
    }
  } catch (err) {
    console.error('Failed to load user settings data:', err);
  }
}

async function savePreferences() {
  // Series can't be switched off (the checkbox is locked on), so there's always a view.
  prefs.value.enabledGroupingModes = [...new Set(['series', ...(prefs.value.enabledGroupingModes || [])])];
  if (!prefs.value.enabledMediaTypes || prefs.value.enabledMediaTypes.length === 0) {
    dialog.alert('Please enable at least one media category.');
    return;
  }
  savingPrefs.value = true;
  try {
    // Cache what the server actually stored (the merge of these three keys into the rest),
    // not just the keys this screen owns — overwriting the local copy with `prefs.value`
    // would drop `onboardingComplete` and pop the onboarding flow open on the spot.
    const { data } = await api.patch('/users/preferences', prefs.value);
    if (authStore.user) {
      authStore.user.preferences = data.preferences || { ...authStore.user.preferences, ...prefs.value };
      localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
    }
    dialog.alert('Preferences saved successfully');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save preferences');
  } finally {
    savingPrefs.value = false;
  }
}

async function unhideItem(item) {
  try {
    await api.post(`/items/${item.id}/unhide`);
    hiddenItems.value = hiddenItems.value.filter(i => i.id !== item.id);
  } catch (err) {
    dialog.alert('Failed to unhide item');
  }
}

async function generateKey() {
  try {
    const res = await api.post('/keys', { name: newKeyName.value });
    newGeneratedKey.value = res.data.key.key;
    newKeyName.value = '';
    const keysRes = await api.get('/keys');
    apiKeys.value = keysRes.data.keys || [];
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to generate key');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => copied.value = false, 2000);
}

async function deleteKey(key) {
  const confirmed = await dialog.confirm({
    title: 'Revoke API Key',
    message: `Are you sure you want to revoke key "${key.name}"? Any external clients using it will lose access immediately.`,
    confirmText: 'Revoke Key',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete(`/keys/${key.id}`);
    apiKeys.value = apiKeys.value.filter(k => k.id !== key.id);
  } catch (err) {
    dialog.alert('Failed to delete key');
  }
}

const signingOutEverywhere = ref(false);

async function signOutEverywhere() {
  const confirmed = await dialog.confirm({
    title: 'Sign out everywhere',
    message: 'Every device signed in to this account will be signed out immediately, including this one.',
    confirmText: 'Sign out everywhere',
    danger: true
  });
  if (!confirmed) return;

  signingOutEverywhere.value = true;
  try {
    await authStore.signOutEverywhere();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to sign out of all devices');
    signingOutEverywhere.value = false;
  }
}

async function changePassword() {
  try {
    await api.patch('/users/password', {
      currentPassword: passwords.value.current,
      newPassword: passwords.value.new
    });
    passwords.value = { current: '', new: '' };
    // Changing the password invalidates every previously-issued token, including the one
    // this tab is using — log out immediately so the user re-authenticates with the new
    // password instead of hitting a confusing "session expired" on their next click.
    await dialog.alert('Password updated. Please log in again with your new password.');
    authStore.logout();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to change password');
  }
}

// Avatar Management
const avatarFileInput = ref(null);
const uploadingAvatar = ref(false);
const removingAvatar = ref(false);
const avatarSuccess = ref('');
const avatarError = ref('');
const avatarLoadError = ref(false);

watch(() => authStore.user?.avatar, () => {
  avatarLoadError.value = false;
});

function triggerAvatarUpload() {
  avatarSuccess.value = '';
  avatarError.value = '';
  avatarFileInput.value?.click();
}

async function handleAvatarFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Please select a valid image file (PNG, JPG, WebP)';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    avatarError.value = 'Avatar image must be smaller than 5MB';
    return;
  }

  uploadingAvatar.value = true;
  avatarError.value = '';
  avatarSuccess.value = '';
  try {
    await authStore.uploadAvatar(file);
    avatarSuccess.value = 'Avatar updated successfully!';
    setTimeout(() => { avatarSuccess.value = ''; }, 4000);
  } catch (err) {
    avatarError.value = err.response?.data?.error || 'Failed to upload avatar';
  } finally {
    uploadingAvatar.value = false;
    if (avatarFileInput.value) avatarFileInput.value.value = '';
  }
}

async function removeAvatar() {
  const confirmed = await dialog.confirm({
    title: 'Remove Avatar',
    message: 'Are you sure you want to remove your profile photo? Your account will display your initials instead.',
    confirmText: 'Remove',
    danger: true
  });
  if (!confirmed) return;

  removingAvatar.value = true;
  avatarError.value = '';
  avatarSuccess.value = '';
  try {
    await authStore.removeAvatar();
    avatarSuccess.value = 'Avatar removed';
    setTimeout(() => { avatarSuccess.value = ''; }, 3000);
  } catch (err) {
    avatarError.value = err.response?.data?.error || 'Failed to remove avatar';
  } finally {
    removingAvatar.value = false;
  }
}

onMounted(() => {
  loadData();
});
</script>
