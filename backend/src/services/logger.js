import { getDb } from '../config/database.js';
import { oneLine, oneLineError } from '../utils/oneLine.js';

export { oneLine, oneLineError };

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

    // One line per console entry; the DB row keeps the original text.
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
