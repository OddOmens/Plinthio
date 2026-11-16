// Keeping text from requests and files on one line in the server's output. No imports, so
// anything can use it (errors.js is also loaded by the frontend's translation check).

// Control characters (C0, DEL, C1) plus the Unicode line and paragraph
// separators. Printed raw, a newline or ANSI escape inside a client-supplied
// value could fake extra log lines or recolour the terminal.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

// One printable line: control characters become visible \uXXXX escapes.
// Always returns a string (non-strings go through String() first).
export function oneLine(value) {
  return String(value).replace(CONTROL_RE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// An error for the console: its message (which can carry request or file text, e.g. a
// JSON parse error quotes the body) on one line, followed by the stack frames, which are
// server-generated and indented. Non-errors go through oneLine.
export function oneLineError(err) {
  if (!(err instanceof Error)) return oneLine(err);
  const header = err.message ? `${err.name}: ${err.message}` : err.name;
  const stack = typeof err.stack === 'string' ? err.stack : '';
  if (stack.startsWith(header)) return oneLine(header) + stack.slice(header.length);
  return oneLine(header);
}
