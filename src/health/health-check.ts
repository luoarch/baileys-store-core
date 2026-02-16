/**
 * @baileys-store/core - Health Check Utilities
 *
 * Health check utilities for production monitoring and Kubernetes probes
 */

import type CircuitBreaker from 'opossum';

/**
 * Health status of a component
 */
export interface ComponentHealth {
  /** Component name */
  component: string;
  /** Whether the component is healthy */
  healthy: boolean;
  /** Additional status details */
  status?: string;
  /** Last check timestamp */
  timestamp?: number;
}

/**
 * Overall health status
 */
export interface HealthStatus {
  /** Overall status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Timestamp of health check */
  timestamp: string;
  /** Component health statuses */
  components: ComponentHealth[];
  /** Additional metadata */
  metadata?: {
    cacheHitRate?: number;
    outboxLag?: number;
    circuitBreakerState?: 'closed' | 'open' | 'half-open';
  };
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Check Redis connectivity */
  checkRedis: () => Promise<boolean>;
  /** Check MongoDB connectivity */
  checkMongo: () => Promise<boolean>;
  /** Get circuit breaker instance (optional) */
  circuitBreaker?: CircuitBreaker;
  /** Get cache hit rate (optional) */
  getCacheHitRate?: () => number;
  /** Get outbox lag in seconds (optional) */
  getOutboxLag?: () => number;
}

/**
 * Perform health check
 *
 * @param config - Health check configuration
 * @returns Health status
 *
 * @example
 * ```typescript
 * const health = await performHealthCheck({
 *   checkRedis: async () => await redis.ping() === 'PONG',
 *   checkMongo: async () => await mongo.ping() === 'ok',
 *   circuitBreaker: store.mongoCircuitBreaker,
 *   getCacheHitRate: () => store.getCacheHitRate(),
 * });
 * ```
 */
export async function performHealthCheck(config: HealthCheckConfig): Promise<HealthStatus> {
  const components: ComponentHealth[] = [];
  const timestamp = new Date().toISOString();

  // Check Redis
  let redisHealthy = false;
  try {
    redisHealthy = await config.checkRedis();
  } catch {
    redisHealthy = false;
  }
  components.push({
    component: 'redis',
    healthy: redisHealthy,
    status: redisHealthy ? 'connected' : 'disconnected',
    timestamp: Date.now(),
  });

  // Check MongoDB
  let mongoHealthy = false;
  try {
    mongoHealthy = await config.checkMongo();
  } catch {
    mongoHealthy = false;
  }
  components.push({
    component: 'mongodb',
    healthy: mongoHealthy,
    status: mongoHealthy ? 'connected' : 'disconnected',
    timestamp: Date.now(),
  });

  // Check circuit breaker if provided
  if (config.circuitBreaker) {
    const state = config.circuitBreaker.status;
    const stateString = typeof state === 'string' ? state : 'unknown';
    const isOpen = typeof state === 'string' && state === 'open';
    components.push({
      component: 'circuit-breaker',
      healthy: !isOpen,
      status: stateString,
      timestamp: Date.now(),
    });
  }

  // Determine overall status
  const allHealthy = redisHealthy && mongoHealthy;
  const circuitBreakerOpen = config.circuitBreaker?.status
    ? typeof config.circuitBreaker.status === 'string'
      ? config.circuitBreaker.status === 'open'
      : false
    : false;
  const status =
    allHealthy && !circuitBreakerOpen ? 'healthy' : circuitBreakerOpen ? 'degraded' : 'unhealthy';

  // Collect metadata
  const metadata: HealthStatus['metadata'] = {};
  if (config.getCacheHitRate) {
    metadata.cacheHitRate = config.getCacheHitRate();
  }
  if (config.getOutboxLag) {
    metadata.outboxLag = config.getOutboxLag();
  }
  if (config.circuitBreaker) {
    const state = config.circuitBreaker.status;
    metadata.circuitBreakerState = (typeof state === 'string' ? state : 'unknown') as
      | 'closed'
      | 'open'
      | 'half-open';
  }

  return {
    status,
    timestamp,
    components,
    metadata,
  };
}

/**
 * Check if the system is ready (ready for traffic)
 *
 * @param health - Health status
 * @returns Whether the system is ready
 *
 * @example
 * ```typescript
 * const health = await performHealthCheck(config);
 * const ready = isReady(health);
 * ```
 */
export function isReady(health: HealthStatus): boolean {
  // Ready if at least one component is healthy
  // (graceful degradation allows Redis-only operation)
  return health.components.some((c) => c.healthy);
}

/**
 * Check if the system is alive (not crashed)
 *
 * @param health - Health status
 * @returns Whether the system is alive
 *
 * @example
 * ```typescript
 * const health = await performHealthCheck(config);
 * const alive = isLive(health);
 * ```
 */
export function isLive(health: HealthStatus): boolean {
  // Alive if not all components are unhealthy
  return health.status !== 'unhealthy';
}
