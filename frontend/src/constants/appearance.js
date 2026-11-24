// Look-and-feel options shared by Admin and Settings → Appearance. `swatch`, `diagram` and
// `icon` are how OptionTiles draws each. Labels are getters so they follow the language.
import { StretchHorizontal, RectangleHorizontal, MonitorSmartphone, Sun, Moon, Grid3x3, LayoutGrid, Grid2x2 } from '@lucide/vue';
import { t } from '../i18n';

const accent = (id, swatch) => ({ id, swatch, get label() { return t(`appearance.accents.${id}`); } });
const option = (group, id, extra = {}) => ({
  id,
  ...extra,
  get label() { return t(`appearance.${group}.${id}.label`); },
  get desc() { return t(`appearance.${group}.${id}.desc`); }
});

// Ordered around the colour wheel, greys first.
export const ACCENT_OPTIONS = [
  accent('zinc', 'bg-zinc-500'),
  accent('slate', 'bg-slate-500'),
  accent('red', 'bg-red-500'),
  accent('orange', 'bg-orange-500'),
  accent('amber', 'bg-amber-500'),
  accent('lime', 'bg-lime-500'),
  accent('emerald', 'bg-emerald-500'),
  accent('teal', 'bg-teal-500'),
  accent('sky', 'bg-sky-500'),
  accent('blue', 'bg-blue-500'),
  accent('indigo', 'bg-indigo-500'),
  accent('violet', 'bg-violet-500'),
  accent('purple', 'bg-purple-500'),
  accent('fuchsia', 'bg-fuchsia-500'),
  accent('pink', 'bg-pink-500'),
  accent('rose', 'bg-rose-500')
];

export const LAYOUT_OPTIONS = [
  option('layouts', 'topnav', { diagram: 'topnav' }),
  option('layouts', 'sidebar', { diagram: 'sidebar' })
];

export const PAGE_WIDTH_OPTIONS = [
  option('pageWidths', 'full', { icon: StretchHorizontal }),
  option('pageWidths', 'contained', { icon: RectangleHorizontal })
];

export const PAUSE_SCREEN_OPTIONS = [
  option('pauseScreens', 'simple'),
  option('pauseScreens', 'details'),
  option('pauseScreens', 'cinematic'),
  option('pauseScreens', 'bedtime')
];

export function optionLabel(options, id) {
  return options.find((o) => o.id === id)?.label || id;
}

// Smallest to largest. `sample` is the tile's own "Aa", drawn at that size.
const textSize = (id, sample) => ({ id, sample, get label() { return t(`appearance.textSizes.${id}`); } });
export const TEXT_SIZE_OPTIONS = [
  textSize('small', 'text-xs'),
  textSize('default', 'text-sm'),
  textSize('large', 'text-base'),
  textSize('xlarge', 'text-lg')
];

// Light or dark; 'system' follows the device.
const simple = (group, id, extra = {}) => ({ id, ...extra, get label() { return t(`appearance.${group}.${id}`); } });
export const THEME_MODE_OPTIONS = [
  simple('themeModes', 'system', { icon: MonitorSmartphone }),
  simple('themeModes', 'light', { icon: Sun }),
  simple('themeModes', 'dark', { icon: Moon })
];

// Most posters in a row to fewest.
export const POSTER_SIZE_OPTIONS = [
  simple('posterSizes', 'compact', { icon: Grid3x3 }),
  simple('posterSizes', 'default', { icon: LayoutGrid }),
  simple('posterSizes', 'large', { icon: Grid2x2 })
];

// `fontFamily` draws each tile's "Aa" in its own lettering where the device already has it;
// the two that ship with the app show in it once chosen.
export const FONT_OPTIONS = [
  option('fonts', 'default', { sample: 'text-base' }),
  option('fonts', 'serif', { sample: 'text-base', fontFamily: 'ui-serif, Georgia, serif' }),
  option('fonts', 'legible', { sample: 'text-base', fontFamily: '"Atkinson Hyperlegible Next Variable", sans-serif' }),
  option('fonts', 'dyslexic', { sample: 'text-base', fontFamily: '"OpenDyslexic", sans-serif' })
];
