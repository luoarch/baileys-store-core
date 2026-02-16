/**
 * Contract Tests - Validates all AuthStore implementations conform to contract
 *
 * These tests ensure that Redis, MongoDB, and Hybrid stores all implement
 * the AuthStore interface correctly and return data matching the contract schemas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

import { createRedisStore, type RedisAuthStore } from '../../redis/store.js';
import { createMongoStore, type MongoAuthStore } from '../../mongodb/store.js';
import { createCryptoService } from '../../crypto/index.js';
import { createCodecService } from '../../crypto/codec.js';
import { VersionedResultSchema, StoreErrorSchema } from '../../contracts/auth-store.contract.js';
import {
  DEFAULT_TTL_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  DEFAULT_SECURITY_CONFIG,
} from '../../types/index.js';

describe('AuthStore Contract Tests', () => {
  let redis: StartedRedisContainer;
  let mongo: StartedMongoDBContainer;
  let redisClient: Redis;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    [redis, mongo] = await Promise.all([
      new RedisContainer('redis:7-alpine').start(),
      new MongoDBContainer('mongo:7').start(),
    ]);
    redisClient = new Redis(redis.getConnectionUrl());
    mongoClient = new MongoClient(mongo.getConnectionString());
    await mongoClient.connect();
  }, 120000);

  afterAll(async () => {
    await redisClient?.quit();
    await mongoClient?.close();
    await redis?.stop();
    await mongo?.stop();
  });

  // Factory para criar stores com config de teste
  const createTestStores = async (): Promise<
    { name: string; store: RedisAuthStore | MongoAuthStore }[]
  > => {
    const cryptoService = await createCryptoService(
      { ...DEFAULT_SECURITY_CONFIG, enableEncryption: false, enableCompression: false },
      undefined,
    );
    const codecService = createCodecService({
      ...DEFAULT_SECURITY_CONFIG,
      enableCompression: false,
    });

    const redisStore = await createRedisStore(
      {
        redisUrl: redis.getConnectionUrl(),
        ttl: DEFAULT_TTL_CONFIG,
        resilience: DEFAULT_RESILIENCE_CONFIG,
      },
      cryptoService,
      codecService,
    );

    const mongoStore = await createMongoStore(
      {
        mongoUrl: mongo.getConnectionString(),
        databaseName: 'contract_test',
        collectionName: 'sessions',
        ttl: DEFAULT_TTL_CONFIG,
        resilience: DEFAULT_RESILIENCE_CONFIG,
      },
      cryptoService,
      codecService,
    );

    return [
      { name: 'RedisStore', store: redisStore },
      { name: 'MongoStore', store: mongoStore },
    ];
  };

  describe.each(['RedisStore', 'MongoStore'])('%s Contract Compliance', (storeName) => {
    let store: RedisAuthStore | MongoAuthStore;

    beforeAll(async () => {
      const stores = await createTestStores();
      store = stores.find((s) => s.name === storeName)!.store;
    });

    afterAll(async () => {
      await store.disconnect();
    });

    it('get() returns null for non-existent session', async () => {
      const result = await store.get('non-existent-session-id');
      expect(result).toBeNull();
    });

    it('set() returns VersionedResult matching contract', async () => {
      const sessionId = `contract-test-${storeName}-${String(Date.now())}`;
      const result = await store.set(sessionId, {
        creds: { registrationId: 12345 } as any,
      });

      // Validate against contract schema
      const validation = VersionedResultSchema.safeParse(result);
      expect(validation.success).toBe(true);
      expect(result.version).toBeGreaterThanOrEqual(0);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.success).toBe(true);

      // Cleanup
      await store.delete(sessionId);
    });

    it('set() with wrong version throws VersionMismatchError', async () => {
      const sessionId = `version-test-${storeName}-${String(Date.now())}`;
      await store.set(sessionId, { creds: { registrationId: 12345 } as any });

      try {
        await store.set(sessionId, { creds: { registrationId: 67890 } as any }, 999);
        expect.fail('Should have thrown VersionMismatchError');
      } catch (error: any) {
        const validation = StoreErrorSchema.safeParse({
          name: error.name,
          message: error.message,
        });
        expect(validation.success).toBe(true);
        expect(error.name).toBe('VersionMismatchError');
      }

      await store.delete(sessionId);
    });

    it('exists() returns correct boolean', async () => {
      const sessionId = `exists-test-${storeName}-${String(Date.now())}`;

      // Should not exist initially
      const beforeExists = await store.exists(sessionId);
      expect(beforeExists).toBe(false);

      // Create session
      await store.set(sessionId, { creds: { registrationId: 12345 } as any });

      // Should exist now
      const afterExists = await store.exists(sessionId);
      expect(afterExists).toBe(true);

      // Cleanup
      await store.delete(sessionId);
    });

    it('delete() removes session successfully', async () => {
      const sessionId = `delete-test-${storeName}-${String(Date.now())}`;
      await store.set(sessionId, { creds: { registrationId: 12345 } as any });

      // Verify it exists
      expect(await store.exists(sessionId)).toBe(true);

      // Delete
      await store.delete(sessionId);

      // Verify it's gone
      expect(await store.exists(sessionId)).toBe(false);
    });

    it('isHealthy() returns boolean', async () => {
      const healthy = await store.isHealthy();
      expect(typeof healthy).toBe('boolean');
      expect(healthy).toBe(true);
    });

    it('touch() extends TTL without error', async () => {
      const sessionId = `touch-test-${storeName}-${String(Date.now())}`;
      await store.set(sessionId, { creds: { registrationId: 12345 } as any });

      // Touch should not throw
      await expect(store.touch(sessionId, 3600)).resolves.not.toThrow();

      // Cleanup
      await store.delete(sessionId);
    });
  });
});
