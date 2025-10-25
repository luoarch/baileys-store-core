#!/usr/bin/env tsx

/**
 * @baileys-store/core - Prometheus Metrics Example
 *
 * Demonstrates how to expose Prometheus metrics for scraping
 * Run: yarn build && tsx examples/prometheus-scraping.ts
 */

import express from 'express';
import { useHybridAuthState } from '../dist/hybrid/index.js';

const app = express();
const PORT = 9090;

// Initialize hybrid store
const { state, saveCreds, store } = await useHybridAuthState({
  sessionId: 'metrics-example',
  hybrid: {
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
    mongoDatabase: 'baileys_metrics_example',
    mongoCollection: 'auth_sessions',
    ttl: {
      defaultTtl: 30 * 24 * 60 * 60,
      credsTtl: 30 * 24 * 60 * 60,
      keysTtl: 30 * 24 * 60 * 60,
      lockTtl: 5,
    },
    masterKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    resilience: {
      operationTimeout: 5000,
      maxRetries: 3,
      retryBaseDelay: 100,
      retryMultiplier: 2,
    },
    observability: {
      enableMetrics: true, // IMPORTANT: Enable Prometheus metrics
      enableTracing: false,
      enableDetailedLogs: false,
      metricsInterval: 60000,
    },
    security: {
      enableEncryption: false,
      enableCompression: false,
      encryptionAlgorithm: 'secretbox',
      compressionAlgorithm: 'snappy',
      keyRotationDays: 90,
    },
    enableWriteBehind: false,
  },
});

console.log(`
================================================================================
📊 Prometheus Metrics Example
================================================================================

Metrics are exposed at: http://localhost:${PORT}/metrics

Available metrics:
- baileys_store_redis_hits_total
- baileys_store_redis_misses_total
- baileys_store_mongo_fallbacks_total
- baileys_store_circuit_breaker_open_total
- baileys_store_circuit_breaker_close_total
- baileys_store_circuit_breaker_halfopen_total
- baileys_store_outbox_reconciler_latency_seconds (histogram)
- baileys_store_outbox_reconciler_failures_total
- baileys_store_operation_latency_seconds (histogram)
- baileys_store_queue_publishes_total
- baileys_store_queue_failures_total
- baileys_store_direct_writes_total

================================================================================
`);

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const metricsText = await store.getMetricsText();
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metricsText);
  } catch (error) {
    res.status(500).send('Error fetching metrics');
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthy = await store.isHealthy();
  const circuitBreakerOpen = store.isMongoCircuitBreakerOpen();
  const circuitBreakerStats = store.getCircuitBreakerStats();

  res.json({
    healthy,
    components: {
      redis: healthy, // Simplified
      mongodb: !circuitBreakerOpen,
    },
    circuitBreaker: {
      open: circuitBreakerOpen,
      stats: circuitBreakerStats,
    },
  });
});

// Example operations endpoint (to generate metrics)
app.post('/simulate-operations', async (req, res) => {
  try {
    // Simulate some operations
    await saveCreds();
    await store.get('metrics-example');

    res.json({ success: true, message: 'Operations simulated' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Metrics server running on http://localhost:${PORT}`);
  console.log(`   - Metrics: http://localhost:${PORT}/metrics`);
  console.log(`   - Health: http://localhost:${PORT}/health`);
  console.log(`   - Simulate ops: curl -X POST http://localhost:${PORT}/simulate-operations\n`);
  console.log('Press Ctrl+C to stop\n');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🔌 Shutting down...');
  await store.disconnect();
  process.exit(0);
});
