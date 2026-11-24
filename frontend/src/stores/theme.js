import { defineStore } from 'pinia';

// Text size scales the root font size, and with it everything sized in rem: text, spacing
// and controls together, like the browser's own zoom. The build emits pixel text sizes in
// rem (postcss.config.js) so they follow too.
export const TEXT_SIZES = { small: 87.5, default: 100, large: 112.5, xlarge: 125 };

function storedTextSize() {
  const stored = localStorage.getItem('plinthio_text_size');
  return stored in TEXT_SIZES ? stored : 'default';
}

// Light/dark and text size are kept per device (a phone and a TV want different sizes), so
// they apply before sign-in too.
export const useThemeStore = defineStore('theme', {
  state: () => ({
    isDark: localStorage.getItem('plinthio_theme') === 'light' ? false : true,
    textSize: storedTextSize()
  }),

  actions: {
    initTheme() {
      this.applyTheme();
      this.applyTextSize();
    },

    toggleTheme() {
      this.isDark = !this.isDark;
      localStorage.setItem('plinthio_theme', this.isDark ? 'dark' : 'light');
      this.applyTheme();
    },

    applyTheme() {
      if (this.isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    },

    setTextSize(size) {
      this.textSize = size in TEXT_SIZES ? size : 'default';
      if (this.textSize === 'default') localStorage.removeItem('plinthio_text_size');
      else localStorage.setItem('plinthio_text_size', this.textSize);
      this.applyTextSize();
    },

    applyTextSize() {
      // The default leaves the browser's own base size (and the reader's setting for it) alone.
      document.documentElement.style.fontSize = this.textSize === 'default' ? '' : `${TEXT_SIZES[this.textSize]}%`;
    }
  }
});
