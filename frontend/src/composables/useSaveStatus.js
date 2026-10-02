import { ref, onUnmounted } from 'vue';

// For settings that save as they change: run the save, and keep a status for <SaveStatus>
// ("Saving…", then "Saved" for a few seconds, or the error until the next try). Resolves
// to { ok, data } and never throws, so a caller only has to undo its change when !ok.
export function useSaveStatus() {
  const status = ref('');
  const message = ref('');
  let timer = null;

  async function run(save, { saved = '' } = {}) {
    clearTimeout(timer);
    status.value = 'saving';
    message.value = '';
    try {
      const result = await save();
      status.value = 'saved';
      message.value = saved;
      timer = setTimeout(() => { status.value = ''; message.value = ''; }, saved ? 6000 : 2500);
      return { ok: true, data: result };
    } catch (err) {
      status.value = 'error';
      message.value = err?.response?.data?.error || '';
      return { ok: false, error: err };
    }
  }

  onUnmounted(() => clearTimeout(timer));
  return { status, message, run };
}
