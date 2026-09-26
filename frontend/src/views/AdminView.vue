<template>
  <div class="min-h-screen bg-background text-foreground transition-colors" :class="isSidebarLayout ? 'flex flex-col md:flex-row' : 'flex flex-col'">
    <!-- Primary navigation: sidebar layout keeps global nav present on this page too -->
    <Sidebar v-if="isSidebarLayout" activeType="all" @filter-type="goToShelf" />
    <div class="flex-1 flex flex-col min-w-0 pb-24">
    <!-- Admin Header -->
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
          <div>
            <h1 class="text-sm font-semibold text-foreground tracking-tight truncate">Admin</h1>
          </div>
        </div>

        <!-- Admin Tabs -->
        <nav class="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs flex-shrink-0">
          <button
            @click="activeTab = 'libraries'"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'libraries'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Folder class="w-4 h-4" />
            <span class="hidden sm:inline">Libraries</span>
          </button>
          <button
            @click="switchTab('health')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'health'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
            title="Library Health"
          >
            <HeartPulse class="w-4 h-4" />
            <span class="hidden sm:inline">Health</span>
          </button>
          <button
            @click="switchTab('metadata')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'metadata'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Sparkles class="w-4 h-4 text-primary" />
            <span class="hidden sm:inline">Metadata</span>
          </button>
          <button
            @click="switchTab('users')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'users'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Users class="w-4 h-4" />
            <span class="hidden sm:inline">Users</span>
          </button>
          <button
            @click="switchTab('logs')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'logs'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Terminal class="w-4 h-4" />
            <span class="hidden sm:inline">Logs</span>
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
            <span class="hidden sm:inline">Server Stats</span>
          </button>
          <button
            @click="switchTab('activity')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'activity'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <History class="w-4 h-4" />
            <span class="hidden sm:inline">Activity</span>
          </button>
          <button
            @click="switchTab('settings')"
            :class="[
              'h-9 min-w-[36px] sm:min-w-0 px-2.5 sm:px-3 rounded-lg font-medium transition flex items-center justify-center gap-1.5 active:scale-95',
              activeTab === 'settings'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            ]"
          >
            <Sliders class="w-4 h-4" />
            <span class="hidden sm:inline">Server Config</span>
          </button>
        </nav>
      </div>
    </header>

    <main class="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 flex flex-col gap-6">
      <!-- TAB 1: LIBRARIES -->
      <section v-if="activeTab === 'libraries'" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <Folder class="w-4 h-4 text-muted-foreground" />
              Media Libraries
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">Manage and scan your media folders mapped into Plinthio</p>
          </div>
          <button
            @click="openAddLibraryModal"
            class="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus class="w-3.5 h-3.5" />
            Add Library
          </button>
        </div>

        <!-- Library List -->
        <div class="grid grid-cols-1 gap-2.5">
          <div
            v-for="lib in libraries"
            :key="lib.id"
            class="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center flex-shrink-0">
                <Headphones v-if="lib.type === 'audiobooks'" class="w-5 h-5 text-muted-foreground" />
                <FileImage v-else-if="lib.type === 'manga'" class="w-5 h-5 text-muted-foreground" />
                <Book v-else class="w-5 h-5 text-muted-foreground" />
              </div>
              <div class="min-w-0">
                <h3 class="text-xs font-semibold text-foreground truncate">{{ lib.name }}</h3>
                <p class="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{{ lib.path }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {{ lib.type }}
                  </span>
                  <span class="text-[11px] text-muted-foreground">
                    {{ lib.item_count || 0 }} items
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                @click="triggerScan(lib)"
                :disabled="scanningId === lib.id"
                class="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50 border border-border"
              >
                <RefreshCw :class="['w-3.5 h-3.5', scanningId === lib.id ? 'animate-spin' : '']" />
                <span>{{ scanningId === lib.id ? 'Scanning...' : 'Scan Now' }}</span>
              </button>
              <button aria-label="Delete Library"
                @click="deleteLibrary(lib)"
                class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition"
                title="Delete Library"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div v-if="libraries.length === 0" class="text-center py-12 text-xs text-muted-foreground bg-card border border-dashed border-border rounded-xl">
            No media libraries configured yet. Click "Add Library" to point Plinthio at your media folders.
          </div>
        </div>
      </section>

      <!-- TAB: METADATA & TITLE CLEANUP -->
      <section v-if="activeTab === 'health'">
        <LibraryHealth @open-metadata="switchTab('metadata')" />
      </section>

      <section v-if="activeTab === 'metadata'">
        <AdminMetadataManager :libraries="libraries" />
      </section>

      <!-- TAB 2: USERS -->
      <section v-if="activeTab === 'users'" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <Users class="w-4 h-4 text-muted-foreground" />
              User Accounts
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">Manage user access and privileges</p>
          </div>
          <button
            @click="showAddUserModal = true"
            class="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus class="w-3.5 h-3.5" />
            Add User
          </button>
        </div>

        <!-- Role Legend -->
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 border border-border">
            <ShieldCheck class="w-3 h-3 text-primary" /> <strong class="text-foreground">Admin</strong> — full control (libraries, users, server settings)
          </span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 border border-border">
            <PenSquare class="w-3 h-3 text-amber-500" /> <strong class="text-foreground">Editor</strong> — can edit shared metadata (title, author, covers, etc.)
          </span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 border border-border">
            <EyeIcon class="w-3 h-3" /> <strong class="text-foreground">Viewer</strong> — can browse, read/listen, and track their own progress only
          </span>
        </div>

        <div class="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          <div
            v-for="u in users"
            :key="u.id"
            class="p-3.5 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <img
                v-if="u.avatar"
                :src="u.avatar"
                :alt="u.username"
                class="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0"
                @error="u.avatar = null"
              />
              <div
                v-else
                class="w-8 h-8 rounded-full bg-muted text-foreground flex items-center justify-center font-semibold text-xs border border-border flex-shrink-0 select-none"
              >
                {{ u.username.slice(0, 1).toUpperCase() }}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold text-foreground truncate">{{ u.username }}</span>
                  <span v-if="u.id === authStore.user?.id" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
                    You
                  </span>
                </div>
                <span class="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <span>Joined {{ formatDate(u.created_at) }}</span>
                  <span class="text-muted-foreground/50">&bull;</span>
                  <span class="flex items-center gap-1">
                    <Clock class="w-3 h-3" />
                    {{ u.last_login_at ? `Last sign-in ${formatDateTime(u.last_login_at)}` : 'Never signed in' }}
                  </span>
                  <template v-if="u.expires_at">
                    <span class="text-muted-foreground/50">&bull;</span>
                    <span
                      :class="[
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium',
                        isUserExpired(u) ? 'bg-destructive/15 text-destructive font-semibold' :
                        isUserExpiringSoon(u) ? 'bg-amber-500/15 text-amber-500 font-semibold' :
                        'bg-emerald-500/15 text-emerald-500'
                      ]"
                      :title="`Expires: ${new Date(u.expires_at).toLocaleString()}`"
                    >
                      <Lock v-if="isUserExpired(u)" class="w-2.5 h-2.5" />
                      <Hourglass v-else class="w-2.5 h-2.5" />
                      <span>{{ getUserExpirationLabel(u) }}</span>
                    </span>
                  </template>
                  <template v-if="u.max_age_rating">
                    <span class="text-muted-foreground/50">&bull;</span>
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-500"
                      :title="u.allow_unrated === 0 ? 'Unrated titles are hidden too' : 'Unrated titles are allowed'"
                    >
                      <ShieldCheck class="w-2.5 h-2.5" />
                      Up to {{ u.max_age_rating }}
                    </span>
                  </template>
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-shrink-0">
              <select
                v-if="u.id !== authStore.user?.id"
                :value="u.role"
                @change="changeUserRole(u, $event.target.value)"
                :class="[
                  'text-[11px] font-medium rounded-md px-2 py-1.5 border focus:outline-none focus:ring-1 focus:ring-ring capitalize',
                  roleBadgeClass(u.role)
                ]"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <span
                v-else
                :class="['text-[11px] font-medium rounded-md px-2 py-1.5 border capitalize', roleBadgeClass(u.role)]"
              >
                {{ u.role }}
              </span>

              <button aria-label="Extend or set account limit"
                v-if="u.id !== authStore.user?.id"
                @click="openExtendUserModal(u)"
                class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition"
                :title="u.expires_at ? 'Extend or change account limit' : 'Set account access limit'"
              >
                <Hourglass class="w-4 h-4 text-primary" />
              </button>

              <button aria-label="Edit user"
                @click="openEditUserModal(u)"
                class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition"
                title="Edit user"
              >
                <Pencil class="w-4 h-4" />
              </button>

              <button aria-label="Delete user"
                v-if="u.id !== authStore.user?.id"
                @click="deleteUser(u)"
                class="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded-md transition"
                title="Delete user"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 3: LIVE SYSTEM LOGS -->
      <section v-if="activeTab === 'logs'" class="flex flex-col gap-3.5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <Terminal class="w-4 h-4 text-muted-foreground" />
              Live System Logs
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">Real-time scan logs, database events, and server errors</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="toggleAutoRefresh"
              :class="[
                'px-2.5 py-1.5 rounded-md text-xs font-medium border transition flex items-center gap-1.5',
                autoRefresh
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              ]"
            >
              <span class="w-2 h-2 rounded-full" :class="autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'"></span>
              {{ autoRefresh ? 'Auto-refreshing (3s)' : 'Paused' }}
            </button>
            <button aria-label="Refresh now"
              @click="loadLogs"
              class="p-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border text-xs transition"
              title="Refresh now"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="loadingLogs ? 'animate-spin' : ''" />
            </button>
            <button
              @click="clearLogs"
              class="px-2.5 py-1.5 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 border border-destructive/20 transition flex items-center gap-1"
            >
              <Trash2 class="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>

        <!-- Filter bar -->
        <div class="flex flex-col sm:flex-row gap-2">
          <div class="relative flex-1">
            <Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="logSearch"
              @input="loadLogs"
              placeholder="Search logs by message or category..."
              class="w-full bg-card border border-border rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="flex items-center gap-1 bg-card border border-border rounded-md p-1">
            <button
              v-for="lvl in ['all', 'info', 'warn', 'error']"
              :key="lvl"
              @click="setLogLevel(lvl)"
              :class="[
                'px-2.5 py-0.5 rounded text-[11px] font-medium capitalize transition',
                selectedLogLevel === lvl
                  ? 'bg-secondary text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              ]"
            >
              {{ lvl }}
            </button>
          </div>
        </div>

        <!-- Console View -->
        <div class="bg-zinc-950 dark:bg-black text-zinc-100 border border-border rounded-xl p-3 font-mono text-[11px] leading-relaxed max-h-[520px] overflow-y-auto shadow-inner flex flex-col gap-1 select-text">
          <div v-if="logs.length === 0" class="py-12 text-center text-zinc-500 font-sans text-xs">
            No log entries match your filter.
          </div>
          <div
            v-for="log in logs"
            :key="log.id"
            class="flex items-start gap-2 hover:bg-white/5 px-2 py-1 rounded transition-colors"
          >
            <span class="text-zinc-500 whitespace-nowrap select-none text-[10px]">
              {{ formatLogTime(log.timestamp) }}
            </span>
            <span
              :class="[
                'px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider whitespace-nowrap select-none',
                log.level === 'error' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                log.level === 'warn' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                'bg-zinc-800 text-zinc-300 border border-zinc-700'
              ]"
            >
              {{ log.level }}
            </span>
            <span v-if="log.category" class="text-zinc-400 select-none text-[10px] whitespace-nowrap">
              [{{ log.category }}]
            </span>
            <span class="text-zinc-200 flex-1 break-words">
              {{ log.message }}
            </span>
            <span v-if="log.details" class="text-zinc-500 text-[10px] truncate max-w-[200px]" :title="log.details">
              {{ log.details }}
            </span>
          </div>
        </div>
      </section>

      <!-- TAB 4: SERVER STATS -->
      <section v-if="activeTab === 'stats'" class="flex flex-col gap-4">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <BarChart3 class="w-4 h-4 text-muted-foreground" />
            Server Statistics
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Media index totals, storage consumption, and library breakdowns</p>
        </div>

        <div v-if="serverStats" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center justify-between text-muted-foreground mb-1">
              <span class="text-xs font-medium">Total Items</span>
              <Book class="w-3.5 h-3.5" />
            </div>
            <div class="text-xl font-bold text-foreground">{{ serverStats.totalItems || 0 }}</div>
          </div>

          <div class="bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center justify-between text-muted-foreground mb-1">
              <span class="text-xs font-medium">Disk Footprint</span>
              <HardDrive class="w-3.5 h-3.5" />
            </div>
            <div class="text-xl font-bold text-foreground">{{ formatBytes(serverStats.totalBytes) }}</div>
          </div>

          <div class="bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center justify-between text-muted-foreground mb-1">
              <span class="text-xs font-medium">Audio Time</span>
              <Clock class="w-3.5 h-3.5" />
            </div>
            <div class="text-xl font-bold text-foreground">{{ formatHours(serverStats.totalAudioDuration) }}</div>
          </div>

          <div class="bg-card border border-border rounded-xl p-3.5">
            <div class="flex items-center justify-between text-muted-foreground mb-1">
              <span class="text-xs font-medium">Active Accounts</span>
              <Users class="w-3.5 h-3.5" />
            </div>
            <div class="text-xl font-bold text-foreground">{{ serverStats.totalUsers || 0 }}</div>
          </div>
        </div>

        <!-- Breakdown by Media Type (Always shows all categories even if 0) -->
        <div v-if="serverStats?.byType" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Media Types Breakdown</h3>
            <span class="text-xs text-muted-foreground">Showing all supported media formats</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div
              v-for="cat in serverStats.byType"
              :key="cat.media_type"
              class="bg-card border border-border rounded-xl p-4 flex flex-col gap-3"
            >
              <!-- Card Header -->
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-lg bg-muted text-foreground flex items-center justify-center flex-shrink-0">
                    <component :is="mediaTypeIcon(cat.media_type)" class="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 class="text-xs font-semibold text-foreground">{{ mediaTypeLabel(cat.media_type) }}</h4>
                    <span class="text-[11px] text-muted-foreground font-mono">{{ formatBytes(cat.bytes) }}</span>
                  </div>
                </div>
                <span class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {{ cat.percentage_of_storage }}% space
                </span>
              </div>

              <!-- Storage Proportion Bar -->
              <div class="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden">
                <div
                  class="bg-primary h-full transition-all duration-300"
                  :style="{ width: `${cat.percentage_of_storage || 0}%` }"
                ></div>
              </div>

              <!-- Detailed Key-Value Grid -->
              <div class="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-border/60">
                <div class="flex flex-col">
                  <span class="text-[10px] text-muted-foreground">Total Files</span>
                  <span class="font-bold text-foreground">{{ cat.count }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-[10px] text-muted-foreground">Avg File Size</span>
                  <span class="font-mono text-foreground">{{ formatBytes(cat.avg_bytes) }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-[10px] text-muted-foreground">Creators / Authors</span>
                  <span class="font-bold text-foreground">{{ cat.unique_authors }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-[10px] text-muted-foreground">Series Groups</span>
                  <span class="font-bold text-foreground">{{ cat.unique_series }}</span>
                </div>
                <div v-if="cat.media_type === 'audiobook' && cat.duration > 0" class="flex flex-col col-span-2">
                  <span class="text-[10px] text-muted-foreground">Playback Length</span>
                  <span class="font-mono text-foreground">{{ formatHours(cat.duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 4.5: ACTIVITY -->
      <section v-if="activeTab === 'activity'" class="flex flex-col gap-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              <History class="w-4 h-4 text-muted-foreground" />
              User Activity
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">Sign-ins and what's being read, watched, or listened to, across every account</p>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="activityUserFilter"
              @change="loadActivity"
              class="bg-card border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Users</option>
              <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
            </select>
            <button aria-label="Refresh now"
              @click="loadActivity"
              class="p-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border text-xs transition"
              title="Refresh now"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="loadingActivity ? 'animate-spin' : ''" />
            </button>
          </div>
        </div>

        <div class="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          <div v-if="activity.length === 0" class="py-12 text-center text-xs text-muted-foreground">
            No activity recorded yet.
          </div>
          <div
            v-for="entry in activity"
            :key="`${entry.type}-${entry.id}`"
            class="p-3 flex items-center gap-3"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="entry.type === 'login' ? (entry.success ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive') : 'bg-muted text-muted-foreground'"
            >
              <LogIn v-if="entry.type === 'login'" class="w-4 h-4" />
              <component v-else :is="mediaTypeIcon(entry.media_type)" class="w-4 h-4" />
            </div>

            <div class="min-w-0 flex-1">
              <p class="text-xs text-foreground truncate">
                <span class="font-semibold">{{ entry.username }}</span>
                <template v-if="entry.type === 'login'">
                  {{ entry.success ? ' signed in' : ' failed to sign in' }}
                </template>
                <template v-else>
                  {{ entry.ended_at ? ' viewed ' : ' is viewing ' }}<span class="italic">{{ entry.item_title || 'a deleted item' }}</span>
                </template>
              </p>
              <p class="text-[11px] text-muted-foreground">
                {{ formatDateTime(entry.timestamp) }}
                <span v-if="entry.type === 'login' && entry.ip_address"> &bull; {{ entry.ip_address }}</span>
                <span v-if="entry.type === 'view' && entry.duration_seconds"> &bull; {{ formatDurationShort(entry.duration_seconds) }}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 5: SETTINGS -->
      <section v-if="activeTab === 'settings'" class="flex flex-col gap-5">
        <div>
          <h2 class="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <Sliders class="w-4 h-4 text-muted-foreground" />
            Server Settings & Defaults
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">Configure global server behavior and available features for all users</p>
        </div>

        <!-- Version & updates -->
        <div class="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-foreground">Plinthio {{ updateInfo?.current || '…' }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              <template v-if="updateInfo && !updateInfo.enabled">Update checks are off (UPDATE_CHECK=false).</template>
              <template v-else-if="updateInfo?.updateAvailable">
                <span class="text-primary font-medium">{{ updateInfo.latest }} is available.</span>
                Update with <code class="bg-muted px-1 rounded">docker compose pull &amp;&amp; docker compose up -d</code>
              </template>
              <template v-else-if="updateInfo?.checkedAt">You're up to date{{ updateInfo.error ? ' (last check failed — offline?)' : '' }}.</template>
              <template v-else>Not checked yet.</template>
            </p>
          </div>
          <a
            v-if="updateInfo?.releaseUrl"
            :href="updateInfo.releaseUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition flex items-center"
          >Release notes</a>
          <button
            type="button"
            @click="checkUpdates(true)"
            :disabled="checkingUpdates || (updateInfo && !updateInfo.enabled)"
            class="h-8 px-3 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition disabled:opacity-50"
          >
            {{ checkingUpdates ? 'Checking…' : 'Check now' }}
          </button>
        </div>

        <!-- Shelf Filter Defaults Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Shelf Views</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Series and Creator are always available. Turning off Disk Folders or Custom Folders hides that view for everyone on this server.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              v-for="filter in allServerFilterModes"
              :key="filter.id"
              :class="[
                'flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 transition select-none',
                filter.always ? '' : 'hover:bg-muted/40 cursor-pointer'
              ]"
            >
              <input
                type="checkbox"
                :value="filter.id"
                v-model="allowedFilters"
                :disabled="filter.always"
                class="mt-0.5 rounded border-border text-primary focus:ring-ring"
              />
              <div class="flex flex-col">
                <span class="text-xs font-semibold text-foreground">{{ filter.label }}</span>
                <span class="text-[11px] text-muted-foreground">{{ filter.always ? 'Always on' : filter.desc }}</span>
              </div>
            </label>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-border">
            <span class="text-xs text-muted-foreground">Changes take effect immediately for connected clients.</span>
            <button
              @click="saveServerFilters"
              :disabled="savingFilters"
              class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle v-if="!savingFilters" class="w-3.5 h-3.5" />
              <span>{{ savingFilters ? 'Saving...' : 'Save Settings' }}</span>
            </button>
          </div>
        </div>

        <!-- Accent Theme Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3 flex items-center justify-between">
            <div>
              <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Accent Theme Preset</h3>
              <p class="text-xs text-muted-foreground mt-0.5">Select a primary color scheme across buttons, badges, and active highlights for all users.</p>
            </div>
            <span class="text-xs font-mono capitalize px-2 py-0.5 rounded bg-muted text-foreground">
              {{ customizationForm.accentTheme }}
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
            <button
              v-for="acc in accentPresets"
              :key="acc.id"
              type="button"
              @click="selectAccent(acc.id)"
              :class="[
                'p-3 rounded-xl border flex flex-col items-center gap-2 transition active:scale-95 text-center',
                customizationForm.accentTheme === acc.id
                  ? 'border-primary ring-2 ring-primary/20 bg-muted/40 font-medium'
                  : 'border-border hover:bg-muted/20'
              ]"
            >
              <span :class="acc.bg" class="w-6 h-6 rounded-full border border-black/10 shadow-sm"></span>
              <span class="text-xs text-foreground capitalize">{{ acc.label }}</span>
            </button>
          </div>
        </div>

        <!-- Layout Mode Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Navigation Layout</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Choose how the primary navigation is presented for all users.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              @click="selectLayoutMode('topnav')"
              :class="[
                'p-3.5 rounded-xl border flex items-center gap-3 text-left transition active:scale-95',
                customizationForm.layoutMode === 'topnav'
                  ? 'border-primary ring-2 ring-primary/20 bg-muted/40'
                  : 'border-border hover:bg-muted/20'
              ]"
            >
              <div class="w-11 h-9 rounded-md border border-border/70 bg-background flex flex-col gap-0.5 p-1 flex-shrink-0">
                <div class="h-1.5 w-full rounded-sm bg-muted-foreground/40"></div>
                <div class="flex-1 rounded-sm bg-muted-foreground/15"></div>
              </div>
              <div>
                <span class="text-xs font-semibold text-foreground block">Top Navigation</span>
                <span class="text-[11px] text-muted-foreground">Classic horizontal header bar</span>
              </div>
            </button>

            <button
              type="button"
              @click="selectLayoutMode('sidebar')"
              :class="[
                'p-3.5 rounded-xl border flex items-center gap-3 text-left transition active:scale-95',
                customizationForm.layoutMode === 'sidebar'
                  ? 'border-primary ring-2 ring-primary/20 bg-muted/40'
                  : 'border-border hover:bg-muted/20'
              ]"
            >
              <div class="w-11 h-9 rounded-md border border-border/70 bg-background flex gap-0.5 p-1 flex-shrink-0">
                <div class="w-2.5 h-full rounded-sm bg-muted-foreground/40"></div>
                <div class="flex-1 rounded-sm bg-muted-foreground/15"></div>
              </div>
              <div>
                <span class="text-xs font-semibold text-foreground block">Sidebar</span>
                <span class="text-[11px] text-muted-foreground">Vertical navigation on the left</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Server Branding Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Server Branding & Notices</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Configure your server name and custom login-screen announcements.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-foreground mb-1.5">Server Name</label>
              <input
                v-model="customizationForm.serverName"
                type="text"
                class="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Plinthio"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-foreground mb-1.5">Login Notice / Message</label>
              <input
                v-model="customizationForm.loginMessage"
                type="text"
                class="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Welcome to family media server"
              />
            </div>
          </div>
        </div>

        <!-- Custom CSS Injection (Jellyfin Style) -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3 flex items-center justify-between">
            <div>
              <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Custom CSS Injection</h3>
              <p class="text-xs text-muted-foreground mt-0.5">
                Inject custom CSS rules live into the web client and PWA for every user.
              </p>
            </div>
            <router-link
              to="/docs"
              class="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            >
              <span>CSS Cheatsheet</span>
              <ExternalLink class="w-3.5 h-3.5" />
            </router-link>
          </div>

          <textarea
            v-model="customizationForm.customCss"
            rows="8"
            class="w-full bg-background border border-border rounded-lg p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="/* Add your custom CSS here */&#10;.group img { border-radius: 1rem !important; }"
          ></textarea>

          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="savingCustomization"
              @click="saveCustomization"
              class="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              <Loader2 v-if="savingCustomization" class="w-3.5 h-3.5 animate-spin" />
              <span>Save Branding & CSS</span>
            </button>

            <button
              type="button"
              @click="previewCustomCss"
              class="px-3.5 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted/40 transition"
            >
              Test Preview
            </button>
          </div>
        </div>

        <!-- External Metadata Providers Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">External Metadata Providers</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Manga (MangaDex) and Books (Google Books / Open Library) work out of the box with no key required.
              Movies, Shows and Anime use TMDB, which requires a free personal API key.
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-foreground">TMDB API Key</label>
              <span
                :class="[
                  'text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border',
                  tmdbConfigured
                    ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
                    : 'text-muted-foreground border-border bg-muted/40'
                ]"
              >
                {{ tmdbConfigured ? 'Configured' : 'Not configured' }}
              </span>
            </div>
            <div class="flex gap-2">
              <input
                v-model="tmdbKeyInput"
                type="password"
                autocomplete="off"
                :placeholder="tmdbConfigured ? 'Enter a new key to replace it, or leave blank to clear' : 'Paste your TMDB v4 API Read Access Token'"
                class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                @click="saveTmdbKey"
                :disabled="savingTmdbKey"
                class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50"
              >
                {{ savingTmdbKey ? 'Saving...' : 'Save' }}
              </button>
            </div>
            <p class="text-[11px] text-muted-foreground">
              Get a free key at themoviedb.org under Settings &rarr; API. Saving an empty value clears the stored key.
            </p>
          </div>
        </div>

        <!-- Hardware Transcoding Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Video Transcoding & Hardware Acceleration</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Plinthio prioritizes <strong>Direct Play</strong> and <strong>Direct Stream</strong> before falling back to transcoding.
              When video streams can be decoded by the browser, they are copied untouched (<code class="text-[11px] bg-muted px-1 rounded">-c:v copy</code>)
              with zero server video CPU load, and only incompatible audio (e.g. EAC3 / Atmos / DTS) is converted to AAC.
            </p>
          </div>

          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-foreground">Detected hardware</label>
            <span
              :class="[
                'text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border',
                transcoding.detected
                  ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
                  : 'text-muted-foreground border-border bg-muted/40'
              ]"
            >
              {{ transcoding.detected || 'None — using CPU' }}
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-foreground">Acceleration</label>
            <div class="flex gap-2">
              <select
                v-model="transcoding.preference"
                @change="saveTranscoding"
                class="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="auto">Auto — use whatever is detected (Recommended)</option>
                <option value="none">Off — always use the CPU</option>
                <option v-for="method in transcoding.available" :key="method" :value="method">
                  Force {{ method.toUpperCase() }}
                </option>
              </select>
              <button
                @click="runHwaccelTest"
                :disabled="testingHwaccel || !testableMethod"
                class="px-3.5 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition disabled:opacity-50"
              >
                {{ testingHwaccel ? 'Testing...' : 'Test' }}
              </button>
            </div>
            <p v-if="hwaccelTestResult" :class="[
              'text-[11px]',
              hwaccelTestResult.ok ? 'text-emerald-500' : 'text-destructive'
            ]">
              {{ hwaccelTestResult.ok
                ? `${testableMethod.toUpperCase()} encoding verified and working on this machine.`
                : `${testableMethod.toUpperCase()} test failed: ${hwaccelTestResult.error}` }}
            </p>
            <p class="text-[11px] text-muted-foreground">
              Testing runs a short real encode — ffmpeg listing an encoder doesn't prove the driver underneath it works.
            </p>
          </div>

          <!-- Architecture & Playback Guide -->
          <div class="rounded-lg bg-muted/40 border border-border p-3 space-y-2 text-xs text-muted-foreground">
            <div class="font-medium text-foreground text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <span>Playback Pipeline & Host Configuration</span>
            </div>
            <ul class="list-disc pl-4 space-y-1.5 text-[11px] leading-relaxed">
              <li>
                <strong class="text-foreground">Direct Stream (Remux):</strong> Files with native video (H.264, or HEVC on Vivaldi/Chrome/Edge/Safari) inside MKV containers or with Dolby/DTS audio stream-copy the video at original resolution (up to 4K) using negligible CPU, converting only the audio track to AAC.
              </li>
              <li>
                <strong class="text-foreground">Browser Hardware Acceleration:</strong> For client-side decoding of 4K H.264/HEVC, ensure your browser has hardware video decoding enabled (<code class="bg-muted px-1 rounded">vivaldi://gpu</code> or <code class="bg-muted px-1 rounded">chrome://gpu</code> &rarr; <em>Video Decode: Hardware accelerated</em>).
              </li>
              <li>
                <strong class="text-foreground">Intel QuickSync & VAAPI:</strong> On Intel/AMD hosts running Docker, uncomment <code class="bg-muted px-1 rounded">devices: [/dev/dri:/dev/dri]</code> and add your host's <code class="bg-muted px-1 rounded">render</code> group GID under <code class="bg-muted px-1 rounded">group_add</code> in <code class="bg-muted px-1 rounded">docker-compose.yml</code>.
              </li>
              <li>
                <strong class="text-foreground">Thermal Protection:</strong> Software transcode fallbacks are throttled to 2 threads with ultrafast presets and live scrub generation is separated from video streaming to protect small micro PCs and NUCs from overheating.
              </li>
            </ul>
          </div>
        </div>

        <!-- Automatic Scanning Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Automatic Scanning</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Picks up media you add to your library folders without anyone having to press Scan. The periodic
              re-scan is the dependable floor — it works on network shares and bind mounts that emit no filesystem
              events at all. Watching reacts within seconds where the filesystem supports it.
            </p>
          </div>

          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                v-model="autoScanConfig.enabled"
                class="rounded border-border text-primary focus:ring-ring"
              />
              <span class="text-xs font-semibold text-foreground">Scan libraries automatically</span>
            </label>

            <div v-if="autoScanConfig.enabled" class="flex flex-col gap-3 pl-0.5">
              <div class="max-w-xs">
                <label for="auto-scan-interval" class="block text-[11px] font-medium text-muted-foreground mb-1">Re-scan every</label>
                <select
                  id="auto-scan-interval"
                  v-model.number="autoScanConfig.intervalMinutes"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option :value="15">15 minutes</option>
                  <option :value="30">30 minutes</option>
                  <option :value="60">Hour</option>
                  <option :value="360">6 hours</option>
                  <option :value="1440">Day</option>
                </select>
              </div>

              <label class="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  v-model="autoScanConfig.watchEnabled"
                  class="rounded border-border text-primary focus:ring-ring"
                />
                <span class="text-xs text-foreground">Also watch folders for changes (scans ~30s after a file appears)</span>
              </label>
            </div>

            <button
              @click="saveAutoScanConfig"
              :disabled="savingAutoScanConfig"
              class="self-start px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle v-if="!savingAutoScanConfig" class="w-3.5 h-3.5" />
              <span>{{ savingAutoScanConfig ? 'Saving...' : 'Save Scanning Settings' }}</span>
            </button>
          </div>
        </div>

        <!-- Database Backup Card -->
        <div class="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
          <div class="border-b border-border pb-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Database Backup</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              Snapshots the database (users, libraries, progress, bookmarks, metadata). This does not include cover
              images or your media files — back those up separately from wherever your library folders and the
              server's config volume live. Deleting a library removes its catalog data immediately and permanently;
              a recent backup is the only way to undo that.
            </p>
          </div>

          <!-- Automatic schedule -->
          <div class="flex flex-col gap-3 pb-4 border-b border-border">
            <label class="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                v-model="backupConfig.enabled"
                class="rounded border-border text-primary focus:ring-ring"
              />
              <span class="text-xs font-semibold text-foreground">Automatic backups</span>
            </label>

            <div v-if="backupConfig.enabled" class="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-0.5">
              <div>
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">Frequency</label>
                <select
                  v-model.number="backupConfig.intervalHours"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option :value="6">Every 6 hours</option>
                  <option :value="12">Every 12 hours</option>
                  <option :value="24">Daily</option>
                  <option :value="72">Every 3 days</option>
                  <option :value="168">Weekly</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] font-medium text-muted-foreground mb-1">Keep last</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  v-model.number="backupConfig.retentionCount"
                  class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <button
              @click="saveBackupConfig"
              :disabled="savingBackupConfig"
              class="self-start px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle v-if="!savingBackupConfig" class="w-3.5 h-3.5" />
              <span>{{ savingBackupConfig ? 'Saving...' : 'Save Schedule' }}</span>
            </button>
          </div>

          <!-- Manual actions -->
          <div class="flex flex-wrap items-center gap-2">
            <button
              @click="createBackupNow"
              :disabled="creatingBackup"
              class="px-3.5 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <Save class="w-3.5 h-3.5" />
              <span>{{ creatingBackup ? 'Backing up...' : 'Backup Now' }}</span>
            </button>
            <button
              @click="downloadBackup"
              :disabled="downloadingBackup"
              class="px-3.5 py-1.5 rounded-md bg-card border border-border hover:bg-muted text-foreground text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <Download class="w-3.5 h-3.5" />
              <span>{{ downloadingBackup ? 'Preparing...' : 'Download a Snapshot' }}</span>
            </button>
          </div>

          <!-- Stored backups list -->
          <div class="flex flex-col gap-2">
            <h4 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Stored Backups {{ storedBackups.length ? `(${storedBackups.length})` : '' }}
            </h4>
            <div v-if="storedBackups.length === 0" class="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
              No backups stored yet — enable automatic backups or click "Backup Now".
            </div>
            <div v-else class="border border-border rounded-lg divide-y divide-border overflow-hidden">
              <div
                v-for="b in storedBackups"
                :key="b.filename"
                class="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div class="min-w-0">
                  <div class="text-xs font-medium text-foreground truncate">{{ formatBackupDate(b.createdAt) }}</div>
                  <div class="text-[11px] text-muted-foreground font-mono">{{ formatBytes(b.size) }}</div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button aria-label="Download this backup"
                    @click="downloadStoredBackup(b)"
                    class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition"
                    title="Download this backup"
                  >
                    <Download class="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Delete this backup"
                    @click="deleteStoredBackup(b)"
                    class="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded-md transition"
                    title="Delete this backup"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Modal: Add Library -->
    <div v-if="showAddLibraryModal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-border rounded-xl w-full max-w-md shadow-xl flex flex-col max-h-[85dvh]">
        <h3 class="text-sm font-semibold text-foreground p-5 pb-3 flex-shrink-0">Add Media Library</h3>

        <form @submit.prevent="submitAddLibrary" class="flex flex-col gap-3 px-5 pb-5 overflow-y-auto">
          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Library Name</label>
            <input v-model="newLib.name" required placeholder="e.g. My Audiobooks" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Folder Path</label>
            <div class="flex items-center gap-1.5">
              <input v-model="newLib.path" required placeholder="/media/Books" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
              <button
                type="button"
                @click="openFolderBrowser"
                title="Browse folders"
                class="flex-shrink-0 h-[30px] px-2.5 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground flex items-center gap-1.5 text-xs font-medium transition"
              >
                <FolderOpen class="w-3.5 h-3.5" />
                <span>Browse...</span>
              </button>
            </div>
            <p class="text-[11px] text-muted-foreground mt-1">
              Your Database is mounted at <code class="bg-muted px-1 py-0.5 rounded font-mono">/media</code>
            </p>

            <!-- Detected Folder Chips -->
            <div v-if="discoveredFolders.length > 0" class="mt-2 flex flex-wrap gap-1.5 items-center">
              <span class="text-[10px] text-muted-foreground mr-1">Available folders:</span>
              <button
                v-for="folder in discoveredFolders"
                :key="folder.path"
                type="button"
                @click="selectFolder(folder)"
                class="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-[11px] font-mono text-foreground border border-border transition"
              >
                {{ folder.name }}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Media Type</label>
            <select v-model="newLib.type" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="audiobooks">Audiobooks (.m4b, .mp3)</option>
              <option value="manga">Manga & Comics (.cbz, .zip)</option>
              <option value="books">eBooks & Mixed (.epub, .pdf)</option>
              <option value="shows">TV Shows (.mp4, .mkv)</option>
              <option value="movies">Movies (.mp4, .mkv)</option>
              <option value="anime">Anime (.mp4, .mkv)</option>
            </select>
          </div>

          <div class="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border">
            <button type="button" @click="showAddLibraryModal = false" class="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition">Cancel</button>
            <button type="submit" class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm">Save & Scan</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: Folder Browser -->
    <div v-if="showFolderBrowser" class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-border rounded-xl w-full max-w-lg shadow-xl flex flex-col max-h-[80dvh]">
        <div class="p-4 pb-3 border-b border-border">
          <h3 class="text-sm font-semibold text-foreground mb-2">Select a Folder</h3>

          <!-- Breadcrumb Navigation -->
          <div class="flex items-center gap-1 flex-wrap text-xs font-mono">
            <button aria-label="Browse to the root folder"
              type="button"
              @click="browseTo('/')"
              class="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            >/</button>
            <template v-for="(part, i) in browserCurrentDir.split('/').filter(Boolean)" :key="i">
              <ChevronRight class="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
              <button
                type="button"
                @click="browseToBreadcrumb(i)"
                class="px-1.5 py-0.5 rounded hover:bg-muted text-foreground transition truncate max-w-[120px]"
              >{{ part }}</button>
            </template>
          </div>
        </div>

        <!-- Folder List -->
        <div class="flex-1 overflow-y-auto p-2 min-h-[220px]">
          <div v-if="browserLoading" class="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 class="w-5 h-5 animate-spin" />
          </div>
          <p v-else-if="browserError" class="text-xs text-destructive px-2 py-4">{{ browserError }}</p>
          <template v-else>
            <button
              v-if="browserCurrentDir !== '/'"
              type="button"
              @click="browseUp"
              class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-muted text-left text-xs text-muted-foreground transition"
            >
              <ArrowUp class="w-4 h-4 flex-shrink-0" />
              <span>.. (Up a level)</span>
            </button>
            <button
              v-for="entry in browserEntries"
              :key="entry.path"
              type="button"
              @click="browseTo(entry.path)"
              class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-muted text-left text-xs text-foreground transition"
            >
              <Folder class="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <span class="truncate">{{ entry.name }}</span>
            </button>
            <p v-if="!browserEntries.length" class="text-xs text-muted-foreground px-2.5 py-4">No subfolders here.</p>
          </template>
        </div>

        <div class="p-4 pt-3 border-t border-border flex items-center justify-between gap-2">
          <span class="text-[11px] font-mono text-muted-foreground truncate" :title="browserCurrentDir">{{ browserCurrentDir }}</span>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button type="button" @click="showFolderBrowser = false" class="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition">Cancel</button>
            <button type="button" @click="confirmFolderSelection" class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm">Select This Folder</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Add User -->
    <div v-if="showAddUserModal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-border rounded-xl w-full max-w-sm shadow-xl flex flex-col max-h-[85dvh]">
        <h3 class="text-sm font-semibold text-foreground p-5 pb-3 flex-shrink-0">Add New User</h3>

        <form @submit.prevent="submitAddUser" class="flex flex-col gap-3 px-5 pb-5 overflow-y-auto">
          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Username</label>
            <input v-model="newUser.username" required class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Password</label>
            <input v-model="newUser.password" type="password" required minlength="8" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <p class="text-[11px] text-muted-foreground mt-1">Must be at least 8 characters long</p>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Role</label>
            <select v-model="newUser.role" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="viewer">Viewer — browse and track own progress only</option>
              <option value="editor">Editor — can also edit shared metadata</option>
              <option value="admin">Admin — full control</option>
            </select>
          </div>

          <div class="pt-2 border-t border-border">
            <label class="block text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
              <Hourglass class="w-3.5 h-3.5 text-muted-foreground" />
              Account Access Limit
            </label>
            <select v-model="newUser.duration" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="forever">Forever / No Limit (Default)</option>
              <option value="1d">1 Day (24 hours)</option>
              <option value="3d">3 Days (Weekend pass)</option>
              <option value="7d">7 Days (1 Week)</option>
              <option value="14d">14 Days (2 Weeks)</option>
              <option value="1m">1 Month (30 Days)</option>
              <option value="3m">3 Months</option>
              <option value="6m">6 Months</option>
              <option value="1y">1 Year</option>
              <option value="custom">Custom Date & Time…</option>
            </select>
          </div>

          <div v-if="newUser.duration === 'custom'">
            <label class="block text-xs font-medium text-foreground mb-1">Expiration Date & Time</label>
            <input
              v-model="newUser.customExpiry"
              type="datetime-local"
              required
              class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div class="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border">
            <button type="button" @click="showAddUserModal = false" class="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition">Cancel</button>
            <button type="submit" class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm">Create User</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: Edit User -->
    <div v-if="showEditUserModal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-border rounded-xl w-full max-w-sm shadow-xl flex flex-col max-h-[85dvh]">
        <h3 class="text-sm font-semibold text-foreground p-5 pb-3 flex-shrink-0">Edit User</h3>

        <form @submit.prevent="submitEditUser" class="flex flex-col gap-4 px-5 pb-5 overflow-y-auto">
          <div>
            <label class="block text-xs font-medium text-foreground mb-1">Username</label>
            <input v-model="editUser.username" required class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div class="pt-3 border-t border-border">
            <label class="block text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
              <Hourglass class="w-3.5 h-3.5 text-muted-foreground" />
              Account Access Limit
            </label>
            <p v-if="editUser.currentExpiresAt" class="text-[11px] text-muted-foreground mb-1.5">
              Current limit: <strong class="text-foreground">{{ formatDateTime(editUser.currentExpiresAt) }}</strong>
              <span v-if="new Date(editUser.currentExpiresAt).getTime() <= Date.now()" class="text-destructive font-semibold ml-1">(Expired)</span>
            </p>
            <p v-else class="text-[11px] text-muted-foreground mb-1.5">
              Current limit: <strong class="text-foreground">Unlimited / Forever</strong>
            </p>

            <select v-model="editUser.duration" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="unchanged">Keep Current Limit</option>
              <option value="forever">Set to Forever / Unlimited</option>
              <option value="1d">1 Day from now</option>
              <option value="3d">3 Days from now</option>
              <option value="7d">7 Days from now</option>
              <option value="14d">14 Days from now</option>
              <option value="1m">1 Month from now</option>
              <option value="3m">3 Months from now</option>
              <option value="6m">6 Months from now</option>
              <option value="1y">1 Year from now</option>
              <option value="custom">Set Specific Date & Time…</option>
            </select>
          </div>

          <div v-if="editUser.duration === 'custom'">
            <label class="block text-xs font-medium text-foreground mb-1">New Expiration Date & Time</label>
            <input
              v-model="editUser.customExpiry"
              type="datetime-local"
              required
              class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div v-if="editUser.id !== authStore.user?.id" class="pt-3 border-t border-border">
            <label class="block text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
              <ShieldCheck class="w-3.5 h-3.5 text-muted-foreground" />
              Content Limit
            </label>
            <select v-model="editUser.maxAgeRating" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">No limit</option>
              <option value="Everyone">Everyone only</option>
              <option value="Teen">Up to Teen</option>
              <option value="Mature">Up to Mature</option>
            </select>
            <label v-if="editUser.maxAgeRating" class="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
              <input v-model="editUser.allowUnrated" type="checkbox" class="mt-0.5 accent-primary" />
              <span>Allow titles that haven't been rated yet. Turn off for strict filtering — only rated titles at or below the limit will show.</span>
            </label>
            <p class="text-[11px] text-muted-foreground mt-1">Ratings are set per series (series sheet) or per title (metadata editor).</p>
          </div>

          <div class="pt-3 border-t border-border">
            <label class="block text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
              <KeyRound class="w-3.5 h-3.5 text-muted-foreground" />
              Reset Password
            </label>
            <input
              v-model="editUser.newPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              placeholder="Leave blank to keep current password"
              class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p class="text-[11px] text-muted-foreground mt-1">If set, must be at least 8 characters. This immediately signs the user out of all sessions.</p>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button type="button" @click="showEditUserModal = false" class="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition">Cancel</button>
            <button type="submit" :disabled="savingEditUser" class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50">
              {{ savingEditUser ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: Quick Extend / Renew User Access -->
    <div v-if="showExtendModal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-border rounded-xl w-full max-w-sm shadow-xl flex flex-col max-h-[85dvh]">
        <div class="p-5 pb-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Hourglass class="w-4 h-4 text-primary" />
              Manage Access Limit
            </h3>
            <p class="text-xs text-muted-foreground mt-0.5">@{{ extendTargetUser?.username }}</p>
          </div>
          <button @click="showExtendModal = false" class="text-muted-foreground hover:text-foreground p-1 rounded-md">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form @submit.prevent="submitExtendUser" class="flex flex-col gap-3.5 p-5 overflow-y-auto">
          <div class="p-2.5 rounded-lg bg-muted/40 border border-border text-xs">
            <div class="text-muted-foreground text-[11px]">Current Status</div>
            <div class="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
              <template v-if="extendTargetUser?.expires_at">
                <span :class="isUserExpired(extendTargetUser) ? 'text-destructive font-semibold' : 'text-emerald-500 font-semibold'">
                  {{ isUserExpired(extendTargetUser) ? 'Expired' : 'Active' }}
                </span>
                <span>·</span>
                <span class="text-muted-foreground font-mono text-[11px]">{{ formatDateTime(extendTargetUser.expires_at) }}</span>
              </template>
              <template v-else>
                <span class="text-emerald-500 font-semibold">Active</span>
                <span>·</span>
                <span class="text-muted-foreground">Unlimited / Forever</span>
              </template>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Extend / Set Duration</label>
            <select v-model="extendDuration" class="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="1d">+1 Day</option>
              <option value="3d">+3 Days</option>
              <option value="7d">+7 Days (1 Week)</option>
              <option value="14d">+14 Days (2 Weeks)</option>
              <option value="1m">+1 Month (30 Days)</option>
              <option value="3m">+3 Months</option>
              <option value="6m">+6 Months</option>
              <option value="1y">+1 Year</option>
              <option value="forever">Set to Forever / Unlimited</option>
            </select>
            <p class="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              Extends from current expiration date (or from today if already expired).
            </p>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-border mt-1">
            <button type="button" @click="showExtendModal = false" class="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition">Cancel</button>
            <button type="submit" :disabled="extendingUser" class="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition shadow-sm disabled:opacity-50 flex items-center gap-1.5">
              <Loader2 v-if="extendingUser" class="w-3.5 h-3.5 animate-spin" />
              <span>Apply Limit</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useDialogStore } from '../stores/dialog';
import { useCustomizationStore } from '../stores/customization';
import Sidebar from '../components/Sidebar.vue';
import AdminMetadataManager from '../components/AdminMetadataManager.vue';
const LibraryHealth = defineAsyncComponent(() => import('../components/LibraryHealth.vue'));
import {
  ArrowLeft,
  Folder,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Headphones,
  FileImage,
  Book,
  Terminal,
  BarChart3,
  Search,
  HardDrive,
  Clock,
  Sliders,
  CheckCircle,
  FolderOpen,
  ChevronRight,
  ArrowUp,
  Loader2,
  Download,
  ShieldCheck,
  PenSquare,
  Eye as EyeIcon,
  ExternalLink,
  Save,
  Film,
  Tv,
  Sparkles,
  Pencil,
  KeyRound,
  History,
  LogIn,
  Lock,
  Hourglass,
  HeartPulse,
  X
} from 'lucide-vue-next';

const route = useRoute();
const authStore = useAuthStore();
const dialog = useDialogStore();
const customizationStore = useCustomizationStore();
const router = useRouter();
// Global nav layout (topnav vs sidebar) is a server-wide admin setting; these pages keep
// their own header either way, so the sidebar just sits alongside it.
const isSidebarLayout = computed(() => customizationStore.layoutMode === 'sidebar');
function goToShelf(type) {
  router.push({ path: '/', query: type && type !== 'all' ? { type } : {} });
}


const validTabs = ['libraries', 'health', 'metadata', 'users', 'logs', 'stats', 'activity', 'settings'];
const activeTab = ref(validTabs.includes(route.query.tab) ? route.query.tab : 'libraries');
const libraries = ref([]);
const users = ref([]);
const discoveredFolders = ref([]);
const scanningId = ref(null);

const logs = ref([]);
const logSearch = ref('');
const selectedLogLevel = ref('all');
const loadingLogs = ref(false);
const autoRefresh = ref(true);
let logPollTimer = null;

const serverStats = ref(null);

const activity = ref([]);
const activityUserFilter = ref('');
const loadingActivity = ref(false);

const allowedFilters = ref(['series', 'creator', 'disk_folder', 'custom_folder']);
const savingFilters = ref(false);

// Series and Creator can't be turned off (the server enforces it too); the folder views can.
const allServerFilterModes = [
  { id: 'series', label: 'Series', desc: '', always: true },
  { id: 'creator', label: 'Creator', desc: '', always: true },
  { id: 'disk_folder', label: 'Disk Folders', desc: 'Browse by the folders on the server.' },
  { id: 'custom_folder', label: 'Custom Folders', desc: 'Users’ own in-app folders, with an Unorganized catch-all.' }
];

const tmdbConfigured = ref(false);
const tmdbKeyInput = ref('');
const savingTmdbKey = ref(false);

const transcoding = ref({ preference: 'auto', detected: null, available: [] });
const testingHwaccel = ref(false);
const hwaccelTestResult = ref(null);
// "Auto" has nothing specific to test until something is actually detected.
const testableMethod = computed(() => transcoding.value.preference === 'auto'
  ? transcoding.value.detected
  : (transcoding.value.preference === 'none' ? null : transcoding.value.preference));

const showAddLibraryModal = ref(false);
const newLib = ref({ name: '', path: '', type: 'audiobooks' });

const showFolderBrowser = ref(false);
const browserCurrentDir = ref('/media');
const browserEntries = ref([]);
const browserLoading = ref(false);
const browserError = ref('');

const showAddUserModal = ref(false);
const newUser = ref({ username: '', password: '', role: 'viewer', duration: 'forever', customExpiry: '' });

const showEditUserModal = ref(false);
const savingEditUser = ref(false);
const editUser = ref({ id: null, username: '', newPassword: '', duration: 'unchanged', customExpiry: '', currentExpiresAt: null });

const showExtendModal = ref(false);
const extendTargetUser = ref(null);
const extendDuration = ref('7d');
const extendingUser = ref(false);

const savingCustomization = ref(false);
const customizationForm = ref({
  serverName: 'Plinthio',
  customCss: '',
  accentTheme: 'zinc',
  loginMessage: '',
  layoutMode: 'topnav'
});

const accentPresets = [
  { id: 'zinc', label: 'Zinc', bg: 'bg-zinc-500' },
  { id: 'slate', label: 'Slate', bg: 'bg-slate-500' },
  { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500' },
  { id: 'violet', label: 'Violet', bg: 'bg-violet-500' },
  { id: 'rose', label: 'Rose', bg: 'bg-rose-500' },
  { id: 'amber', label: 'Amber', bg: 'bg-amber-500' },
  { id: 'sky', label: 'Sky', bg: 'bg-sky-500' },
  { id: 'indigo', label: 'Indigo', bg: 'bg-indigo-500' }
];

const updateInfo = ref(null);
const checkingUpdates = ref(false);
async function checkUpdates(force = true) {
  checkingUpdates.value = true;
  try {
    const res = await api.get('/system/update', { params: force === true ? { refresh: '1' } : {} });
    updateInfo.value = res.data;
  } catch (err) {
    // Leave the card as it was.
  } finally {
    checkingUpdates.value = false;
  }
}

function switchTab(tab) {
  activeTab.value = tab;
  if (tab === 'settings') checkUpdates(false);
  if (tab === 'logs') {
    loadLogs();
  } else if (tab === 'stats') {
    loadStats();
  } else if (tab === 'activity') {
    loadActivity();
  } else if (tab === 'settings') {
    loadServerFilters();
    loadMetadataProviders();
    loadTranscoding();
    loadCustomization();
    loadBackupConfig();
    loadStoredBackups();
    loadAutoScanConfig();
  }
}

async function loadCustomization() {
  try {
    await customizationStore.fetchCustomization();
    customizationForm.value = {
      serverName: customizationStore.serverName,
      customCss: customizationStore.customCss,
      accentTheme: customizationStore.accentTheme,
      loginMessage: customizationStore.loginMessage,
      layoutMode: customizationStore.layoutMode
    };
  } catch (err) {
    console.warn('Failed to load customization:', err);
  }
}

async function selectAccent(accentId) {
  customizationForm.value.accentTheme = accentId;
  document.documentElement.setAttribute('data-accent', accentId);
  try {
    await customizationStore.updateCustomization({ accentTheme: accentId });
  } catch (e) {
    dialog.alert('Failed to save accent theme');
  }
}

async function selectLayoutMode(mode) {
  const previous = customizationForm.value.layoutMode;
  customizationForm.value.layoutMode = mode;
  try {
    await customizationStore.updateCustomization({ layoutMode: mode });
  } catch (e) {
    customizationForm.value.layoutMode = previous;
    dialog.alert('Failed to save navigation layout');
  }
}

function previewCustomCss() {
  let tag = document.getElementById('plinthio-custom-css');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'plinthio-custom-css';
    document.head.appendChild(tag);
  }
  tag.textContent = customizationForm.value.customCss || '';
}

async function saveCustomization() {
  savingCustomization.value = true;
  try {
    await customizationStore.updateCustomization({
      serverName: customizationForm.value.serverName.trim(),
      customCss: customizationForm.value.customCss,
      accentTheme: customizationForm.value.accentTheme,
      loginMessage: customizationForm.value.loginMessage.trim()
    });
    dialog.alert('Branding and CSS saved successfully!');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save customization');
  } finally {
    savingCustomization.value = false;
  }
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

function roleBadgeClass(role) {
  if (role === 'admin') return 'bg-primary/10 text-primary border-primary/20';
  if (role === 'editor') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

async function changeUserRole(user, role) {
  if (role === user.role) return;
  try {
    await api.patch(`/users/${user.id}/role`, { role });
    user.role = role;
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to update role');
    await loadData();
  }
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// SQLite's CURRENT_TIMESTAMP is UTC but stored without a timezone marker
// ("YYYY-MM-DD HH:MM:SS"), which the JS Date constructor otherwise misreads as local time.
function parseServerDate(value) {
  if (!value) return null;
  const iso = value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(iso);
}

function formatDateTime(value) {
  const d = parseServerDate(value);
  if (!d) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadMetadataProviders() {
  try {
    const res = await api.get('/settings/metadata-providers');
    tmdbConfigured.value = !!res.data.tmdbConfigured;
  } catch (err) {
    console.warn('Failed to load metadata provider status:', err);
  }
}

async function loadTranscoding() {
  try {
    const res = await api.get('/settings/transcoding');
    transcoding.value = res.data;
  } catch (err) {
    console.warn('Failed to load transcoding settings:', err);
  }
}

async function saveTranscoding() {
  hwaccelTestResult.value = null;
  try {
    await api.put('/settings/transcoding', { preference: transcoding.value.preference });
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save transcoding settings');
  }
}

async function runHwaccelTest() {
  if (!testableMethod.value) return;
  testingHwaccel.value = true;
  hwaccelTestResult.value = null;
  try {
    const res = await api.post('/settings/transcoding/test', { method: testableMethod.value });
    hwaccelTestResult.value = res.data;
  } catch (err) {
    hwaccelTestResult.value = { ok: false, error: err.response?.data?.error || 'Test failed' };
  } finally {
    testingHwaccel.value = false;
  }
}

async function saveTmdbKey() {
  savingTmdbKey.value = true;
  try {
    const res = await api.put('/settings/metadata-providers/tmdb-key', { apiKey: tmdbKeyInput.value });
    tmdbConfigured.value = !!res.data.tmdbConfigured;
    tmdbKeyInput.value = '';
    dialog.alert(res.data.message || 'TMDB API key updated');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to update TMDB API key');
  } finally {
    savingTmdbKey.value = false;
  }
}

const downloadingBackup = ref(false);
async function downloadBackup() {
  downloadingBackup.value = true;
  try {
    const res = await api.get('/settings/backup', { responseType: 'blob' });
    const disposition = res.headers['content-disposition'] || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `plinthio-backup-${Date.now()}.sqlite`;

    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    dialog.alert('Failed to create database backup — see browser console for details.');
    console.error('Backup download failed:', err);
  } finally {
    downloadingBackup.value = false;
  }
}

const backupConfig = ref({ enabled: false, intervalHours: 24, retentionCount: 7 });
const autoScanConfig = ref({ enabled: true, intervalMinutes: 60, watchEnabled: true });
const savingAutoScanConfig = ref(false);

async function loadAutoScanConfig() {
  try {
    const res = await api.get('/settings/auto-scan');
    autoScanConfig.value = {
      enabled: !!res.data.enabled,
      intervalMinutes: res.data.intervalMinutes || 60,
      watchEnabled: !!res.data.watchEnabled
    };
  } catch (err) {
    console.warn('Failed to load automatic scanning settings:', err);
  }
}

async function saveAutoScanConfig() {
  savingAutoScanConfig.value = true;
  try {
    const res = await api.put('/settings/auto-scan', autoScanConfig.value);
    autoScanConfig.value = {
      enabled: !!res.data.enabled,
      intervalMinutes: res.data.intervalMinutes,
      watchEnabled: !!res.data.watchEnabled
    };
    dialog.alert('Automatic scanning settings saved');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save automatic scanning settings');
  } finally {
    savingAutoScanConfig.value = false;
  }
}
const savingBackupConfig = ref(false);
const creatingBackup = ref(false);
const storedBackups = ref([]);

async function loadBackupConfig() {
  try {
    const res = await api.get('/settings/backup/config');
    backupConfig.value = {
      enabled: !!res.data.enabled,
      intervalHours: res.data.intervalHours || 24,
      retentionCount: res.data.retentionCount || 7
    };
  } catch (err) {
    console.warn('Failed to load backup schedule:', err);
  }
}

async function loadStoredBackups() {
  try {
    const res = await api.get('/settings/backup/list');
    storedBackups.value = res.data.backups || [];
  } catch (err) {
    console.warn('Failed to load stored backups:', err);
  }
}

async function saveBackupConfig() {
  savingBackupConfig.value = true;
  try {
    const res = await api.put('/settings/backup/config', backupConfig.value);
    backupConfig.value = {
      enabled: !!res.data.enabled,
      intervalHours: res.data.intervalHours,
      retentionCount: res.data.retentionCount
    };
    dialog.alert({ title: 'Backup schedule saved', message: 'Automatic backups are configured.', type: 'success' });
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to save backup schedule');
  } finally {
    savingBackupConfig.value = false;
  }
}

async function createBackupNow() {
  creatingBackup.value = true;
  try {
    const res = await api.post('/settings/backup/create');
    storedBackups.value = res.data.backups || [];
    dialog.alert({ title: 'Backup created', message: 'A new backup has been saved on the server.', type: 'success' });
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to create backup');
  } finally {
    creatingBackup.value = false;
  }
}

async function downloadStoredBackup(backup) {
  try {
    const res = await api.get(`/settings/backup/${encodeURIComponent(backup.filename)}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = backup.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    dialog.alert('Failed to download backup — see browser console for details.');
    console.error('Backup download failed:', err);
  }
}

async function deleteStoredBackup(backup) {
  const confirmed = await dialog.confirm({
    title: 'Delete Backup',
    message: `Delete backup from ${formatBackupDate(backup.createdAt)}? This cannot be undone.`,
    confirmText: 'Delete Backup',
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await api.delete(`/settings/backup/${encodeURIComponent(backup.filename)}`);
    storedBackups.value = res.data.backups || [];
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to delete backup');
  }
}

function formatBackupDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadServerFilters() {
  try {
    const res = await api.get('/settings/filters');
    if (res.data.allowedGroupingModes) {
      allowedFilters.value = res.data.allowedGroupingModes;
    }
  } catch (err) {
    console.warn('Failed to load server filters:', err);
  }
}

async function saveServerFilters() {
  savingFilters.value = true;
  try {
    const res = await api.patch('/settings/filters', { allowedGroupingModes: allowedFilters.value });
    allowedFilters.value = res.data.allowedGroupingModes || allowedFilters.value;
    dialog.alert('Shelf views updated.');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to update filter settings');
  } finally {
    savingFilters.value = false;
  }
}

async function loadData() {
  try {
    const [libRes, userRes] = await Promise.all([
      api.get('/libraries'),
      api.get('/users'),
      loadServerFilters()
    ]);
    libraries.value = libRes.data.libraries || [];
    users.value = userRes.data.users || [];
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

async function loadLogs() {
  loadingLogs.value = true;
  try {
    const params = { limit: 100 };
    if (selectedLogLevel.value !== 'all') {
      params.level = selectedLogLevel.value;
    }
    if (logSearch.value.trim()) {
      params.search = logSearch.value.trim();
    }
    const res = await api.get('/admin/logs', { params });
    logs.value = res.data.logs || [];
  } catch (err) {
    console.warn('Failed to load system logs:', err);
  } finally {
    loadingLogs.value = false;
  }
}

function setLogLevel(lvl) {
  selectedLogLevel.value = lvl;
  loadLogs();
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) {
    startLogPolling();
  } else {
    stopLogPolling();
  }
}

function startLogPolling() {
  stopLogPolling();
  logPollTimer = setInterval(() => {
    if (activeTab.value === 'logs' && autoRefresh.value) {
      loadLogs();
    }
  }, 3000);
}

function stopLogPolling() {
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
}

async function clearLogs() {
  const confirmed = await dialog.confirm({
    title: 'Clear System Logs',
    message: 'Are you sure you want to clear all system logs from the database?',
    confirmText: 'Clear Logs',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete('/admin/logs');
    logs.value = [];
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to clear logs');
  }
}

async function loadStats() {
  try {
    const res = await api.get('/stats/admin');
    serverStats.value = res.data;
  } catch (err) {
    console.warn('Failed to load stats:', err);
  }
}

async function loadActivity() {
  loadingActivity.value = true;
  try {
    const params = { limit: 150 };
    if (activityUserFilter.value) params.userId = activityUserFilter.value;
    const res = await api.get('/activity/admin', { params });
    activity.value = res.data.activity || [];
  } catch (err) {
    console.warn('Failed to load activity:', err);
  } finally {
    loadingActivity.value = false;
  }
}

function formatDurationShort(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = (seconds / 3600).toFixed(1);
  return `${hrs}h`;
}

function formatLogTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatHours(seconds) {
  if (!seconds) return '0 hrs';
  const hrs = (seconds / 3600).toFixed(1);
  return `${hrs} hrs`;
}

async function openAddLibraryModal() {
  showAddLibraryModal.value = true;
  try {
    const res = await api.get('/libraries/browse');
    discoveredFolders.value = res.data.directories || [];
  } catch (err) {
    console.warn('Could not browse folders:', err);
  }
}

function selectFolder(folder) {
  newLib.value.path = folder.path;
  if (!newLib.value.name) {
    newLib.value.name = folder.name;
  }
  if (folder.name.toLowerCase().includes('manga') || folder.name.toLowerCase().includes('comic')) {
    newLib.value.type = 'manga';
  } else if (folder.name.toLowerCase().includes('book')) {
    newLib.value.type = 'audiobooks';
  }
}

async function openFolderBrowser() {
  showFolderBrowser.value = true;
  await browseTo(newLib.value.path || '/media');
}

async function browseTo(dir) {
  browserLoading.value = true;
  browserError.value = '';
  try {
    const res = await api.get('/libraries/browse', { params: { dir } });
    browserCurrentDir.value = res.data.currentDir || dir;
    browserEntries.value = res.data.directories || [];
  } catch (err) {
    browserError.value = err.response?.data?.error || 'Failed to browse folder';
  } finally {
    browserLoading.value = false;
  }
}

function browseUp() {
  const parent = browserCurrentDir.value.split('/').filter(Boolean);
  parent.pop();
  browseTo('/' + parent.join('/'));
}

function browseToBreadcrumb(index) {
  const parts = browserCurrentDir.value.split('/').filter(Boolean);
  const target = '/' + parts.slice(0, index + 1).join('/');
  browseTo(target);
}

function confirmFolderSelection() {
  newLib.value.path = browserCurrentDir.value;
  const folderName = browserCurrentDir.value.split('/').filter(Boolean).pop() || '';
  if (!newLib.value.name && folderName) {
    newLib.value.name = folderName;
  }
  const lower = folderName.toLowerCase();
  if (lower.includes('manga') || lower.includes('comic')) {
    newLib.value.type = 'manga';
  } else if (lower.includes('book')) {
    newLib.value.type = 'audiobooks';
  }
  showFolderBrowser.value = false;
}

async function triggerScan(lib) {
  scanningId.value = lib.id;
  try {
    const res = await api.post(`/libraries/${lib.id}/scan`);
    await loadData();
    if (activeTab.value === 'logs') loadLogs();
    if (activeTab.value === 'stats') loadStats();

    const { added = 0, updated = 0, renamed = 0, removed = 0 } = res.data || {};
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (renamed) parts.push(`${renamed} renamed/moved`);
    if (updated) parts.push(`${updated} updated`);
    if (removed) parts.push(`${removed} removed`);
    if (parts.length) {
      dialog.alert(`Scan complete: ${parts.join(', ')}.`);
    }
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Scan failed');
  } finally {
    scanningId.value = null;
  }
}

async function deleteLibrary(lib) {
  const confirmed = await dialog.confirm({
    title: 'Delete Library',
    message: `Are you sure you want to delete the library "${lib.name}"? Media files on disk will not be touched, and reading progress/bookmarks are preserved (they'll re-attach automatically if you re-scan the same folder), but the catalog entries themselves — titles, covers, metadata — will be removed and need a re-scan to rebuild.`,
    confirmText: 'Delete Library',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete(`/libraries/${lib.id}`);
    await loadData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to delete');
  }
}

async function submitAddLibrary() {
  try {
    await api.post('/libraries', newLib.value);
    showAddLibraryModal.value = false;
    newLib.value = { name: '', path: '', type: 'audiobooks' };
    await loadData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to add library');
  }
}

function isUserExpired(user) {
  if (!user.expires_at) return false;
  return new Date(user.expires_at).getTime() <= Date.now();
}

function isUserExpiringSoon(user) {
  if (!user.expires_at) return false;
  const diffMs = new Date(user.expires_at).getTime() - Date.now();
  return diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function getUserExpirationLabel(user) {
  if (!user.expires_at) return 'Unlimited';
  const diffMs = new Date(user.expires_at).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    return `${hours}h left`;
  }
  return `${days}d left`;
}

function openExtendUserModal(user) {
  extendTargetUser.value = user;
  extendDuration.value = '7d';
  showExtendModal.value = true;
}

async function submitExtendUser() {
  if (!extendTargetUser.value) return;
  extendingUser.value = true;
  try {
    await api.post(`/users/${extendTargetUser.value.id}/extend`, { duration: extendDuration.value });
    showExtendModal.value = false;
    await loadData();
    dialog.alert(extendDuration.value === 'forever' ? 'Account access set to unlimited' : 'Account access extended successfully');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to extend account access');
  } finally {
    extendingUser.value = false;
  }
}

async function submitAddUser() {
  try {
    const payload = {
      username: newUser.value.username,
      password: newUser.value.password,
      role: newUser.value.role,
      duration: newUser.value.duration === 'custom' ? newUser.value.customExpiry : newUser.value.duration
    };
    await api.post('/users', payload);
    showAddUserModal.value = false;
    newUser.value = { username: '', password: '', role: 'viewer', duration: 'forever', customExpiry: '' };
    await loadData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to add user');
  }
}

function openEditUserModal(user) {
  editUser.value = {
    id: user.id,
    username: user.username,
    newPassword: '',
    duration: 'unchanged',
    customExpiry: '',
    currentExpiresAt: user.expires_at,
    maxAgeRating: user.max_age_rating || '',
    allowUnrated: user.allow_unrated !== 0
  };
  showEditUserModal.value = true;
}

async function submitEditUser() {
  savingEditUser.value = true;
  try {
    const target = users.value.find(u => u.id === editUser.value.id);
    const updates = {};
    if (target && editUser.value.username.trim() !== target.username) {
      updates.username = editUser.value.username.trim();
    }
    if (target && editUser.value.id !== authStore.user?.id) {
      if ((editUser.value.maxAgeRating || '') !== (target.max_age_rating || '')) {
        updates.maxAgeRating = editUser.value.maxAgeRating || null;
      }
      if (editUser.value.allowUnrated !== (target.allow_unrated !== 0)) {
        updates.allowUnrated = editUser.value.allowUnrated;
      }
    }
    if (editUser.value.duration !== 'unchanged') {
      updates.duration = editUser.value.duration === 'custom'
        ? editUser.value.customExpiry
        : editUser.value.duration;
    }
    if (Object.keys(updates).length > 0) {
      await api.patch(`/users/${editUser.value.id}`, updates);
    }
    if (editUser.value.newPassword) {
      if (editUser.value.newPassword.length < 8) {
        dialog.alert('New password must be at least 8 characters');
        savingEditUser.value = false;
        return;
      }
      await api.patch(`/users/${editUser.value.id}/password`, { newPassword: editUser.value.newPassword });
    }
    showEditUserModal.value = false;
    await loadData();
    dialog.alert('User updated successfully');
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to update user');
  } finally {
    savingEditUser.value = false;
  }
}

async function deleteUser(user) {
  const confirmed = await dialog.confirm({
    title: 'Delete User',
    message: `Are you sure you want to delete user "${user.username}"?`,
    confirmText: 'Delete User',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.delete(`/users/${user.id}`);
    await loadData();
  } catch (err) {
    dialog.alert(err.response?.data?.error || 'Failed to delete user');
  }
}

onMounted(() => {
  loadData();
  startLogPolling();
  if (activeTab.value !== 'libraries') {
    switchTab(activeTab.value);
  }
});

onUnmounted(() => {
  stopLogPolling();
});
</script>
