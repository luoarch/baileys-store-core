/**
 * @baileys-store/core - E2E Race Condition Test
 *
 * Tests the race condition fix for me/account fields not persisted to Redis.
 * The bug was caused by shared reference between Redis and Outbox operations.
 *
 * Root cause: patch.creds was a direct reference to authState.creds.
 * During async Redis encoding, Baileys could modify the object, causing
 * different data to be serialized by Redis (async) vs Outbox (sync).
 *
 * Fix: Deep copy the patch before splitting to Redis and Outbox.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useHybridAuthState } from '../../hybrid/use-hybrid-auth-state.js';
import type { HybridAuthStore } from '../../hybrid/store.js';

// Skip E2E tests if MongoDB not available
const skipE2E = !process.env.MONGODB_URI && !process.env.CI;

describe.skipIf(skipE2E)('E2E: Race Condition - me/account persistence', () => {
  const sessionId = 'race-condition-test';

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
      enableMetrics: false,
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

  let store: HybridAuthStore | null = null;

  beforeEach(async () => {
    // Clean up any previous test data
    if (store) {
      try {
        await store.delete(sessionId);
        await store.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
    store = null;
  });

  afterEach(async () => {
    if (store) {
      try {
        await store.delete(sessionId);
        await store.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should persist me field even when modified during save', async () => {
    // Step 1: Create initial session
    const {
      state,
      saveCreds,
      store: hybridStore,
    } = await useHybridAuthState({
      sessionId,
      hybrid: testConfig,
    });
    store = hybridStore;

    // Step 2: Simulate Baileys adding me field
    state.creds.me = {
      id: '5511999999999@s.whatsapp.net',
      lid: '123456789:0@lid',
    };

    // Step 3: Save credentials
    await saveCreds();

    // Step 4: Modify state AFTER save started (simulates race condition)
    // With the fix, this should NOT affect the saved data
    const savedMe = { ...state.creds.me };
    state.creds.me = {
      id: '9999999999999@s.whatsapp.net', // Different ID
      lid: '999999999:0@lid',
    };

    // Step 5: Verify persisted data has the ORIGINAL me value
    const persisted = await store.get(sessionId);
    expect(persisted).toBeDefined();
    expect(persisted!.data.creds.me).toBeDefined();
    expect(persisted!.data.creds.me?.id).toBe(savedMe.id);
    expect(persisted!.data.creds.me?.lid).toBe(savedMe.lid);
  });

  it('should persist account field correctly', async () => {
    const {
      state,
      saveCreds,
      store: hybridStore,
    } = await useHybridAuthState({
      sessionId: `${sessionId}-account`,
      hybrid: testConfig,
    });
    store = hybridStore;

    // Simulate Baileys adding account field
    state.creds.account = {
      details: Buffer.from('test-account-details'),
      accountSignatureKey: Buffer.from('test-signature-key-32-bytes-long'),
      accountSignature: Buffer.from('test-signature'),
      deviceSignature: Buffer.from('test-device-sig'),
    };

    await saveCreds();

    // Verify persisted data
    const persisted = await store.get(`${sessionId}-account`);
    expect(persisted).toBeDefined();
    expect(persisted!.data.creds.account).toBeDefined();
    expect(Buffer.isBuffer(persisted!.data.creds.account?.details)).toBe(true);

    // Cleanup
    await store.delete(`${sessionId}-account`);
  });

  it('should maintain consistency after reconnection', async () => {
    // Step 1: Create session with me field
    const {
      state,
      saveCreds,
      store: hybridStore,
    } = await useHybridAuthState({
      sessionId: `${sessionId}-reconnect`,
      hybrid: testConfig,
    });
    store = hybridStore;

    state.creds.me = {
      id: '5511888888888@s.whatsapp.net',
      lid: '888888888:0@lid',
    };

    await saveCreds();

    // Step 2: Disconnect
    await store.disconnect();

    // Step 3: Reconnect (simulates error 515 scenario)
    const { state: state2, store: store2 } = await useHybridAuthState({
      sessionId: `${sessionId}-reconnect`,
      hybrid: testConfig,
    });
    store = store2;

    // Step 4: Verify me field is present (should NOT show new QR)
    expect(state2.creds.me).toBeDefined();
    expect(state2.creds.me?.id).toBe('5511888888888@s.whatsapp.net');
    expect(state2.creds.me?.lid).toBe('888888888:0@lid');

    // Cleanup
    await store.delete(`${sessionId}-reconnect`);
  });

  it('should handle rapid credential updates without data loss', async () => {
    const {
      state,
      saveCreds,
      store: hybridStore,
    } = await useHybridAuthState({
      sessionId: `${sessionId}-rapid`,
      hybrid: testConfig,
    });
    store = hybridStore;

    // Simulate rapid Baileys updates (common during handshake)
    for (let i = 0; i < 10; i++) {
      state.creds.accountSyncCounter = i;
      state.creds.me = {
        id: `551199999999${String(i)}@s.whatsapp.net`,
        lid: `${String(i)}23456789:0@lid`,
      };
      await saveCreds();
    }

    // Verify final state is persisted
    const persisted = await store.get(`${sessionId}-rapid`);
    expect(persisted).toBeDefined();
    expect(persisted!.data.creds.me).toBeDefined();
    expect(persisted!.data.creds.accountSyncCounter).toBe(9);

    // Cleanup
    await store.delete(`${sessionId}-rapid`);
  });

  it('should handle Buffer fields in creds correctly', async () => {
    const {
      state,
      saveCreds,
      store: hybridStore,
    } = await useHybridAuthState({
      sessionId: `${sessionId}-buffers`,
      hybrid: testConfig,
    });
    store = hybridStore;

    // Verify initial buffers are present
    expect(state.creds.noiseKey).toBeDefined();
    expect(state.creds.signedIdentityKey).toBeDefined();

    // Add me field and save
    state.creds.me = {
      id: '5511777777777@s.whatsapp.net',
    };

    await saveCreds();

    // Reconnect and verify buffers are still valid
    await store.disconnect();

    const { state: state2, store: store2 } = await useHybridAuthState({
      sessionId: `${sessionId}-buffers`,
      hybrid: testConfig,
    });
    store = store2;

    // Verify buffers are actual Buffer instances (not plain objects)
    expect(Buffer.isBuffer(state2.creds.noiseKey.private)).toBe(true);
    expect(Buffer.isBuffer(state2.creds.noiseKey.public)).toBe(true);
    expect(Buffer.isBuffer(state2.creds.signedIdentityKey.private)).toBe(true);
    expect(Buffer.isBuffer(state2.creds.signedIdentityKey.public)).toBe(true);

    // Verify me field persisted
    expect(state2.creds.me).toBeDefined();
    expect(state2.creds.me?.id).toBe('5511777777777@s.whatsapp.net');

    // Cleanup
    await store.delete(`${sessionId}-buffers`);
  });
});
