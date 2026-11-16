// Item and Live TV channel ids are 32-char hex md5s. Rejecting anything else before an id
// builds a file path or hits the DB blocks path traversal via a malformed :id.
export const ITEM_ID_RE = /^[a-f0-9]{32}$/;
