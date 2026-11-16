import { useCustomizationStore } from '../stores/customization';
import { useSaveStatus } from './useSaveStatus';

// Optimistic save of admin settings in the customization store, reverted on failure.
// Nested patches change only the given keys, as on the server.
export function useServerSetting() {
  const store = useCustomizationStore();
  const save = useSaveStatus();

  // Snapshot only the patch's own paths, so a revert can't undo a neighbouring change.
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
