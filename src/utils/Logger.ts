export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    OFF = 4,
    NONE = 4
}

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    module: string;
    message: string;
    data?: any;
}

export type LogListener = (entry: LogEntry) => void;

/**
 * Structured Logger with support for multiple modules and custom listeners.
 */
export class Logger {
    private static level: LogLevel = LogLevel.INFO;
    private static prefix: string = '[Sovereign]';
    private static listeners: Set<LogListener> = new Set();

    public static setLevel(level: LogLevel) {
        this.level = level;
    }

    public static setPrefix(prefix: string) {
        this.prefix = prefix;
    }

    public static addListener(listener: LogListener) {
        this.listeners.add(listener);
    }

    public static removeListener(listener: LogListener) {
        this.listeners.delete(listener);
    }

    private static log(level: LogLevel, module: string, message: string, data?: any) {
        if (level < this.level) return;

        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            module,
            message,
            data
        };

        const levelName = LogLevel[level];
        const formattedMessage = `${this.prefix}${module ? `[${module}]` : ''} ${levelName}: ${message}`;

        if (level === LogLevel.ERROR) {
            console.error(formattedMessage, data || '');
        } else if (level === LogLevel.WARN) {
            console.warn(formattedMessage, data || '');
        } else {
            console.log(formattedMessage, data || '');
        }

        this.listeners.forEach(l => l(entry));
    }

    public static debug(module: string, message: string, data?: any) {
        this.log(LogLevel.DEBUG, module, message, data);
    }

    public static info(module: string, message: string, data?: any) {
        this.log(LogLevel.INFO, module, message, data);
    }

    public static warn(module: string, message: string, data?: any) {
        this.log(LogLevel.WARN, module, message, data);
    }

    public static error(module: string, message: string, data?: any) {
        this.log(LogLevel.ERROR, module, message, data);
    }

    // Compatibility methods for old static usage (though they were already semi-structured)
    // Most old code called Logger.info(msg) without module.
    // We can handle that by checking if first arg is actually the module name.
    // For now, let's keep it simple and update callers.
}
