import { defineStore } from 'pinia';

// Look-and-feel choices kept on the device rather than the account: a phone, a computer and
// a TV each want their own, and they apply before sign-in too.

// Text size scales the root font size, and with it everything sized in rem: text, spacing
// and controls together, like the browser's own zoom. The build emits pixel text sizes in
// rem (postcss.config.js) so they follow too.
export const TEXT_SIZES = { small: 87.5, default: 100, large: 112.5, xlarge: 125 };
// 'system' follows the device's light or dark setting as it changes.
export const THEME_MODES = ['system', 'light', 'dark'];
// How many posters sit in a row (assets/main.css: --poster-cols).
export const POSTER_SIZES = ['compact', 'default', 'large'];
// The lettering. The last two are downloaded only when chosen.
export const FONTS = ['default', 'serif', 'legible', 'dyslexic'];

const FONT_FILES = {
  legible: () => import('@fontsource-variable/atkinson-hyperlegible-next/wght.css'),
  dyslexic: () => Promise.all([import('@fontsource/opendyslexic/400.css'), import('@fontsource/opendyslexic/700.css')])
};

const KEYS = {
  mode: 'plinthio_theme',
  textSize: 'plinthio_text_size',
  posterSize: 'plinthio_poster_size',
  font: 'plinthio_font',
  reduceMotion: 'plinthio_reduce_motion'
};

function stored(key, allowed, fallback) {
  const value = localStorage.getItem(key);
  return allowed.includes(value) ? value : fallback;
}

// Kept as its default by removing the entry, so a later change of default reaches the device.
function store(key, value, fallback) {
  if (value === fallback) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
const systemReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

let watchingDevice = false;

export const useThemeStore = defineStore('theme', {
  state: () => {
    // Dark unless the device was set otherwise: the look Plinthio has always opened with.
    const mode = stored(KEYS.mode, THEME_MODES, 'dark');
    return {
      mode,
      isDark: mode === 'system' ? systemDark() : mode === 'dark',
      textSize: stored(KEYS.textSize, Object.keys(TEXT_SIZES), 'default'),
      posterSize: stored(KEYS.posterSize, POSTER_SIZES, 'default'),
      font: stored(KEYS.font, FONTS, 'default'),
      // Off follows the device's own "reduce motion" setting; on reduces it here regardless.
      reduceMotion: localStorage.getItem(KEYS.reduceMotion) === '1'
    };
  },

  actions: {
    initTheme() {
      this.applyTheme();
      this.applyTextSize();
      this.applyPosterSize();
      this.applyFont();
      this.applyMotion();
      if (watchingDevice || !window.matchMedia) return;
      watchingDevice = true;
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.applyTheme());
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => this.applyMotion());
    },

    setMode(mode) {
      this.mode = THEME_MODES.includes(mode) ? mode : 'dark';
      store(KEYS.mode, this.mode, 'dark');
      this.applyTheme();
    },

    // The menu's quick switch: the opposite of what is showing, whatever the device says.
    toggleTheme() {
      this.setMode(this.isDark ? 'light' : 'dark');
    },

    applyTheme() {
      this.isDark = this.mode === 'system' ? systemDark() : this.mode === 'dark';
      document.documentElement.classList.toggle('dark', this.isDark);
    },

    setTextSize(size) {
      this.textSize = size in TEXT_SIZES ? size : 'default';
      store(KEYS.textSize, this.textSize, 'default');
      this.applyTextSize();
    },

    applyTextSize() {
      // The default leaves the browser's own base size (and the reader's setting for it) alone.
      document.documentElement.style.fontSize = this.textSize === 'default' ? '' : `${TEXT_SIZES[this.textSize]}%`;
    },

    setPosterSize(size) {
      this.posterSize = POSTER_SIZES.includes(size) ? size : 'default';
      store(KEYS.posterSize, this.posterSize, 'default');
      this.applyPosterSize();
    },

    applyPosterSize() {
      const root = document.documentElement;
      if (this.posterSize === 'default') root.removeAttribute('data-posters');
      else root.setAttribute('data-posters', this.posterSize);
    },

    setFont(font) {
      this.font = FONTS.includes(font) ? font : 'default';
      store(KEYS.font, this.font, 'default');
      this.applyFont();
    },

    applyFont() {
      const root = document.documentElement;
      if (this.font === 'default') root.removeAttribute('data-font');
      else root.setAttribute('data-font', this.font);
      // Until its files arrive (or if they can't), the text stays in the usual lettering.
      FONT_FILES[this.font]?.().catch(() => {});
    },

    setReduceMotion(on) {
      this.reduceMotion = !!on;
      store(KEYS.reduceMotion, this.reduceMotion ? '1' : '0', '0');
      this.applyMotion();
    },

    applyMotion() {
      document.documentElement.classList.toggle('reduce-motion', this.reduceMotion || systemReducedMotion());
    }
  }
});
