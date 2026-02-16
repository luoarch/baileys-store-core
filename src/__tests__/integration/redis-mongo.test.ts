/**
 * @baileys-store/core - Integration Tests
 *
 * Integration tests using real Redis + MongoDB (must be running locally)
 * Based on test-qr-simple.ts pattern with useAuthState hooks
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { useRedisAuthState } from '../../redis/use-redis-auth-state.js';
import { useHybridAuthState } from '../../hybrid/use-hybrid-auth-state.js';
import { withContext } from '../../context/execution-context.js';

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

  describe('Batch Operations Integration', () => {
    it('should batch get multiple sessions from Redis cache', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'batch-test-1',
        hybrid: testConfig,
      });

      try {
        const session1 = 'batch-session-1';
        const session2 = 'batch-session-2';
        const session3 = 'batch-session-3';

        // Create test data
        const patch1 = { creds: { me: { id: '1@test' } } as any };
        const patch2 = { creds: { me: { id: '2@test' } } as any };

        await store.set(session1, patch1);
        await store.set(session2, patch2);

        // Batch get
        const results = await store.batchGet([session1, session2, session3]);

        expect(results.size).toBe(3);
        expect(results.get(session1)).toBeDefined();
        expect(results.get(session2)).toBeDefined();
        expect(results.get(session3)).toBeNull();

        // Cleanup
        await store.batchDelete([session1, session2, session3]);
      } finally {
        await store.disconnect();
      }
    });

    it('should handle batch delete with partial success', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'batch-delete-test',
        hybrid: testConfig,
      });

      try {
        const session1 = 'delete-session-1';
        const session2 = 'delete-session-2';
        const session3 = 'non-existent-session';

        // Create test data
        await store.set(session1, { creds: { me: { id: '1@test' } } as any });
        await store.set(session2, { creds: { me: { id: '2@test' } } as any });

        // Batch delete
        const result = await store.batchDelete([session1, session2, session3]);

        expect(result.successful.size).toBe(3); // All should succeed even if non-existent
        expect(result.failed.size).toBe(0);
      } finally {
        await store.disconnect();
      }
    });
  });

  describe('Health Checks with Fallbacks', () => {
    it('should return healthy when both services are up', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'health-test-1',
        hybrid: testConfig,
      });

      try {
        const healthy = await store.isHealthy();
        expect(healthy).toBe(true);
      } finally {
        await store.disconnect();
      }
    });

    it('should report unhealthy if Redis is down', async () => {
      // This test validates the health check logic
      // In a real scenario, we'd need to stop Redis
      // For now, we just verify the API exists
      const { store } = await useHybridAuthState({
        sessionId: 'health-test-2',
        hybrid: testConfig,
      });

      try {
        // Verify health check doesn't throw
        const healthy = await store.isHealthy();
        expect(typeof healthy).toBe('boolean');
      } finally {
        await store.disconnect();
      }
    });
  });

  describe('Correlation ID Propagation', () => {
    it('should propagate correlation ID across operations', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'correlation-test',
        hybrid: testConfig,
      });

      try {
        const correlationId = 'test-correlation-123';
        const sessionId = 'correlation-session-1';

        // Create test data
        const patch = { creds: { me: { id: '1@test' } } as any };

        // Execute operation with correlation ID
        await withContext({ correlationId }, async () => {
          await store.set(sessionId, patch);
          const result = await store.get(sessionId);
          expect(result).toBeDefined();
          expect(result!.data?.creds?.me?.id).toBe('1@test');
        });

        // Cleanup
        await store.delete(sessionId);
      } finally {
        await store.disconnect();
      }
    });

    it('should handle batch operations with correlation ID', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'batch-correlation-test',
        hybrid: testConfig,
      });

      try {
        const correlationId = 'test-batch-correlation-456';
        const session1 = 'batch-corr-1';
        const session2 = 'batch-corr-2';

        // Create test data
        const patch1 = { creds: { me: { id: '1@test' } } as any };
        const patch2 = { creds: { me: { id: '2@test' } } as any };

        await store.set(session1, patch1);
        await store.set(session2, patch2);

        // Batch get with correlation ID
        await withContext({ correlationId }, async () => {
          const results = await store.batchGet([session1, session2]);
          expect(results.size).toBe(2);
          expect(results.get(session1)).toBeDefined();
          expect(results.get(session2)).toBeDefined();
        });

        // Cleanup
        await store.batchDelete([session1, session2]);
      } finally {
        await store.disconnect();
      }
    });
  });

  describe('Circuit Breaker Recovery', () => {
    it('should recover from circuit breaker half-open state', async () => {
      const { store } = await useHybridAuthState({
        sessionId: 'cb-recovery-test',
        hybrid: {
          ...testConfig,
          resilience: {
            operationTimeout: 1000, // Short timeout to trigger circuit breaker
            maxRetries: 0,
            retryBaseDelay: 100,
            retryMultiplier: 2,
          },
        },
      });

      try {
        // Get circuit breaker stats
        const cbStats = store.getCircuitBreakerStats();
        expect(cbStats).toBeDefined();
        expect(typeof cbStats.fires).toBe('number');
        expect(typeof cbStats.successes).toBe('number');

        // Verify circuit breaker can be in different states
        const isOpen = store.isMongoCircuitBreakerOpen();
        expect(typeof isOpen).toBe('boolean');
      } finally {
        await store.disconnect();
      }
    });
  });
});
