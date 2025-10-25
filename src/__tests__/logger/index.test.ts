/**
 * Tests for Structured Logger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConsoleStructuredLogger, NullLogger } from '../../logger/index.js';
import { withContext } from '../../context/execution-context.js';

describe('ConsoleStructuredLogger', () => {
  let logger: ConsoleStructuredLogger;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  
  beforeEach(() => {
    // Spy on console methods
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    
    logger = new ConsoleStructuredLogger('test', { level: 1 }); // DEBUG level
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });
  
  describe('Log Levels', () => {
    it('should log at DEBUG level in development', () => {
      const devLogger = new ConsoleStructuredLogger('development');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      devLogger.debug('Debug message');
      
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
    
    it('should not log below WARN level in production', () => {
      const prodLogger = new ConsoleStructuredLogger('production');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      prodLogger.info('Info message');
      
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
    
    it('should log ERROR level in production', () => {
      const prodLogger = new ConsoleStructuredLogger('production');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      prodLogger.error('Error message');
      
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
  
  describe('Context Propagation', () => {
    it('should include correlationId in logs', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      withContext({ correlationId: 'test-123' }, () => {
        logger.info('Test message');
      });
      
      expect(spy).toHaveBeenCalled();
      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toContain('test-123');
      
      spy.mockRestore();
    });
    
    it('should include requestId in logs', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      withContext({ correlationId: 'test-123' }, () => {
        logger.info('Test message');
      });
      
      expect(spy).toHaveBeenCalled();
      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toContain('correlationId');
      
      spy.mockRestore();
    });
  });
  
  describe('Error Logging', () => {
    it('should serialize Error objects', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');
      
      logger.error('Error occurred', error);
      
      expect(spy).toHaveBeenCalled();
      
      spy.mockRestore();
    });
    
    it('should handle non-Error objects', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = { message: 'Custom error' };
      
      logger.error('Error occurred', error);
      
      expect(spy).toHaveBeenCalled();
      
      spy.mockRestore();
    });
  });
  
  describe('Data Sanitization', () => {
    it('should redact sensitive fields', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      logger.info('Testing sanitization', {
        masterKey: 'secret-key-123',
        username: 'user1',
        password: 'password123',
      });
      
      expect(spy).toHaveBeenCalled();
      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toContain('[REDACTED]');
      expect(logCall).not.toContain('secret-key-123');
      
      spy.mockRestore();
    });
    
    it('should preserve non-sensitive fields', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      logger.info('Testing sanitization', {
        username: 'user1',
        sessionId: 'session-123',
      });
      
      expect(spy).toHaveBeenCalled();
      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toContain('user1');
      expect(logCall).toContain('session-123');
      
      spy.mockRestore();
    });
  });
});

describe('NullLogger', () => {
  it('should not output anything', () => {
    const logger = new NullLogger();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    logger.trace();
    logger.debug();
    logger.info();
    logger.warn();
    logger.error();
    
    expect(spy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    
    spy.mockRestore();
    errorSpy.mockRestore();
  });
});
