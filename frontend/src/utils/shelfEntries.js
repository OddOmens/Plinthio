// Turns a flat list of titles into what the shelf shows: one entry per series (keyed by
// library and media type too, since two libraries — or a manga and its anime — can share
// a name) and one per title with no series. Every shelf view uses this, so no view ever
// lays out individual volumes or episodes.

function compareVolumes(a, b) {
  if (a.volume == null && b.volume == null) return a.title.localeCompare(b.title, undefined, { numeric: true });
  if (a.volume == null) return 1;
  if (b.volume == null) return -1;
  return a.volume - b.volume;
}

export function compareNames(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// `alphabetical`: sort entries by name. Otherwise they keep the order of `items` (a series
// sits where its first-listed title would), which is how the server's sort is honoured.
// `ungroup(item)`: true for titles that should stand alone even though they're in a series
// (the shelf's "All movies" setting shows each Star Wars film rather than the collection).
export function buildShelfEntries(items, { alphabetical = true, ungroup = null } = {}) {
  const entries = [];
  const bySeries = new Map();
  for (const item of items) {
    if (item.series && !(ungroup && ungroup(item))) {
      const key = `s::${item.series}::${item.library_id}::${item.media_type}`;
      let entry = bySeries.get(key);
      if (!entry) {
        entry = {
          kind: 'series',
          key,
          name: item.series,
          author: item.author,
          libraryId: item.library_id,
          mediaType: item.media_type,
          volumes: []
        };
        bySeries.set(key, entry);
        entries.push(entry);
      }
      entry.volumes.push(item);
    } else {
      entries.push({ kind: 'item', key: `i::${item.id}`, name: item.title, item });
    }
  }
  for (const entry of bySeries.values()) entry.volumes.sort(compareVolumes);
  if (alphabetical) entries.sort((a, b) => compareNames(a.name, b.name));
  return entries;
}

// The folder an entry lives in, relative to its library: a title's own folder, or for a
// series the deepest folder all of its titles share — so a show split into Season 1/ and
// Season 2/ folders sits once under the show's folder instead of once per season.
export function entryFolder(entry) {
  const folders = entry.kind === 'series' ? entry.volumes.map((v) => v.folder || '') : [entry.item.folder || ''];
  const split = folders.map((f) => f.split('/').filter(Boolean));
  const common = [];
  for (let i = 0; split.every((parts) => i < parts.length && parts[i] === split[0][i]); i++) {
    common.push(split[0][i]);
  }
  // The last two segments keep group names readable ("Night Shift", "Manga/One Piece").
  return common.slice(-2).join('/') || 'Root';
}

// Groups entries under a heading computed per entry, alphabetically by heading.
export function groupEntries(entries, headingFor) {
  const groups = new Map();
  for (const entry of entries) {
    const heading = headingFor(entry);
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([heading, groupEntries]) => ({ heading, entries: groupEntries }));
}
