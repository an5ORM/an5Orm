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
export declare class Logger {
    private level;
    private prefix;
    private json;
    private colors;
    constructor(options?: LoggerOptions);
    private formatEntry;
    private log;
    debug(message: string, options?: {
        context?: string;
        data?: any;
    }): void;
    info(message: string, options?: {
        context?: string;
        data?: any;
        duration?: number;
    }): void;
    warn(message: string, options?: {
        context?: string;
        data?: any;
    }): void;
    error(message: string, error?: Error, options?: {
        context?: string;
        data?: any;
    }): void;
    child(context: string): Logger;
    timer(label: string): {
        end: () => void;
    };
}
export declare const logger: Logger;
export declare function createLogger(context: string): Logger;
//# sourceMappingURL=logger.d.ts.map