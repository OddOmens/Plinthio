<template>
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <!-- Primary navigation: sidebar layout keeps global nav present on this page too -->
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0 pb-24">
    <!-- Settings Header (Matching AdminView header) -->
    <header class="bg-background/95 backdrop-blur-xl border-b border-border sticky top-0 z-30 safe-top transition-colors">
      <div class="page-width mx-auto px-4 sm:px-6 lg:px-8 h-[60px] flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
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
            <span class="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground hidden sm:inline">
              {{ authStore.user?.username }}
            </span>
          </div>
        </div>

        <!-- Settings Navigation Tabs (Matching AdminView tabs styling) -->
        <nav class="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs flex-shrink-0">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="switchTab(tab.id)"
            :title="tab.label"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === tab.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <component :is="tab.icon" class="w-4 h-4" />
            <span class="hidden sm:inline">{{ tab.label }}</span>
          </button>
        </nav>
      </div>
    </header>

    <main class="page-width mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 flex flex-col gap-6">
      <!-- TAB: APPEARANCE (your own look, where the admin allows it) -->
      <section v-if="activeTab === 'appearance'" class="flex flex-col gap-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <Palette class="w-4 h-4 text-muted-foreground" />
              Appearance
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">How Plinthio looks for you. Changes show in the preview and save straight away; they only affect your account.</p>
          </div>
          <router-link
            v-if="authStore.isAdmin"
            to="/admin?tab=settings"
            class="text-xs text-primary hover:underline flex items-center gap-1 font-medium flex-shrink-0"
          >
            <span>Server defaults &amp; branding in Admin</span>
            <ExternalLink class="w-3.5 h-3.5" />
          </router-link>
        </div>

        <div v-if="!personalizationOn" class="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
          <Lock class="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p class="text-xs text-muted-foreground leading-relaxed">
            Your admin sets how Plinthio looks on this server, so these can't be changed here. The preview shows what everyone sees.
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-5 items-start">
          <div class="order-2 lg:order-1 flex flex-col gap-5 min-w-0">
            <div
              v-for="card in appearanceCards"
              :key="card.field"
              class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4"
              @focusin="previewView = card.preview"
              @click="previewView = card.preview"
            >
              <div class="border-b border-border pb-3 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">{{ card.title }}</h3>
                  <p class="text-xs text-muted-foreground mt-0.5">{{ card.desc }}</p>
                </div>
                <span v-if="!card.allowed" class="text-[11px] text-muted-foreground font-medium flex-shrink-0 flex items-center gap-1 px-2 h-6 rounded-md bg-muted">
                  <Lock class="w-3 h-3" /> Set by your admin
                </span>
              </div>
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
            </div>
          </div>
          <div class="order-1 lg:order-2 lg:sticky lg:top-[76px] min-w-0">
            <CustomizationPreview v-model:view="previewView" :settings="previewSettings" :only="['shelf', 'pause']" />
          </div>
        </div>
      </section>

      <!-- TAB: SHELVES (what's on your shelves; saves as you go) -->
      <section v-if="activeTab === 'preferences'" class="flex flex-col gap-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <LayoutGrid class="w-4 h-4 text-muted-foreground" />
              Shelves
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">What shows on your shelves and where you start. Saves as you go.</p>
          </div>
          <span v-if="prefsStatus" class="text-[12px] font-medium flex-shrink-0 flex items-center gap-1" :class="prefsStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'">
            <Loader2 v-if="prefsStatus === 'saving'" class="w-3 h-3 animate-spin" />
            <CheckCircle v-else-if="prefsStatus === 'saved'" class="w-3 h-3 text-emerald-500" />
            {{ { saving: 'Saving…', saved: 'Saved', error: 'Couldn\'t save' }[prefsStatus] }}
          </span>
        </div>

        <!-- Visible Media Categories Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Media Categories</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Which kinds of media appear on your shelves. Keep at least one.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <label
              v-for="cat in mediaCategories"
              :key="cat.id"
              :class="[
                'flex items-start gap-3 p-3.5 rounded-xl border transition cursor-pointer select-none',
                prefs.enabledMediaTypes.includes(cat.id) ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border hover:bg-muted/20'
              ]"
            >
              <input
                type="checkbox"
                :value="cat.id"
                v-model="prefs.enabledMediaTypes"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <component :is="cat.icon" class="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-foreground">{{ cat.label }}</span>
                <span class="text-[12px] text-muted-foreground">{{ cat.desc }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Shelf Filter Modes Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Shelf Views</h3>
            <p class="text-xs text-muted-foreground mt-0.5">The views above your shelf. Every view shows one card per series; Alphabetical is always there.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              v-for="mode in availableFilterModes"
              :key="mode.id"
              :class="[
                'flex items-start gap-3 p-3.5 rounded-xl border transition select-none',
                prefs.enabledGroupingModes.includes(mode.id) && mode.allowed ? 'border-primary ring-2 ring-primary/20 bg-muted/40' : 'border-border',
                mode.allowed && !mode.always ? 'cursor-pointer hover:bg-muted/20' : (mode.allowed ? '' : 'opacity-50 cursor-not-allowed')
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
                <span v-if="!mode.allowed" class="text-[12px] text-muted-foreground flex items-center gap-1"><Lock class="w-3 h-3" /> Turned off by your admin</span>
                <span v-else class="text-[12px] text-muted-foreground">{{ mode.always ? 'Always on. ' : '' }}{{ mode.desc }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Default Startup View Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Start On</h3>
            <p class="text-xs text-muted-foreground mt-0.5">The shelf Plinthio opens to.</p>
          </div>
          <OptionTiles
            label="Start on"
            :options="startupOptions"
            v-model="prefs.defaultView"
            grid-class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5"
          />
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
                <p class="text-[12px] text-muted-foreground">
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
              <p class="text-[12px] text-muted-foreground truncate">{{ item.author || 'Unknown' }}</p>
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

        <!-- Reading apps: they all sign in with an API key, so they live next to where keys
             are made. -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Reading Apps</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Read your comics, manga, PDFs and books in other apps. Each one signs in with your Plinthio username
              (<span class="font-mono">{{ authStore.user?.username }}</span>) and an API key from below as the password — make one key per app,
              so you can sign one out by deleting its key.
            </p>
          </div>
          <div v-for="app in readingApps" :key="app.id" class="flex flex-col gap-1.5">
            <p class="text-xs font-semibold text-foreground">{{ app.name }}</p>
            <p class="text-[12px] text-muted-foreground">{{ app.how }}</p>
            <div class="flex gap-2">
              <input
                :value="app.url"
                readonly
                :aria-label="`${app.name} address`"
                class="flex-1 min-w-0 bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono text-foreground"
              />
              <button
                @click="copyAppUrl(app)"
                class="px-3.5 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition"
              >
                {{ copiedApp === app.id ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Create Key Form Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Generate New Key</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Include with the <code class="font-mono text-[12px] bg-muted px-1 py-0.5 rounded">X-API-Key</code> HTTP header in requests.
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
                <span class="ml-3 text-[11px] text-muted-foreground font-mono">{{ formatDate(k.created_at) }}</span>
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
              <p class="text-[12px] text-muted-foreground">
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
              <p class="text-[12px] text-muted-foreground mt-1">Must be at least 8 characters long</p>
            </div>

            <button
              type="submit"
              class="self-start mt-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm"
            >
              Update Password
            </button>
          </form>
        </div>

        <!-- Two-factor Card -->
        <div id="two-factor" class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 scroll-mt-24">
          <div class="border-b border-border pb-2">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Two-Factor Sign-In</h3>
            <p class="text-xs text-muted-foreground mt-0.5">A code from your phone as well as your password. Optional, and worth it if you use Plinthio away from home.</p>
          </div>
          <TwoFactorSetup />
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
import TwoFactorSetup from '../components/TwoFactorSetup.vue';
import OptionTiles from '../components/OptionTiles.vue';
import CustomizationPreview from '../components/CustomizationPreview.vue';
import { ACCENT_OPTIONS, LAYOUT_OPTIONS, PAGE_WIDTH_OPTIONS, PAUSE_SCREEN_OPTIONS, optionLabel } from '../constants/appearance';
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
  Upload,
  Server,
  LayoutGrid,
  Loader2
} from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const customizationStore = useCustomizationStore();
// Global nav layout (topnav vs sidebar) respects user preference when allowed, falling back to server default.
const isSidebarLayout = computed(() => customizationStore.effectiveLayoutMode(authStore.user) === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}

const authStore = useAuthStore();
const dialog = useDialogStore();

// 'preferences' is the Shelves tab (the id older links use).
const tabs = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'preferences', label: 'Shelves', icon: LayoutGrid },
  { id: 'stats', label: 'My Activity', icon: BarChart3 },
  { id: 'hidden', label: 'Hidden', icon: EyeOff },
  { id: 'apikeys', label: 'API Keys', icon: Key },
  { id: 'account', label: 'Security', icon: Lock }
];
const activeTab = ref(tabs.some((t) => t.id === route.query.tab) ? route.query.tab : 'appearance');

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

const mediaCategories = [
  { id: 'movie', label: 'Movies', desc: 'Feature films', icon: Film },
  { id: 'show', label: 'TV Shows', desc: 'Series and episodes', icon: Tv },
  { id: 'anime', label: 'Anime', desc: 'Anime series and films', icon: Sparkles },
  { id: 'book', label: 'Books', desc: 'EPUB, PDF and text', icon: Book },
  { id: 'manga', label: 'Manga & Comics', desc: 'CBZ, CBR and graphic novels', icon: FileImage },
  { id: 'audiobook', label: 'Audiobooks', desc: 'Spoken word and audio dramas', icon: Headphones }
];
// "All" plus each category that's switched on.
const startupOptions = computed(() => [
  { id: 'all', label: 'All media', icon: LayoutGrid },
  ...mediaCategories.filter((c) => prefs.value.enabledMediaTypes.includes(c.id)).map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
]);

const allowedFilters = ref([...SHELF_MODES]);

const allFilterModes = [
  { id: 'series', label: 'Alphabetical', desc: 'Every series and title A–Z; open one to see its volumes or episodes.', always: true },
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

const origin = window.location.origin;
const readingApps = [
  {
    id: 'mihon',
    name: 'Mihon (Android)',
    how: 'Install the Komga extension, open its settings and enter this address, your username and an API key as the password. Then, in Mihon\'s Settings → Tracking, turn on Komga so what you read in Mihon marks it read here.',
    url: origin
  },
  {
    id: 'koreader',
    name: 'KOReader (Kobo, Kindle, PocketBook, Android)',
    how: 'Open a book, then Tools → Progress sync → Custom sync server: enter this address. Choose Login (not Register) with your username and an API key as the password. Your place in PDFs and comics syncs both ways; EPUB positions sync between KOReader devices, and Plinthio shows how far through you are. Keys made before Plinthio 1.0 don\'t work here — make a new one.',
    url: `${origin}/api/kosync`
  },
  {
    id: 'opds',
    name: 'OPDS readers (Chunky, Panels, KyBook, Moon+ Reader)',
    how: 'Add this as an OPDS catalog, with your username and an API key as the password.',
    url: `${origin}/api/opds`
  }
];
const copiedApp = ref('');

async function copyAppUrl(app) {
  try {
    await navigator.clipboard.writeText(app.url);
    copiedApp.value = app.id;
    setTimeout(() => { copiedApp.value = ''; }, 2000);
  } catch (err) {
    console.warn('Could not copy address:', err);
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
    savedPrefs = JSON.stringify(prefs.value);
  } catch (err) {
    console.error('Failed to load user settings data:', err);
  }
}

// Appearance: each setting is the person's own when the admin allows it, otherwise the
// server's (shown, locked). `null` means "use the server default".
const personalizationOn = computed(() => customizationStore.userCustomization?.enabled !== false);
const previewView = ref('shelf');
const hoverPreview = ref({});

const appearanceCards = computed(() => {
  const prefsNow = authStore.user?.preferences || {};
  const serverAccent = ACCENT_OPTIONS.find((a) => a.id === (customizationStore.accentTheme || 'zinc'));
  const cards = [
    {
      field: 'accentTheme', key: 'accentColor', title: 'Accent Color', preview: 'shelf',
      desc: 'Your highlight colour on buttons, badges and the current tab.',
      serverValue: customizationStore.accentTheme || 'zinc',
      options: [{ id: null, label: 'Server default', swatch: 'bg-muted', defaultSwatch: serverAccent?.swatch }, ...ACCENT_OPTIONS],
      swatches: true, grid: 'grid grid-cols-3 sm:grid-cols-9 lg:grid-cols-3 2xl:grid-cols-9 gap-2.5'
    },
    {
      field: 'layoutMode', key: 'layoutMode', title: 'Navigation Layout', preview: 'shelf',
      desc: 'Where the main navigation sits.',
      serverValue: customizationStore.layoutMode || 'topnav',
      options: LAYOUT_OPTIONS
    },
    {
      field: 'pageWidth', key: 'pageWidth', title: 'Page Width', preview: 'shelf',
      desc: 'How wide pages get on a big screen. Full width fits more posters in a row.',
      serverValue: customizationStore.pageWidth || 'full',
      options: PAGE_WIDTH_OPTIONS
    },
    {
      field: 'pauseScreen', key: 'pauseScreen', title: 'Pause Screen', preview: 'pause',
      desc: 'What appears after a couple of seconds paused on a movie or episode.',
      serverValue: customizationStore.pauseScreen || 'details',
      options: PAUSE_SCREEN_OPTIONS
    }
  ];
  return cards.map((card) => {
    const options = card.field === 'accentTheme'
      ? card.options
      : [{ id: null, label: 'Server default', desc: `Currently ${optionLabel(card.options, card.serverValue)}`, icon: Server }, ...card.options];
    return {
      ...card,
      options,
      allowed: customizationStore.isCustomizationAllowed(card.key),
      value: prefsNow[card.field] || null
    };
  });
});

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
    pauseScreen: pick('pauseScreen', customizationStore.effectivePauseScreen(user))
  };
});

function hoverAppearance(card, id) {
  if (!card.allowed || card.field === 'pageWidth') return;
  // Hovering "Server default" previews the server's value.
  const value = id === undefined ? undefined : (id ?? card.serverValue);
  hoverPreview.value = { ...hoverPreview.value, [card.field]: value };
  if (value !== undefined) previewView.value = card.preview;
}

async function setPersonal(field, value) {
  if (!authStore.user) return;
  const previous = authStore.user.preferences || {};
  authStore.user.preferences = { ...previous, [field]: value };
  try {
    const { data } = await api.patch('/users/preferences', { [field]: value });
    authStore.user.preferences = data.preferences || authStore.user.preferences;
    localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
  } catch (err) {
    authStore.user.preferences = previous;
    dialog.alert(err.response?.data?.error || 'Could not save that setting');
  }
}

// Shelves save a moment after each change.
const prefsStatus = ref('');
let savedPrefs = '';
let prefsTimer = null;
watch(prefs, (value) => {
  if (!value.enabledMediaTypes?.length) {
    // Keep at least one category: undo the last untick.
    prefs.value.enabledMediaTypes = JSON.parse(savedPrefs || '{}').enabledMediaTypes || ALL_MEDIA_TYPES;
    return;
  }
  if (value.defaultView !== 'all' && !value.enabledMediaTypes.includes(value.defaultView)) {
    prefs.value.defaultView = 'all';
    return;
  }
  if (JSON.stringify(value) === savedPrefs) return;
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(savePreferences, 400);
}, { deep: true });

async function savePreferences() {
  // Series can't be switched off (the checkbox is locked on), so there's always a view.
  const body = {
    ...prefs.value,
    enabledGroupingModes: [...new Set(['series', ...(prefs.value.enabledGroupingModes || [])])]
  };
  prefsStatus.value = 'saving';
  try {
    // Cache what the server actually stored (the merge of these keys into the rest), not
    // just the keys this screen owns — overwriting the local copy with `prefs.value` would
    // drop `onboardingComplete` and pop the onboarding flow open on the spot.
    const { data } = await api.patch('/users/preferences', body);
    if (authStore.user) {
      authStore.user.preferences = data.preferences || { ...authStore.user.preferences, ...body };
      localStorage.setItem('plinthio_user', JSON.stringify(authStore.user));
    }
    savedPrefs = JSON.stringify(prefs.value);
    prefsStatus.value = 'saved';
  } catch (err) {
    prefsStatus.value = 'error';
    dialog.alert(err.response?.data?.error || 'Failed to save preferences');
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
