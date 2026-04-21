/**
 * Centralized logging utility for boltcard Cloudflare Worker
 * Provides consistent logging and error handling across the application
 */

class Logger {
  constructor(level = 'info') {
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    this.currentLevel = this.levels[level] || this.levels.info;
  }

  setLevel(level) {
    if (this.levels.hasOwnProperty(level)) {
      this.currentLevel = this.levels[level];
    }
  }

  shouldLog(level) {
    return this.levels[level] <= this.currentLevel;
  }

  formatMessage(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(context).length > 0 ? ` | ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  error(message, context = {}) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }

  warn(message, context = {}) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message, context = {}) {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  debug(message, context = {}) {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  trace(message, context = {}) {
    if (this.shouldLog('trace')) {
      console.log(this.formatMessage('trace', message, context));
    }
  }

  logRequest(request) {
    if (this.shouldLog('debug')) {
      const url = new URL(request.url);
      this.debug('Incoming request', {
        method: request.method,
        url: request.url,
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams)
      });
    }
  }

  logResponse(status, body, context = {}) {
    if (this.shouldLog('debug')) {
      this.debug('Response sent', {
        status,
        bodyLength: typeof body === 'string' ? body.length : 'object',
        ...context
      });
    }
  }

  logError(error, context = {}) {
    this.error(error.message || 'Unknown error', {
      stack: error.stack,
      ...context
    });
  }

  logCrypto(operation, context = {}) {
    if (this.shouldLog('debug')) {
      this.debug(`Crypto operation: ${operation}`, context);
    }
  }

  logPayment(method, action, context = {}) {
    this.info(`Payment method [${method}]: ${action}`, context);
  }
}

export const logger = new Logger('info');

export { Logger };
