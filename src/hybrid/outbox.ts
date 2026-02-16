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
import pLimit from 'p-limit';
import type { SessionId, AuthPatch, StructuredLogger } from '../types/index.js';
import { NullLoggerStructured } from '../types/index.js';
import type { OutboxEntry, OutboxReconcilerStats } from '../types/outbox.js';
import type { MongoAuthStore } from '../mongodb/store.js';
import {
  outboxReconcilerLatencyHistogram,
  outboxReconcilerFailuresCounter,
} from '../metrics/index.js';

/** Maximum concurrent MongoDB writes during reconciliation */
const RECONCILER_CONCURRENCY = 10;

/** Maximum retry attempts before moving to dead letter queue */
const MAX_RETRY_ATTEMPTS = 3;

/** Dead letter queue key */
const DLQ_KEY = 'outbox:dlq';

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

    // Use HSETNX for idempotent add (returns 0 if already exists)
    const added = await this.redis.hsetnx(outboxKey, version.toString(), JSON.stringify(entry));

    if (added === 0) {
      this.logger.debug('Outbox entry already exists, skipping duplicate', {
        sessionId,
        version,
        action: 'outbox_duplicate_skipped',
      });
      return; // Idempotent - entry already queued
    }

    // Set TTL on hash (7 days) only for new entries
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
      if (
        entry.status === 'pending' ||
        (entry.status === 'failed' && entry.attempts < MAX_RETRY_ATTEMPTS)
      ) {
        pending.push(entry);
      }
    }

    return pending.sort((a, b) => a.version - b.version);
  }

  /**
   * Reconcile outbox - process pending entries with concurrency control
   * Uses p-limit to prevent overwhelming MongoDB with concurrent writes
   * Moves permanently failed entries to dead letter queue
   */
  async reconcile(): Promise<number> {
    const startTime = Date.now();
    const limit = pLimit(RECONCILER_CONCURRENCY);
    let processedCount = 0;

    try {
      // Get all outbox keys (exclude DLQ)
      const allKeys = await this.redis.keys('outbox:*');
      const outboxKeys = allKeys.filter((key) => key !== DLQ_KEY);

      // Collect all entries to process
      const allEntries: { sessionId: SessionId; entry: OutboxEntry; outboxKey: string }[] = [];

      for (const outboxKey of outboxKeys) {
        const sessionId: SessionId = outboxKey.replace('outbox:', '');
        const pending = await this.getPendingEntries(sessionId);

        for (const entry of pending) {
          allEntries.push({ sessionId, entry, outboxKey });
        }
      }

      if (allEntries.length === 0) {
        this.stats.lastRunAt = Date.now();
        return 0;
      }

      // Process entries with concurrency limit
      const results = await Promise.allSettled(
        allEntries.map(({ sessionId, entry, outboxKey }) =>
          limit(async () => {
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

              return true;
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              // Check if max retries exceeded - move to DLQ
              if (entry.attempts >= MAX_RETRY_ATTEMPTS - 1) {
                await this.moveToDeadLetter(sessionId, entry, errorMessage);
                this.stats.totalFailed++;
              } else {
                // Mark as failed for retry
                await this.markFailed(sessionId, entry.version, errorMessage);
                this.stats.totalRetried++;
              }

              this.stats.totalFailed++;

              // Record failure
              outboxReconcilerFailuresCounter.inc({
                error_type: error instanceof Error ? error.constructor.name : 'unknown',
              });

              outboxReconcilerLatencyHistogram.observe(
                { operation: 'persist', status: 'failure' },
                (Date.now() - entryStartTime) / 1000,
              );

              this.logger.error(
                'Outbox reconciler failed to persist entry',
                error instanceof Error ? error : undefined,
                {
                  sessionId,
                  version: entry.version,
                  attempts: entry.attempts,
                  action: 'outbox_reconciler_failure',
                },
              );

              return false;
            }
          }),
        ),
      );

      processedCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      this.stats.totalProcessed += allEntries.length;
      this.stats.lastRunAt = Date.now();

      // Update average latency
      const totalLatency = Date.now() - startTime;
      if (this.stats.totalProcessed > 0) {
        this.stats.avgLatency =
          (this.stats.avgLatency * (this.stats.totalProcessed - allEntries.length) + totalLatency) /
          this.stats.totalProcessed;
      }

      this.logger.debug('Outbox reconciler completed', {
        processed: allEntries.length,
        successful: processedCount,
        latency: totalLatency,
        stats: this.stats,
        action: 'outbox_reconciler_complete',
      });

      return processedCount;
    } catch (error: unknown) {
      this.logger.error('Outbox reconciler error', error instanceof Error ? error : undefined, {
        action: 'outbox_reconciler_error',
      });
      return processedCount;
    }
  }

  /**
   * Move permanently failed entry to dead letter queue
   */
  private async moveToDeadLetter(
    sessionId: SessionId,
    entry: OutboxEntry,
    error: string,
  ): Promise<void> {
    const dlqEntry = JSON.stringify({
      sessionId,
      entryId: entry.id,
      version: entry.version,
      patch: entry.patch,
      fencingToken: entry.fencingToken,
      attempts: entry.attempts + 1,
      lastError: error,
      failedAt: new Date().toISOString(),
      createdAt: entry.createdAt,
    });

    // Add to DLQ list
    await this.redis.lpush(DLQ_KEY, dlqEntry);

    // Remove from outbox
    const outboxKey = this.buildOutboxKey(sessionId);
    await this.redis.hdel(outboxKey, entry.version.toString());

    this.logger.warn('Entry moved to dead letter queue', {
      sessionId,
      version: entry.version,
      attempts: entry.attempts + 1,
      error,
      action: 'outbox_entry_dlq',
    });
  }

  /**
   * Get dead letter queue entries
   */
  async getDeadLetterEntries(limit = 100): Promise<string[]> {
    return await this.redis.lrange(DLQ_KEY, 0, limit - 1);
  }

  /**
   * Get dead letter queue size
   */
  async getDeadLetterSize(): Promise<number> {
    return await this.redis.llen(DLQ_KEY);
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
        this.logger.error(
          'Outbox reconciler unhandled error',
          error instanceof Error ? error : undefined,
          {
            action: 'outbox_reconciler_unhandled_error',
          },
        );
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
