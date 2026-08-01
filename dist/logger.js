"use strict";
/**
 * Structured Logger for an5Orm
 * Provides consistent logging with levels, timestamps, and context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
exports.createLogger = createLogger;
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const COLORS = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
    reset: '\x1b[0m',
};
class Logger {
    constructor(options = {}) {
        this.level = LOG_LEVELS[options.level || 'info'];
        this.prefix = options.prefix || '';
        this.json = options.json || false;
        this.colors = options.colors !== false && !this.json;
    }
    formatEntry(entry) {
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
    log(level, message, options) {
        if (LOG_LEVELS[level] < this.level)
            return;
        const entry = {
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
    debug(message, options) {
        this.log('debug', message, options);
    }
    info(message, options) {
        this.log('info', message, options);
    }
    warn(message, options) {
        this.log('warn', message, options);
    }
    error(message, error, options) {
        this.log('error', message, { ...options, error });
    }
    child(context) {
        return new Logger({
            level: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === this.level),
            prefix: this.prefix ? `${this.prefix}:${context}` : context,
            json: this.json,
            colors: this.colors,
        });
    }
    timer(label) {
        const start = Date.now();
        return {
            end: () => {
                const duration = Date.now() - start;
                this.info(`${label} completed`, { duration });
            },
        };
    }
}
exports.Logger = Logger;
// Default logger instance
exports.logger = new Logger({
    level: process.env.LOG_LEVEL || 'info',
    prefix: 'an5Orm',
});
// Create scoped loggers
function createLogger(context) {
    return exports.logger.child(context);
}
//# sourceMappingURL=logger.js.map