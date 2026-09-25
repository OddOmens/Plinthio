// One rule for every place an account name is set (setup wizard, admin create/rename).
// Letters and digits from any script plus a few separators — enough for real names and
// email-style logins, while keeping control characters, markup and 10KB "usernames" out of
// the users table, the login history and every screen that prints them.
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._@ -]{0,63}$/u;

export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return USERNAME_RE.test(trimmed) ? trimmed : null;
}

export const USERNAME_RULE =
  'Usernames are 1–64 characters: letters, numbers, spaces, and . _ @ - (starting with a letter or number)';
