/**
 * @baileys-store/core/redis - Redis Adapter
 *
 * Exports:
 * - RedisAuthStore (class)
 * - createRedisStore (factory)
 * - useRedisAuthState (Baileys hook) ✅
 */

export { RedisAuthStore, createRedisStore, type RedisStoreConfig } from './store.js';
export { useRedisAuthState, type UseRedisAuthStateOptions } from './use-redis-auth-state.js';
