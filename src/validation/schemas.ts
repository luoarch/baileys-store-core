/**
 * @baileys-store/core - Zod Validation Schemas
 *
 * Schemas for runtime configuration validation
 * Provides type-safe validation with helpful error messages
 */

import { z } from 'zod';

/**
 * TTL Configuration Schema
 */
export const TtlConfigSchema = z.object({
  defaultTtl: z
    .number()
    .int()
    .min(1, 'defaultTtl must be at least 1 second')
    .describe('Default TTL for session snapshots (seconds)'),

  credsTtl: z
    .number()
    .int()
    .min(1, 'credsTtl must be at least 1 second')
    .describe('TTL for credentials (seconds)'),

  keysTtl: z
    .number()
    .int()
    .min(1, 'keysTtl must be at least 1 second')
    .describe('TTL for keys (seconds)'),

  lockTtl: z
    .number()
    .int()
    .min(1, 'lockTtl must be at least 1 second')
    .describe('TTL for distributed locks (seconds)'),
});

/**
 * Resilience Configuration Schema
 */
export const ResilienceConfigSchema = z.object({
  operationTimeout: z
    .number()
    .int()
    .min(100, 'operationTimeout must be at least 100ms')
    .max(60000, 'operationTimeout should not exceed 60s')
    .describe('Timeout for storage operations (milliseconds)'),

  maxRetries: z
    .number()
    .int()
    .min(0, 'maxRetries must be non-negative')
    .max(10, 'maxRetries should not exceed 10')
    .describe('Maximum retry attempts for failed operations'),

  retryBaseDelay: z
    .number()
    .int()
    .min(0, 'retryBaseDelay must be non-negative')
    .describe('Base delay for exponential backoff (milliseconds)'),

  retryMultiplier: z
    .number()
    .min(1, 'retryMultiplier must be at least 1')
    .describe('Multiplier for exponential backoff'),
});

/**
 * Security Configuration Schema
 */
export const SecurityConfigSchema = z.object({
  enableEncryption: z
    .boolean()
    .describe('Enable encryption for stored data'),

  enableCompression: z
    .boolean()
    .describe('Enable compression for stored data'),

  encryptionAlgorithm: z
    .enum(['aes-256-gcm', 'secretbox'], {
      errorMap: () => ({ message: 'encryptionAlgorithm must be either "aes-256-gcm" or "secretbox"' }),
    })
    .describe('Encryption algorithm to use'),

  compressionAlgorithm: z
    .enum(['snappy', 'gzip', 'lz4'], {
      errorMap: () => ({ message: 'compressionAlgorithm must be "snappy", "gzip", or "lz4"' }),
    })
    .describe('Compression algorithm to use'),

  keyRotationDays: z
    .number()
    .int()
    .min(1, 'keyRotationDays must be at least 1 day')
    .describe('Key rotation interval (days)'),

  enableDebugLogging: z
    .boolean()
    .describe('Enable debug logging (for development only)'),

  environment: z
    .enum(['development', 'production', 'test'], {
      errorMap: () => ({ message: 'environment must be "development", "production", or "test"' }),
    })
    .describe('Deployment environment'),
}).refine(
  (data) => !data.enableEncryption || data.keyRotationDays >= 1,
  {
    message: 'keyRotationDays must be at least 1 day when encryption is enabled',
    path: ['keyRotationDays'],
  },
);

/**
 * Observability Configuration Schema
 */
export const ObservabilityConfigSchema = z.object({
  enableMetrics: z
    .boolean()
    .describe('Enable Prometheus metrics'),

  enableTracing: z
    .boolean()
    .describe('Enable distributed tracing (OpenTelemetry)'),

  enableDetailedLogs: z
    .boolean()
    .describe('Enable detailed structured logging'),

  metricsInterval: z
    .number()
    .int()
    .min(1000, 'metricsInterval must be at least 1 second')
    .describe('Metrics collection interval (milliseconds)'),
});

/**
 * Hybrid Store Configuration Schema
 */
export const HybridStoreConfigSchema = z.object({
  // Connection strings
  redisUrl: z
    .string()
    .optional()
    .describe('Redis connection URL'),

  mongoUrl: z
    .string()
    .min(1, 'mongoUrl is required')
    .describe('MongoDB connection URL'),

  mongoDatabase: z
    .string()
    .min(1, 'mongoDatabase is required')
    .describe('MongoDB database name'),

  mongoCollection: z
    .string()
    .min(1, 'mongoCollection is required')
    .describe('MongoDB collection name'),

  // Configuration objects
  ttl: TtlConfigSchema,
  resilience: ResilienceConfigSchema,
  security: SecurityConfigSchema,
  observability: ObservabilityConfigSchema,

  // Optional fields
  masterKey: z
    .string()
    .optional()
    .describe('Master encryption key (64 hex characters)'),

  enableWriteBehind: z
    .boolean()
    .optional()
    .describe('Enable write-behind pattern (async MongoDB writes)'),

  writeBehindFlushInterval: z
    .number()
    .int()
    .min(100, 'writeBehindFlushInterval must be at least 100ms')
    .optional()
    .describe('Write-behind flush interval (milliseconds)'),

  writeBehindQueueSize: z
    .number()
    .int()
    .min(10, 'writeBehindQueueSize must be at least 10')
    .max(10000, 'writeBehindQueueSize should not exceed 10000')
    .optional()
    .describe('Maximum size of write-behind queue'),
}).refine(
  (data) => !data.security.enableEncryption || !!data.masterKey,
  {
    message: 'masterKey is required when encryption is enabled',
    path: ['masterKey'],
  },
);

/**
 * Configuration Preset Schema
 */
export const ConfigPresetSchema = z.object({
  ttl: TtlConfigSchema,
  resilience: ResilienceConfigSchema,
  security: SecurityConfigSchema,
  observability: ObservabilityConfigSchema,
});

// Export types inferred from schemas
export type TtlConfig = z.infer<typeof TtlConfigSchema>;
export type ResilienceConfig = z.infer<typeof ResilienceConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;
export type HybridStoreConfig = z.infer<typeof HybridStoreConfigSchema>;
export type ConfigPreset = z.infer<typeof ConfigPresetSchema>;
