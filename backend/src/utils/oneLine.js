// Keeps request and file text on one line in server output. No imports: errors.js uses it and
// is also loaded by the frontend's translation check.

// Control characters plus Unicode line/paragraph separators: printed raw, they could fake
// log lines or recolour the terminal.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

// One printable line: control characters become visible \uXXXX escapes.
export function oneLine(value) {
  return String(value).replace(CONTROL_RE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// An error for the console: the message (which can quote request text) on one line, then the
// server-generated stack frames.
export function oneLineError(err) {
  if (!(err instanceof Error)) return oneLine(err);
  const header = err.message ? `${err.name}: ${err.message}` : err.name;
  const stack = typeof err.stack === 'string' ? err.stack : '';
  if (stack.startsWith(header)) return oneLine(header) + stack.slice(header.length);
  return oneLine(header);
}
