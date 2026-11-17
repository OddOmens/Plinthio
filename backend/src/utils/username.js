// The one rule for account names: letters and digits from any script plus a few separators,
// keeping control characters, markup and huge names out of the DB and UI.
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._@ -]{0,63}$/u;

export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return USERNAME_RE.test(trimmed) ? trimmed : null;
}

export const USERNAME_RULE =
  'Usernames are 1–64 characters: letters, numbers, spaces, and . _ @ - (starting with a letter or number)';
