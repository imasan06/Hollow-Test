type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  error?: Error;
}

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 100;

  private formatMessage(level: LogLevel, message: string, context?: string, error?: Error): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? `[${context}]` : '';
    const errorStr = error ? ` - ${error.message}` : '';
    return `${timestamp} ${level.toUpperCase()} ${contextStr} ${message}${errorStr}`;
  }

  private addToHistory(entry: LogEntry): void {
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
  }

  error(message: string, context?: string, error?: Error): void {
    const entry: LogEntry = {
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      context,
      error,
    };
    this.addToHistory(entry);
    if (this.isDevelopment) {
      console.error(this.formatMessage('error', message, context, error));
      if (error) console.error(error);
    }
  }

  warn(message: string, context?: string): void {
    const entry: LogEntry = {
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    if (this.isDevelopment) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message: string, context?: string): void {
    const entry: LogEntry = {
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    if (this.isDevelopment) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  debug(message: string, context?: string): void {
    if (this.isDevelopment) {
      const entry: LogEntry = {
        level: 'debug',
        message,
        timestamp: new Date().toISOString(),
        context,
      };
      this.addToHistory(entry);
      console.log(this.formatMessage('debug', message, context));
    }
  }

  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  clearHistory(): void {
    this.logHistory = [];
  }
}

export const logger = new Logger();

