/**
 * @baileys-store/core - Adapter Configurations
 *
 * Configuration types for Redis, MongoDB and Hybrid stores
 */

import type { TtlConfig, ResilienceConfig, ObservabilityConfig, SecurityConfig, StructuredLogger } from './index.js';
import type { QueueAdapter } from './queue.js';

/**
 * Redis Store configuration
 */
export interface RedisStoreConfig {
  /** Redis connection URL (redis://host:port) */
  redisUrl?: string;
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database */
  db?: number;
  /** TTL configuration */
  ttl: TtlConfig;
  /** Resilience configuration */
  resilience: ResilienceConfig;
  /** Enable TLS */
  enableTls?: boolean;
}

/**
 * MongoDB Store configuration
 */
export interface MongoStoreConfig {
  /** MongoDB connection URL */
  mongoUrl: string;
  /** Database name */
  databaseName: string;
  /** Collection name */
  collectionName: string;
  /** TTL configuration */
  ttl: TtlConfig;
  /** Resilience configuration */
  resilience: ResilienceConfig;
  /** Enable TLS */
  enableTls?: boolean;
}

/**
 * Hybrid Store configuration
 */
export interface HybridStoreConfig {
  /** Redis connection URL */
  redisUrl?: string;
  /** Redis host */
  redisHost?: string;
  /** Redis port */
  redisPort?: number;
  /** MongoDB connection URL */
  mongoUrl: string;
  /** MongoDB database name */
  mongoDatabase: string;
  /** MongoDB collection name */
  mongoCollection: string;
  /** TTL configuration */
  ttl: TtlConfig;
  /** Resilience configuration */
  resilience: ResilienceConfig;
  /** Observability configuration */
  observability: ObservabilityConfig;
  /** Security configuration */
  security: SecurityConfig;
  /** Optional queue adapter for write-behind */
  queue?: QueueAdapter;
  /** Enable write-behind pattern (requires queue) */
  enableWriteBehind?: boolean;
  /** Write-behind flush interval in ms */
  writeBehindFlushInterval?: number;
  /** Maximum write-behind queue size */
  writeBehindQueueSize?: number;
  /** Master key for encryption (64 hex chars) */
  masterKey?: string;
  /** Optional structured logger */
  logger?: StructuredLogger;
}

/**
 * Options for useRedisAuthState
 */
export interface UseRedisAuthStateOptions {
  /** Redis configuration */
  redis: RedisStoreConfig;
  /** Session ID */
  sessionId: string;
  /** Enable encryption (requires masterKey) */
  enableEncryption?: boolean;
  /** Master key for encryption */
  masterKey?: string;
  /** Enable compression */
  enableCompression?: boolean;
  /** Session TTL in seconds */
  ttl?: number;
}

/**
 * Options for useMongoAuthState
 */
export interface UseMongoAuthStateOptions {
  /** MongoDB configuration */
  mongodb: MongoStoreConfig;
  /** Session ID */
  sessionId: string;
  /** Enable encryption (requires masterKey) */
  enableEncryption?: boolean;
  /** Master key for encryption */
  masterKey?: string;
  /** Enable compression */
  enableCompression?: boolean;
  /** Session TTL in seconds */
  ttl?: number;
}

/**
 * Options for useHybridAuthState
 */
export interface UseHybridAuthStateOptions {
  /** Hybrid configuration */
  hybrid: HybridStoreConfig;
  /** Session ID */
  sessionId: string;
  /** Fencing token to avoid zombie sessions */
  fencingToken?: number;
}
