/**
 * @baileys-store/core - Shared Types
 *
 * Universal auth state library for Baileys v7.0+
 * Supports Redis, MongoDB, and hybrid strategies
 * Strong typing ensures compile-time safety across the entire auth pipeline
 */

import type { AuthenticationCreds } from '@whiskeysockets/baileys';

// Export Baileys type safety layer
export * from './baileys.js';

/**
 * Simplified session identifier
 * For multi-tenancy, use format: "tenantId:deviceId"
 */
export type SessionId = string;

/**
 * Complete authentication state snapshot
 */
export interface AuthSnapshot {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
  appState?: Record<string, unknown>;
}

/**
 * Partial patch for incremental updates
 */
export type AuthPatch = Partial<AuthSnapshot>;

/**
 * Version for optimistic locking
 */
export interface Versioned<T = unknown> {
  data: T;
  version: number;
  updatedAt: Date;
}

/**
 * Operation result with version
 */
export interface VersionedResult {
  version: number;
  updatedAt: Date;
  success: boolean;
}

/**
 * Main storage interface (Strategy Pattern)
 * All adapters (Redis, MongoDB, Hybrid) implement this interface
 */
export interface AuthStore {
  /**
   * Get complete snapshot
   * @throws {VersionMismatchError} if version doesn't match
   */
  get(sessionId: SessionId): Promise<Versioned<AuthSnapshot> | null>;

  /**
   * Update snapshot (total or partial)
   * @param expectedVersion - For optimistic locking (optional)
   * @throws {VersionMismatchError} if version doesn't match
   */
  set(
    sessionId: SessionId,
    patch: AuthPatch,
    expectedVersion?: number,
    fencingToken?: number,
  ): Promise<VersionedResult>;

  /**
   * Delete snapshot
   */
  delete(sessionId: SessionId): Promise<void>;

  /**
   * Renew TTL (keep-alive)
   */
  touch(sessionId: SessionId, ttlSeconds?: number): Promise<void>;

  /**
   * Check existence
   */
  exists(sessionId: SessionId): Promise<boolean>;

  /**
   * Health check
   */
  isHealthy(): Promise<boolean>;
}

/**
 * TTL and expiration configuration
 */
export interface TtlConfig {
  /** Default TTL in seconds (default: 86400 = 24h) */
  defaultTtl: number;
  /** TTL for creds (default: 86400 = 24h) */
  credsTtl: number;
  /** TTL for keys (default: 86400 = 24h) */
  keysTtl: number;
  /** TTL for locks (default: 5s) */
  lockTtl: number;
}

/**
 * Resilience configuration
 */
export interface ResilienceConfig {
  /** Operation timeout in ms */
  operationTimeout: number;
  /** Number of retries */
  maxRetries: number;
  /** Base retry interval in ms */
  retryBaseDelay: number;
  /** Exponential backoff multiplier */
  retryMultiplier: number;
}

/**
 * Observability configuration
 */
export interface ObservabilityConfig {
  /** Enable Prometheus metrics */
  enableMetrics: boolean;
  /** Enable distributed tracing */
  enableTracing: boolean;
  /** Enable detailed structured logs */
  enableDetailedLogs: boolean;
  /** Metrics collection interval in ms */
  metricsInterval: number;
}

/**
 * Logger interface for configurable logging
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Null logger implementation (no-op)
 */
export class NullLogger implements Logger {
  debug(): void {
    // No-op implementation
  }
  info(): void {
    // No-op implementation
  }
  warn(): void {
    // No-op implementation
  }
  error(): void {
    // No-op implementation
  }
}

/**
 * Console logger implementation (legacy)
 * @deprecated Use StructuredLogger from @baileys-store/core/logger instead
 */
export class ConsoleLogger implements Logger {
  debug(msg: string, data?: Record<string, unknown>): void {
    console.debug(msg, data ?? '');
  }
  info(msg: string, data?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(msg, data ?? '');
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    console.warn(msg, data ?? '');
  }
  error(msg: string, data?: Record<string, unknown>): void {
    console.error(msg, data ?? '');
  }
}

// Re-export StructuredLogger from logger module
export {
  ConsoleStructuredLogger,
  NullLogger as NullLoggerStructured,
  LogLevel,
  type StructuredLogger,
  type LogContext,
} from '../logger/index.js';

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Enable app-level encryption */
  enableEncryption: boolean;
  /** Encryption algorithm (default: 'secretbox') */
  encryptionAlgorithm: 'secretbox' | 'aes-256-gcm';
  /** Key rotation in days */
  keyRotationDays: number;
  /** Enable compression */
  enableCompression: boolean;
  /** Compression algorithm (default: 'snappy') */
  compressionAlgorithm: 'snappy' | 'gzip' | 'lz4';
  /** Enable debug logging (default: false) */
  enableDebugLogging?: boolean;
  /** Environment (default: 'production') */
  environment?: 'development' | 'production' | 'test';
  /** Custom logger instance (default: NullLogger) */
  logger?: Logger;
}

/**
 * Encrypted data
 */
export interface EncryptedData {
  /** Encrypted data */
  ciphertext: Buffer;
  /** Nonce/IV */
  nonce: Buffer;
  /** Key ID used */
  keyId: string;
  /** Schema version */
  schemaVersion: number;
  /** Creation timestamp */
  timestamp: Date;
}

/**
 * Cache metrics
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRatio: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  evictions: number;
  keyspaceSize: number;
}

/**
 * Persistence metrics
 */
export interface PersistenceMetrics {
  writeBehindLag: number; // ms
  writeSuccessRate: number; // 0-1
  writeFailures: number;
  replayCount: number;
  lastSyncTime: Date;
}

/**
 * Baileys metrics
 */
export interface BaileysMetrics {
  reconnections: number;
  decryptFailures: number;
  rehydrateTime: number; // ms
  eventProcessingTime: number; // ms
}

/**
 * Aggregated system metrics
 */
export interface SystemMetrics {
  cache: CacheMetrics;
  persistence: PersistenceMetrics;
  baileys: BaileysMetrics;
  uptime: number; // seconds
  timestamp: Date;
}

/**
 * Custom errors
 */
export class VersionMismatchError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Version mismatch: expected ${String(expected)}, got ${String(actual)}`);
    this.name = 'VersionMismatchError';
  }
}

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class CompressionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'CompressionError';
  }
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly layer: 'redis' | 'mongo' | 'hybrid',
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Default TTL values
 */
export const DEFAULT_TTL_CONFIG: TtlConfig = {
  defaultTtl: 86400, // 24h
  credsTtl: 86400, // 24h
  keysTtl: 86400, // 24h
  lockTtl: 5, // 5s
};

/**
 * Default resilience values
 */
export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  operationTimeout: 5000, // 5s
  maxRetries: 3,
  retryBaseDelay: 100, // 100ms
  retryMultiplier: 2,
};

/**
 * Default observability values
 */
export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enableMetrics: true,
  enableTracing: false,
  enableDetailedLogs: false,
  metricsInterval: 60000, // 1 min
};

/**
 * Default security values
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableEncryption: true,
  encryptionAlgorithm: 'secretbox',
  keyRotationDays: 90,
  enableCompression: true,
  compressionAlgorithm: 'snappy',
};
