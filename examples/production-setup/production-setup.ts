/**
 * @baileys-store/core - Production Setup Example
 *
 * Complete production-ready setup with:
 * - Express server with health checks
 * - Prometheus metrics endpoint
 * - Graceful shutdown
 * - Error recovery strategies
 * - Config presets (PRODUCTION)
 */

import express from 'express';
import { makeWASocket } from '@whiskeysockets/baileys';
import { useHybridAuthState, PRODUCTION, createHybridConfigFromPreset } from '@baileys-store/core';
import { getMetricsText } from '@baileys-store/core/metrics';

const app = express();
app.use(express.json());

// Create store instance with PRODUCTION preset
const config = createHybridConfigFromPreset('PRODUCTION', {
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  mongoDatabase: 'whatsapp_prod',
  mongoCollection: 'sessions',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  masterKey: process.env.BAILEYS_MASTER_KEY,
});

let store: Awaited<ReturnType<typeof useHybridAuthState>>['store'] | null = null;

/**
 * Health Check Endpoint
 * GET /health
 */
app.get('/health', async (_req, res) => {
  try {
    if (!store) {
      return res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: 'Store not initialized',
      });
    }

    const healthy = await store.isHealthy();
    const isMongoCircuitBreakerOpen = store.isMongoCircuitBreakerOpen?.() ?? false;

    const status = healthy && !isMongoCircuitBreakerOpen ? 'healthy' : 'degraded';
    const httpStatus = status === 'healthy' ? 200 : 503;

    res.status(httpStatus).json({
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      components: {
        redis: healthy ? 'up' : 'down',
        mongodb: isMongoCircuitBreakerOpen ? 'degraded' : 'up',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Readiness Probe
 * GET /ready
 */
app.get('/ready', async (_req, res) => {
  if (!store) {
    return res.status(503).json({ ready: false });
  }

  const healthy = await store.isHealthy();
  res.status(healthy ? 200 : 503).json({ ready: healthy });
});

/**
 * Metrics Endpoint (Prometheus)
 * GET /metrics
 */
app.get('/metrics', async (_req, res) => {
  try {
    const metrics = await getMetricsText();
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  } catch (error) {
    res.status(500).send(`Error generating metrics: ${error}`);
  }
});

// Initialize store
async function initializeStore() {
  try {
    const authState = await useHybridAuthState({
      hybrid: config,
      sessionId: process.env.SESSION_ID || 'production-session',
    });

    store = authState.store;

    console.log('✅ Store initialized with PRODUCTION preset');
    return authState;
  } catch (error) {
    console.error('Failed to initialize store:', error);
    throw error;
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    if (store) {
      await store.disconnect?.();
      console.log('✅ Store disconnected');
    }

    // Close server
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
  console.log(`🚀 Production server started on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`🔍 Ready probe: http://localhost:${PORT}/ready`);

  try {
    await initializeStore();
  } catch (error) {
    console.error('Failed to initialize store:', error);
    process.exit(1);
  }
});

// Graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export default app;
