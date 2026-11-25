// The rows above the main shelf on Home, in their usual order. A person's own order and
// hidden rows are kept on their account as preferences.homeRows = { order, hidden }. The
// Live TV row is ordered here but switched on and off by preferences.liveTv.showOnHome, the
// same switch as in Live TV → My channels.
export const HOME_ROWS = ['live', 'watching', 'reading'];

/** Every row, in the person's order; rows their saved order doesn't know come last. */
export function homeRowOrder(pref) {
  const saved = Array.isArray(pref?.order) ? pref.order.filter((id) => HOME_ROWS.includes(id)) : [];
  return [...new Set([...saved, ...HOME_ROWS])];
}

export function hiddenHomeRows(pref) {
  return Array.isArray(pref?.hidden) ? pref.hidden.filter((id) => id !== 'live' && HOME_ROWS.includes(id)) : [];
}
