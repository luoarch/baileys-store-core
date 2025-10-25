/**
 * Structured Logging System
 * 
 * Provides structured logging with:
 * - Configurable log levels (TRACE, DEBUG, INFO, WARN, ERROR)
 * - Automatic context propagation (correlationId, requestId)
 * - Data sanitization for sensitive information
 * - JSON output for production
 */

import { getContext } from '../context/execution-context.js';

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5,
}

export interface LogContext {
  [key: string]: unknown;
}

export interface StructuredLogger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
}

export class ConsoleStructuredLogger implements StructuredLogger {
  private level: LogLevel;

  constructor(
    private environment: 'development' | 'production' | 'test',
    options?: { level?: LogLevel }
  ) {
    this.level = options?.level ?? this.getDefaultLevel();
  }

  private getDefaultLevel(): LogLevel {
    switch (this.environment) {
      case 'development':
        return LogLevel.DEBUG;
      case 'production':
        return LogLevel.WARN;
      case 'test':
        return LogLevel.SILENT;
    }
  }

  trace(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.TRACE) {
      this.log('TRACE', message, context);
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, context);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, context);
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (this.level <= LogLevel.ERROR) {
      this.log('ERROR', message, { ...context, error: this.serializeError(error) });
    }
  }

  private log(level: string, message: string, context?: LogContext): void {
    const execContext = getContext();
    const logEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      correlationId: execContext?.correlationId,
      requestId: execContext?.requestId,
      duration: execContext ? Date.now() - execContext.startTime : undefined,
      environment: this.environment,
      ...this.sanitize(context),
    };

    const output = this.environment === 'production' 
      ? JSON.stringify(logEntry)
      : this.formatPretty(logEntry);

    // Use appropriate console method
    switch (level) {
      case 'ERROR':
        console.error(output);
        break;
      case 'WARN':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  private formatPretty(entry: Record<string, unknown>): string {
    const lines = [
      `${entry.timestamp} [${entry.level}] ${entry.message}`,
    ];
    
    // Add correlationId if present
    if (entry.correlationId) {
      lines.push(`  correlationId: ${entry.correlationId}`);
    }
    
    // Add all other context fields (excluding metadata)
    const contextKeys = ['correlationId', 'requestId', 'timestamp', 'level', 'message', 'environment', 'duration'];
    const contextFields: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(entry)) {
      if (!contextKeys.includes(key) && value !== undefined) {
        contextFields[key] = value;
      }
    }
    
    if (Object.keys(contextFields).length > 0) {
      lines.push(`  context: ${JSON.stringify(contextFields, null, 2)}`);
    }
    
    return lines.join('\n');
  }

  private sanitize(data: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!data) return {};
    
    const sanitized: Record<string, unknown> = {};
    const sensitiveFields = ['masterKey', 'password', 'token', 'secret', 'apiKey', 'privateKey', 'keyData'];
    
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  private serializeError(error: unknown): unknown {
    if (error instanceof Error) {
      const serialized: Record<string, unknown> = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
      
      if (error.cause) {
        serialized.cause = error.cause;
      }
      
      return serialized;
    }
    return error;
  }
}

export class NullLogger implements StructuredLogger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
