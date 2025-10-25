/**
 * @baileys-store/core - Outbox Types
 *
 * Transactional Outbox Pattern for dual-write problem
 * Ensures MongoDB writes are eventually consistent with Redis
 */

import type { AuthPatch, SessionId } from './index.js';

/**
 * Outbox entry status
 */
export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Outbox entry stored in Redis
 */
export interface OutboxEntry {
  id: string; // Unique ID: `${sessionId}:${version}`
  sessionId: SessionId;
  patch: AuthPatch;
  version: number;
  fencingToken?: number;
  status: OutboxStatus;
  createdAt: number; // Unix timestamp
  updatedAt: number;
  attempts: number;
  lastError?: string;
  completedAt?: number;
}

/**
 * Persist job for queue
 */
export interface PersistJob {
  sessionId: SessionId;
  patch: AuthPatch;
  version: number;
  fencingToken?: number;
  timestamp: number;
}

/**
 * Outbox reconciler stats
 */
export interface OutboxReconcilerStats {
  totalProcessed: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetried: number;
  avgLatency: number;
  lastRunAt: number;
}
