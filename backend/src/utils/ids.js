// Item ids are always a 32-char hex md5 of the file path (see scanner.js), and Live TV channel
// ids are an md5 as well (services/liveTv.js). Rejecting anything else before an id is used
// to build a filesystem path or hits the DB closes off any path traversal / injection surface
// via a malformed :id.
export const ITEM_ID_RE = /^[a-f0-9]{32}$/;
