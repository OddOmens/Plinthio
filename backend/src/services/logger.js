import { getDb } from '../config/database.js';

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

    // Console output
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`;
    if (level === 'error') {
      console.error(prefix, message, details || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, details || '');
    } else {
      console.log(prefix, message, details || '');
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
