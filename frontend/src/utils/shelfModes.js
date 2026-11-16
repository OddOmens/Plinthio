// Shelf views. Series and Creator are always on; the folder views can be turned off by an
// admin or hidden by a user. LEGACY maps old saved names (grid, author) onto current ones.
export const SHELF_MODES = ['series', 'creator', 'disk_folder', 'custom_folder'];
export const OPTIONAL_SHELF_MODES = ['disk_folder', 'custom_folder'];
const LEGACY = { grid: 'series', series: 'series', author: 'creator', creator: 'creator', disk_folder: 'disk_folder', custom_folder: 'custom_folder' };

export function normalizeShelfModes(list) {
  const wanted = new Set((Array.isArray(list) ? list : SHELF_MODES).map((m) => LEGACY[m]).filter(Boolean));
  return SHELF_MODES.filter((m) => !OPTIONAL_SHELF_MODES.includes(m) || wanted.has(m));
}

// A user's choice: Series always kept; nothing saved means everything.
export function userShelfModes(list) {
  if (!Array.isArray(list) || list.length === 0) return [...SHELF_MODES];
  const mapped = new Set(list.map((m) => LEGACY[m]).filter(Boolean));
  mapped.add('series');
  return SHELF_MODES.filter((m) => mapped.has(m));
}
