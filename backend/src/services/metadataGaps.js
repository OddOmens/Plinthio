// What counts as a metadata gap worth flagging (Admin → Metadata's "No poster" and "No
// synopsis", Health's metadata list). A title an admin said to ignore, or any title in a
// library set to ignore missing metadata, is never one: a home video has no poster to find.

/** For a row selected with items.metadata_ignored and libraries.ignore_missing_metadata. */
export function isMetadataIgnored(row) {
  return row.metadata_ignored === 1 || row.ignore_missing_metadata === 1;
}
