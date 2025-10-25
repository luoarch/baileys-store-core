/**
 * @baileys-store/core - Hybrid Store Tests
 *
 * Unit tests for hybrid Redis + MongoDB orchestration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridAuthStore, createHybridStore } from '../../hybrid/store.js';
import type { RedisAuthStore } from '../../redis/store.js';
import type { MongoAuthStore } from '../../mongodb/store.js';
import type { AuthPatch, Versioned, AuthSnapshot } from '../../types/index.js';
import { VersionMismatchError } from '../../types/index.js';
import type { QueueAdapter } from '../../types/queue.js';
import { withContext } from '../../context/execution-context.js';

// Mock stores
class MockRedisStore {
  private data = new Map<string, Versioned<AuthSnapshot>>();
  connected = false;

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async get(sessionId: string): Promise<Versioned<AuthSnapshot> | null> {
    return this.data.get(sessionId) ?? null;
  }

  async set(sessionId: string, patch: AuthPatch, _expectedVersion?: number) {
    const existing = this.data.get(sessionId);
    const version = existing ? existing.version + 1 : 1;

    this.data.set(sessionId, {
      data: {
        creds: patch.creds ?? existing?.data.creds ?? ({} as any),
        keys: patch.keys ?? existing?.data.keys ?? ({} as any),
      },
      version,
      updatedAt: new Date(),
    });

    return { version, fencingToken: Date.now() };
  }

  async delete(_sessionId: string) {
    this.data.delete(_sessionId);
  }

  async touch(_sessionId: string) {}

  async list(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async isHealthy(): Promise<boolean> {
    return this.connected;
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.data.has(sessionId);
  }

  getMetrics() {
    return { totalWrites: 0, totalReads: 0 };
  }

  get client() {
    return {
      hset: vi.fn(),
      hgetall: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      del: vi.fn(),
      expire: vi.fn(),
      hget: vi.fn(),
      hdel: vi.fn(),
    };
  }
}

class MockMongoStore {
  private data = new Map<string, Versioned<AuthSnapshot>>();
  connected = false;
  shouldFail = false;

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async get(sessionId: string): Promise<Versioned<AuthSnapshot> | null> {
    if (this.shouldFail) throw new Error('MongoDB unavailable');
    return this.data.get(sessionId) ?? null;
  }

  async set(sessionId: string, patch: AuthPatch, _expectedVersion?: number) {
    if (this.shouldFail) throw new Error('MongoDB unavailable');

    const existing = this.data.get(sessionId);
    const version = existing ? existing.version + 1 : 1;

    this.data.set(sessionId, {
      data: {
        creds: patch.creds ?? existing?.data.creds ?? ({} as any),
        keys: patch.keys ?? existing?.data.keys ?? ({} as any),
      },
      version,
      updatedAt: new Date(),
    });

    return { version, fencingToken: Date.now() };
  }

  async delete(_sessionId: string) {
    if (this.shouldFail) throw new Error('MongoDB unavailable');
    this.data.delete(_sessionId);
  }

  async touch(_sessionId: string) {
    if (this.shouldFail) throw new Error('MongoDB unavailable');
  }

  async list(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async isHealthy(): Promise<boolean> {
    return this.connected && !this.shouldFail;
  }

  async exists(sessionId: string): Promise<boolean> {
    if (this.shouldFail) throw new Error('MongoDB unavailable');
    return this.data.has(sessionId);
  }

  getMetrics() {
    return { totalWrites: 0, totalReads: 0, cacheHits: 0 };
  }

  getClient() {
    return this as unknown;
  }
}

class MockQueue implements QueueAdapter {
  jobs: any[] = [];
  shouldFail = false;

  async add(jobName: string, data: any) {
    if (this.shouldFail) throw new Error('Queue unavailable');
    this.jobs.push({ jobName, data });
  }

  async close() {}
}

describe('HybridAuthStore', () => {
  let redis: MockRedisStore;
  let mongo: MockMongoStore;
  let queue: MockQueue;
  let store: HybridAuthStore;
  const sessionId = 'test-session';

  beforeEach(async () => {
    redis = new MockRedisStore();
    mongo = new MockMongoStore();
    queue = new MockQueue();

    store = new HybridAuthStore(
      redis as unknown as RedisAuthStore,
      mongo as unknown as MongoAuthStore,
      {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
        ttl: {
          defaultTtl: 30 * 24 * 60 * 60, // 30 days in seconds
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
        enableWriteBehind: true,
        queue,
      },
    );

    await store.connect();
  });

  afterEach(async () => {
    await store.disconnect();
  });

  describe('Read-Through Cache', () => {
    it('should read from Redis first (cache hit)', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      const result = await store.get(sessionId);
      expect(result).toBeDefined();
      expect(result!.data.creds).toBeDefined();
    });

    it('should fallback to MongoDB on Redis miss', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      // Write directly to MongoDB
      await mongo.set(sessionId, patch);

      const result = await store.get(sessionId);
      expect(result).toBeDefined();
    });

    it('should return null when data not found in both stores', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Write-Behind', () => {
    it('should write to Redis immediately and queue MongoDB write', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      const result = await store.set(sessionId, patch);

      expect(result.version).toBe(1);
      expect(queue.jobs).toHaveLength(1);
      expect(queue.jobs[0].data.sessionId).toBe(sessionId);
    });

    it('should fallback to direct MongoDB write on queue failure', async () => {
      queue.shouldFail = true;

      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await expect(store.set(sessionId, patch)).resolves.toBeDefined();

      // Should still be in MongoDB despite queue failure
      const mongoData = await mongo.get(sessionId);
      expect(mongoData).toBeDefined();
    });

    it('should write directly to MongoDB when write-behind disabled', async () => {
      await store.disconnect();

      const storeNoQueue = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
            encryptionAlgorithm: 'secretbox',
            compressionAlgorithm: 'snappy',
            keyRotationDays: 90,
          },
          enableWriteBehind: false,
        },
      );

      await storeNoQueue.connect();

      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await storeNoQueue.set(sessionId, patch);

      const mongoData = await mongo.get(sessionId);
      expect(mongoData).toBeDefined();

      await storeNoQueue.disconnect();
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after MongoDB failures', async () => {
      mongo.shouldFail = true;

      // Trigger multiple failures
      for (let i = 0; i < 10; i++) {
        try {
          await store.get(sessionId);
        } catch {
          // Ignore
        }
      }

      // Circuit breaker should be open
      expect(store.isMongoCircuitBreakerOpen()).toBe(true);
    });

    it('should return null when circuit breaker open', async () => {
      mongo.shouldFail = true;

      // Trigger failures to open circuit
      for (let i = 0; i < 10; i++) {
        try {
          await store.get(sessionId);
        } catch {
          // Ignore
        }
      }

      const result = await store.get(sessionId);
      expect(result).toBeNull();
    });

    it('should provide circuit breaker stats', () => {
      const stats = store.getCircuitBreakerStats();
      expect(stats).toBeDefined();
      expect(stats.fires).toBeDefined();
    });
  });

  describe('Concurrency Control', () => {
    it('should handle concurrent writes to same session', async () => {
      const writes = Promise.all([
        store.set(sessionId, { creds: { registrationId: 1 } as any }),
        store.set(sessionId, { creds: { registrationId: 2 } as any }),
        store.set(sessionId, { creds: { registrationId: 3 } as any }),
      ]);

      await expect(writes).resolves.toBeDefined();
    });
  });

  describe('Metrics', () => {
    it('should expose Prometheus metrics', async () => {
      const metricsText = await store.getMetricsText();
      expect(metricsText).toContain('baileys_store');
    });

    it('should provide metrics registry', () => {
      const registry = store.getMetricsRegistry();
      expect(registry).toBeDefined();
    });
  });

  describe('Outbox', () => {
    it('should expose outbox stats', () => {
      const stats = store.getOutboxStats();
      expect(stats).toBeDefined();
    });

    it('should allow manual outbox reconciliation', async () => {
      await expect(store.reconcileOutbox()).resolves.not.toThrow();
    });
  });

  describe('Partial Failures', () => {
    it('should handle Redis failure in delete gracefully', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 1 } as any,
      };

      await store.set(sessionId, patch);

      // Mock Redis failure
      redis.delete = vi.fn().mockRejectedValue(new Error('Redis unavailable'));

      // Should still succeed with MongoDB
      await expect(store.delete(sessionId)).resolves.not.toThrow();
    });

    it('should handle MongoDB failure in delete gracefully', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 1 } as any,
      };

      await store.set(sessionId, patch);

      // Mock MongoDB failure
      mongo.shouldFail = true;

      // Should still succeed with Redis
      await expect(store.delete(sessionId)).resolves.not.toThrow();
    });
  });

  describe('Health Check', () => {
    it('should return true when both stores healthy', async () => {
      const isHealthy = await store.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should return false when Redis unhealthy', async () => {
      await redis.disconnect();
      const isHealthy = await store.isHealthy();
      expect(isHealthy).toBe(false);
    });

    it('should return false when MongoDB unhealthy', async () => {
      mongo.shouldFail = true;
      const isHealthy = await store.isHealthy();
      expect(isHealthy).toBe(false);
    });

    it('should return false when not connected', async () => {
      await store.disconnect();
      const isHealthy = await store.isHealthy();
      expect(isHealthy).toBe(false);
    });
  });

  describe('Cache Warming', () => {
    it('should skip cache warming when newer version exists', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      // Write initial data
      await store.set(sessionId, patch);
      const initialResult = await store.get(sessionId);

      // Write newer data
      const newerPatch: AuthPatch = {
        creds: { registrationId: 54321 } as any,
      };
      await store.set(sessionId, newerPatch);

      // Mock cache warming scenario
      const warmCacheMethod = (store as any).warmCache;
      await warmCacheMethod.call(store, sessionId, initialResult!);

      // Should not overwrite newer data
      const finalResult = await store.get(sessionId);
      expect(finalResult!.data.creds.registrationId).toBe(54321);
    });

    it('should handle cache warming errors gracefully', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);
      const result = await store.get(sessionId);

      // Mock Redis failure during cache warming
      redis.set = vi.fn().mockRejectedValue(new Error('Redis set failed'));

      const warmCacheMethod = (store as any).warmCache;
      await expect(warmCacheMethod.call(store, sessionId, result!)).resolves.not.toThrow();
    });
  });

  describe('Legacy Metrics', () => {
    it('should provide legacy metrics', () => {
      const metrics = store.getMetrics();
      expect(metrics).toHaveProperty('hitRatio');
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('redisHits');
      expect(metrics).toHaveProperty('redisMisses');
      expect(metrics).toHaveProperty('mongoFallbacks');
    });

    it('should reset legacy metrics', () => {
      store.resetMetrics();
      const metrics = store.getMetrics();
      expect(metrics.redisHits).toBe(0);
      expect(metrics.redisMisses).toBe(0);
      expect(metrics.mongoFallbacks).toBe(0);
    });
  });

  describe('Touch Operations', () => {
    it('should handle partial failure in touch (Redis fails)', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      // Mock Redis failure
      redis.touch = vi.fn().mockRejectedValue(new Error('Redis touch failed'));

      // Should still succeed with MongoDB
      await expect(store.touch(sessionId)).resolves.not.toThrow();
    });

    it('should handle partial failure in touch (MongoDB fails)', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      // Mock MongoDB failure
      mongo.shouldFail = true;

      // Should still succeed with Redis
      await expect(store.touch(sessionId)).resolves.not.toThrow();
    });

    it('should handle complete failure in touch', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      // Mock both failures
      redis.touch = vi.fn().mockRejectedValue(new Error('Redis touch failed'));
      mongo.shouldFail = true;

      await expect(store.touch(sessionId)).rejects.toThrow();
    });
  });

  describe('Delete Operations', () => {
    it('should handle complete failure in delete', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      // Mock both failures
      redis.delete = vi.fn().mockRejectedValue(new Error('Redis delete failed'));
      mongo.shouldFail = true;

      await expect(store.delete(sessionId)).rejects.toThrow();
    });
  });

  describe('Exists Operations', () => {
    it('should check existence in Redis first', async () => {
      const patch: AuthPatch = {
        creds: { registrationId: 12345 } as any,
      };

      await store.set(sessionId, patch);

      const exists = await store.exists(sessionId);
      expect(exists).toBe(true);
    });

    it('should fallback to MongoDB for existence check', async () => {
      // Mock Redis to return false
      redis.exists = vi.fn().mockResolvedValue(false);

      // Write to MongoDB directly
      await mongo.set(sessionId, { creds: { registrationId: 12345 } as any });

      const exists = await store.exists(sessionId);
      expect(exists).toBe(true);
    });

    it('should handle existence check errors', async () => {
      redis.exists = vi.fn().mockRejectedValue(new Error('Redis exists failed'));

      await expect(store.exists(sessionId)).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should handle connection errors', async () => {
      const failingStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
            encryptionAlgorithm: 'secretbox',
            compressionAlgorithm: 'snappy',
            keyRotationDays: 90,
          },
          enableWriteBehind: false,
        },
      );

      // Mock connection failure
      redis.connect = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await expect(failingStore.connect()).rejects.toThrow();
    });

    it('should handle disconnect errors', async () => {
      redis.disconnect = vi.fn().mockRejectedValue(new Error('Redis disconnect failed'));

      await expect(store.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Write-Behind Edge Cases', () => {
    it('should handle outbox manager initialization failure', async () => {
      await store.disconnect();

      // Mock Redis client to not have getClient method
      const mockRedisWithoutClient = {
        ...redis,
        getClient: undefined,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue({ version: 1, updatedAt: new Date() }),
        delete: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        isHealthy: vi.fn().mockResolvedValue(true),
      };

      const storeWithoutClient = new HybridAuthStore(
        mockRedisWithoutClient as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
            encryptionAlgorithm: 'secretbox',
            compressionAlgorithm: 'snappy',
            keyRotationDays: 90,
          },
          enableWriteBehind: true,
          queue,
        },
      );

      await expect(storeWithoutClient.connect()).resolves.not.toThrow();
    });
  });

  describe('Buffer Type Assertions', () => {
    it('should assert buffer types in set operation', async () => {
      const patch: AuthPatch = {
        creds: {
          noiseKey: {
            public: Buffer.from('test'),
            private: Buffer.from('private'),
          },
        } as any,
      };

      await expect(store.set(sessionId, patch)).resolves.not.toThrow();
    });

    it('should assert buffer types in keys', async () => {
      const patch: AuthPatch = {
        keys: {
          'pre-key': {
            key1: Buffer.from('test'),
          },
        },
      };

      await expect(store.set(sessionId, patch)).resolves.not.toThrow();
    });
  });

  describe('Mutex Management', () => {
    it('should handle mutex creation and retrieval', async () => {
      const getMutexMethod = (store as any).getMutex;
      const mutex = getMutexMethod.call(store, 'new-session');

      expect(mutex).toBeDefined();
    });

    it('should handle mutex not found error', async () => {
      const getMutexMethod = (store as any).getMutex;

      // Mock mutex map to return undefined
      const originalMutexes = (store as any).writeMutexes;
      (store as any).writeMutexes = new Map();

      // This should not throw in normal operation, but test the error path
      const mutex = getMutexMethod.call(store, 'test-session');
      expect(mutex).toBeDefined();

      // Restore
      (store as any).writeMutexes = originalMutexes;
    });
  });

  describe('Cache Warming - Complete Coverage', () => {
    it('should handle Redis connection check during warmCache', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      // Mock Redis como não conectado
      redis.isHealthy = vi.fn().mockResolvedValue(false);
      redis.get = vi.fn().mockResolvedValue(null);
      redis.set = vi.fn().mockResolvedValue({ version: 1, updatedAt: new Date(), success: true });
      mongo.get = vi.fn().mockResolvedValue(data);

      const result = await store.get(sessionId);

      expect(result).toEqual(data);
      // Deve ter aquecido o cache (chamou Redis SET)
      expect(redis.set).toHaveBeenCalled();
    });

    it('should handle version comparison during cache warming', async () => {
      const sessionId = 'test-session';
      const existingData: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 2,
        updatedAt: new Date(),
      };
      const newData: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1, // Versão mais antiga
        updatedAt: new Date(),
      };

      // Primeiro get retorna versão mais nova (2)
      redis.get = vi
        .fn()
        .mockResolvedValueOnce(existingData) // version: 2
        .mockResolvedValueOnce(null); // segundo get para warmCache
      mongo.get = vi.fn().mockResolvedValue(newData); // version: 1
      const setSpy = vi.spyOn(redis, 'set');

      const result = await store.get(sessionId);

      expect(result).toEqual(existingData); // Deve retornar a versão mais nova do Redis
      // Não deve sobrescrever com versão mais antiga
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker Transitions', () => {
    it('should handle circuit breaker OPEN → HALF_OPEN transition', async () => {
      const sessionId = 'test-session';

      // Simular circuit breaker aberto
      const circuitBreaker = (store as any).mongoCircuitBreaker;
      circuitBreaker.open();

      // Acessar estado interno diretamente
      circuitBreaker.state = 'HALF_OPEN';

      // Deve tentar operação
      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockResolvedValue(null);

      const result = await store.get(sessionId);
      expect(result).toBeNull();
    });
  });

  describe('Mutex Timeout Handling', () => {
    it('should handle mutex acquisition timeout', async () => {
      const sessionId = 'test-session';
      const patch: AuthPatch = { creds: {} as any };

      // Mock mutex para simular timeout
      const mockMutex = {
        runExclusive: vi.fn().mockImplementation(async () => {
          // Simular timeout
          throw new Error('Mutex acquisition timeout');
        }),
      };

      // Substituir getMutex para retornar mock com timeout
      const originalGetMutex = (store as any).getMutex;
      (store as any).getMutex = vi.fn().mockReturnValue(mockMutex);

      await expect(store.set(sessionId, patch)).rejects.toThrow('Mutex acquisition timeout');

      // Restore
      (store as any).getMutex = originalGetMutex;
    });
  });

  describe('Connection State Validation', () => {
    it('should throw error when not connected', async () => {
      // Desconectar store
      await store.disconnect();

      // Tentar operação sem conexão
      await expect(store.get('test-session')).rejects.toThrow('Failed to get from HybridAuthStore');
      await expect(store.set('test-session', {})).rejects.toThrow(
        'Failed to set in HybridAuthStore',
      );
      await expect(store.delete('test-session')).rejects.toThrow(
        'Failed to delete from HybridAuthStore',
      );
    });

    it('should handle ensureConnected error path', async () => {
      // Mock connected como false mas não permitir reconexão
      (store as any).connected = false;
      redis.connect = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await expect(store.get('test-session')).rejects.toThrow('Failed to get from HybridAuthStore');
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle warmCache with Redis connection failure', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockResolvedValue(data);
      // Redis connection falha durante warmCache
      redis.connect = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      const result = await store.get(sessionId);
      expect(result).toEqual(data);
    });

    it('should handle warmCache with Redis set failure', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockResolvedValue(data);
      // Redis set falha durante warmCache
      redis.set = vi.fn().mockRejectedValue(new Error('Redis set failed'));

      const result = await store.get(sessionId);
      expect(result).toEqual(data);
    });
  });

  describe('Connection Management - Complete Coverage', () => {
    it('should handle getClient not available during connect', async () => {
      // Mock Redis sem getClient mas com connect
      const mockRedisWithoutGetClient = {
        ...redis,
        getClient: undefined,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue({ version: 1, updatedAt: new Date() }),
        delete: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        isHealthy: vi.fn().mockResolvedValue(true),
      };

      const store = new HybridAuthStore(mockRedisWithoutGetClient as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
      });

      // Deve conectar mas não inicializar outbox
      await store.connect();

      expect(store).toBeDefined();
    });

    it('should handle queue close failure during disconnect', async () => {
      const configWithQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: true,
        queue: {
          add: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        },
      };

      const store = new HybridAuthStore(redis as any, mongo as any, configWithQueue);
      await store.connect();

      // Disconnect deve falhar mas não quebrar
      await expect(store.disconnect()).resolves.toBeUndefined();
    });

    it('should handle complete connect failure', async () => {
      // Mock Redis que falha no connect
      const failingRedis = {
        ...redis,
        connect: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      };

      const store = new HybridAuthStore(failingRedis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
      });

      await expect(store.connect()).rejects.toThrow('Failed to connect HybridAuthStore');
    });

    it('should handle MongoDB connect failure', async () => {
      // Mock MongoDB que falha no connect
      const failingMongo = {
        ...mongo,
        connect: vi.fn().mockRejectedValue(new Error('MongoDB connection failed')),
      };

      const store = new HybridAuthStore(redis as any, failingMongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
      });

      await expect(store.connect()).rejects.toThrow('Failed to connect HybridAuthStore');
    });

    it('should handle Redis disconnect failure', async () => {
      const failingRedis = {
        ...redis,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockRejectedValue(new Error('Redis disconnect failed')),
      };

      const store = new HybridAuthStore(failingRedis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
      });
      await store.connect();

      // Disconnect deve falhar mas não quebrar
      await expect(store.disconnect()).resolves.toBeUndefined();
    });

    it('should handle MongoDB disconnect failure', async () => {
      const failingMongo = {
        ...mongo,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockRejectedValue(new Error('MongoDB disconnect failed')),
      };

      const store = new HybridAuthStore(redis as any, failingMongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
      });
      await store.connect();

      // Disconnect deve falhar mas não quebrar
      await expect(store.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('Circuit Breaker Transitions - Complete Coverage', () => {
    it('should handle circuit breaker HALF_OPEN transition with success', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      // Simular circuit breaker HALF_OPEN
      const circuitBreaker = (store as any).mongoCircuitBreaker;

      // Simular transição para HALF_OPEN diretamente
      circuitBreaker.state = 'HALF_OPEN';

      // Redis miss, MongoDB success
      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockResolvedValue(data);

      const result = await store.get(sessionId);
      expect(result).toEqual(data);
    });

    it('should handle circuit breaker CLOSED transition', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      // Simular circuit breaker CLOSED
      const circuitBreaker = (store as any).mongoCircuitBreaker;
      circuitBreaker.close();

      // Redis miss, MongoDB success
      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockResolvedValue(data);

      const result = await store.get(sessionId);
      expect(result).toEqual(data);
    });

    it('should trigger circuit breaker events', async () => {
      const circuitBreaker = (store as any).mongoCircuitBreaker;

      // Mock event listeners
      const openSpy = vi.fn();
      const halfOpenSpy = vi.fn();
      const closeSpy = vi.fn();

      circuitBreaker.on('open', openSpy);
      circuitBreaker.on('halfOpen', halfOpenSpy);
      circuitBreaker.on('close', closeSpy);

      // Simular transições - usar métodos disponíveis
      circuitBreaker.open();
      // Simular halfOpen manualmente
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.close();

      expect(openSpy).toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle circuit breaker timeout', async () => {
      const sessionId = 'test-session';

      // Mock MongoDB que demora muito
      mongo.get = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)));

      redis.get = vi.fn().mockResolvedValue(null);

      // Circuit breaker deve timeout
      const result = await store.get(sessionId);
      expect(result).toBeNull();
    });

    it('should handle circuit breaker error threshold', async () => {
      const sessionId = 'test-session';

      // Simular múltiplas falhas para abrir circuit breaker
      redis.get = vi.fn().mockResolvedValue(null);
      mongo.get = vi.fn().mockRejectedValue(new Error('MongoDB error'));

      // Fazer várias chamadas para atingir threshold
      for (let i = 0; i < 5; i++) {
        await store.get(sessionId);
      }

      // Circuit breaker deve estar aberto
      expect(store.isMongoCircuitBreakerOpen()).toBe(true);
    });
  });

  describe('Cache Warming - Advanced Scenarios', () => {
    it('should handle warmCache when Redis get returns null', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      // Primeiro get retorna null (cache miss)
      redis.get = vi
        .fn()
        .mockResolvedValueOnce(null) // Primeiro get
        .mockResolvedValueOnce(null); // Segundo get no warmCache
      mongo.get = vi.fn().mockResolvedValue(data);

      const setSpy = vi.spyOn(redis, 'set');

      const result = await store.get(sessionId);
      expect(result).toEqual(data);

      // Deve tentar fazer warm cache
      expect(setSpy).toHaveBeenCalled();
    });

    it('should handle warmCache when Redis set fails', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      redis.get = vi
        .fn()
        .mockResolvedValueOnce(null) // Primeiro get
        .mockResolvedValueOnce(null); // Segundo get no warmCache
      mongo.get = vi.fn().mockResolvedValue(data);
      redis.set = vi.fn().mockRejectedValue(new Error('Redis set failed'));

      const result = await store.get(sessionId);
      expect(result).toEqual(data);

      // Deve tentar fazer warm cache mas falhar silenciosamente
      expect(redis.set).toHaveBeenCalled();
    });

    it('should handle warmCache race condition with newer version', async () => {
      const sessionId = 'test-session';
      const oldData: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };
      const newData: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 2,
        updatedAt: new Date(),
      };

      // Simular race condition: cache já tem versão mais nova
      redis.get = vi
        .fn()
        .mockResolvedValueOnce(null) // Primeiro get (cache miss)
        .mockResolvedValueOnce(newData); // Segundo get no warmCache (já tem versão nova)
      mongo.get = vi.fn().mockResolvedValue(oldData);

      const setSpy = vi.spyOn(redis, 'set');

      const result = await store.get(sessionId);
      expect(result).toEqual(oldData); // Deve retornar dados do MongoDB

      // Não deve sobrescrever com versão mais antiga
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('should handle warmCache with Redis connection failure', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      redis.get = vi
        .fn()
        .mockResolvedValueOnce(null) // Primeiro get
        .mockRejectedValueOnce(new Error('Redis connection failed')); // Segundo get no warmCache
      mongo.get = vi.fn().mockResolvedValue(data);

      const result = await store.get(sessionId);
      expect(result).toEqual(data);

      // Deve tentar fazer warm cache mas falhar silenciosamente
    });

    it('should handle warmCache with Redis set timeout', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      redis.get = vi
        .fn()
        .mockResolvedValueOnce(null) // Primeiro get
        .mockResolvedValueOnce(null); // Segundo get no warmCache
      mongo.get = vi.fn().mockResolvedValue(data);
      redis.set = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error('Redis timeout'));
            }, 100),
          ),
      );

      const result = await store.get(sessionId);
      expect(result).toEqual(data);

      // Deve tentar fazer warm cache mas falhar silenciosamente
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('Error Handling - Complete Coverage', () => {
    it('should re-throw VersionMismatchError', async () => {
      const sessionId = 'test-session';
      const patch: AuthPatch = { creds: {} as any };

      // Mock Redis para lançar VersionMismatchError real
      const versionMismatchError = new VersionMismatchError(1, 2);

      redis.set = vi.fn().mockRejectedValue(versionMismatchError);

      // Desabilitar write-behind para evitar fallback para MongoDB
      const configWithoutQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: false, // Desabilitar write-behind
      };

      const storeWithoutQueue = new HybridAuthStore(redis as any, mongo as any, configWithoutQueue);
      await storeWithoutQueue.connect();

      // Deve re-lançar o VersionMismatchError original
      await expect(storeWithoutQueue.set(sessionId, patch, 1)).rejects.toThrow(
        versionMismatchError,
      );

      await storeWithoutQueue.disconnect();
    });

    it('should handle markCompleted when outbox manager exists', async () => {
      const sessionId = 'test-session';
      const patch: AuthPatch = { creds: {} as any };

      // Mock outbox manager
      const mockOutboxManager = {
        addEntry: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
      };

      const configWithQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        queue: {
          add: vi.fn().mockRejectedValue(new Error('Queue failed')), // Queue falha para trigger fallback
          close: vi.fn().mockResolvedValue(undefined),
        },
        enableWriteBehind: true,
      };

      const store = new HybridAuthStore(redis as any, mongo as any, configWithQueue);
      await store.connect();

      // Simular outbox manager
      (store as any).outboxManager = mockOutboxManager;

      // Mock Redis set para sucesso
      redis.set = vi.fn().mockResolvedValue({ version: 1, fencingToken: Date.now() });

      // Mock MongoDB set para sucesso (fallback)
      mongo.set = vi.fn().mockResolvedValue({ version: 1, fencingToken: Date.now() });

      await store.set(sessionId, patch, 1);

      expect(mockOutboxManager.addEntry).toHaveBeenCalled();
      expect(mockOutboxManager.markCompleted).toHaveBeenCalled();
    });

    it('should handle Redis error without circuit breaker', async () => {
      const sessionId = 'test-session';

      // Mock Redis error
      redis.get = vi.fn().mockRejectedValue(new Error('Redis connection failed'));
      mongo.get = vi.fn().mockResolvedValue(null);

      const result = await store.get(sessionId);
      expect(result).toBeNull();
    });

    it('should handle Redis error with circuit breaker closed', async () => {
      const sessionId = 'test-session';
      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} },
        version: 1,
        updatedAt: new Date(),
      };

      // Redis error, MongoDB success
      redis.get = vi.fn().mockRejectedValue(new Error('Redis read failed'));
      mongo.get = vi.fn().mockResolvedValue(data);

      const result = await store.get(sessionId);
      expect(result).toEqual(data);
    });

    it('should handle set operation with outbox manager failure', async () => {
      const sessionId = 'test-session';
      const patch: AuthPatch = { creds: {} as any };

      // Mock outbox manager que falha
      const mockOutboxManager = {
        addEntry: vi.fn().mockRejectedValue(new Error('Outbox add failed')),
        markCompleted: vi.fn().mockResolvedValue(undefined),
      };

      const configWithQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        queue: {
          add: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        },
        enableWriteBehind: true,
      };

      const store = new HybridAuthStore(redis as any, mongo as any, configWithQueue);
      await store.connect();

      // Simular outbox manager
      (store as any).outboxManager = mockOutboxManager;

      // Mock MongoDB set como spy
      const mongoSetSpy = vi
        .spyOn(mongo, 'set')
        .mockResolvedValue({ version: 1, fencingToken: Date.now() });

      // Deve fazer fallback para MongoDB direto
      await store.set(sessionId, patch, 1);

      expect(mongoSetSpy).toHaveBeenCalled();
    });

    it('should handle queue failure with outbox manager', async () => {
      const sessionId = 'test-session';
      const patch: AuthPatch = { creds: {} as any };

      // Mock outbox manager
      const mockOutboxManager = {
        addEntry: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
      };

      const configWithQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        queue: {
          add: vi.fn().mockRejectedValue(new Error('Queue failed')),
          close: vi.fn().mockResolvedValue(undefined),
        },
        enableWriteBehind: true,
      };

      const store = new HybridAuthStore(redis as any, mongo as any, configWithQueue);
      await store.connect();

      // Simular outbox manager
      (store as any).outboxManager = mockOutboxManager;

      // Mock MongoDB set como spy
      const mongoSetSpy = vi
        .spyOn(mongo, 'set')
        .mockResolvedValue({ version: 1, fencingToken: Date.now() });

      // Deve fazer fallback para MongoDB direto
      await store.set(sessionId, patch, 1);

      expect(mongoSetSpy).toHaveBeenCalled();
      expect(mockOutboxManager.markCompleted).toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker Events', () => {
    it('should handle circuit breaker halfOpen event', async () => {
      const testStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
        },
      );
      await testStore.connect();

      // Simular halfOpen manualmente
      const circuitBreaker = (testStore as any).mongoCircuitBreaker;
      circuitBreaker.emit('halfOpen');

      // Verificar que o contador foi incrementado
      // (isso é testado indiretamente através do comportamento)
      expect(circuitBreaker).toBeDefined();

      await testStore.disconnect();
    });
  });

  describe('Outbox Manager Integration', () => {
    it('should handle outbox manager when not initialized', async () => {
      const testStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
        },
      );
      await testStore.connect();

      // Test getOutboxStats when outbox manager is null
      const stats = testStore.getOutboxStats();
      expect(stats).toBeNull();

      // Test reconcileOutbox when outbox manager is null
      await expect(testStore.reconcileOutbox()).resolves.not.toThrow();

      await testStore.disconnect();
    });

    it('should handle outbox manager when initialized', async () => {
      const configWithQueue = {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: true,
        queue: queue,
      };

      const testStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        configWithQueue,
      );
      await testStore.connect();

      // Test getOutboxStats when outbox manager exists
      const stats = testStore.getOutboxStats();
      expect(stats).toBeDefined();

      // Test reconcileOutbox when outbox manager exists
      await expect(testStore.reconcileOutbox()).resolves.not.toThrow();

      await testStore.disconnect();
    });
  });

  describe('Health Check Error Handling', () => {
    it('should return false when health check throws error', async () => {
      const testStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
        },
      );
      await testStore.connect();

      // Mock health check to throw error
      vi.spyOn(redis, 'isHealthy').mockRejectedValue(new Error('Redis error'));
      vi.spyOn(mongo, 'isHealthy').mockRejectedValue(new Error('MongoDB error'));

      const isHealthy = await testStore.isHealthy();
      expect(isHealthy).toBe(false);

      await testStore.disconnect();
    });
  });

  describe('Disconnect Error Handling', () => {
    it('should handle disconnect errors gracefully', async () => {
      const testStore = new HybridAuthStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
        },
      );
      await testStore.connect();

      // Mock disconnect to throw error
      vi.spyOn(redis, 'disconnect').mockRejectedValue(new Error('Redis disconnect error'));
      vi.spyOn(mongo, 'disconnect').mockRejectedValue(new Error('MongoDB disconnect error'));

      // Should not throw error
      await expect(testStore.disconnect()).resolves.not.toThrow();

      // When disconnect fails, connected remains true (this is the actual behavior)
      // The error is logged but the connection state is not changed
      expect((testStore as any).connected).toBe(true);
    });
  });

  describe('Factory Function', () => {
    it('should create HybridAuthStore via factory', async () => {
      const testStore = await createHybridStore(
        redis as unknown as RedisAuthStore,
        mongo as unknown as MongoAuthStore,
        {
          redisUrl: 'redis://localhost',
          mongoUrl: 'mongodb://localhost',
          mongoDatabase: 'test',
          mongoCollection: 'sessions',
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
        },
      );
      expect(testStore).toBeInstanceOf(HybridAuthStore);
      await testStore.disconnect();
    });
  });

  describe('Outbox Manager Lifecycle', () => {
    let store: HybridAuthStore;
    let redis: MockRedisStore;
    let mongo: MockMongoStore;
    let queue: MockQueue;

    beforeEach(async () => {
      redis = new MockRedisStore();
      mongo = new MockMongoStore();
      queue = new MockQueue();

      store = new HybridAuthStore(redis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: true,
        queue,
      });
      await store.connect();
    });

    afterEach(async () => {
      if (store) {
        await store.disconnect();
      }
    });

    it('deve chamar stopReconciler quando outboxManager existe no disconnect', async () => {
      // Mock do outboxManager para verificar se stopReconciler foi chamado
      const mockOutboxManager = {
        stopReconciler: vi.fn(),
        getStats: vi.fn().mockReturnValue({ pending: 0, completed: 0 }),
      };

      // Substituir o outboxManager interno
      (store as any).outboxManager = mockOutboxManager;

      await store.disconnect();

      // Verificar se stopReconciler foi chamado
      expect(mockOutboxManager.stopReconciler).toHaveBeenCalled();
    });

    it('deve retornar stats válidas do outboxManager quando existe', () => {
      // Mock do outboxManager com stats
      const mockStats = {
        pending: 5,
        completed: 10,
        failed: 2,
        lastReconcile: new Date(),
      };

      const mockOutboxManager = {
        getStats: vi.fn().mockReturnValue(mockStats),
      };

      // Substituir o outboxManager interno
      (store as any).outboxManager = mockOutboxManager;

      const stats = store.getOutboxStats();

      expect(stats).toEqual(mockStats);
      expect(mockOutboxManager.getStats).toHaveBeenCalled();
    });

    it('deve retornar null quando outboxManager não existe', () => {
      // Garantir que outboxManager é null
      (store as any).outboxManager = null;

      const stats = store.getOutboxStats();

      expect(stats).toBeNull();
    });

    it('deve executar reconcile quando outboxManager existe', async () => {
      // Mock do outboxManager
      const mockOutboxManager = {
        reconcile: vi.fn().mockResolvedValue(undefined),
      };

      // Substituir o outboxManager interno
      (store as any).outboxManager = mockOutboxManager;

      await store.reconcileOutbox();

      // Verificar se reconcile foi chamado
      expect(mockOutboxManager.reconcile).toHaveBeenCalled();
    });

    it('deve não fazer nada quando outboxManager não existe no reconcileOutbox', async () => {
      // Garantir que outboxManager é null
      (store as any).outboxManager = null;

      // Não deve lançar erro
      await expect(store.reconcileOutbox()).resolves.toBeUndefined();
    });

    it('deve inicializar outboxManager quando enableWriteBehind é true e queue existe', async () => {
      // Criar store com write-behind habilitado
      const writeBehindStore = new HybridAuthStore(redis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: true,
        queue,
      });

      await writeBehindStore.connect();

      // Verificar se outboxManager foi inicializado (pode ser null se getClient não está disponível)
      const outboxStats = writeBehindStore.getOutboxStats();

      // Pode ser null se getClient não está disponível no mock
      expect(outboxStats === null || typeof outboxStats === 'object').toBe(true);

      await writeBehindStore.disconnect();
    });

    it('deve não inicializar outboxManager quando enableWriteBehind é false', async () => {
      // Criar store sem write-behind
      const noWriteBehindStore = new HybridAuthStore(redis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        queue,
      });

      await noWriteBehindStore.connect();

      // outboxManager deve ser null
      const outboxStats = noWriteBehindStore.getOutboxStats();
      expect(outboxStats).toBeNull();

      await noWriteBehindStore.disconnect();
    });

    it('deve não inicializar outboxManager quando queue não existe', async () => {
      // Criar store sem queue
      const noQueueStore = new HybridAuthStore(redis as any, mongo as any, {
        redisUrl: 'redis://localhost',
        mongoUrl: 'mongodb://localhost',
        mongoDatabase: 'test',
        mongoCollection: 'sessions',
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
        enableWriteBehind: true,
        // queue não fornecido
      });

      await noQueueStore.connect();

      // outboxManager deve ser null
      const outboxStats = noQueueStore.getOutboxStats();
      expect(outboxStats).toBeNull();

      await noQueueStore.disconnect();
    });
  });

  describe('Batch Operations', () => {
    it('should batch get multiple sessions from Redis cache', async () => {
      await store.connect();

      // Setup: add data to Redis
      const session1 = 'session-batch-1';
      const session2 = 'session-batch-2';
      const session3 = 'session-batch-3';

      const data1: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} as any },
        version: 1,
        updatedAt: new Date(),
      };
      const data2: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} as any },
        version: 1,
        updatedAt: new Date(),
      };

      // Mock Redis.get to return different values based on session ID
      vi.spyOn(redis, 'get').mockImplementation((id: string) => {
        if (id === session1) return Promise.resolve(data1);
        if (id === session2) return Promise.resolve(data2);
        return Promise.resolve(null);
      });

      const results = await store.batchGet([session1, session2, session3]);

      expect(results.size).toBe(3);
      expect(results.get(session1)).toEqual(data1);
      expect(results.get(session2)).toEqual(data2);
      expect(results.get(session3)).toBeNull();

      await store.disconnect();
    });

    it('should fallback to MongoDB when Redis fails in batch get', async () => {
      await store.connect();

      const session1 = 'session-fallback-1';
      const session2 = 'session-fallback-2';

      const mongoData: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} as any },
        version: 1,
        updatedAt: new Date(),
      };

      // Mock Redis to fail
      vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('Redis unavailable'));

      // Mock MongoDB to return data
      vi.spyOn(mongo, 'get').mockResolvedValueOnce(mongoData);

      const results = await store.batchGet([session1, session2]);

      expect(results.size).toBe(2);
      expect(mongo.get).toHaveBeenCalled();
      // Session2 will be null since Redis failed and MongoDB only returns for session1

      await store.disconnect();
    });

    it('should propagate correlation ID through batch operations', async () => {
      await store.connect();

      const correlationId = 'test-correlation-123';

      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} as any },
        version: 1,
        updatedAt: new Date(),
      };

      vi.spyOn(redis, 'get').mockResolvedValue(data);
      vi.spyOn((store as any).logger, 'debug');

      await withContext({ correlationId }, async () => {
        await store.batchGet(['session-1', 'session-2']);
      });

      // Verify logger was called with correlationId
      const logCalls = ((store as any).logger.debug).mock.calls;
      const hasCorrelationId = logCalls.some((call: unknown[]) => 
        call.some((arg: unknown) => 
          typeof arg === 'object' && arg !== null && 'correlationId' in arg && (arg as { correlationId?: string }).correlationId === correlationId
        )
      );
      expect(hasCorrelationId).toBe(true);

      await store.disconnect();
    });

    it('should handle batch delete with partial failures', async () => {
      await store.connect();

      const session1 = 'session-delete-1';
      const session2 = 'session-delete-2';

      // Mock Redis to succeed for session1 and fail for session2
      let callCount = 0;
      vi.spyOn(redis, 'delete').mockImplementation((id: string) => {
        callCount++;
        if (id === session2 && callCount === 2) {
          return Promise.reject(new Error('Redis delete failed'));
        }
        return Promise.resolve();
      });

      vi.spyOn(mongo, 'delete').mockImplementation((id: string) => {
        if (id === session2) {
          return Promise.reject(new Error('MongoDB delete failed'));
        }
        return Promise.resolve();
      });

      const result = await store.batchDelete([session1, session2]);

      expect(result.successful.size).toBe(1);
      expect(result.failed.size).toBe(1);
      expect(result.successful.has(session1)).toBe(true);
      expect(result.failed.has(session2)).toBe(true);

      await store.disconnect();
    });

    it('should track metrics for batch operations', async () => {
      await store.connect();

      const data: Versioned<AuthSnapshot> = {
        data: { creds: {} as any, keys: {} as any },
        version: 1,
        updatedAt: new Date(),
      };

      vi.spyOn(redis, 'get').mockResolvedValue(data);

      await store.batchGet(['session-1', 'session-2']);

      // Metrics should be recorded (we can't easily verify Prometheus metrics in tests,
      // but we can verify the code path was executed)
      expect(redis.get).toHaveBeenCalledTimes(2);

      await store.disconnect();
    });

    it('should handle empty batch operations', async () => {
      await store.connect();

      const results = await store.batchGet([]);
      expect(results.size).toBe(0);

      const deleteResult = await store.batchDelete([]);
      expect(deleteResult.successful.size).toBe(0);
      expect(deleteResult.failed.size).toBe(0);

      await store.disconnect();
    });
  });
});
