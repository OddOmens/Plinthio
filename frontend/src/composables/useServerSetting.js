import { useCustomizationStore } from '../stores/customization';
import { useSaveStatus } from './useSaveStatus';

// Admin settings kept in the customization store (look and feel, features): shown changed
// straight away, saved, and put back if the save fails. `set({ ratings: { showExternal:
// false } })` changes just that one, like the server does.
export function useServerSetting() {
  const store = useCustomizationStore();
  const save = useSaveStatus();

  // What the store has now at just the patch's own paths, so putting it back can't undo
  // another change made meanwhile to a neighbour (`ratings.showPersonal` vs `ratings.showExternal`).
  function pick(source, patch) {
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
      const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
      out[key] = isObject(value) && isObject(source?.[key])
        ? pick(source[key], value)
        : JSON.parse(JSON.stringify(source?.[key] ?? null));
    }
    return out;
  }

  async function set(patch) {
    const before = pick(store, patch);
    store.$patch(patch);
    const result = await save.run(() => store.updateCustomization(patch));
    if (!result.ok) store.$patch(before);
    return result;
  }

  return { ...save, set };
}
