// Titles marked ignored, or in a library set to ignore missing metadata, are never flagged as gaps.
// The row must select items.metadata_ignored and libraries.ignore_missing_metadata.
export function isMetadataIgnored(row) {
  return row.metadata_ignored === 1 || row.ignore_missing_metadata === 1;
}
