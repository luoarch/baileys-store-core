/**
 * @baileys-store/core - MongoDB Module
 *
 * MongoDB-based authentication state storage
 * - Durable persistence with ACID guarantees
 * - Optimistic locking for concurrent access
 * - TTL management and document caching
 * - Full Baileys compatibility
 */

export { MongoAuthStore, createMongoStore } from './store.js';
export { useMongoAuthState } from './use-mongo-auth-state.js';
export type { MongoAuthStoreConfig } from './store.js';
export type { UseMongoAuthStateOptions } from '../types/config.js';
