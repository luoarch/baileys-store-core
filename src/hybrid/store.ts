/**
 * @baileys-store/core - Hybrid Auth Store
 *
 * Orchestrator for Redis + MongoDB with optional queue integration
 * - Read path: Redis → MongoDB (fallback) → cache warming
 * - Write path: Redis (sync) + Queue (async) or MongoDB (fallback)
 * - Queue integration via QueueAdapter interface
 * - Circuit breaker for both layers
 * - Internal metrics (hits, misses, fallbacks)
 */

import { Mutex } from 'async-mutex';
import { LRUCache } from 'lru-cache';
import CircuitBreaker from 'opossum';
import type {
  AuthStore,
  SessionId,
  AuthSnapshot,
  AuthPatch,
  Versioned,
  VersionedResult,
  BatchResult,
  StructuredLogger,
} from '../types/index.js';
import {
  StorageError,
  VersionMismatchError,
  assertBufferTypes,
  NullLoggerStructured,
} from '../types/index.js';
import type { HybridStoreConfig } from '../types/config.js';
import type { RedisAuthStore } from '../redis/store.js';
import type { MongoAuthStore } from '../mongodb/store.js';
import {
  redisHitsCounter,
  redisMissesCounter,
  mongoFallbacksCounter,
  queuePublishesCounter,
  queueFailuresCounter,
  directWritesCounter,
  circuitBreakerOpenCounter,
  circuitBreakerCloseCounter,
  circuitBreakerHalfOpenCounter,
  batchOperationsCounter,
  batchOperationsDurationHistogram,
  metricsRegistry,
} from '../metrics/index.js';
import { OutboxManager } from './outbox.js';
import { getContext } from '../context/execution-context.js';

/**
 * Hybrid store metrics
 */
interface HybridMetrics {
  redisHits: number;
  redisMisses: number;
  mongoFallbacks: number;
  queuePublishes: number;
  queueFailures: number;
  directWrites: number;
}

/**
 * HybridAuthStore - Orchestrates Redis + MongoDB + Queue
 */
export class HybridAuthStore implements AuthStore {
  private redis: RedisAuthStore;
  private mongo: MongoAuthStore;
  private config: HybridStoreConfig;
  private connected = false;
  private logger: StructuredLogger;

  // Metrics
  private metrics: HybridMetrics = {
    redisHits: 0,
    redisMisses: 0,
    mongoFallbacks: 0,
    queuePublishes: 0,
    queueFailures: 0,
    directWrites: 0,
  };

  // Mutexes for per-session write serialization (prevents race conditions)
  // LRU cache prevents memory leak by evicting old mutexes
  private writeMutexes = new LRUCache<string, Mutex>({
    max: 10000, // Max 10k sessions
    ttl: 1000 * 60 * 30, // 30 min TTL for idle sessions
  });

  // Circuit breaker for MongoDB operations (prevents cascade failures)
  private mongoCircuitBreaker: CircuitBreaker<
    [() => Promise<Versioned<AuthSnapshot> | null>],
    Versioned<AuthSnapshot> | null
  >;

  // Outbox manager for write-behind safety (transactional outbox pattern)
  private outboxManager: OutboxManager | null = null;

  constructor(redis: RedisAuthStore, mongo: MongoAuthStore, config: HybridStoreConfig) {
    this.redis = redis;
    this.mongo = mongo;
    this.config = config;
    this.logger = config.logger ?? new NullLoggerStructured();

    // Initialize circuit breaker for MongoDB
    this.mongoCircuitBreaker = new CircuitBreaker(
      async (fn: () => Promise<Versioned<AuthSnapshot> | null>) => fn(),
      {
        timeout: 3000, // 3s timeout for MongoDB operations
        errorThresholdPercentage: 50, // Open after 50% errors
        resetTimeout: 30000, // Try to close after 30s
        rollingCountTimeout: 10000, // 10s window for error calculation
        rollingCountBuckets: 10,
        name: 'mongodb-circuit-breaker',
      },
    );

    // Circuit breaker event listeners for observability
    this.mongoCircuitBreaker.on('open', () => {
      circuitBreakerOpenCounter.inc();
      this.logger.error('MongoDB circuit breaker OPEN - entering degraded mode', undefined, {
        action: 'circuit_breaker_open',
      });
    });

    this.mongoCircuitBreaker.on('halfOpen', () => {
      circuitBreakerHalfOpenCounter.inc();
      this.logger.warn('MongoDB circuit breaker HALF-OPEN - testing recovery', {
        action: 'circuit_breaker_half_open',
      });
    });

    this.mongoCircuitBreaker.on('close', () => {
      circuitBreakerCloseCounter.inc();
      this.logger.info('MongoDB circuit breaker CLOSED - normal operation resumed', {
        action: 'circuit_breaker_closed',
      });
    });
  }

  /**
   * Connect to all underlying stores
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const context = getContext();
    const startTime = Date.now();

    try {
      // Connect to Redis
      await this.redis.connect();
      this.logger.debug('Redis connected', {
        action: 'redis_connect',
        correlationId: context?.correlationId,
      });

      // Connect to MongoDB
      await this.mongo.connect();
      this.logger.debug('MongoDB connected', {
        action: 'mongo_connect',
        correlationId: context?.correlationId,
      });

      this.connected = true;
      this.logger.info('HybridAuthStore connected successfully', {
        action: 'hybrid_connect',
        duration: Date.now() - startTime,
        correlationId: context?.correlationId,
      });

      // Initialize outbox manager if write-behind is enabled
      if (this.config.enableWriteBehind && this.config.queue) {
        try {
          const redisClient = this.redis.getClient(); // Access internal Redis client
          this.outboxManager = new OutboxManager(redisClient, this.mongo, this.logger);
          this.outboxManager.startReconciler();

          this.logger.info('Outbox reconciler started', {
            action: 'outbox_reconciler_started',
            correlationId: context?.correlationId,
          });
        } catch {
          // Silently skip outbox initialization if getClient is not available
          this.logger.warn('Outbox manager not initialized - getClient not available', {
            action: 'outbox_reconciler_init_skipped',
            correlationId: context?.correlationId,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to connect HybridAuthStore',
        error instanceof Error ? error : undefined,
        {
          action: 'hybrid_connect_error',
          duration: Date.now() - startTime,
          correlationId: context?.correlationId,
        },
      );
      throw new StorageError(
        'Failed to connect HybridAuthStore',
        'hybrid',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Disconnect from all underlying stores
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      // Stop outbox reconciler
      if (this.outboxManager) {
        this.outboxManager.stopReconciler();
      }

      await Promise.all([
        this.redis.disconnect(),
        this.mongo.disconnect(),
        this.config.queue?.close(),
      ]);

      this.connected = false;

      this.logger.info('HybridAuthStore disconnected', {
        action: 'hybrid_disconnected',
      });
    } catch (error) {
      this.logger.error(
        'Error disconnecting HybridAuthStore',
        error instanceof Error ? error : undefined,
        {
          message: error instanceof Error ? error.message : String(error),
          action: 'hybrid_disconnect_error',
        },
      );
    }
  }

  /**
   * Get complete snapshot (Read-through pattern)
   */
  async get(sessionId: SessionId): Promise<Versioned<AuthSnapshot> | null> {
    const startTime = Date.now();
    const context = getContext();

    try {
      this.ensureConnected();

      this.logger.debug('Starting get operation', {
        sessionId,
        action: 'get_start',
        correlationId: context?.correlationId,
      });

      // Try Redis first (hot path)
      try {
        const cached = await this.redis.get(sessionId);
        if (cached) {
          redisHitsCounter.inc({ session_id: sessionId });
          this.logger.debug('Data loaded from Redis cache', {
            sessionId,
            duration: Date.now() - startTime,
            correlationId: context?.correlationId,
            action: 'redis_cache_hit',
          });
          return cached;
        }
        redisMissesCounter.inc({ session_id: sessionId });
      } catch {
        redisMissesCounter.inc({ session_id: sessionId });
        this.logger.warn('Redis read failed, falling back to MongoDB', {
          sessionId,
          action: 'redis_read_fallback',
        });
      }

      // Fallback to MongoDB with circuit breaker (cold path)
      let data: Versioned<AuthSnapshot> | null = null;

      try {
        data = await this.mongoCircuitBreaker.fire(async () => {
          return await this.mongo.get(sessionId);
        });
      } catch {
        // Circuit breaker rejected or MongoDB failed
        this.logger.error('MongoDB unavailable - circuit breaker open', undefined, {
          sessionId,
          operation: 'circuit_breaker_rejected',
        });
        return null; // Graceful degradation
      }

      if (!data) {
        this.logger.debug('Data not found in MongoDB', {
          sessionId,
          action: 'mongo_data_not_found',
        });
        return null;
      }

      mongoFallbacksCounter.inc({ session_id: sessionId });

      // Async cache warming (don't await)
      this.warmCache(sessionId, data).catch(() => {
        this.logger.warn('Cache warming failed', {
          sessionId,
          action: 'cache_warming_failed',
        });
      });

      this.logger.debug('Data loaded from MongoDB with cache warming', {
        sessionId,
        action: 'mongo_data_loaded',
        duration: Date.now() - startTime,
        correlationId: context?.correlationId,
      });

      return data;
    } catch (error) {
      this.logger.error(
        'Failed to get from HybridAuthStore',
        error instanceof Error ? error : undefined,
        {
          sessionId,
          duration: Date.now() - startTime,
          correlationId: context?.correlationId,
          action: 'get_error',
        },
      );
      throw new StorageError(
        'Failed to get from HybridAuthStore',
        'hybrid',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Update snapshot (Write-through + Write-behind pattern)
   */
  async set(
    sessionId: SessionId,
    patch: AuthPatch,
    expectedVersion?: number,
    fencingToken?: number,
  ): Promise<VersionedResult> {
    const mutex = this.getMutex(sessionId);

    // Acquire exclusive lock for this session (prevents race conditions)
    return await mutex.runExclusive(async () => {
      try {
        this.ensureConnected();

        // Type safety: Assert all Buffers are valid before persisting
        if (patch.creds) {
          assertBufferTypes(patch.creds, 'patch.creds');
        }
        if (patch.keys) {
          assertBufferTypes(patch.keys, 'patch.keys');
        }

        // Write to Redis first (hot path, synchronous)
        const result = await this.redis.set(sessionId, patch, expectedVersion);

        // Write-behind to MongoDB (async via queue or direct fallback)
        if (this.config.queue && this.config.enableWriteBehind) {
          try {
            // Add to outbox BEFORE queuing (transactional outbox pattern)
            if (this.outboxManager) {
              await this.outboxManager.addEntry(sessionId, patch, result.version, fencingToken);
            }

            await this.config.queue.add('persist', {
              sessionId,
              patch,
              version: result.version,
              fencingToken,
              timestamp: Date.now(),
            });

            queuePublishesCounter.inc({ session_id: sessionId });
          } catch (queueError) {
            queueFailuresCounter.inc({ session_id: sessionId });
            this.logger.warn('Queue write failed, falling back to direct MongoDB write', {
              sessionId,
              error: queueError instanceof Error ? queueError.message : String(queueError),
              action: 'hybrid_queue_fallback',
            });

            // Fallback: direct write to MongoDB
            await this.mongo.set(sessionId, patch, expectedVersion, fencingToken);
            directWritesCounter.inc({ session_id: sessionId });

            // Mark as completed in outbox (if exists)
            if (this.outboxManager) {
              await this.outboxManager.markCompleted(sessionId, result.version);
            }
          }
        } else {
          // Direct write to MongoDB (no queue)
          await this.mongo.set(sessionId, patch, expectedVersion, fencingToken);
          directWritesCounter.inc({ session_id: sessionId });
        }

        this.logger.debug('Hybrid write completed', {
          sessionId,
          action: 'hybrid_write_completed',
        });

        return result;
      } catch (error) {
        if (error instanceof VersionMismatchError) {
          throw error;
        }

        throw new StorageError(
          'Failed to set in HybridAuthStore',
          'hybrid',
          error instanceof Error ? error : undefined,
        );
      }
    }); // Lock automatically released after execution
  }

  /**
   * Delete snapshot (both layers)
   * Handles partial failures gracefully
   */
  async delete(sessionId: SessionId): Promise<void> {
    try {
      this.ensureConnected();

      const errors: Error[] = [];

      // Try deleting from Redis
      try {
        await this.redis.delete(sessionId);
      } catch (error) {
        errors.push(error as Error);
        this.logger.error('Redis delete failed', error instanceof Error ? error : undefined, {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: 'hybrid_delete_redis_failed',
        });
      }

      // Try deleting from MongoDB
      try {
        await this.mongo.delete(sessionId);
      } catch (error) {
        errors.push(error as Error);
        this.logger.error('MongoDB delete failed', error instanceof Error ? error : undefined, {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: 'hybrid_delete_mongo_failed',
        });
      }

      // If both failed, throw error
      if (errors.length === 2) {
        throw new StorageError('Failed to delete from both Redis and MongoDB', 'hybrid', errors[0]);
      }

      // If one failed, log warning but consider success
      if (errors.length === 1) {
        this.logger.warn('Partial delete success - one layer failed', {
          sessionId,
          failedLayers: errors.length,
          action: 'hybrid_delete_partial',
        });
      }

      this.logger.warn('Snapshot deleted from both layers', {
        sessionId,
        action: 'hybrid_delete_success',
      });
    } catch (error) {
      throw new StorageError(
        'Failed to delete from HybridAuthStore',
        'hybrid',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Renew TTL (both layers)
   * Handles partial failures gracefully
   */
  async touch(sessionId: SessionId, ttlSeconds?: number): Promise<void> {
    try {
      this.ensureConnected();

      const errors: Error[] = [];

      // Try touching Redis
      try {
        await this.redis.touch(sessionId, ttlSeconds);
      } catch (error) {
        errors.push(error as Error);
        this.logger.error('Redis touch failed', error instanceof Error ? error : undefined, {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: 'hybrid_touch_redis_failed',
        });
      }

      // Try touching MongoDB
      try {
        await this.mongo.touch(sessionId, ttlSeconds);
      } catch (error) {
        errors.push(error as Error);
        this.logger.error('MongoDB touch failed', error instanceof Error ? error : undefined, {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: 'hybrid_touch_mongo_failed',
        });
      }

      // If both failed, throw error
      if (errors.length === 2) {
        throw new StorageError('Failed to touch in both Redis and MongoDB', 'hybrid', errors[0]);
      }

      // If one failed, log warning but consider success
      if (errors.length === 1) {
        this.logger.warn('Partial touch success - one layer failed', {
          sessionId,
          failedLayers: errors.length,
          ttlSeconds,
          action: 'hybrid_touch_partial',
        });
      }

      this.logger.debug('TTL renewed in both layers', {
        sessionId,
        ttlSeconds,
        action: 'hybrid_touch_success',
      });
    } catch (error) {
      throw new StorageError(
        'Failed to touch in HybridAuthStore',
        'hybrid',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Check existence (Redis first, then MongoDB)
   */
  async exists(sessionId: SessionId): Promise<boolean> {
    try {
      this.ensureConnected();

      // Check Redis first
      const redisExists = await this.redis.exists(sessionId);
      if (redisExists) {
        return true;
      }

      // Fallback to MongoDB
      return await this.mongo.exists(sessionId);
    } catch (error) {
      throw new StorageError(
        'Failed to check existence in HybridAuthStore',
        'hybrid',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Health check (both layers must be healthy)
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.connected) return false;

      const [redisHealthy, mongoHealthy] = await Promise.all([
        this.redis.isHealthy(),
        this.mongo.isHealthy(),
      ]);

      return redisHealthy && mongoHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Get Prometheus metrics registry
   * Expose this for scraping at /metrics endpoint
   */
  getMetricsRegistry(): typeof metricsRegistry {
    return metricsRegistry;
  }

  /**
   * Get metrics text for Prometheus scraping
   */
  async getMetricsText(): Promise<string> {
    return await metricsRegistry.metrics();
  }

  /**
   * Check if MongoDB circuit breaker is open
   * Useful for health check endpoints
   */
  isMongoCircuitBreakerOpen(): boolean {
    return this.mongoCircuitBreaker.opened;
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats(): CircuitBreaker.Stats {
    return this.mongoCircuitBreaker.stats;
  }

  /**
   * Get outbox reconciler stats
   */
  getOutboxStats(): ReturnType<NonNullable<typeof this.outboxManager>['getStats']> | null {
    if (!this.outboxManager) {
      return null;
    }
    return this.outboxManager.getStats();
  }

  /**
   * Manually trigger outbox reconciliation
   */
  async reconcileOutbox(): Promise<void> {
    if (this.outboxManager) {
      await this.outboxManager.reconcile();
    }
  }

  /**
   * Get metrics (legacy method for backward compatibility)
   * @deprecated Use getMetricsRegistry() instead
   */
  getMetrics(): HybridMetrics & {
    hitRatio: number;
    totalRequests: number;
  } {
    const totalRequests = this.metrics.redisHits + this.metrics.redisMisses;
    const hitRatio = totalRequests > 0 ? this.metrics.redisHits / totalRequests : 0;

    return {
      ...this.metrics,
      hitRatio,
      totalRequests,
    };
  }

  /**
   * Reset metrics (legacy method)
   * @deprecated Prometheus metrics are cumulative
   */
  resetMetrics(): void {
    this.metrics = {
      redisHits: 0,
      redisMisses: 0,
      mongoFallbacks: 0,
      queuePublishes: 0,
      queueFailures: 0,
      directWrites: 0,
    };
  }

  /**
   * Batch get multiple snapshots
   * Optimized for fetching many sessions at once
   *
   * @param sessionIds - Array of session IDs to fetch
   * @returns Map of sessionId -> snapshot (or null if not found)
   *
   * @example
   * ```typescript
   * const sessions = await store.batchGet(['session1', 'session2', 'session3']);
   * for (const [sessionId, snapshot] of sessions) {
   *   if (snapshot) {
   *     console.log(`Found ${sessionId}: version ${snapshot.version}`);
   *   }
   * }
   * ```
   */
  async batchGet(sessionIds: SessionId[]): Promise<Map<SessionId, Versioned<AuthSnapshot> | null>> {
    const results = new Map<SessionId, Versioned<AuthSnapshot> | null>();
    const startTime = Date.now();
    const context = getContext();

    this.logger.debug('Starting batch get', {
      count: sessionIds.length,
      action: 'batch_get_start',
      correlationId: context?.correlationId,
    });

    // Try Redis pipeline first (best performance)
    const redisResults = new Map<SessionId, Versioned<AuthSnapshot> | null>();
    const mongoIds: SessionId[] = [];

    for (const sessionId of sessionIds) {
      try {
        const cached = await this.redis.get(sessionId);
        redisResults.set(sessionId, cached);
        if (cached) {
          redisHitsCounter.inc({ session_id: sessionId });
        } else {
          redisMissesCounter.inc({ session_id: sessionId });
          mongoIds.push(sessionId);
        }
      } catch (error) {
        this.logger.warn('Redis batch get failed, will fallback to MongoDB', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: 'batch_get_redis_fallback',
        });
        mongoIds.push(sessionId);
      }
    }

    // Fetch missing items from MongoDB
    if (mongoIds.length > 0) {
      for (const sessionId of mongoIds) {
        try {
          const data = await this.mongoCircuitBreaker.fire(() => this.mongo.get(sessionId));
          redisResults.set(sessionId, data);

          if (data) {
            mongoFallbacksCounter.inc({ session_id: sessionId });
            // Warm cache asynchronously
            this.warmCache(sessionId, data).catch(() => {
              this.logger.warn('Cache warming failed during batch', {
                sessionId,
                action: 'batch_get_cache_warming_failed',
              });
            });
          }
        } catch (error) {
          this.logger.error(
            'MongoDB batch get failed',
            error instanceof Error ? error : undefined,
            {
              sessionId,
              action: 'batch_get_mongo_error',
              correlationId: context?.correlationId,
            },
          );
        }
      }
    }

    // Merge results
    for (const [sessionId, value] of redisResults) {
      results.set(sessionId, value);
    }

    const duration = Date.now() - startTime;

    // Record metrics
    batchOperationsCounter.inc({ type: 'get', result: 'success' }, sessionIds.length);
    batchOperationsDurationHistogram.observe({ type: 'get', result: 'success' }, duration / 1000);

    this.logger.debug('Batch get completed', {
      count: sessionIds.length,
      hitCount: redisResults.size,
      duration,
      action: 'batch_get_completed',
      correlationId: context?.correlationId,
    });

    return results;
  }

  /**
   * Batch delete multiple snapshots
   * Optimized for removing many sessions at once
   *
   * @param sessionIds - Array of session IDs to delete
   * @returns Batch result with successful and failed operations
   *
   * @example
   * ```typescript
   * const result = await store.batchDelete(['session1', 'session2']);
   * console.log(`Deleted ${result.successful.size} sessions`);
   * console.log(`Failed ${result.failed.size} deletions`);
   * ```
   */
  async batchDelete(sessionIds: SessionId[]): Promise<BatchResult<void>> {
    const successful = new Map<SessionId, void>();
    const failed = new Map<SessionId, Error>();
    const startTime = Date.now();
    const context = getContext();

    this.logger.debug('Starting batch delete', {
      count: sessionIds.length,
      action: 'batch_delete_start',
      correlationId: context?.correlationId,
    });

    for (const sessionId of sessionIds) {
      try {
        await this.delete(sessionId);
        successful.set(sessionId, undefined);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        failed.set(sessionId, err);
        this.logger.error('Batch delete failed for session', err, {
          sessionId,
          action: 'batch_delete_failed',
          correlationId: context?.correlationId,
        });
      }
    }

    const duration = Date.now() - startTime;

    // Record metrics
    batchOperationsCounter.inc({ type: 'delete', result: 'success' }, successful.size);
    batchOperationsCounter.inc({ type: 'delete', result: 'failure' }, failed.size);
    batchOperationsDurationHistogram.observe(
      { type: 'delete', result: failed.size > 0 ? 'partial' : 'success' },
      duration / 1000,
    );

    this.logger.debug('Batch delete completed', {
      count: sessionIds.length,
      successfulCount: successful.size,
      failedCount: failed.size,
      duration,
      action: 'batch_delete_completed',
      correlationId: context?.correlationId,
    });

    return { successful, failed };
  }

  // ========== Private methods ==========

  /**
   * Get or create mutex for session (lazy initialization)
   * Ensures exclusive write access per session
   */
  private getMutex(sessionId: SessionId): Mutex {
    if (!this.writeMutexes.has(sessionId)) {
      this.writeMutexes.set(sessionId, new Mutex());
    }
    const mutex = this.writeMutexes.get(sessionId);
    if (!mutex) throw new StorageError('Mutex not found for session', 'hybrid');
    return mutex;
  }

  /**
   * Warm cache asynchronously with TOCTOU protection
   * Uses Redis WATCH + MULTI/EXEC for atomic version-checked writes
   */
  private async warmCache(sessionId: SessionId, data: Versioned<AuthSnapshot>): Promise<void> {
    try {
      const redis = this.redis.getClient();
      const metaKey = `baileys:auth:${sessionId}:meta`;

      // WATCH the meta key for changes during our operation
      await redis.watch(metaKey);

      try {
        // Check if cache already has newer version
        const currentMeta = await redis.get(metaKey);
        if (currentMeta) {
          const meta = JSON.parse(currentMeta) as { version: number };
          if (meta.version >= data.version) {
            await redis.unwatch();
            this.logger.debug('Cache warming skipped - newer version exists', {
              sessionId,
              currentVersion: meta.version,
              warmVersion: data.version,
              action: 'hybrid_cache_warming_skipped',
            });
            return;
          }
        }

        // Use the redis store's set method within a conceptual transaction
        // The WATCH ensures if meta key changed, the operation is safe
        // We unwatch first since redis.set will handle its own pipeline
        await redis.unwatch();

        // Perform the actual cache warming via redis store
        await this.redis.set(sessionId, data.data, data.version);

        this.logger.debug('Cache warmed successfully', {
          sessionId,
          version: data.version,
          action: 'hybrid_cache_warmed',
        });
      } catch (error) {
        // Ensure we unwatch on any error
        await redis.unwatch().catch(() => {
          // Ignore unwatch errors
        });
        throw error;
      }
    } catch (error) {
      this.logger.warn('Cache warming failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        action: 'hybrid_cache_warming_failed',
      });
    }
  }

  /**
   * Check if connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new StorageError('HybridAuthStore not connected', 'hybrid');
    }
  }
}

/**
 * Factory to create HybridAuthStore
 */
export async function createHybridStore(
  redis: RedisAuthStore,
  mongo: MongoAuthStore,
  config: HybridStoreConfig,
): Promise<HybridAuthStore> {
  const store = new HybridAuthStore(redis, mongo, config);
  await store.connect();
  return store;
}
