/**
 * @baileys-store/core - Rate Limiting
 *
 * Token bucket rate limiting for WhatsApp message throttling.
 *
 * @since 1.1.0
 */

export { TokenBucket } from './token-bucket.js';
export type { TokenBucketConfig, TokenBucketState } from './token-bucket.js';

export { SessionRateLimiter, DEFAULT_RATE_LIMITER_CONFIG } from './rate-limiter.js';
export type { RateLimiterConfig, RateLimitStatus, SessionMetadata } from './rate-limiter.js';
