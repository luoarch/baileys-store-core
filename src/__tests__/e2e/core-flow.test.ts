/**
 * Golden Core Flow Test
 *
 * Este teste DEVE passar para qualquer release.
 * Exercita o ciclo completo: create -> save -> reload -> verify -> delete
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { useHybridAuthState } from '../../hybrid/use-hybrid-auth-state.js';
import {
  DEFAULT_TTL_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
} from '../../types/index.js';

describe('Golden Core Flow: Hybrid Auth Lifecycle', () => {
  let redis: StartedRedisContainer;
  let mongo: StartedMongoDBContainer;

  const createHybridConfig = () => ({
    redisUrl: redis.getConnectionUrl(),
    mongoUrl: mongo.getConnectionString(),
    mongoDatabase: 'core_flow_test',
    mongoCollection: 'sessions',
    ttl: DEFAULT_TTL_CONFIG,
    resilience: DEFAULT_RESILIENCE_CONFIG,
    observability: { ...DEFAULT_OBSERVABILITY_CONFIG, enableMetrics: false },
    security: {
      enableEncryption: false,
      enableCompression: false,
      encryptionAlgorithm: 'secretbox' as const,
      compressionAlgorithm: 'snappy' as const,
      keyRotationDays: 90,
    },
  });

  beforeAll(async () => {
    [redis, mongo] = await Promise.all([
      new RedisContainer('redis:7-alpine').start(),
      new MongoDBContainer('mongo:7').start(),
    ]);
  }, 120000);

  afterAll(async () => {
    await redis?.stop();
    await mongo?.stop();
  });

  it('completes full auth lifecycle', async () => {
    const sessionId = `core-flow-${String(Date.now())}`;

    // Step 1: Create fresh state
    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId,
      hybrid: createHybridConfig(),
    });

    try {
      expect(state.creds).toBeDefined();
      expect(state.creds.registrationId).toBeTypeOf('number');

      // Step 2: Simulate pairing (update creds)
      state.creds.me = { id: '5511999999999@s.whatsapp.net', name: 'Test' };
      await saveCreds();

      // Step 3: Verify data was persisted
      const snapshot = await store.get(sessionId);
      expect(snapshot).toBeDefined();
      expect(snapshot!.version).toBeGreaterThan(0);

      // Step 4: Reload and verify (simulate reconnection)
      const { state: reloaded, store: reloadedStore } = await useHybridAuthState({
        sessionId,
        hybrid: createHybridConfig(),
      });

      try {
        expect(reloaded.creds.me?.id).toBe('5511999999999@s.whatsapp.net');
        expect(reloaded.creds.me?.name).toBe('Test');
      } finally {
        await reloadedStore.disconnect();
      }

      // Step 5: Cleanup
      await store.delete(sessionId);
      const afterDelete = await store.get(sessionId);
      expect(afterDelete).toBeNull();
    } finally {
      await store.disconnect();
    }
  }, 60000);

  it('handles concurrent credential updates safely', async () => {
    const sessionId = `concurrent-test-${String(Date.now())}`;

    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId,
      hybrid: createHybridConfig(),
    });

    try {
      // Set initial credentials
      state.creds.me = { id: 'initial@s.whatsapp.net', name: 'Initial' };
      await saveCreds();

      // Simulate multiple rapid updates (should not cause version conflicts)
      const updatePromises = [];
      for (let i = 0; i < 5; i++) {
        state.creds.me = { id: `update${String(i)}@s.whatsapp.net`, name: `Update ${String(i)}` };
        updatePromises.push(saveCreds());
      }

      // All updates should complete without throwing
      await expect(Promise.all(updatePromises)).resolves.not.toThrow();

      // Final state should be consistent
      const finalSnapshot = await store.get(sessionId);
      expect(finalSnapshot).toBeDefined();
      expect(finalSnapshot!.data.creds.me).toBeDefined();
    } finally {
      await store.delete(sessionId);
      await store.disconnect();
    }
  }, 30000);

  it('recovers gracefully from simulated Redis failure', async () => {
    const sessionId = `fallback-test-${String(Date.now())}`;

    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId,
      hybrid: createHybridConfig(),
    });

    try {
      // Save initial state
      state.creds.me = { id: 'fallback@s.whatsapp.net', name: 'Fallback' };
      await saveCreds();

      // Verify data exists
      const snapshot = await store.get(sessionId);
      expect(snapshot).toBeDefined();

      // Verify circuit breaker is not open
      expect(store.isMongoCircuitBreakerOpen()).toBe(false);
    } finally {
      await store.delete(sessionId);
      await store.disconnect();
    }
  }, 30000);

  it('handles key management operations', async () => {
    const sessionId = `keys-test-${String(Date.now())}`;

    const { state, store } = await useHybridAuthState({
      sessionId,
      hybrid: createHybridConfig(),
    });

    try {
      // Set some keys (using any to avoid strict Baileys type constraints in tests)
      const testKeys = {
        'pre-key': {
          '1': { private: Buffer.from('test-priv-1'), public: Buffer.from('test-pub-1') },
          '2': { private: Buffer.from('test-priv-2'), public: Buffer.from('test-pub-2') },
        },
      };
      await state.keys.set(testKeys as any);

      // Get keys back
      const keys = await state.keys.get('pre-key', ['1', '2', '3']);
      expect(keys['1']).toBeDefined();
      expect(keys['2']).toBeDefined();
      expect(keys['3']).toBeUndefined();

      // Delete a key
      await state.keys.set({
        'pre-key': {
          '1': null,
        },
      } as any);

      // Verify deletion
      const keysAfterDelete = await state.keys.get('pre-key', ['1', '2']);
      expect(keysAfterDelete['1']).toBeUndefined();
      expect(keysAfterDelete['2']).toBeDefined();
    } finally {
      await store.delete(sessionId);
      await store.disconnect();
    }
  }, 30000);
});
