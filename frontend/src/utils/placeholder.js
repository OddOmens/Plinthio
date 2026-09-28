// A local stand-in cover (one letter on a dark card), rendered as an inline SVG data URL.
// These used to come from placehold.co, which leaked every series name on the shelf to a
// third party and broke offline.
export function placeholderCover(text = '?', { width = 200, height = 300 } = {}) {
  const label = String(text || '?').slice(0, 12)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fontSize = Math.round(Math.min(width, height) / (label.length > 2 ? 6 : 3));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#18181b"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#52525b" ` +
    `font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="600">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
