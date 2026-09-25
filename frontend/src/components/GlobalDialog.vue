<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div
        v-if="dialog.isOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        @click.self="dialog.showCancel ? dialog.onCancel() : dialog.onConfirm()"
        @keydown.escape="dialog.showCancel ? dialog.onCancel() : dialog.onConfirm()"
      >
        <div
          class="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
        >
          <!-- Top Icon & Header -->
          <div class="flex items-start gap-3.5">
            <div
              :class="[
                'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm',
                dialog.type === 'danger' ? 'bg-destructive/15 text-destructive' :
                dialog.type === 'success' ? 'bg-emerald-500/15 text-emerald-500' :
                dialog.type === 'warning' ? 'bg-amber-500/15 text-amber-500' :
                'bg-primary/15 text-primary'
              ]"
            >
              <AlertOctagon v-if="dialog.type === 'danger'" class="w-5 h-5" />
              <CheckCircle v-else-if="dialog.type === 'success'" class="w-5 h-5" />
              <AlertTriangle v-else-if="dialog.type === 'warning'" class="w-5 h-5" />
              <Info v-else class="w-5 h-5" />
            </div>

            <div class="flex-1 min-w-0 pt-0.5">
              <h3 class="text-base font-bold text-foreground leading-snug">
                {{ dialog.title }}
              </h3>
              <p v-if="dialog.message" class="text-xs text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line">
                {{ dialog.message }}
              </p>
            </div>

            <button aria-label="Close"
              @click="dialog.showCancel ? dialog.onCancel() : dialog.onConfirm()"
              class="w-9 h-9 -mr-1.5 -mt-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 flex items-center justify-center transition"
              title="Close"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Buttons Action Row -->
          <div class="mt-6 flex items-center justify-end gap-2.5">
            <button
              v-if="dialog.showCancel"
              @click="dialog.onCancel"
              class="h-9 px-4 rounded-xl border border-border bg-background hover:bg-muted text-foreground text-xs font-medium transition active:scale-95"
            >
              {{ dialog.cancelText }}
            </button>

            <button
              @click="dialog.onConfirm"
              :class="[
                'h-9 px-4 rounded-xl text-xs font-semibold transition active:scale-95 shadow-sm',
                dialog.isDanger
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-destructive/20'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20'
              ]"
            >
              {{ dialog.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useDialogStore } from '../stores/dialog';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle,
  Info,
  X
} from 'lucide-vue-next';

const dialog = useDialogStore();
</script>

<style scoped>
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
