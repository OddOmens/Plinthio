// Shelf views. Series and Creator are always on; Disk Folders and Custom Folders can be
// switched off by an admin (server-wide) or hidden by a user for themselves. Earlier
// versions used grid / author / series — those names map onto the current ones so saved
// preferences keep working.
export const SHELF_MODES = ['series', 'creator', 'disk_folder', 'custom_folder'];
export const OPTIONAL_SHELF_MODES = ['disk_folder', 'custom_folder'];
const LEGACY = { grid: 'series', series: 'series', author: 'creator', creator: 'creator', disk_folder: 'disk_folder', custom_folder: 'custom_folder' };

export function normalizeShelfModes(list) {
  const wanted = new Set((Array.isArray(list) ? list : SHELF_MODES).map((m) => LEGACY[m]).filter(Boolean));
  return SHELF_MODES.filter((m) => !OPTIONAL_SHELF_MODES.includes(m) || wanted.has(m));
}

// A user's own choice (Settings → Shelf Views): old names mapped, Series always kept, and
// anything they never saved defaults to everything.
export function userShelfModes(list) {
  if (!Array.isArray(list) || list.length === 0) return [...SHELF_MODES];
  const mapped = new Set(list.map((m) => LEGACY[m]).filter(Boolean));
  mapped.add('series');
  return SHELF_MODES.filter((m) => mapped.has(m));
}
