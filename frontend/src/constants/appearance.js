// The look-and-feel choices, shared by Admin → Server Config (the server's defaults) and
// Settings → Appearance (a person's own), so both show the same options the same way.
// `swatch`, `diagram` and `icon` are how OptionTiles draws each one.
import { StretchHorizontal, RectangleHorizontal } from '@lucide/vue';

// Ordered around the colour wheel, greys first.
export const ACCENT_OPTIONS = [
  { id: 'zinc', label: 'Zinc', swatch: 'bg-zinc-500' },
  { id: 'slate', label: 'Slate', swatch: 'bg-slate-500' },
  { id: 'red', label: 'Red', swatch: 'bg-red-500' },
  { id: 'orange', label: 'Orange', swatch: 'bg-orange-500' },
  { id: 'amber', label: 'Amber', swatch: 'bg-amber-500' },
  { id: 'lime', label: 'Lime', swatch: 'bg-lime-500' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'teal', label: 'Teal', swatch: 'bg-teal-500' },
  { id: 'sky', label: 'Sky', swatch: 'bg-sky-500' },
  { id: 'blue', label: 'Blue', swatch: 'bg-blue-500' },
  { id: 'indigo', label: 'Indigo', swatch: 'bg-indigo-500' },
  { id: 'violet', label: 'Violet', swatch: 'bg-violet-500' },
  { id: 'purple', label: 'Purple', swatch: 'bg-purple-500' },
  { id: 'fuchsia', label: 'Fuchsia', swatch: 'bg-fuchsia-500' },
  { id: 'pink', label: 'Pink', swatch: 'bg-pink-500' },
  { id: 'rose', label: 'Rose', swatch: 'bg-rose-500' }
];

export const LAYOUT_OPTIONS = [
  { id: 'topnav', label: 'Top Navigation', desc: 'Classic horizontal header bar', diagram: 'topnav' },
  { id: 'sidebar', label: 'Sidebar', desc: 'Vertical navigation on the left', diagram: 'sidebar' }
];

export const PAGE_WIDTH_OPTIONS = [
  { id: 'full', label: 'Full Width', desc: 'Use the whole screen, fitting more posters', icon: StretchHorizontal },
  { id: 'contained', label: 'Contained', desc: 'Centred, capped at 1440px wide', icon: RectangleHorizontal }
];

export const PAUSE_SCREEN_OPTIONS = [
  { id: 'simple', label: 'Simple', desc: 'Just the player controls — nothing covers the picture.' },
  { id: 'details', label: 'Details', desc: 'Poster, title, tagline, synopsis, director and cast, and when it will end.' },
  { id: 'cinematic', label: 'Cinematic', desc: 'The picture dims behind a full-screen title card with cast photos and facts from TMDB — box office, original title, keywords.' },
  { id: 'bedtime', label: 'Bedtime', desc: 'A dim clock with the time it ends and, for shows, when the rest of the season would. Easy on the eyes in a dark room.' }
];

export function optionLabel(options, id) {
  return options.find((o) => o.id === id)?.label || id;
}
