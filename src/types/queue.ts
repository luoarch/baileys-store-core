/**
 * @baileys-store/core - Queue Adapter Interface
 *
 * Abstract interface for queue system integration (BullMQ, Kafka, SQS, etc.)
 * Enables async write-behind without coupling the library to a specific system
 */

import type { AuthPatch } from './index.js';

/**
 * Job options for queuing
 */
export interface JobOptions {
  /** Number of attempts on failure */
  attempts?: number;
  /** Backoff configuration for retries */
  backoff?: {
    /** Backoff type */
    type: 'exponential' | 'fixed';
    /** Delay in ms */
    delay: number;
  };
  /** Remove job after successful completion */
  removeOnComplete?: boolean;
  /** Job priority (higher = more priority) */
  priority?: number;
  /** Delay before processing (ms) */
  delay?: number;
}

/**
 * Main Queue Adapter interface
 *
 * Common implementations:
 * - BullMQAdapter (Redis-based)
 * - KafkaAdapter (Kafka producer)
 * - SQSAdapter (AWS SQS)
 * - RedisStreamsAdapter (Redis Streams)
 *
 * @example
 * ```typescript
 * class BullMQAdapter implements QueueAdapter {
 *   private queue: Queue;
 *
 *   constructor(queueName: string, connection: Redis | Cluster) {  // ✅ Tipado
 *     this.queue = new Queue(queueName, { connection });
 *   }
 *
 *   async add(jobName: string, data: OutboxEntry, options?: JobOptions) {
 *     await this.queue.add(jobName, data, options);
 *   }
 *
 *   async close() {
 *     await this.queue.close();
 *   }
 * }
 * ```
 */
export interface QueueAdapter<TData = unknown> {
  /**
   * Add a job to the queue
   *
   * @param jobName - Job name/type
   * @param data - Job data
   * @param options - Queuing options
   */
  add(jobName: string, data: TData, options?: JobOptions): Promise<void>;

  /**
   * Close connections and free resources
   */
  close(): Promise<void>;
}

/**
 * Persistence job for write-behind
 */
export interface PersistJob {
  /** Session ID */
  sessionId: string;
  /** Data patch to persist */
  patch: AuthPatch;
  /** Expected version (optimistic locking) */
  expectedVersion?: number;
  /** Job creation timestamp */
  timestamp: number;
  /** Fencing token to avoid zombie writes */
  fencingToken?: number;
}
