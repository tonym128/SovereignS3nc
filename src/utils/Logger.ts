export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

export class Logger {
    private static level: LogLevel = LogLevel.INFO;
    private static prefix: string = '[Sovereign]';

    static setLevel(level: LogLevel) {
        this.level = level;
    }

    static setPrefix(prefix: string) {
        this.prefix = prefix;
    }

    static debug(message: string, ...args: any[]) {
        if (this.level <= LogLevel.DEBUG) {
            console.log(`${this.prefix} DEBUG: ${message}`, ...args);
        }
    }

    static info(message: string, ...args: any[]) {
        if (this.level <= LogLevel.INFO) {
            console.log(`${this.prefix} INFO: ${message}`, ...args);
        }
    }

    static warn(message: string, ...args: any[]) {
        if (this.level <= LogLevel.WARN) {
            console.warn(`${this.prefix} WARN: ${message}`, ...args);
        }
    }

    static error(message: string, ...args: any[]) {
        if (this.level <= LogLevel.ERROR) {
            console.error(`${this.prefix} ERROR: ${message}`, ...args);
        }
    }
}
