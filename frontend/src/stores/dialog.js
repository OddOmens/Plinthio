import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDialogStore = defineStore('dialog', () => {
  const isOpen = ref(false);
  const title = ref('');
  const message = ref('');
  const type = ref('info'); // 'info', 'success', 'warning', 'danger'
  const confirmText = ref('OK');
  const cancelText = ref('Cancel');
  const showCancel = ref(false);
  const isDanger = ref(false);

  let resolver = null;

  function alert(opts) {
    if (typeof opts === 'string') {
      opts = { message: opts };
    }
    title.value = opts.title || 'Notification';
    message.value = opts.message || '';
    type.value = opts.type || 'info';
    confirmText.value = opts.confirmText || 'OK';
    cancelText.value = 'Cancel';
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
    title.value = opts.title || 'Are you sure?';
    message.value = opts.message || '';
    type.value = opts.type || (opts.danger ? 'danger' : 'warning');
    confirmText.value = opts.confirmText || 'Confirm';
    cancelText.value = opts.cancelText || 'Cancel';
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
