<template>
  <div class="min-h-screen bg-background flex items-center justify-center p-4 transition-colors overflow-y-auto safe-top safe-bottom">
    <div class="w-full max-w-sm bg-card border border-border rounded-xl p-6 shadow-lg my-auto">
      <!-- App Header -->
      <div class="flex flex-col items-center text-center mb-6">
        <div class="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mb-3 shadow-sm">
          <BookOpen class="w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold tracking-tight text-foreground">
          {{ isSetup ? 'Welcome back' : 'Initial Server Setup' }}
        </h1>
        <p class="text-xs text-muted-foreground mt-1">
          {{ isSetup ? 'Sign in to access your library' : 'Create an Administrator account to get started' }}
        </p>
      </div>

      <!-- Expired Account State -->
      <div v-if="isExpired" class="flex flex-col items-center text-center py-2 animate-in fade-in duration-200">
        <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center mb-3.5 shadow-sm">
          <Lock class="w-6 h-6" />
        </div>
        <h2 class="text-base font-bold text-foreground">Account Access Expired</h2>
        <p class="text-xs text-muted-foreground mt-2 leading-relaxed">
          Your access pass for <strong class="text-foreground font-semibold">@{{ username }}</strong> has concluded. Please reach out to your server administrator to renew or extend your access.
        </p>

        <button
          type="button"
          @click="resetExpired"
          class="mt-6 w-full h-9 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-medium transition active:scale-95"
        >
          Back to Sign In
        </button>
      </div>

      <!-- Regular Login Form -->
      <template v-else>
        <!-- Error Alert -->
        <div v-if="error" class="mb-4 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertCircle class="w-4 h-4 flex-shrink-0" />
          <span>{{ error }}</span>
        </div>

        <!-- Form -->
        <form @submit.prevent="handleSubmit" class="flex flex-col gap-3.5">
          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Username</label>
            <input
              v-model="username"
              type="text"
              required
              autocomplete="username"
              class="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition"
              placeholder="admin"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-foreground mb-1.5">Password</label>
            <input
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              class="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition"
              placeholder="••••••••"
            />
            <p v-if="!isSetup" class="text-[11px] text-muted-foreground mt-1">Minimum 8 characters</p>
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="mt-2 w-full bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground font-medium py-2 rounded-md text-xs shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Loader2 v-if="loading" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ isSetup ? 'Sign In' : 'Create Account' }}</span>
          </button>
        </form>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { BookOpen, AlertCircle, Loader2, Lock } from 'lucide-vue-next';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const isSetup = ref(true);
const isExpired = ref(false);

onMounted(async () => {
  isSetup.value = await authStore.checkSetupStatus();
});

function resetExpired() {
  isExpired.value = false;
  error.value = '';
  password.value = '';
}

async function handleSubmit() {
  error.value = '';
  isExpired.value = false;
  loading.value = true;
  try {
    if (!isSetup.value) {
      await authStore.setup(username.value, password.value);
    } else {
      await authStore.login(username.value, password.value);
    }
    router.push('/');
  } catch (err) {
    if (err.response?.data?.code === 'P103') {
      isExpired.value = true;
    } else {
      error.value = err.response?.data?.error || 'Authentication failed';
    }
  } finally {
    loading.value = false;
  }
}
</script>
