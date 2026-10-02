// The EPUB reader's display settings. They belong to the person, not the book: set them
// once in any book and every book opens the same way, on every device (they're saved in
// the user's preferences as `ebookReader`).

export const EBOOK_DEFAULTS = Object.freeze({
  theme: 'auto',        // follows the app's light/dark mode until one is picked
  font: 'publisher',    // the book's own font
  fontSize: 18,
  lineHeight: 'normal',
  margins: 'normal',
  align: 'publisher',
  layout: 'paged',      // 'paged' | 'scrolled'
  columns: 'auto',      // two columns on a wide screen, or always one
  progress: 'percent'   // what the corner shows: percent | chapter | location | none
});

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 34;

// Page colours, like an e-reader. `dark` decides how highlights blend with the page.
export const READER_THEMES = {
  white: { label: 'White', bg: '#ffffff', fg: '#1c1c1c', muted: '#6b6b6b', border: '#e7e5e4', link: '#1d4ed8', dark: false },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#3b2e20', muted: '#7a6a55', border: '#e2d4b4', link: '#8a4b0f', dark: false },
  green: { label: 'Green', bg: '#d8e8d0', fg: '#1f2a1d', muted: '#566b52', border: '#c1d6b7', link: '#1f5f2a', dark: false },
  gray: { label: 'Gray', bg: '#3f3f46', fg: '#ececec', muted: '#a8a8b0', border: '#52525b', link: '#93c5fd', dark: true },
  black: { label: 'Black', bg: '#000000', fg: '#d6d6d6', muted: '#8a8a8a', border: '#262626', link: '#93c5fd', dark: true }
};

export const THEME_OPTIONS = [{ id: 'auto', label: 'Auto' }, ...Object.entries(READER_THEMES).map(([id, t]) => ({ id, label: t.label }))];

export function resolveTheme(id) {
  if (READER_THEMES[id]) return READER_THEMES[id];
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  // Auto: the app's own background, so opening a book doesn't flash a different colour.
  return dark
    ? { ...READER_THEMES.black, bg: '#0c0c0e' }
    : READER_THEMES.white;
}

export const FONT_OPTIONS = [
  { id: 'publisher', label: 'Original', css: null },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif' },
  { id: 'sans', label: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'readable', label: 'Readable', css: 'Verdana, Geneva, Tahoma, sans-serif' },
  { id: 'mono', label: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }
];

export const LINE_HEIGHTS = { compact: 1.4, normal: 1.65, loose: 1.95 };
export const LINE_HEIGHT_OPTIONS = [
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'loose', label: 'Loose' }
];

// Paged mode: the gap between columns, as a share of the page width (epub.js splits it
// into half a gap either side). Scrolled mode: side padding.
export const MARGINS = {
  narrow: { gap: 0.04, pad: '4%' },
  normal: { gap: 0.09, pad: '8%' },
  wide: { gap: 0.18, pad: '14%' }
};
export const MARGIN_OPTIONS = [
  { id: 'narrow', label: 'Narrow' },
  { id: 'normal', label: 'Normal' },
  { id: 'wide', label: 'Wide' }
];

export const ALIGN_OPTIONS = [
  { id: 'publisher', label: 'Original' },
  { id: 'left', label: 'Left' },
  { id: 'justify', label: 'Justified' }
];

export const PROGRESS_OPTIONS = [
  { id: 'percent', label: 'Percent of book' },
  { id: 'chapter', label: 'Pages left in chapter' },
  { id: 'location', label: 'Location' },
  { id: 'none', label: 'Nothing' }
];

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', fill: '#facc15' },
  { id: 'green', label: 'Green', fill: '#4ade80' },
  { id: 'blue', label: 'Blue', fill: '#60a5fa' },
  { id: 'pink', label: 'Pink', fill: '#f472b6' },
  { id: 'orange', label: 'Orange', fill: '#fb923c' }
];

export function highlightFill(color) {
  return (HIGHLIGHT_COLORS.find((c) => c.id === color) || HIGHLIGHT_COLORS[0]).fill;
}

// Stored settings merged over the defaults, with anything unknown (an old or hand-edited
// value) dropped back to its default.
export function normalizeEbookPrefs(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const pick = (key, allowed) => (allowed.includes(s[key]) ? s[key] : EBOOK_DEFAULTS[key]);
  const size = Number(s.fontSize);
  return {
    theme: pick('theme', THEME_OPTIONS.map((t) => t.id)),
    font: pick('font', FONT_OPTIONS.map((f) => f.id)),
    fontSize: Number.isFinite(size) ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size))) : EBOOK_DEFAULTS.fontSize,
    lineHeight: pick('lineHeight', Object.keys(LINE_HEIGHTS)),
    margins: pick('margins', Object.keys(MARGINS)),
    align: pick('align', ALIGN_OPTIONS.map((a) => a.id)),
    layout: pick('layout', ['paged', 'scrolled']),
    columns: pick('columns', ['auto', 'single']),
    progress: pick('progress', PROGRESS_OPTIONS.map((p) => p.id))
  };
}

// The stylesheet put into every chapter of the book. `!important` throughout, because a
// book's own CSS is free to set any of these and a reader setting has to win.
export function readerStylesheet(prefs) {
  const theme = resolveTheme(prefs.theme);
  const font = FONT_OPTIONS.find((f) => f.id === prefs.font)?.css;
  const lh = LINE_HEIGHTS[prefs.lineHeight] || LINE_HEIGHTS.normal;
  const rules = [
    `html, body { background: ${theme.bg} !important; }`,
    `body { color: ${theme.fg} !important; font-size: ${prefs.fontSize}px !important; line-height: ${lh} !important; -webkit-text-size-adjust: 100%; }`,
    // Coloured text and boxed backgrounds in a book's CSS fight every page colour but its own.
    `body *:not(a) { color: inherit !important; }`,
    `a, a * { color: ${theme.link} !important; }`,
    `p, li, blockquote, dd, dt { font-size: 1em !important; line-height: inherit !important; }`,
    `img, svg, video { max-width: 100% !important; }`,
    `::selection { background: rgba(250, 204, 21, 0.45); }`
  ];
  if (prefs.theme !== 'white') {
    rules.push(`body *:not(img):not(svg):not(image) { background-color: transparent !important; }`);
  }
  if (font) {
    rules.push(`body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${font} !important; }`);
  }
  if (prefs.align !== 'publisher') {
    const hyphens = prefs.align === 'justify' ? ' hyphens: auto; -webkit-hyphens: auto;' : '';
    rules.push(`p, li, blockquote { text-align: ${prefs.align} !important;${hyphens} }`);
  }
  if (prefs.layout === 'scrolled') {
    const pad = (MARGINS[prefs.margins] || MARGINS.normal).pad;
    rules.push(`body { padding: 1.5em ${pad} 3em !important; max-width: 46em; margin: 0 auto !important; box-sizing: border-box; }`);
  }
  return rules.join('\n');
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ra, rb)}${c(ga, gb)}${c(ba, bb)}`;
}

// The app's colour tokens are "h s% l%" triplets (see assets/main.css).
function hsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// The app's colour tokens re-pointed at a page theme. Set on the reader's root, so its bars
// and buttons — written with the usual bg-background / text-muted-foreground classes —
// take the page's colours instead of the app's.
export function themeTokens(theme) {
  const surface = mix(theme.bg, theme.fg, theme.dark ? 0.12 : 0.06);
  return {
    '--background': hsl(theme.bg),
    '--foreground': hsl(theme.fg),
    '--card': hsl(theme.bg),
    '--card-foreground': hsl(theme.fg),
    '--muted': hsl(surface),
    '--muted-foreground': hsl(theme.muted),
    '--secondary': hsl(surface),
    '--secondary-foreground': hsl(theme.fg),
    '--accent': hsl(surface),
    '--accent-foreground': hsl(theme.fg),
    '--border': hsl(theme.border),
    '--input': hsl(theme.border),
    colorScheme: theme.dark ? 'dark' : 'light'
  };
}
