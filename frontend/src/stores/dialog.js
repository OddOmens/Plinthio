import { defineStore } from 'pinia';
import { ref } from 'vue';
import { t } from '../i18n';

// Default wording is looked up each time a dialog opens, so it follows the current language;
// callers pass their own (already translated) title, message and button labels.
export const useDialogStore = defineStore('dialog', () => {
  const isOpen = ref(false);
  const title = ref('');
  const message = ref('');
  const type = ref('info'); // 'info', 'success', 'warning', 'danger'
  const confirmText = ref('');
  const cancelText = ref('');
  const showCancel = ref(false);
  const isDanger = ref(false);

  let resolver = null;

  function alert(opts) {
    if (typeof opts === 'string') {
      opts = { message: opts };
    }
    title.value = opts.title || t('dialog.notification');
    message.value = opts.message || '';
    type.value = opts.type || 'info';
    confirmText.value = opts.confirmText || t('common.ok');
    cancelText.value = t('common.cancel');
    showCancel.value = false;
    isDanger.value = false;
    isOpen.value = true;

    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  function confirm(opts) {
    if (typeof opts === 'string') {
      opts = { message: opts };
    }
    title.value = opts.title || t('dialog.areYouSure');
    message.value = opts.message || '';
    type.value = opts.type || (opts.danger ? 'danger' : 'warning');
    confirmText.value = opts.confirmText || t('common.confirm');
    cancelText.value = opts.cancelText || t('common.cancel');
    showCancel.value = true;
    isDanger.value = !!opts.danger;
    isOpen.value = true;

    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  function onConfirm() {
    isOpen.value = false;
    if (resolver) {
      resolver(true);
      resolver = null;
    }
  }

  function onCancel() {
    isOpen.value = false;
    if (resolver) {
      resolver(false);
      resolver = null;
    }
  }

  return {
    isOpen,
    title,
    message,
    type,
    confirmText,
    cancelText,
    showCancel,
    isDanger,
    alert,
    confirm,
    onConfirm,
    onCancel
  };
});
