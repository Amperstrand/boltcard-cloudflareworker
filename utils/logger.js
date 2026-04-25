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
}

export const logger = new Logger('info');
