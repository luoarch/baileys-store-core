/**
 * Session Rate Limiter Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { SessionRateLimiter, DEFAULT_RATE_LIMITER_CONFIG } from '../../rate-limit/rate-limiter.js';

describe('SessionRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const limiter = new SessionRateLimiter();
      const config = limiter.getConfig();

      expect(config.maxMessagesPerMinute).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxMessagesPerMinute);
      expect(config.coldContactMultiplier).toBe(DEFAULT_RATE_LIMITER_CONFIG.coldContactMultiplier);
      expect(config.enabled).toBe(true);
    });

    it('should accept custom config', () => {
      const limiter = new SessionRateLimiter({ maxMessagesPerMinute: 20 });
      expect(limiter.getConfig().maxMessagesPerMinute).toBe(20);
    });
  });

  describe('acquire', () => {
    it('should allow when rate limit not exceeded', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 60,
        jitterRangeMs: [0, 0],
        enabled: true,
      });

      const status = await limiter.acquire('session-1');
      expect(status.allowed).toBe(true);
    });

    it('should bypass when disabled', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({ enabled: false });

      const status = await limiter.acquire('session-1');
      expect(status.allowed).toBe(true);
      expect(status.tokensRemaining).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxMessagesPerMinute);
    });

    it('should apply jitter when configured', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 60,
        jitterRangeMs: [100, 200],
        enabled: true,
      });

      const start = Date.now();
      const status = await limiter.acquire('session-1');
      const elapsed = Date.now() - start;

      expect(status.jitterApplied).toBe(true);
      expect(status.jitterDelayMs).toBeGreaterThanOrEqual(100);
      expect(status.jitterDelayMs).toBeLessThanOrEqual(200);
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('should track session metadata', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 60,
        jitterRangeMs: [0, 0],
      });

      await limiter.acquire('session-1');
      await limiter.acquire('session-1');

      const metadata = limiter.getSessionMetadata('session-1');
      expect(metadata).not.toBeNull();
      expect(metadata?.totalMessages).toBe(2);
    });
  });

  describe('canAcquire', () => {
    it('should check without blocking', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 60,
        enabled: true,
      });

      const status = limiter.canAcquire('session-1');
      expect(status.allowed).toBe(true);
    });

    it('should handle cold contacts', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 12,
        coldContactMultiplier: 0.33,
        enabled: true,
      });

      const regularStatus = limiter.canAcquire('session-1', false);
      expect(regularStatus.tokensRemaining).toBeGreaterThan(0);
    });

    it('should apply cold contact multiplier to reduce rate', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 12,
        coldContactMultiplier: 0.5,
        jitterRangeMs: [0, 0],
        enabled: true,
      });

      // For cold contacts, limit should be 12 * 0.5 = 6 msg/min
      // So after acquiring some tokens, we should see reduced remaining
      const coldStatus = limiter.canAcquire('cold-session', true);
      expect(coldStatus.allowed).toBe(true);
      // With cold contact multiplier, effective limit is lower
      expect(coldStatus.tokensRemaining).toBeLessThanOrEqual(6);
    });
  });

  describe('warmup period', () => {
    it('should apply warmup restrictions for new sessions', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 12,
        warmupPeriodDays: 10,
        jitterRangeMs: [0, 0],
      });

      await limiter.acquire('new-session');
      const metadata = limiter.getSessionMetadata('new-session');

      expect(metadata?.isWarmup).toBe(true);
    });

    it('should end warmup after period expires', () => {
      vi.useFakeTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 12,
        warmupPeriodDays: 10,
        jitterRangeMs: [0, 0],
        enabled: true,
      });

      limiter.canAcquire('warmup-session');
      const meta1 = limiter.getSessionMetadata('warmup-session');
      expect(meta1?.isWarmup).toBe(true);

      vi.advanceTimersByTime(11 * 24 * 60 * 60 * 1000);

      limiter.canAcquire('warmup-session');
      const meta2 = limiter.getSessionMetadata('warmup-session');
      expect(meta2?.isWarmup).toBe(false);
    });
  });

  describe('canAcquire with disabled', () => {
    it('should return full tokens when disabled', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 12,
        enabled: false,
      });

      const status = limiter.canAcquire('session-1');
      expect(status.allowed).toBe(true);
      expect(status.tokensRemaining).toBe(12);
    });
  });

  describe('jitter abort signal', () => {
    it('should abort during jitter sleep', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 60,
        jitterRangeMs: [200, 300],
        enabled: true,
      });

      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 50);

      await expect(limiter.acquire('abort-session', { signal: controller.signal })).rejects.toThrow(
        'aborted',
      );
    });
  });

  describe('reset', () => {
    it('should reset session state', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({ jitterRangeMs: [0, 0] });

      await limiter.acquire('session-1');
      expect(limiter.getSessionMetadata('session-1')).not.toBeNull();

      limiter.reset('session-1');
      expect(limiter.getSessionMetadata('session-1')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all sessions', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({ jitterRangeMs: [0, 0] });

      await limiter.acquire('session-1');
      await limiter.acquire('session-2');

      expect(limiter.getStats().activeSessions).toBe(2);

      limiter.clear();
      expect(limiter.getStats().activeSessions).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return session statistics', async () => {
      vi.useRealTimers();
      const limiter = new SessionRateLimiter({
        maxSessions: 100,
        jitterRangeMs: [0, 0],
      });

      await limiter.acquire('session-1');
      await limiter.acquire('session-2');

      const stats = limiter.getStats();
      expect(stats.activeSessions).toBe(2);
      expect(stats.totalCapacity).toBe(100);
    });
  });

  describe('abort signal', () => {
    it('should respect abort signal in token bucket', async () => {
      vi.useRealTimers();
      const { TokenBucket } = await import('../../rate-limit/token-bucket.js');
      const bucket = new TokenBucket({ maxTokens: 10, refillRate: 0.1, initialTokens: 0 });
      const controller = new AbortController();

      setTimeout(() => {
        controller.abort();
      }, 50);

      await expect(bucket.acquire(1, controller.signal)).rejects.toThrow('aborted');
    });
  });
});
