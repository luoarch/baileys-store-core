/**
 * @baileys-store/core - Outbox Manager
 *
 * Transactional Outbox Pattern implementation
 * Tracks pending MongoDB writes in Redis to ensure eventual consistency
 *
 * Format:
 * - Redis hash: `outbox:{sessionId}`
 * - Fields: `{version}` → `OutboxEntry` (JSON)
 * - TTL: 7 days (auto-cleanup completed entries)
 */

import type { Redis } from 'ioredis';
import type { SessionId, AuthPatch, StructuredLogger } from '../types/index.js';
import { NullLoggerStructured } from '../types/index.js';
import type { OutboxEntry, OutboxReconcilerStats } from '../types/outbox.js';
import type { MongoAuthStore } from '../mongodb/store.js';
import {
  outboxReconcilerLatencyHistogram,
  outboxReconcilerFailuresCounter,
} from '../metrics/index.js';

/**
 * OutboxManager - Manages outbox for write-behind safety
 */
export class OutboxManager {
  private redis: Redis;
  private mongo: MongoAuthStore;
  private logger: StructuredLogger;
  private reconcilerInterval: NodeJS.Timeout | null = null;
  private stats: OutboxReconcilerStats = {
    totalProcessed: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalRetried: 0,
    avgLatency: 0,
    lastRunAt: 0,
  };

  constructor(redis: Redis, mongo: MongoAuthStore, logger?: StructuredLogger) {
    this.redis = redis;
    this.mongo = mongo;
    this.logger = logger ?? new NullLoggerStructured();
  }

  /**
   * Build outbox key for session
   */
  private buildOutboxKey(sessionId: SessionId): string {
    return `outbox:${sessionId}`;
  }

  /**
   * Build entry ID
   */
  private buildEntryId(sessionId: SessionId, version: number): string {
    return `${sessionId}:${String(version)}`;
  }

  /**
   * Add entry to outbox (before queuing MongoDB write)
   */
  async addEntry(
    sessionId: SessionId,
    patch: AuthPatch,
    version: number,
    fencingToken?: number,
  ): Promise<void> {
    const entryId = this.buildEntryId(sessionId, version);
    const outboxKey = this.buildOutboxKey(sessionId);

    const entry: OutboxEntry = {
      id: entryId,
      sessionId,
      patch,
      version,
      fencingToken,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    };

    // Save to Redis hash
    await this.redis.hset(outboxKey, version.toString(), JSON.stringify(entry));

    // Set TTL on hash (7 days)
    await this.redis.expire(outboxKey, 7 * 24 * 60 * 60);
  }

  /**
   * Mark entry as completed (after MongoDB confirms)
   */
  async markCompleted(sessionId: SessionId, version: number): Promise<void> {
    const outboxKey = this.buildOutboxKey(sessionId);
    const entryStr = await this.redis.hget(outboxKey, version.toString());

    if (!entryStr) return;

    const entry: OutboxEntry = JSON.parse(entryStr) as OutboxEntry;
    entry.status = 'completed';
    entry.completedAt = Date.now();
    entry.updatedAt = Date.now();

    await this.redis.hset(outboxKey, version.toString(), JSON.stringify(entry));

    // Delete completed entry after 1 hour (allow time for reconciler to verify)
    setTimeout(
      () => {
        this.redis.hdel(outboxKey, version.toString()).catch(() => {
          // Ignore errors
        });
      },
      60 * 60 * 1000,
    );
  }

  /**
   * Mark entry as failed
   */
  async markFailed(sessionId: SessionId, version: number, error: string): Promise<void> {
    const outboxKey = this.buildOutboxKey(sessionId);
    const entryStr = await this.redis.hget(outboxKey, version.toString());

    if (!entryStr) return;

    const entry: OutboxEntry = JSON.parse(entryStr) as OutboxEntry;
    entry.status = 'failed';
    entry.lastError = error;
    entry.updatedAt = Date.now();
    entry.attempts++;

    await this.redis.hset(outboxKey, version.toString(), JSON.stringify(entry));
  }

  /**
   * Get pending entries for session
   */
  async getPendingEntries(sessionId: SessionId): Promise<OutboxEntry[]> {
    const outboxKey = this.buildOutboxKey(sessionId);
    const entries = await this.redis.hgetall(outboxKey);

    const pending: OutboxEntry[] = [];

    for (const [, entryStr] of Object.entries(entries)) {
      const entry: OutboxEntry = JSON.parse(entryStr) as OutboxEntry;
      if (entry.status === 'pending' || (entry.status === 'failed' && entry.attempts < 3)) {
        pending.push(entry);
      }
    }

    return pending.sort((a, b) => a.version - b.version);
  }

  /**
   * Reconcile outbox - process pending entries
   * Should be called periodically (e.g., every 30s)
   */
  async reconcile(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get all outbox keys
      const outboxKeys = await this.redis.keys('outbox:*');

      for (const outboxKey of outboxKeys) {
        const sessionId: SessionId = outboxKey.replace('outbox:', '');
        const pending = await this.getPendingEntries(sessionId);

        for (const entry of pending) {
          const entryStartTime = Date.now();

          try {
            // Mark as processing
            entry.status = 'processing';
            entry.updatedAt = Date.now();
            await this.redis.hset(outboxKey, entry.version.toString(), JSON.stringify(entry));

            // Try to persist to MongoDB
            await this.mongo.set(sessionId, entry.patch, entry.version - 1, entry.fencingToken);

            // Mark as completed
            await this.markCompleted(sessionId, entry.version);

            this.stats.totalCompleted++;

            // Record latency
            const latency = (Date.now() - entryStartTime) / 1000;
            outboxReconcilerLatencyHistogram.observe(
              { operation: 'persist', status: 'success' },
              latency,
            );
          } catch (error: unknown) {
            // Mark as failed
            await this.markFailed(
              sessionId,
              entry.version,
              error instanceof Error ? error.message : String(error),
            );

            this.stats.totalFailed++;
            this.stats.totalRetried += entry.attempts;

            // Record failure
            outboxReconcilerFailuresCounter.inc({
              error_type: error instanceof Error ? error.constructor.name : 'unknown',
            });

            outboxReconcilerLatencyHistogram.observe(
              { operation: 'persist', status: 'failure' },
              (Date.now() - entryStartTime) / 1000,
            );

            this.logger.error('Outbox reconciler failed to persist entry', error instanceof Error ? error : undefined, {
              sessionId,
              version: entry.version,
              attempts: entry.attempts,
              action: 'outbox_reconciler_failure',
            });
          }
        }

        this.stats.totalProcessed += pending.length;
      }

      this.stats.lastRunAt = Date.now();

      // Update average latency
      const totalLatency = Date.now() - startTime;
      this.stats.avgLatency =
        (this.stats.avgLatency * (this.stats.totalProcessed - outboxKeys.length) + totalLatency) /
        this.stats.totalProcessed;

      this.logger.debug('Outbox reconciler completed', {
        processed: outboxKeys.length,
        latency: totalLatency,
        stats: this.stats,
        action: 'outbox_reconciler_complete',
      });
    } catch (error: unknown) {
      this.logger.error('Outbox reconciler error', error instanceof Error ? error : undefined, {
        action: 'outbox_reconciler_error',
      });
    }
  }

  /**
   * Start background reconciler (30s interval)
   */
  startReconciler(): void {
    if (this.reconcilerInterval) {
      this.logger.warn('Outbox reconciler already running', {
        action: 'outbox_reconciler_already_running',
      });
      return;
    }

    this.logger.warn('Starting outbox reconciler (30s interval)', {
      action: 'outbox_reconciler_start',
    });

    this.reconcilerInterval = setInterval(() => {
      this.reconcile().catch((error: unknown) => {
        this.logger.error('Outbox reconciler unhandled error', error instanceof Error ? error : undefined, {
          action: 'outbox_reconciler_unhandled_error',
        });
      });
    }, 30_000);
  }

  /**
   * Stop background reconciler
   */
  stopReconciler(): void {
    if (this.reconcilerInterval) {
      clearInterval(this.reconcilerInterval);
      this.reconcilerInterval = null;
      this.logger.warn('Outbox reconciler stopped', {
        action: 'outbox_reconciler_stop',
      });
    }
  }

  /**
   * Get reconciler stats
   */
  getStats(): OutboxReconcilerStats {
    return { ...this.stats };
  }

  /**
   * Clean up completed entries older than 1 hour
   */
  async cleanup(): Promise<void> {
    const outboxKeys = await this.redis.keys('outbox:*');
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const outboxKey of outboxKeys) {
      const entries = await this.redis.hgetall(outboxKey);

      for (const [version, entryStr] of Object.entries(entries)) {
        const entry: OutboxEntry = JSON.parse(entryStr) as OutboxEntry;

        if (entry.status === 'completed' && entry.completedAt && entry.completedAt < oneHourAgo) {
          await this.redis.hdel(outboxKey, version);
        }
      }
    }
  }
}
