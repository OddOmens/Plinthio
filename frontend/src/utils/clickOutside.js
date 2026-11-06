// v-click-outside: calls its value on a click anywhere else. The listener is attached on a
// deferred tick so the click that opened the menu (or dialog) doesn't close it straight away.
export const vClickOutside = {
  mounted(el, binding) {
    el.clickOutsideEvent = (event) => {
      if (!(el === event.target || el.contains(event.target))) binding.value();
    };
    el._clickOutsideTimer = setTimeout(() => {
      document.addEventListener('click', el.clickOutsideEvent);
    }, 0);
  },
  unmounted(el) {
    clearTimeout(el._clickOutsideTimer);
    document.removeEventListener('click', el.clickOutsideEvent);
  }
};
