/**
 * @baileys-store/core - Integration Tests
 *
 * Integration tests using real Redis + MongoDB (must be running locally)
 * Based on test-qr-simple.ts pattern with useAuthState hooks
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { useRedisAuthState } from '../../redis/use-redis-auth-state.js';
import { useHybridAuthState } from '../../hybrid/use-hybrid-auth-state.js';

// Configuração baseada em test-qr-simple.ts
const testConfig = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDatabase: 'baileys_test',
  mongoCollection: 'auth_sessions',
  ttl: {
    defaultTtl: 30 * 24 * 60 * 60, // 30 days
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
    enableMetrics: false,
    enableTracing: false,
    enableDetailedLogs: false,
    metricsInterval: 60000,
  },
  security: {
    enableEncryption: false, // Disabled para testes
    enableCompression: false,
    encryptionAlgorithm: 'secretbox' as const,
    compressionAlgorithm: 'snappy' as const,
    keyRotationDays: 90,
  },
};

describe('Integration Tests - Real Services', () => {
  const sessionId = 'integration-test-session';

  // Cleanup before all tests
  beforeAll(async () => {
    const Redis = (await import('ioredis')).default;
    const { MongoClient } = await import('mongodb');

    const redisClient = new Redis(testConfig.redisUrl);
    const mongoClient = new MongoClient(testConfig.mongoUrl);

    try {
      await mongoClient.connect();
      const db = mongoClient.db(testConfig.mongoDatabase);
      await db.collection(testConfig.mongoCollection).deleteMany({});

      const keys = await redisClient.keys('*integration-test*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      console.warn('✅ Test cleanup completed');
    } catch (error) {
      console.warn('Cleanup error (continuing anyway):', error);
    } finally {
      await redisClient.quit();
      await mongoClient.close();
    }
  });

  describe('useRedisAuthState Hook', () => {
    it('should initialize with proper state and store', async () => {
      const { state, saveCreds, store } = await useRedisAuthState({
        sessionId,
        redis: testConfig,
      });

      try {
        // Initial state should have creds
        expect(state.creds).toBeDefined();
        expect(state.creds.registrationId).toBeDefined();
        expect(state.keys).toBeDefined();

        // Store should be accessible
        expect(store).toBeDefined();

        // Health check
        const healthy = await store.isHealthy();
        expect(healthy).toBe(true);

        // Save function should be defined
        expect(typeof saveCreds).toBe('function');

        // Cleanup
        await store.delete(sessionId);
      } finally {
        await store.disconnect();
      }
    });
  });

  describe('useHybridAuthState Hook', () => {
    it('should initialize and orchestrate Redis + MongoDB', async () => {
      const { state, saveCreds, store } = await useHybridAuthState({
        sessionId,
        hybrid: {
          ...testConfig,
          enableWriteBehind: false, // Direct writes for testing
        },
      });

      try {
        // Initial state
        expect(state.creds).toBeDefined();
        expect(state.creds.registrationId).toBeDefined();

        // Save creds
        await saveCreds();

        // Verify hybrid store orchestration
        const data = await store.get(sessionId);
        expect(data).toBeDefined();
        expect(data!.version).toBeGreaterThan(0);

        // Verify circuit breaker
        const isBreakerOpen = store.isMongoCircuitBreakerOpen();
        expect(typeof isBreakerOpen).toBe('boolean');
        expect(isBreakerOpen).toBe(false);

        // Get metrics
        const metricsText = await store.getMetricsText();
        expect(metricsText).toBeDefined();
        expect(metricsText).toContain('baileys_store');

        // Get circuit breaker stats
        const cbStats = store.getCircuitBreakerStats();
        expect(cbStats).toBeDefined();
        expect(cbStats.fires).toBeDefined();

        // Health check
        const healthy = await store.isHealthy();
        expect(healthy).toBe(true);

        // Cleanup
        await store.delete(sessionId);
      } finally {
        await store.disconnect();
      }
    });

    it('should expose outbox reconciliation API', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'outbox-api-test',
        hybrid: {
          ...testConfig,
          enableWriteBehind: true,
          queue: {
            add: async () => {}, // Dummy queue
            close: async () => {},
          },
        },
      });

      try {
        // Get outbox stats (should exist when write-behind enabled)
        const outboxStats = store.getOutboxStats();
        expect(outboxStats).toBeDefined();
        expect(outboxStats!.totalProcessed).toBeDefined();

        // Trigger manual reconciliation (should not throw)
        await expect(store.reconcileOutbox()).resolves.not.toThrow();

        // Cleanup
        await store.delete('outbox-api-test');
      } finally {
        await store.disconnect();
      }
    });
  });
});
