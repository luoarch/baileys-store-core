/**
 * @baileys-store/core - Session Rate Limiter
 *
 * Token bucket rate limiter for WhatsApp message throttling.
 * Prevents account bans from automation detection.
 *
 * @see https://www.a2c.chat/en/whatsapp-risk-control-mechanism
 * @since 1.1.0
 */

import { LRUCache } from 'lru-cache';

import type { SessionId } from '../types/index.js';

import { TokenBucket } from './token-bucket.js';

/**
 * Configuration for session-based rate limiting.
 */
export interface RateLimiterConfig {
  /** Maximum messages per minute (default: 12, validated threshold) */
  maxMessagesPerMinute: number;
  /** Multiplier for cold contacts (default: 0.33 = 4 msg/min) */
  coldContactMultiplier: number;
  /** Random delay range in ms to appear human-like [min, max] */
  jitterRangeMs: [number, number];
  /** Warmup period for new numbers (days) */
  warmupPeriodDays: number;
  /** Maximum number of sessions to track (LRU eviction) */
  maxSessions?: number;
  /** Whether rate limiting is enabled */
  enabled: boolean;
}

/**
 * Rate limit status returned after acquiring.
 */
export interface RateLimitStatus {
  /** Whether the request was allowed */
  allowed: boolean;
  /** Tokens remaining for this session */
  tokensRemaining: number;
  /** Wait time if rate limited (ms) */
  waitTimeMs: number;
  /** Whether jitter was applied */
  jitterApplied: boolean;
  /** Jitter delay in ms (if applied) */
  jitterDelayMs: number;
}

/**
 * Session metadata for rate limiting decisions.
 */
export interface SessionMetadata {
  /** Session creation timestamp */
  createdAt: Date;
  /** Total messages sent */
  totalMessages: number;
  /** Whether session is in warmup period */
  isWarmup: boolean;
}

/**
 * Default rate limiter configuration optimized for production use.
 */
export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxMessagesPerMinute: 12,
  coldContactMultiplier: 0.33,
  jitterRangeMs: [500, 1500],
  warmupPeriodDays: 10,
  maxSessions: 10000,
  enabled: true,
};

/**
 * Token bucket rate limiter for WhatsApp session management.
 *
 * Implements per-session rate limiting with:
 * - Configurable message rate thresholds
 * - Cold contact rate reduction
 * - Human-like jitter delays
 * - New account warmup period
 *
 * @example
 * ```typescript
 * const limiter = new SessionRateLimiter(config);
 * await limiter.acquire(sessionId, { isColdContact: true });
 * await sendMessage();
 * ```
 */
export class SessionRateLimiter {
  private readonly buckets: LRUCache<SessionId, TokenBucket>;
  private readonly metadata: LRUCache<SessionId, SessionMetadata>;
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };

    this.buckets = new LRUCache<SessionId, TokenBucket>({
      max: this.config.maxSessions ?? 10000,
      ttl: 60 * 60 * 1000,
    });

    this.metadata = new LRUCache<SessionId, SessionMetadata>({
      max: this.config.maxSessions ?? 10000,
      ttl: 24 * 60 * 60 * 1000,
    });
  }

  /**
   * Gets or creates a token bucket for the session.
   */
  private getOrCreateBucket(sessionId: SessionId): TokenBucket {
    let bucket = this.buckets.get(sessionId);

    if (!bucket) {
      bucket = new TokenBucket({
        maxTokens: this.config.maxMessagesPerMinute,
        refillRate: this.config.maxMessagesPerMinute / 60,
      });
      this.buckets.set(sessionId, bucket);
    }

    return bucket;
  }

  /**
   * Gets or creates session metadata.
   */
  private getOrCreateMetadata(sessionId: SessionId): SessionMetadata {
    let meta = this.metadata.get(sessionId);

    if (!meta) {
      meta = {
        createdAt: new Date(),
        totalMessages: 0,
        isWarmup: true,
      };
      this.metadata.set(sessionId, meta);
    }

    return meta;
  }

  /**
   * Calculates the effective rate limit based on session state.
   */
  private calculateEffectiveLimit(sessionId: SessionId, isColdContact: boolean): number {
    const meta = this.getOrCreateMetadata(sessionId);
    let effectiveLimit = this.config.maxMessagesPerMinute;

    if (isColdContact) {
      effectiveLimit *= this.config.coldContactMultiplier;
    }

    if (meta.isWarmup) {
      const daysSinceCreation = (Date.now() - meta.createdAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceCreation < this.config.warmupPeriodDays) {
        const warmupProgress = daysSinceCreation / this.config.warmupPeriodDays;
        effectiveLimit *= 0.3 + warmupProgress * 0.7;
      } else {
        meta.isWarmup = false;
        this.metadata.set(sessionId, meta);
      }
    }

    return Math.max(1, Math.floor(effectiveLimit));
  }

  /**
   * Generates random jitter delay within configured range.
   */
  private generateJitter(): number {
    const [min, max] = this.config.jitterRangeMs;
    return min + Math.random() * (max - min);
  }

  /**
   * Acquires a rate limit permit, waiting if necessary.
   *
   * @param sessionId - Session identifier
   * @param options - Options for this acquisition
   * @returns Status of the rate limit acquisition
   */
  async acquire(
    sessionId: SessionId,
    options: { isColdContact?: boolean; signal?: AbortSignal } = {},
  ): Promise<RateLimitStatus> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        tokensRemaining: this.config.maxMessagesPerMinute,
        waitTimeMs: 0,
        jitterApplied: false,
        jitterDelayMs: 0,
      };
    }

    const bucket = this.getOrCreateBucket(sessionId);
    const effectiveLimit = this.calculateEffectiveLimit(sessionId, options.isColdContact ?? false);

    const scaledBucket = new TokenBucket({
      maxTokens: effectiveLimit,
      refillRate: effectiveLimit / 60,
      initialTokens: Math.min(bucket.getAvailableTokens(), effectiveLimit),
    });

    const waitTimeMs = scaledBucket.getWaitTime(1);

    await scaledBucket.acquire(1, options.signal);

    const meta = this.getOrCreateMetadata(sessionId);
    meta.totalMessages++;
    this.metadata.set(sessionId, meta);

    let jitterDelayMs = 0;
    const [minJitter] = this.config.jitterRangeMs;
    if (minJitter > 0) {
      jitterDelayMs = this.generateJitter();
      await this.sleep(jitterDelayMs, options.signal);
    }

    return {
      allowed: true,
      tokensRemaining: scaledBucket.getAvailableTokens(),
      waitTimeMs,
      jitterApplied: jitterDelayMs > 0,
      jitterDelayMs,
    };
  }

  /**
   * Checks if a session can send a message without blocking.
   *
   * @param sessionId - Session identifier
   * @param isColdContact - Whether the recipient is a cold contact
   * @returns Status indicating if the request would be allowed
   */
  canAcquire(sessionId: SessionId, isColdContact = false): RateLimitStatus {
    if (!this.config.enabled) {
      return {
        allowed: true,
        tokensRemaining: this.config.maxMessagesPerMinute,
        waitTimeMs: 0,
        jitterApplied: false,
        jitterDelayMs: 0,
      };
    }

    const bucket = this.getOrCreateBucket(sessionId);
    const effectiveLimit = this.calculateEffectiveLimit(sessionId, isColdContact);

    const scaledBucket = new TokenBucket({
      maxTokens: effectiveLimit,
      refillRate: effectiveLimit / 60,
      initialTokens: Math.min(bucket.getAvailableTokens(), effectiveLimit),
    });

    const canAcquire = scaledBucket.tryAcquire(1);
    const tokensRemaining = scaledBucket.getAvailableTokens();
    const waitTimeMs = canAcquire ? 0 : scaledBucket.getWaitTime(1);

    return {
      allowed: canAcquire,
      tokensRemaining: tokensRemaining + (canAcquire ? 1 : 0),
      waitTimeMs,
      jitterApplied: false,
      jitterDelayMs: 0,
    };
  }

  /**
   * Gets metadata for a session.
   *
   * @param sessionId - Session identifier
   * @returns Session metadata or null if not found
   */
  getSessionMetadata(sessionId: SessionId): SessionMetadata | null {
    return this.metadata.get(sessionId) ?? null;
  }

  /**
   * Resets rate limit state for a session.
   *
   * @param sessionId - Session identifier
   */
  reset(sessionId: SessionId): void {
    this.buckets.delete(sessionId);
    this.metadata.delete(sessionId);
  }

  /**
   * Clears all rate limit state.
   */
  clear(): void {
    this.buckets.clear();
    this.metadata.clear();
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): Readonly<RateLimiterConfig> {
    return { ...this.config };
  }

  /**
   * Returns statistics about tracked sessions.
   */
  getStats(): { activeSessions: number; totalCapacity: number } {
    return {
      activeSessions: this.buckets.size,
      totalCapacity: this.config.maxSessions ?? 10000,
    };
  }

  /**
   * Sleep helper that respects AbortSignal.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new Error('Rate limit wait aborted'));
          },
          { once: true },
        );
      }
    });
  }
}
