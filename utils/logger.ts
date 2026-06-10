type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

class Logger {
  levels: Record<LogLevel, number>;
  currentLevel: number;
  private requestId: string = '';

  constructor(level: LogLevel = 'info') {
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    this.currentLevel = this.levels[level] || this.levels.info;
  }

  setLevel(level: LogLevel) {
    if (level in this.levels) {
      this.currentLevel = this.levels[level];
    }
  }

  setRequestId(id: string) {
    this.requestId = id;
  }

  shouldLog(level: LogLevel) {
    return this.levels[level] <= this.currentLevel;
  }

  formatMessage(level: LogLevel, message: string, context: Record<string, unknown> = {}) {
    const timestamp = new Date().toISOString();
    const merged = this.requestId ? { requestId: this.requestId, ...context } : context;
    const contextStr = Object.keys(merged).length > 0 ? ` | ${JSON.stringify(merged)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  error(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }

  warn(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  debug(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  trace(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('trace')) {
      console.log(this.formatMessage('trace', message, context));
    }
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const logger = new Logger('info');
