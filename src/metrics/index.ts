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
 * Batch operations counter
 */
export const batchOperationsCounter = new Counter({
  name: 'baileys_store_batch_operations_total',
  help: 'Total number of batch operations',
  labelNames: ['type', 'result'],
  registers: [metricsRegistry],
});

/**
 * Batch operations duration histogram
 */
export const batchOperationsDurationHistogram = new Histogram({
  name: 'baileys_store_batch_operations_duration_seconds',
  help: 'Duration of batch operations',
  labelNames: ['type', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

/**
 * Version conflict counter
 */
export const versionConflictCounter = new Counter({
  name: 'baileys_store_version_conflicts_total',
  help: 'Total number of version conflicts (optimistic locking failures)',
  labelNames: ['layer', 'session_id'],
  registers: [metricsRegistry],
});

/**
 * Cache warming counter
 */
export const cacheWarmingCounter = new Counter({
  name: 'baileys_store_cache_warming_total',
  help: 'Total number of cache warming operations',
  labelNames: ['result'],
  registers: [metricsRegistry],
});

/**
 * Circuit breaker transitions gauge
 * Track state transitions: 0=closed, 1=half-open, 2=open
 */
export const circuitBreakerStateGauge = new Counter({
  name: 'baileys_store_circuit_breaker_state_transitions_total',
  help: 'Total number of circuit breaker state transitions',
  labelNames: ['from_state', 'to_state'],
  registers: [metricsRegistry],
});

/**
 * Outbox queue size gauge
 */
export const outboxQueueSizeGauge = new Counter({
  name: 'baileys_store_outbox_queue_size_total',
  help: 'Total number of items added to outbox queue',
  labelNames: [],
  registers: [metricsRegistry],
});

/**
 * Outbox reconciliation latency histogram (detailed)
 */
export const outboxReconciliationLatencyHistogram = new Histogram({
  name: 'baileys_store_outbox_reconciliation_latency_seconds',
  help: 'Latency of individual outbox reconciliation operations',
  labelNames: ['status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [metricsRegistry],
});

/**
 * Operation timeout counter
 */
export const operationTimeoutCounter = new Counter({
  name: 'baileys_store_operation_timeouts_total',
  help: 'Total number of operation timeouts',
  labelNames: ['operation', 'layer'],
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
