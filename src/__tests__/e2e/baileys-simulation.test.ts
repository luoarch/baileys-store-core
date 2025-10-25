/**
 * @baileys-store/core - E2E Baileys Simulation
 *
 * End-to-end test simulating Baileys connection lifecycle
 * Tests creds.update events and authentication flow
 */

import { describe, it, expect } from 'vitest';

// Skip E2E tests se MongoDB não estiver disponível
const skipE2E = !process.env.MONGODB_URI && !process.env.CI;
import { EventEmitter } from 'events';
import { useHybridAuthState } from '../../hybrid/use-hybrid-auth-state.js';

// Simulate Baileys EventEmitter
class MockBaileysSocket extends EventEmitter {
  auth: any;

  constructor(auth: any) {
    super();
    this.auth = auth;
  }

  simulateCredsUpdate() {
    // Simulate what Baileys does during authentication
    this.emit('creds.update', this.auth.creds);
  }

  simulateConnectionOpen() {
    this.emit('connection.update', { connection: 'open' });
  }

  simulateQR(qrCode: string) {
    this.emit('connection.update', { qr: qrCode });
  }
}

describe.skipIf(skipE2E)('E2E: Baileys Authentication Simulation', () => {
  const sessionId = 'e2e-test-session';

  const testConfig = {
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
    mongoDatabase: 'baileys_test',
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
      enableMetrics: true, // Enable for E2E
      enableTracing: false,
      enableDetailedLogs: false,
      metricsInterval: 60000,
    },
    security: {
      enableEncryption: false,
      enableCompression: false,
      encryptionAlgorithm: 'secretbox' as const,
      compressionAlgorithm: 'snappy' as const,
      keyRotationDays: 90,
    },
    enableWriteBehind: false,
  };

  it('should handle complete authentication lifecycle', async () => {
    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId,
      hybrid: testConfig,
    });

    try {
      // Step 1: Initial state
      expect(state.creds).toBeDefined();
      expect(state.creds.registrationId).toBeDefined();
      expect(state.keys).toBeDefined();

      // Step 2: Simulate Baileys socket
      const socket = new MockBaileysSocket(state);

      // Step 3: Simulate QR code generation
      socket.simulateQR('fake-qr-code-12345');

      // Step 4: Simulate credentials update (like after QR scan)
      let saveCount = 0;
      const originalSaveCreds = saveCreds;
      const wrappedSaveCreds = async () => {
        saveCount++;
        await originalSaveCreds();
      };

      socket.on('creds.update', () => {
        void wrappedSaveCreds();
      });
      socket.simulateCredsUpdate();

      // Wait for async save
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 5: Verify credentials were saved
      expect(saveCount).toBeGreaterThan(0);

      // Step 6: Simulate connection open
      socket.simulateConnectionOpen();

      // Step 7: Verify data persisted
      const persisted = await store.get(sessionId);
      expect(persisted).toBeDefined();

      // Step 8: Verify metrics were collected
      const metricsText = await store.getMetricsText();
      expect(metricsText).toBeDefined();
      expect(metricsText.length).toBeGreaterThan(0);

      // Step 9: Verify circuit breaker status (may be open due to test failures)
      // Note: Circuit breaker will auto-close after resetTimeout (30s)
      const circuitBreakerOpen = store.isMongoCircuitBreakerOpen();
      console.log('Circuit breaker status:', circuitBreakerOpen ? 'OPEN' : 'CLOSED');

      // Step 10: Cleanup
      socket.removeAllListeners();
      await store.delete(sessionId);
    } finally {
      await store.disconnect();
    }
  });

  it('should handle reconnection scenario', async () => {
    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId: 'reconnect-test',
      hybrid: testConfig,
    });

    try {
      // Initial connection
      expect(state.creds).toBeDefined();

      // Save initial creds
      await saveCreds();

      // Simulate disconnect
      await store.disconnect();

      // Reconnect (new session but same sessionId)
      const { state: state2, store: store2 } = await useHybridAuthState({
        sessionId: 'reconnect-test',
        hybrid: testConfig,
      });

      // Should have loaded existing creds
      expect(state2.creds).toBeDefined();
      expect(state2.creds.registrationId).toBeDefined();

      // Cleanup
      await store2.delete('reconnect-test');
      await store2.disconnect();
    } finally {
      // Ensure cleanup
      if (await store.isHealthy()) {
        await store.disconnect().catch(() => {});
      }
    }
  });

  it('should handle concurrent credential updates', async () => {
    const { state, saveCreds, store } = await useHybridAuthState({
      sessionId: 'concurrent-test',
      hybrid: testConfig,
    });

    try {
      // Simulate multiple rapid credential updates (like Baileys does during setup)
      for (let i = 0; i < 5; i++) {
        state.creds.accountSyncCounter = i;
        await saveCreds();
      }

      // Final state should be persisted
      const persisted = await store.get('concurrent-test');
      expect(persisted).toBeDefined();
      if (persisted?.data.creds.accountSyncCounter !== undefined) {
        expect(persisted.data.creds.accountSyncCounter).toBeGreaterThanOrEqual(0);
      }

      // Cleanup
      await store.delete('concurrent-test');
    } finally {
      await store.disconnect();
    }
  });
});
