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
  BatchUpdate,
  BatchResult,
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
} from './config/presets.js';

export type {
  ConfigPreset,
  PresetName,
  RateLimitConfig,
  MonitoringConfig,
} from './config/presets.js';

// ========== Validation ==========
export {
  validateAndReportConfig,
  validatePreset,
  analyzeConfigPerformance,
  scanConfigSecurity,
  HybridStoreConfigSchema,
  TtlConfigSchema,
  ResilienceConfigSchema,
  SecurityConfigSchema,
  ObservabilityConfigSchema,
  ConfigPresetSchema,
} from './validation/index.js';

export type { ValidationReport, ValidationError } from './validation/index.js';

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
  batchOperationsCounter,
  batchOperationsDurationHistogram,
  versionConflictCounter,
  cacheWarmingCounter,
  circuitBreakerStateGauge,
  outboxQueueSizeGauge,
  outboxReconciliationLatencyHistogram,
  operationTimeoutCounter,
  rateLimitWaitCounter,
  rateLimitTokensGauge,
  rotationAnomalyCounter,
  rotationRateGauge,
  connectionStateGauge,
  connectionSilenceGauge,
  reconnectionAttemptsCounter,
  reconnectionSuccessCounter,
  lidMappingCacheHitsCounter,
  lidMappingCacheMissesCounter,
  lidMappingsStoredCounter,
  diagnosticChecksCounter,
  diagnosticRecommendationsGauge,
  getMetricsText,
  resetMetrics,
} from './metrics/index.js';

// ========== Logger & Context ==========
export { ConsoleStructuredLogger, NullLogger, LogLevel } from './logger/index.js';
export type { StructuredLogger, LogContext } from './logger/index.js';

export {
  getContext,
  withContext,
  getCorrelationId,
  getRequestId,
  getOperationDuration,
  withCorrelationId,
  setContextMetadata,
  getContextMetadata,
  hasCorrelationId,
} from './context/execution-context.js';

export type { ExecutionContext } from './context/execution-context.js';

// ========== Health Checks ==========
export { performHealthCheck, isReady, isLive } from './health/index.js';
export type { ComponentHealth, HealthStatus, HealthCheckConfig } from './health/index.js';

// ========== Errors ==========
export {
  ErrorDomain,
  ErrorSeverity,
  ErrorCode,
  getErrorMetadata,
  isRetryable,
  getRetryDelay,
} from './errors/hierarchy.js';
export type { ErrorMetadata } from './errors/hierarchy.js';

// ========== Rate Limiting (v1.1.0) ==========
export {
  TokenBucket,
  SessionRateLimiter,
  DEFAULT_RATE_LIMITER_CONFIG,
} from './rate-limit/index.js';
export type {
  TokenBucketConfig,
  TokenBucketState,
  RateLimiterConfig,
  RateLimitStatus,
  SessionMetadata,
} from './rate-limit/index.js';

// ========== Monitoring (v1.1.0) ==========
export {
  RotationMonitor,
  ConnectionHealthTracker,
  DEFAULT_ROTATION_MONITOR_CONFIG,
  DEFAULT_CONNECTION_TRACKER_CONFIG,
} from './monitoring/index.js';
export type {
  RotationMonitorConfig,
  RotationStatus,
  RotationStats,
  ConnectionState,
  ConnectionTrackerConfig,
  ConnectionHealth,
  SessionConnectionData,
} from './monitoring/index.js';

// ========== Identity (v1.1.0) ==========
export { LIDMappingCache, DEFAULT_LID_CACHE_CONFIG } from './identity/index.js';
export type { LIDMapping, LIDCacheConfig, LIDCacheStats } from './identity/index.js';

// ========== Diagnostics (v1.1.0) ==========
export { DiagnosticEngine, DEFAULT_DIAGNOSTIC_ENGINE_CONFIG } from './diagnostics/index.js';
export type {
  DiagnosticStatus,
  CheckResult,
  DiagnosticReport,
  DiagnosticEngineConfig,
} from './diagnostics/index.js';
