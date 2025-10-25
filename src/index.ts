/**
 * @baileys-store/core - Universal Auth State for Baileys v7.0+
 *
 * Biblioteca universal de autenticação para Baileys com suporte a:
 * - Redis (hot cache)
 * - MongoDB (cold storage)
 * - Hybrid (Redis + MongoDB)
 * - Criptografia opcional (AES-256-GCM)
 * - Compressão opcional (Snappy/Gzip)
 * - Queue abstraction (BullMQ, Kafka, SQS, etc.)
 */

// ========== Types ==========
export type {
  SessionId,
  AuthSnapshot,
  AuthPatch,
  Versioned,
  VersionedResult,
  AuthStore,
  TtlConfig,
  ResilienceConfig,
  ObservabilityConfig,
  SecurityConfig,
  EncryptedData,
  CacheMetrics,
  PersistenceMetrics,
  BaileysMetrics,
  SystemMetrics,
} from './types/index.js';

export {
  VersionMismatchError,
  EncryptionError,
  CompressionError,
  StorageError,
  TimeoutError,
  DEFAULT_TTL_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
  DEFAULT_SECURITY_CONFIG,
} from './types/index.js';

export type { QueueAdapter, JobOptions, PersistJob } from './types/queue.js';

// ========== Configuration Presets ==========
export {
  DEVELOPMENT,
  PRODUCTION,
  TESTING,
  PRESETS,
  createHybridConfigFromPreset,
  getPreset,
  validatePreset,
} from './config/presets.js';

export type { ConfigPreset, PresetName } from './config/presets.js';

// Nota: Configs específicos são exportados pelos respectivos módulos
// RedisStoreConfig → @baileys-store/core/redis
// MongoStoreConfig → @baileys-store/core/mongodb
// HybridStoreConfig → @baileys-store/core/hybrid

// ========== Crypto & Codec ==========
export { CryptoService, createCryptoService } from './crypto/index.js';
export { CodecService, createCodecService } from './crypto/codec.js';

// ========== Storage Utilities ==========
export {
  serializeWithBuffer,
  deserializeWithBuffer,
  retryWithBackoff,
  calculateExpiresAt,
  calculatePXAT,
  isExpired,
} from './storage/index.js';

// ========== Redis ==========
export { RedisAuthStore, createRedisStore } from './redis/index.js';

// ========== MongoDB ==========
export { MongoAuthStore, createMongoStore } from './mongodb/index.js';

// ========== Hybrid ==========
export { HybridAuthStore, createHybridStore, OutboxManager } from './hybrid/index.js';
export type { OutboxEntry, OutboxStatus, OutboxReconcilerStats } from './types/outbox.js';

// ========== Baileys Hooks ==========
export { useRedisAuthState } from './redis/use-redis-auth-state.js';
export { useMongoAuthState } from './mongodb/use-mongo-auth-state.js';
export { useHybridAuthState } from './hybrid/use-hybrid-auth-state.js';

// ========== Metrics (Prometheus) ==========
export {
  metricsRegistry,
  redisHitsCounter,
  redisMissesCounter,
  mongoFallbacksCounter,
  queuePublishesCounter,
  queueFailuresCounter,
  directWritesCounter,
  circuitBreakerOpenCounter,
  circuitBreakerCloseCounter,
  circuitBreakerHalfOpenCounter,
  outboxReconcilerLatencyHistogram,
  outboxReconcilerFailuresCounter,
  operationLatencyHistogram,
  getMetricsText,
  resetMetrics,
} from './metrics/index.js';
