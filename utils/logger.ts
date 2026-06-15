type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

class Logger {
  private currentLevel: number;
  private requestId: string = '';

  constructor(level: LogLevel = 'info') {
    this.currentLevel = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
  }

  setLevel(level: LogLevel) {
    this.currentLevel = LEVEL_PRIORITY[level] ?? this.currentLevel;
  }

  setRequestId(id: string) {
    this.requestId = id;
  }

  private shouldLog(level: LogLevel) {
    return LEVEL_PRIORITY[level] <= this.currentLevel;
  }

  private emit(level: LogLevel, message: string, context: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    if (this.requestId) payload.requestId = this.requestId;
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) payload[key] = value;
    }
    const serialized = JSON.stringify(payload);
    if (level === 'error') console.error(serialized);
    else if (level === 'warn') console.warn(serialized);
    else console.log(serialized);
  }

  error(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('error')) this.emit('error', message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('warn')) this.emit('warn', message, context);
  }

  info(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('info')) this.emit('info', message, context);
  }

  debug(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('debug')) this.emit('debug', message, context);
  }

  trace(message: string, context: Record<string, unknown> = {}) {
    if (this.shouldLog('trace')) this.emit('trace', message, context);
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const logger = new Logger('info');
