/**
 * @baileys-store/core - Configuration Presets
 *
 * Pre-configured presets for different environments
 * Each preset is optimized for specific use cases and tested in production-like scenarios
 */

import type {
  TtlConfig,
  ResilienceConfig,
  ObservabilityConfig,
  SecurityConfig,
} from '../types/index.js';
import type { HybridStoreConfig } from '../types/config.js';

/**
 * Configuration Preset
 * Represents a complete configuration optimized for a specific environment
 */
export interface ConfigPreset {
  ttl: TtlConfig;
  resilience: ResilienceConfig;
  security: SecurityConfig;
  observability: ObservabilityConfig;
}

/**
 * DEVELOPMENT Preset
 *
 * Optimized for local development with:
 * - Short TTLs for rapid iteration
 * - Long timeouts for debugging
 * - Detailed logging
 * - Encryption disabled for simplicity
 *
 * Use Case: Development, debugging, local testing
 */
export const DEVELOPMENT: ConfigPreset = {
  ttl: {
    defaultTtl: 300, // 5 minutes - short enough to test expiration
    credsTtl: 3600, // 1 hour
    keysTtl: 3600, // 1 hour
    lockTtl: 5, // 5 seconds
  },
  resilience: {
    operationTimeout: 10000, // 10s - longer timeout for debugging
    maxRetries: 2, // Fewer retries to fail fast during development
    retryBaseDelay: 200, // 200ms base delay
    retryMultiplier: 2,
  },
  security: {
    enableEncryption: false, // Disabled for easier debugging
    enableCompression: false, // Disabled for easier debugging
    encryptionAlgorithm: 'secretbox',
    compressionAlgorithm: 'snappy',
    keyRotationDays: 365, // Not enforced when encryption disabled
    enableDebugLogging: true, // Enable debug logs
    environment: 'development',
  },
  observability: {
    enableMetrics: true, // Metrics helpful during development
    enableTracing: false, // Tracing overhead not needed
    enableDetailedLogs: true, // Detailed logs for debugging
    metricsInterval: 60000, // 1 minute
  },
};

/**
 * PRODUCTION Preset
 *
 * Optimized for production with:
 * - Long TTLs to minimize database load
 * - Aggressive timeouts for fast failures
 * - Encryption mandatory
 * - Minimal logging
 *
 * Use Case: Production deployments, high availability
 */
export const PRODUCTION: ConfigPreset = {
  ttl: {
    defaultTtl: 3600, // 1 hour - balance between performance and freshness
    credsTtl: 604800, // 7 days - credentials change rarely
    keysTtl: 604800, // 7 days - keys change rarely
    lockTtl: 5, // 5 seconds
  },
  resilience: {
    operationTimeout: 5000, // 5s - aggressive timeout
    maxRetries: 3, // Retry 3 times with exponential backoff
    retryBaseDelay: 100, // 100ms base delay
    retryMultiplier: 2, // Exponential backoff
  },
  security: {
    enableEncryption: true, // Mandatory in production
    enableCompression: true, // Reduce storage costs
    encryptionAlgorithm: 'aes-256-gcm', // Stronger algorithm for production
    compressionAlgorithm: 'snappy', // Fast compression
    keyRotationDays: 90, // Rotate keys every 90 days
    enableDebugLogging: false, // No debug logs in production
    environment: 'production',
  },
  observability: {
    enableMetrics: true, // Essential for production monitoring
    enableTracing: false, // Optional (can be enabled if needed)
    enableDetailedLogs: false, // Reduced logging to minimize I/O
    metricsInterval: 60000, // 1 minute
  },
};

/**
 * TESTING Preset
 *
 * Optimized for automated tests with:
 * - Very short TTLs for quick test execution
 * - Fast timeouts
 * - No encryption for speed
 * - Metrics disabled to reduce overhead
 *
 * Use Case: Unit tests, integration tests, E2E tests
 */
export const TESTING: ConfigPreset = {
  ttl: {
    defaultTtl: 30, // 30 seconds - short enough for fast tests
    credsTtl: 60, // 1 minute
    keysTtl: 60, // 1 minute
    lockTtl: 1, // 1 second - minimal lock duration
  },
  resilience: {
    operationTimeout: 2000, // 2s - fail fast in tests
    maxRetries: 1, // Single retry for test speed
    retryBaseDelay: 50, // 50ms base delay
    retryMultiplier: 1, // No exponential backoff
  },
  security: {
    enableEncryption: false, // Disabled for test speed
    enableCompression: false, // Disabled for test speed
    encryptionAlgorithm: 'secretbox',
    compressionAlgorithm: 'gzip', // Lighter compression
    keyRotationDays: 365, // Not enforced when encryption disabled
    enableDebugLogging: false, // Quiet tests
    environment: 'test',
  },
  observability: {
    enableMetrics: false, // Metrics add overhead in tests
    enableTracing: false, // No tracing in tests
    enableDetailedLogs: false, // Quiet tests
    metricsInterval: 5000, // 5s (if metrics enabled)
  },
};

/**
 * Preset Registry
 * Map of preset names to configurations
 */
export const PRESETS = {
  DEVELOPMENT,
  PRODUCTION,
  TESTING,
} as const;

export type PresetName = keyof typeof PRESETS;

/**
 * Create a HybridStoreConfig from a preset
 *
 * @param presetName - Name of the preset (DEVELOPMENT, PRODUCTION, TESTING)
 * @param overrides - Optional overrides for connection strings and other required fields
 * @returns Complete HybridStoreConfig ready to use
 *
 * @example
 * ```typescript
 * const config = createHybridConfigFromPreset('PRODUCTION', {
 *   mongoUrl: 'mongodb://localhost:27017',
 *   mongoDatabase: 'whatsapp',
 *   mongoCollection: 'sessions',
 *   masterKey: process.env.BAILEYS_MASTER_KEY,
 * });
 * ```
 */
export function createHybridConfigFromPreset(
  presetName: PresetName,
  overrides: Partial<
    Pick<
      HybridStoreConfig,
      'mongoUrl' | 'mongoDatabase' | 'mongoCollection' | 'redisUrl' | 'masterKey'
    >
  >,
): HybridStoreConfig {
  const preset = PRESETS[presetName];

  return {
    mongoUrl: overrides.mongoUrl ?? '',
    mongoDatabase: overrides.mongoDatabase ?? 'baileys_store',
    mongoCollection: overrides.mongoCollection ?? 'sessions',
    redisUrl: overrides.redisUrl,
    ttl: preset.ttl,
    resilience: preset.resilience,
    security: preset.security,
    observability: preset.observability,
    masterKey: overrides.masterKey,
    enableWriteBehind: false, // Disabled by default (can be overridden)
    writeBehindFlushInterval: 1000, // 1 second
    writeBehindQueueSize: 1000,
  };
}

/**
 * Get preset by name
 *
 * @param name - Preset name
 * @returns Configuration preset
 */
export function getPreset(name: PresetName): ConfigPreset {
  return PRESETS[name];
}

/**
 * Validate preset configuration
 * Checks if preset values are within acceptable ranges
 *
 * @param preset - Preset to validate
 * @returns Array of validation errors (empty if valid)
 * @deprecated Use validatePreset from src/validation/reporter.ts instead
 */
export function validatePreset(preset: ConfigPreset): string[] {
  const errors: string[] = [];

  // Validate TTLs
  if (preset.ttl.defaultTtl < 1) {
    errors.push('defaultTtl must be at least 1 second');
  }
  if (preset.ttl.credsTtl < 1) {
    errors.push('credsTtl must be at least 1 second');
  }
  if (preset.ttl.keysTtl < 1) {
    errors.push('keysTtl must be at least 1 second');
  }
  if (preset.ttl.lockTtl < 1) {
    errors.push('lockTtl must be at least 1 second');
  }

  // Validate resilience
  if (preset.resilience.operationTimeout < 100) {
    errors.push('operationTimeout must be at least 100ms');
  }
  if (preset.resilience.maxRetries < 0 || preset.resilience.maxRetries > 10) {
    errors.push('maxRetries must be between 0 and 10');
  }
  if (preset.resilience.retryBaseDelay < 0) {
    errors.push('retryBaseDelay must be non-negative');
  }
  if (preset.resilience.retryMultiplier < 1) {
    errors.push('retryMultiplier must be at least 1');
  }

  // Validate security
  if (preset.security.enableEncryption && preset.security.keyRotationDays < 1) {
    errors.push('keyRotationDays must be at least 1 day when encryption is enabled');
  }

  return errors;
}
