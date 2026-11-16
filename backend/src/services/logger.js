import { getDb } from '../config/database.js';

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

const memoryLogs = [];
const MAX_MEMORY_LOGS = 200;

class Logger {
  async log(level, category, message, details = null) {
    const timestamp = new Date().toISOString();
    const entry = {
      level,
      category,
      message,
      details: typeof details === 'object' && details !== null ? JSON.stringify(details) : details,
      timestamp
    };

    // Console output, kept to one line per entry (the DB row keeps the
    // original text; the admin log viewer renders it as text).
    const prefix = oneLine(`[${timestamp}] [${String(level).toUpperCase()}] [${category}]`);
    const consoleMessage = oneLine(message);
    const consoleDetails = details instanceof Error
      ? oneLineError(details)
      : (entry.details ? oneLine(entry.details) : '');
    if (level === 'error') {
      console.error(prefix, consoleMessage, consoleDetails);
    } else if (level === 'warn') {
      console.warn(prefix, consoleMessage, consoleDetails);
    } else {
      console.log(prefix, consoleMessage, consoleDetails);
    }

    // Memory ring buffer
    memoryLogs.unshift(entry);
    if (memoryLogs.length > MAX_MEMORY_LOGS) {
      memoryLogs.pop();
    }

    // SQLite persistence
    try {
      const db = await getDb();
      await db.run(
        'INSERT INTO system_logs (level, category, message, details, timestamp) VALUES (?, ?, ?, ?, ?)',
        [level, category, message, entry.details, timestamp]
      );
    } catch (err) {
      // Avoid infinite error loop if DB write fails
    }
  }

  info(category, message, details) {
    return this.log('info', category, message, details);
  }

  warn(category, message, details) {
    return this.log('warn', category, message, details);
  }

  error(category, message, details) {
    return this.log('error', category, message, details);
  }

  getRecentLogs() {
    return memoryLogs;
  }
}

export const logger = new Logger();
