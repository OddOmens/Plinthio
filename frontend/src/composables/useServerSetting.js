import { useCustomizationStore } from '../stores/customization';
import { useSaveStatus } from './useSaveStatus';

// Admin settings kept in the customization store (look and feel, features): shown changed
// straight away, saved, and put back if the save fails. `set({ ratings: { showExternal:
// false } })` changes just that one, like the server does.
export function useServerSetting() {
  const store = useCustomizationStore();
  const save = useSaveStatus();

  async function set(patch) {
    const before = {};
    for (const key of Object.keys(patch)) before[key] = JSON.parse(JSON.stringify(store[key] ?? null));
    store.$patch(patch);
    const result = await save.run(() => store.updateCustomization(patch));
    if (!result.ok) store.$patch(before);
    return result;
  }

  return { ...save, set };
}
