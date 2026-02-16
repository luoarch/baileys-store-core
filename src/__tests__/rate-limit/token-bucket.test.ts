/**
 * Token Bucket Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { TokenBucket } from '../../rate-limit/token-bucket.js';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('constructor', () => {
    it('should initialize with max tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(bucket.getAvailableTokens()).toBe(10);
    });

    it('should initialize with custom initial tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1, initialTokens: 5 });
      expect(bucket.getAvailableTokens()).toBe(5);
    });
  });

  describe('tryAcquire', () => {
    it('should acquire tokens when available', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(bucket.tryAcquire(1)).toBe(true);
      expect(bucket.getAvailableTokens()).toBe(9);
    });

    it('should acquire multiple tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(bucket.tryAcquire(5)).toBe(true);
      expect(bucket.getAvailableTokens()).toBe(5);
    });

    it('should fail when not enough tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1, initialTokens: 2 });
      expect(bucket.tryAcquire(5)).toBe(false);
      expect(bucket.getAvailableTokens()).toBe(2);
    });

    it('should throw for non-positive count', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(() => bucket.tryAcquire(0)).toThrow('Token count must be positive');
      expect(() => bucket.tryAcquire(-1)).toThrow('Token count must be positive');
    });

    it('should throw when count exceeds max capacity', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(() => bucket.tryAcquire(15)).toThrow('Cannot acquire 15 tokens');
    });
  });

  describe('refill', () => {
    it('should refill tokens over time', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 2, initialTokens: 0 });

      vi.advanceTimersByTime(1000);
      expect(bucket.getAvailableTokens()).toBe(2);

      vi.advanceTimersByTime(1000);
      expect(bucket.getAvailableTokens()).toBe(4);
    });

    it('should not exceed max tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 100 });

      vi.advanceTimersByTime(10000);
      expect(bucket.getAvailableTokens()).toBe(10);
    });
  });

  describe('acquire', () => {
    it('should acquire immediately when tokens available', async () => {
      vi.useRealTimers();
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });

      const start = Date.now();
      await bucket.acquire(1);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('should wait when tokens not available', async () => {
      vi.useRealTimers();
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 10, initialTokens: 0 });

      const start = Date.now();
      await bucket.acquire(1);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should support abort signal', async () => {
      vi.useRealTimers();
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 0.1, initialTokens: 0 });
      const controller = new AbortController();

      setTimeout(() => {
        controller.abort();
      }, 50);

      await expect(bucket.acquire(1, controller.signal)).rejects.toThrow('aborted');
    });

    it('should throw for non-positive count in acquire', async () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      await expect(bucket.acquire(0)).rejects.toThrow('Token count must be positive');
      await expect(bucket.acquire(-1)).rejects.toThrow('Token count must be positive');
    });

    it('should throw when count exceeds max capacity in acquire', async () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      await expect(bucket.acquire(15)).rejects.toThrow('Cannot acquire 15 tokens');
    });

    it('should throw immediately if signal already aborted', async () => {
      vi.useRealTimers();
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 0.1, initialTokens: 0 });
      const controller = new AbortController();
      controller.abort();

      await expect(bucket.acquire(1, controller.signal)).rejects.toThrow('aborted');
    });
  });

  describe('getWaitTime', () => {
    it('should return 0 when tokens available', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      expect(bucket.getWaitTime(1)).toBe(0);
    });

    it('should calculate wait time correctly', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 2, initialTokens: 0 });

      const waitTime = bucket.getWaitTime(4);
      expect(waitTime).toBe(2000);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 2 });
      const state = bucket.getState();

      expect(state.maxTokens).toBe(10);
      expect(state.refillRate).toBe(2);
      expect(state.tokens).toBe(10);
    });
  });

  describe('reset', () => {
    it('should reset to full capacity', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 1 });
      bucket.tryAcquire(5);
      expect(bucket.getAvailableTokens()).toBe(5);

      bucket.reset();
      expect(bucket.getAvailableTokens()).toBe(10);
    });
  });
});
