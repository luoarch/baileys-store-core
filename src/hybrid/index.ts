/**
 * @baileys-store/core - Hybrid Module
 *
 * Hybrid Redis+MongoDB authentication state storage
 * - Read-through: Redis cache with MongoDB fallback
 * - Write-behind: Redis hot path with async MongoDB persistence
 * - Queue integration via QueueAdapter interface
 * - Circuit breaker and metrics
 * - Full Baileys compatibility
 */

export { HybridAuthStore, createHybridStore } from './store.js';
export { useHybridAuthState } from './use-hybrid-auth-state.js';
export type { UseHybridAuthStateOptions } from '../types/config.js';
export { OutboxManager } from './outbox.js';
export type {
  OutboxEntry,
  OutboxStatus,
  OutboxReconcilerStats,
  PersistJob,
} from '../types/outbox.js';
