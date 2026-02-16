/**
 * @baileys-store/core - Token Bucket Algorithm
 *
 * Implements token bucket rate limiting for controlled message throughput.
 * Tokens are added at a fixed rate and consumed per operation.
 *
 * @see https://en.wikipedia.org/wiki/Token_bucket
 * @since 1.1.0
 */

/**
 * Configuration for the token bucket.
 */
export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold */
  maxTokens: number;
  /** Rate at which tokens are refilled (tokens per second) */
  refillRate: number;
  /** Initial number of tokens (defaults to maxTokens) */
  initialTokens?: number;
}

/**
 * Token bucket state snapshot.
 */
export interface TokenBucketState {
  /** Current number of tokens */
  tokens: number;
  /** Last refill timestamp (ms) */
  lastRefill: number;
  /** Maximum tokens capacity */
  maxTokens: number;
  /** Refill rate (tokens per second) */
  refillRate: number;
}

/**
 * Token bucket implementation for rate limiting.
 *
 * The bucket holds a maximum number of tokens that are consumed on each operation.
 * Tokens are refilled at a constant rate up to the maximum capacity.
 *
 * @example
 * ```typescript
 * const bucket = new TokenBucket({ maxTokens: 12, refillRate: 12 / 60 });
 * await bucket.acquire(); // Consumes 1 token
 * await bucket.acquire(3); // Consumes 3 tokens
 * ```
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(config: TokenBucketConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokens = config.initialTokens ?? config.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Attempts to acquire tokens without blocking.
   *
   * @param count - Number of tokens to acquire (default: 1)
   * @returns true if tokens were acquired, false otherwise
   */
  tryAcquire(count = 1): boolean {
    if (count <= 0) {
      throw new Error('Token count must be positive');
    }
    if (count > this.maxTokens) {
      throw new Error(
        `Cannot acquire ${String(count)} tokens; max capacity is ${String(this.maxTokens)}`,
      );
    }

    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Acquires tokens, waiting if necessary.
   *
   * @param count - Number of tokens to acquire (default: 1)
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise that resolves when tokens are acquired
   */
  async acquire(count = 1, signal?: AbortSignal): Promise<void> {
    if (count <= 0) {
      throw new Error('Token count must be positive');
    }
    if (count > this.maxTokens) {
      throw new Error(
        `Cannot acquire ${String(count)} tokens; max capacity is ${String(this.maxTokens)}`,
      );
    }

    while (!this.tryAcquire(count)) {
      if (signal?.aborted) {
        throw new Error('Token acquisition aborted');
      }

      const tokensNeeded = count - this.tokens;
      const waitTimeMs = (tokensNeeded / this.refillRate) * 1000;

      await this.sleep(Math.min(waitTimeMs, 100), signal);
    }
  }

  /**
   * Returns the current number of available tokens.
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Returns the estimated wait time in ms to acquire the specified tokens.
   *
   * @param count - Number of tokens to acquire
   * @returns Wait time in milliseconds, or 0 if tokens are available
   */
  getWaitTime(count = 1): number {
    this.refill();

    if (this.tokens >= count) {
      return 0;
    }

    const tokensNeeded = count - this.tokens;
    return (tokensNeeded / this.refillRate) * 1000;
  }

  /**
   * Returns a snapshot of the bucket state.
   */
  getState(): TokenBucketState {
    this.refill();
    return {
      tokens: this.tokens,
      lastRefill: this.lastRefill,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }

  /**
   * Resets the bucket to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
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
            reject(new Error('Token acquisition aborted'));
          },
          { once: true },
        );
      }
    });
  }
}
