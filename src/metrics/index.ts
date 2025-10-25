/**
 * @baileys-store/core - Prometheus Metrics
 *
 * Thread-safe metrics using prom-client
 * All counters and histograms are atomic and safe for concurrent access
 */

import { Counter, Histogram, Registry } from 'prom-client';

/**
 * Global metrics registry
 * Can be scraped by Prometheus at /metrics endpoint
 */
export const metricsRegistry = new Registry();

/**
 * Redis cache hits counter
 */
export const redisHitsCounter = new Counter({
  name: 'baileys_store_redis_hits_total',
  help: 'Total number of Redis cache hits',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * Redis cache misses counter
 */
export const redisMissesCounter = new Counter({
  name: 'baileys_store_redis_misses_total',
  help: 'Total number of Redis cache misses',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * MongoDB fallback counter
 */
export const mongoFallbacksCounter = new Counter({
  name: 'baileys_store_mongo_fallbacks_total',
  help: 'Total number of MongoDB fallbacks after Redis miss',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * Queue publish counter
 */
export const queuePublishesCounter = new Counter({
  name: 'baileys_store_queue_publishes_total',
  help: 'Total number of messages published to write-behind queue',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * Queue failure counter
 */
export const queueFailuresCounter = new Counter({
  name: 'baileys_store_queue_failures_total',
  help: 'Total number of queue publish failures',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * Direct MongoDB writes counter
 */
export const directWritesCounter = new Counter({
  name: 'baileys_store_direct_writes_total',
  help: 'Total number of direct MongoDB writes (fallback or no queue)',
  labelNames: ['session_id'],
  registers: [metricsRegistry],
});

/**
 * Circuit breaker state change counter
 */
export const circuitBreakerOpenCounter = new Counter({
  name: 'baileys_store_circuit_breaker_open_total',
  help: 'Total number of times MongoDB circuit breaker opened',
  registers: [metricsRegistry],
});

export const circuitBreakerCloseCounter = new Counter({
  name: 'baileys_store_circuit_breaker_close_total',
  help: 'Total number of times MongoDB circuit breaker closed',
  registers: [metricsRegistry],
});

export const circuitBreakerHalfOpenCounter = new Counter({
  name: 'baileys_store_circuit_breaker_halfopen_total',
  help: 'Total number of times MongoDB circuit breaker entered half-open state',
  registers: [metricsRegistry],
});

/**
 * Outbox reconciler latency histogram
 */
export const outboxReconcilerLatencyHistogram = new Histogram({
  name: 'baileys_store_outbox_reconciler_latency_seconds',
  help: 'Latency of outbox reconciliation operations',
  labelNames: ['operation', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

/**
 * Outbox reconciler failures counter
 */
export const outboxReconcilerFailuresCounter = new Counter({
  name: 'baileys_store_outbox_reconciler_failures_total',
  help: 'Total number of outbox reconciler failures',
  labelNames: ['error_type'],
  registers: [metricsRegistry],
});

/**
 * Operation latency histogram
 */
export const operationLatencyHistogram = new Histogram({
  name: 'baileys_store_operation_latency_seconds',
  help: 'Latency of storage operations',
  labelNames: ['operation', 'layer', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

/**
 * Helper to get metrics in text format for Prometheus scraping
 */
export async function getMetricsText(): Promise<string> {
  return await metricsRegistry.metrics();
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}
