import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Text sizes written in pixels (`text-[11px]`) are emitted in rem, so the Text size setting,
// which scales the root font size, reaches them like every other size. At the default size
// nothing changes (11px is 0.6875rem). 16px and up is left alone: those are the touch-input
// sizes that stop iOS zooming into a field, and must not shrink.
const pxTextToRem = () => ({
  postcssPlugin: 'px-text-to-rem',
  Declaration(decl) {
    if (decl.prop !== 'font-size') return;
    const match = decl.value.match(/^(\d*\.?\d+)px$/);
    if (match && Number(match[1]) < 16) decl.value = `${Number((Number(match[1]) / 16).toFixed(4))}rem`;
  }
});
pxTextToRem.postcss = true;

export default {
  plugins: [tailwindcss(), pxTextToRem(), autoprefixer()]
};
