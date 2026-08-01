/**
 * Structured Logger for an5Orm
 * Provides consistent logging with levels, timestamps, and context.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: any;
  duration?: number;
  error?: Error;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  json?: boolean;
  colors?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

export class Logger {
  private level: number;
  private prefix: string;
  private json: boolean;
  private colors: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = LOG_LEVELS[options.level || 'info'];
    this.prefix = options.prefix || '';
    this.json = options.json || false;
    this.colors = options.colors !== false && !this.json;
  }

  private formatEntry(entry: LogEntry): string {
    if (this.json) {
      return JSON.stringify({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
        context: entry.context,
        duration: entry.duration,
        ...(entry.data && { data: entry.data }),
        ...(entry.error && { error: entry.error.message, stack: entry.error.stack }),
      });
    }

    const color = this.colors ? COLORS[entry.level] : '';
    const reset = this.colors ? COLORS.reset : '';
    const prefix = this.prefix ? `[${this.prefix}]` : '';
    const context = entry.context ? `[${entry.context}]` : '';
    const duration = entry.duration !== undefined ? ` (${entry.duration}ms)` : '';
    const timestamp = entry.timestamp;

    let line = `${color}${timestamp} ${entry.level.toUpperCase().padEnd(5)}${reset} ${prefix}${context} ${entry.message}${duration}`;

    if (entry.error) {
      line += `\n${color}${entry.error.stack || entry.error.message}${reset}`;
    }

    return line;
  }

  private log(level: LogLevel, message: string, options?: { context?: string; data?: any; duration?: number; error?: Error }) {
    if (LOG_LEVELS[level] < this.level) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...options,
    };

    const formatted = this.formatEntry(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, options?: { context?: string; data?: any }) {
    this.log('debug', message, options);
  }

  info(message: string, options?: { context?: string; data?: any; duration?: number }) {
    this.log('info', message, options);
  }

  warn(message: string, options?: { context?: string; data?: any }) {
    this.log('warn', message, options);
  }

  error(message: string, error?: Error, options?: { context?: string; data?: any }) {
    this.log('error', message, { ...options, error });
  }

  child(context: string): Logger {
    return new Logger({
      level: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k as LogLevel] === this.level) as LogLevel,
      prefix: this.prefix ? `${this.prefix}:${context}` : context,
      json: this.json,
      colors: this.colors,
    });
  }

  timer(label: string): { end: () => void } {
    const start = Date.now();
    return {
      end: () => {
        const duration = Date.now() - start;
        this.info(`${label} completed`, { duration });
      },
    };
  }
}

// Default logger instance
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  prefix: 'an5Orm',
});

// Create scoped loggers
export function createLogger(context: string): Logger {
  return logger.child(context);
}
