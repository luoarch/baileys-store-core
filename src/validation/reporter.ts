/**
 * @baileys-store/core - Configuration Validation Reporter
 *
 * Provides detailed validation reports with:
 * - Error severity and suggested fixes
 * - Performance scoring
 * - Security warnings
 * - Optimization recommendations
 */

import type { HybridStoreConfig } from '../types/config.js';
import type { ConfigPreset } from '../config/presets.js';
import { HybridStoreConfigSchema, ConfigPresetSchema } from './schemas.js';

/**
 * Validation error with severity and suggested fix
 */
export interface ValidationError {
  /** Path to the invalid field (e.g., 'ttl.defaultTtl') */
  path: string;
  /** Error message */
  message: string;
  /** Error severity level */
  severity: 'error' | 'warning';
  /** Suggested fix or recommendation */
  suggestedFix?: string;
}

/**
 * Configuration validation report
 */
export interface ValidationReport {
  /** Whether the configuration is valid */
  valid: boolean;
  /** Validation errors (if any) */
  errors?: ValidationError[];
  /** Non-blocking warnings */
  warnings?: string[];
  /** Performance score (0-100) */
  performanceScore?: number;
  /** Security warnings */
  securityWarnings?: string[];
}

/**
 * Validate and report on a configuration
 *
 * @param config - Configuration to validate
 * @returns Validation report with errors, warnings, and recommendations
 *
 * @example
 * ```typescript
 * const report = validateAndReportConfig(myConfig);
 * if (!report.valid) {
 *   console.error('Configuration errors:', report.errors);
 * }
 * ```
 */
export function validateAndReportConfig(config: unknown): ValidationReport {
  const result = HybridStoreConfigSchema.safeParse(config);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((error) => ({
        path: error.path.join('.'),
        message: error.message,
        severity: calculateSeverity(error.code, error.path.join('.')),
        suggestedFix: generateFix(error.code, error.path.join('.')),
      })),
      performanceScore: analyzeConfigPerformance(config as HybridStoreConfig),
      securityWarnings: scanConfigSecurity(config as HybridStoreConfig),
    };
  }

  // Config is valid, but may have warnings
  const validatedConfig = result.data;

  return {
    valid: true,
    warnings: generateOptimizationWarnings(validatedConfig),
    performanceScore: analyzeConfigPerformance(validatedConfig),
    securityWarnings: scanConfigSecurity(validatedConfig),
  };
}

/**
 * Validate a configuration preset
 *
 * @param preset - Preset to validate
 * @returns Validation report
 */
export function validatePreset(preset: unknown): ValidationReport {
  const result = ConfigPresetSchema.safeParse(preset);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((error) => ({
        path: error.path.join('.'),
        message: error.message,
        severity: 'error' as const,
        suggestedFix: generateFix(error.code, error.path.join('.')),
      })),
    };
  }

  return {
    valid: true,
    performanceScore: analyzePresetPerformance(result.data),
    securityWarnings: scanConfigSecurity(result.data),
  };
}

/**
 * Calculate error severity based on error code and path
 */
function calculateSeverity(code: string, path: string): 'error' | 'warning' {
  // Security-related fields are errors
  if (path.includes('security') || path.includes('masterKey')) {
    return 'error';
  }

  // Connection strings are errors
  if (path.includes('Url') || path.includes('Database')) {
    return 'error';
  }

  // Invalid codes
  switch (code) {
    case 'invalid_type':
      return 'error';
    case 'custom':
      return 'error';
    default:
      return 'warning';
  }
}

/**
 * Generate suggested fix based on error code and path
 */
function generateFix(_code: string, path: string): string | undefined {
  if (path.includes('defaultTtl')) {
    return 'Use a value >= 1 second (e.g., 300 for 5 minutes)';
  }

  if (path.includes('masterKey')) {
    return 'Provide a 64-character hexadecimal master key: openssl rand -hex 32';
  }

  if (path.includes('operationTimeout')) {
    return 'Use a value between 100ms and 60000ms (e.g., 5000 for 5 seconds)';
  }

  if (path.includes('encryptionAlgorithm')) {
    return 'Use either "aes-256-gcm" or "secretbox"';
  }

  if (path.includes('compressionAlgorithm')) {
    return 'Use either "snappy", "gzip", or "lz4"';
  }

  return undefined;
}

/**
 * Analyze configuration performance characteristics
 *
 * Returns a score from 0-100 where:
 * - 90-100: Excellent (production-ready)
 * - 70-89: Good (acceptable for production)
 * - 50-69: Fair (needs optimization)
 * - 0-49: Poor (not recommended)
 *
 * @param config - Configuration to analyze
 * @returns Performance score (0-100)
 */
export function analyzeConfigPerformance(config: HybridStoreConfig): number {
  let score = 100;

  // TTL penalties (too short = more database load)
  if (config.ttl.defaultTtl < 300) {
    score -= 20; // Very short TTLs increase load
  } else if (config.ttl.defaultTtl < 600) {
    score -= 10; // Short TTLs increase load moderately
  }

  // Timeout penalties (too short = premature failures)
  if (config.resilience.operationTimeout < 1000) {
    score -= 15; // Too aggressive
  } else if (config.resilience.operationTimeout < 2000) {
    score -= 5; // Moderately aggressive
  }

  // Retry penalties (too many retries = slow failures)
  if (config.resilience.maxRetries > 5) {
    score -= 10; // Too many retries
  }

  // Reward compression (reduces storage costs and I/O)
  if (config.security.enableCompression) {
    score += 10;
  }

  // Penalize no retries (fail-fast is good for development, bad for production)
  if (config.resilience.maxRetries === 0 && config.security.environment === 'production') {
    score -= 20; // Production should have some resilience
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Scan configuration for security issues
 *
 * @param config - Configuration or preset to scan
 * @returns Array of security warnings
 */
export function scanConfigSecurity(config: HybridStoreConfig | ConfigPreset): string[] {
  const warnings: string[] = [];

  if ('security' in config) {
    // Check encryption
    if (!config.security.enableEncryption && config.security.environment === 'production') {
      warnings.push('⚠️  Encryption is disabled in production - data will be stored in plaintext');
    }

    // Check key rotation
    if (config.security.enableEncryption && config.security.keyRotationDays > 365) {
      warnings.push(
        '⚠️  Key rotation period > 1 year - consider rotating keys more frequently (90-180 days)',
      );
    }

    // Check debug logging
    if (config.security.enableDebugLogging && config.security.environment === 'production') {
      warnings.push(
        '⚠️  Debug logging enabled in production - consider disabling for security and performance',
      );
    }
  }

  return warnings;
}

/**
 * Generate optimization warnings for valid configurations
 */
function generateOptimizationWarnings(config: HybridStoreConfig): string[] {
  const warnings: string[] = [];

  // TTL optimization
  if (config.ttl.defaultTtl < 300) {
    warnings.push(
      '💡 Consider increasing defaultTtl to reduce database load (current: ' +
        String(config.ttl.defaultTtl) +
        's, recommended: 300-3600s)',
    );
  }

  // Compression recommendation
  if (!config.security.enableCompression && config.security.environment === 'production') {
    warnings.push('💡 Consider enabling compression to reduce storage costs and improve I/O');
  }

  // Timeout optimization
  if (config.resilience.operationTimeout > 10000) {
    warnings.push(
      '💡 Consider reducing operationTimeout for faster failure detection (current: ' +
        String(config.resilience.operationTimeout) +
        'ms, recommended: 3000-5000ms)',
    );
  }

  return warnings;
}

/**
 * Analyze preset performance
 */
function analyzePresetPerformance(preset: ConfigPreset): number {
  // Similar to analyzeConfigPerformance but for presets
  let score = 100;

  if (preset.ttl.defaultTtl < 300) {
    score -= 20;
  }

  if (preset.resilience.operationTimeout < 1000) {
    score -= 15;
  }

  if (preset.security.enableCompression) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}
