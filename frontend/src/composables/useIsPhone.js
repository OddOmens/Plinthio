import { ref } from 'vue';

// True below Tailwind's `sm` breakpoint. One media-query listener shared by every caller,
// so a shelf of hundreds of cards doesn't register hundreds of them.
const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 639px)') : null;
const isPhone = ref(!!query?.matches);
query?.addEventListener?.('change', (e) => { isPhone.value = e.matches; });

export function useIsPhone() {
  return isPhone;
}
