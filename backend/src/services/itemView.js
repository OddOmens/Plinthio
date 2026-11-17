import path from 'path';

// The absolute path reveals server layout, so only admins keep `path`; everyone gets
// `folder`, the item's directory relative to its library root.
export async function shapeItems(db, items, user) {
  if (!items || items.length === 0) return items;
  const libs = await db.all('SELECT id, path FROM libraries');
  const libPaths = new Map(libs.map((l) => [l.id, l.path]));
  const isAdmin = user?.role === 'admin';

  for (const item of items) {
    if (!item || !item.path) continue;
    const libPath = libPaths.get(item.library_id);
    const dir = path.dirname(item.path);
    item.folder = libPath ? path.relative(libPath, dir).split(path.sep).join('/') : path.basename(dir);
    if (!isAdmin) delete item.path;
  }
  return items;
}

export async function shapeItem(db, item, user) {
  if (item) await shapeItems(db, [item], user);
  return item;
}
