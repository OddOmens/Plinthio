// The look-and-feel choices, shared by Admin → Appearance (the server's defaults) and
// Settings → Appearance (a person's own), so both show the same options the same way.
// `swatch`, `diagram` and `icon` are how OptionTiles draws each one. Labels are getters so
// they follow the current language (spreading an option copies today's wording).
import { StretchHorizontal, RectangleHorizontal } from '@lucide/vue';
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
