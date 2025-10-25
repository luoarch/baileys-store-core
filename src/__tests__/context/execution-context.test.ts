/**
 * Execution Context Tests
 * 
 * Tests for context propagation using AsyncLocalStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getContext,
  withContext,
  withCorrelationId,
  getCorrelationId,
  getRequestId,
  getOperationDuration,
  setContextMetadata,
  getContextMetadata,
  hasCorrelationId,
} from '../../context/execution-context.js';

describe('Execution Context', () => {
  beforeEach(() => {
    // Clear context before each test
    // Note: AsyncLocalStorage doesn't have a clear method,
    // so we rely on test isolation
  });

  afterEach(() => {
    // Ensure context is cleared after each test
  });

  describe('getContext', () => {
    it('should return undefined when no context is set', () => {
      const context = getContext();
      expect(context).toBeUndefined();
    });

    it('should return context when set via withContext', () => {
      withContext({ correlationId: 'test-123' }, () => {
        const context = getContext();
        expect(context).toBeDefined();
        expect(context?.correlationId).toBe('test-123');
      });
    });
  });

  describe('withContext', () => {
    it('should create full context with defaults', () => {
      withContext({ correlationId: 'test-123' }, () => {
        const context = getContext();
        expect(context).toBeDefined();
        expect(context?.correlationId).toBe('test-123');
        expect(context?.requestId).toBeDefined();
        expect(context?.startTime).toBeDefined();
        expect(context?.environment).toBe('production');
      });
    });

    it('should use provided requestId', () => {
      withContext({ requestId: 'custom-req-123' }, () => {
        const context = getContext();
        expect(context?.requestId).toBe('custom-req-123');
      });
    });

    it('should use provided startTime', () => {
      const startTime = Date.now() - 1000;
      withContext({ startTime }, () => {
        const context = getContext();
        expect(context?.startTime).toBe(startTime);
      });
    });

    it('should use provided environment', () => {
      withContext({ environment: 'development' }, () => {
        const context = getContext();
        expect(context?.environment).toBe('development');
      });
    });

    it('should propagate context across async operations', async () => {
      withContext({ correlationId: 'async-123' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        const context = getContext();
        expect(context?.correlationId).toBe('async-123');
      });
    });

    it('should isolate context between nested calls', () => {
      withContext({ correlationId: 'outer-123' }, () => {
        withContext({ correlationId: 'inner-456' }, () => {
          const innerContext = getContext();
          expect(innerContext?.correlationId).toBe('inner-456');
        });
        const outerContext = getContext();
        expect(outerContext?.correlationId).toBe('outer-123');
      });
    });

    it('should preserve metadata across nested calls', () => {
      withContext({ correlationId: 'outer-123', metadata: { key1: 'value1' } }, () => {
        withContext({ correlationId: 'inner-456', metadata: { key2: 'value2' } }, () => {
          const innerContext = getContext();
          expect(innerContext?.metadata).toEqual({ key2: 'value2' });
        });
        const outerContext = getContext();
        expect(outerContext?.metadata).toEqual({ key1: 'value1' });
      });
    });

    it('should return function result', () => {
      const result = withContext({ correlationId: 'test' }, () => {
        return 'test-result';
      });
      expect(result).toBe('test-result');
    });

    it('should propagate errors from function', () => {
      expect(() => {
        withContext({ correlationId: 'test' }, () => {
          throw new Error('test error');
        });
      }).toThrow('test error');
    });
  });

  describe('withCorrelationId', () => {
    it('should set correlation ID in context', () => {
      withCorrelationId('corr-123', () => {
        const context = getContext();
        expect(context?.correlationId).toBe('corr-123');
      });
    });

    it('should auto-generate requestId when not provided', () => {
      withCorrelationId('corr-123', () => {
        const context = getContext();
        expect(context?.requestId).toBeDefined();
        expect(context?.requestId).toMatch(/^\d+-[a-z0-9]+$/);
      });
    });

    it('should propagate across async boundaries', async () => {
      await withCorrelationId('async-corr-123', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        const context = getContext();
        expect(context?.correlationId).toBe('async-corr-123');
      });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined when no context', () => {
      expect(getCorrelationId()).toBeUndefined();
    });

    it('should return correlation ID from context', () => {
      withContext({ correlationId: 'test-123' }, () => {
        expect(getCorrelationId()).toBe('test-123');
      });
    });
  });

  describe('getRequestId', () => {
    it('should return undefined when no context', () => {
      expect(getRequestId()).toBeUndefined();
    });

    it('should return request ID from context', () => {
      withContext({ requestId: 'req-123' }, () => {
        expect(getRequestId()).toBe('req-123');
      });
    });
  });

  describe('getOperationDuration', () => {
    it('should return undefined when no context', () => {
      expect(getOperationDuration()).toBeUndefined();
    });

    it('should return duration in milliseconds', async () => {
      withContext({ startTime: Date.now() }, async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        const duration = getOperationDuration();
        expect(duration).toBeDefined();
        expect(duration).toBeGreaterThanOrEqual(50);
        expect(duration).toBeLessThan(100);
      });
    });

    it('should calculate duration from provided startTime', () => {
      const startTime = Date.now() - 1000;
      withContext({ startTime }, () => {
        const duration = getOperationDuration();
        expect(duration).toBeGreaterThanOrEqual(1000);
        expect(duration).toBeLessThan(1100);
      });
    });
  });

  describe('setContextMetadata', () => {
    it('should not throw when no context', () => {
      expect(() => {
        setContextMetadata({ key: 'value' });
      }).not.toThrow();
    });

    it('should add metadata to context', () => {
      withContext({ correlationId: 'test' }, () => {
        setContextMetadata({ key1: 'value1' });
        const context = getContext();
        expect(context?.metadata?.key1).toBe('value1');
      });
    });

    it('should merge with existing metadata', () => {
      withContext({ correlationId: 'test', metadata: { key1: 'value1' } }, () => {
        setContextMetadata({ key2: 'value2' });
        const context = getContext();
        expect(context?.metadata).toEqual({ key1: 'value1', key2: 'value2' });
      });
    });

    it('should overwrite existing keys', () => {
      withContext({ correlationId: 'test', metadata: { key1: 'value1' } }, () => {
        setContextMetadata({ key1: 'value2' });
        const context = getContext();
        expect(context?.metadata?.key1).toBe('value2');
      });
    });

    it('should handle empty metadata object', () => {
      withContext({ correlationId: 'test' }, () => {
        setContextMetadata({});
        const context = getContext();
        expect(context?.metadata).toEqual({});
      });
    });
  });

  describe('getContextMetadata', () => {
    it('should return undefined when no context', () => {
      expect(getContextMetadata('key')).toBeUndefined();
    });

    it('should return undefined when key does not exist', () => {
      withContext({ correlationId: 'test' }, () => {
        expect(getContextMetadata('nonexistent')).toBeUndefined();
      });
    });

    it('should return undefined when metadata does not exist', () => {
      withContext({ correlationId: 'test' }, () => {
        expect(getContextMetadata('key')).toBeUndefined();
      });
    });

    it('should return metadata value when exists', () => {
      withContext({ correlationId: 'test', metadata: { key1: 'value1' } }, () => {
        expect(getContextMetadata('key1')).toBe('value1');
      });
    });

    it('should return undefined for empty string key', () => {
      withContext({ correlationId: 'test', metadata: { key1: 'value1' } }, () => {
        expect(getContextMetadata('')).toBeUndefined();
      });
    });
  });

  describe('hasCorrelationId', () => {
    it('should return false when no context', () => {
      expect(hasCorrelationId()).toBe(false);
    });

    it('should return true when correlation ID is auto-generated', () => {
      // When withContext is used without correlationId, it auto-generates one
      withContext({ requestId: 'req-123' }, () => {
        expect(hasCorrelationId()).toBe(true);
        expect(getCorrelationId()).toBeDefined();
      });
    });

    it('should return true when correlation ID exists', () => {
      withContext({ correlationId: 'corr-123' }, () => {
        expect(hasCorrelationId()).toBe(true);
      });
    });

    it('should return true for empty string correlation ID', () => {
      withContext({ correlationId: '' }, () => {
        expect(hasCorrelationId()).toBe(true);
      });
    });
  });

  describe('Real-world scenarios', () => {
    it('should maintain context across Promise chain', async () => {
      withCorrelationId('promise-chain-123', async () => {
        const result = await Promise.resolve(1)
          .then(value => value + 1)
          .then(value => value * 2);
        
        expect(result).toBe(4);
        expect(getCorrelationId()).toBe('promise-chain-123');
      });
    });

    it('should maintain context across async/await boundaries', async () => {
      withCorrelationId('async-await-123', async () => {
        const step1 = await Promise.resolve('step1');
        expect(getCorrelationId()).toBe('async-await-123');
        
        const step2 = await Promise.resolve('step2');
        expect(getCorrelationId()).toBe('async-await-123');
        
        return step1 + step2;
      });
    });

    it('should isolate context in parallel operations', async () => {
      const results = await Promise.all([
        withCorrelationId('parallel-1', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return getCorrelationId();
        }),
        withCorrelationId('parallel-2', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return getCorrelationId();
        }),
      ]);

      expect(results).toEqual(['parallel-1', 'parallel-2']);
    });

    it('should handle metadata propagation across async operations', async () => {
      withContext({ correlationId: 'meta-test' }, () => {
        setContextMetadata({ userId: 'user-123' });
        
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          expect(getContextMetadata('userId')).toBe('user-123');
        })();
      });
    });
  });
});
