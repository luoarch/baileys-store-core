import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisAuthStore } from '../../redis/store';

describe('RedisAuthStore - Simplified Tests', () => {
  let store: RedisAuthStore;
  const mockCrypto = {
    encrypt: vi.fn().mockResolvedValue({
      ciphertext: Buffer.from('encrypted'),
      nonce: Buffer.from('nonce'),
      keyId: 'key1',
      schemaVersion: 1,
      timestamp: new Date(),
    }),
    decrypt: vi.fn().mockResolvedValue(Buffer.from('decrypted')),
  } as any;

  const mockCodec = {
    encode: vi.fn().mockResolvedValue(Buffer.from('encoded')),
    decode: vi.fn().mockResolvedValue({ creds: {}, keys: {}, version: 1 }),
  } as any;

  const baseConfig = {
    host: 'localhost',
    port: 6379,
    ttl: { defaultTtl: 86400, credsTtl: 86400, keysTtl: 86400, lockTtl: 300 },
    resilience: { maxRetries: 3, retryBaseDelay: 1000, retryMultiplier: 2, operationTimeout: 5000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisAuthStore(baseConfig, mockCrypto, mockCodec);
  });

  describe('Construction', () => {
    it('should create store instance', () => {
      expect(store).toBeDefined();
    });

    it('should create store with TLS config', () => {
      const tlsStore = new RedisAuthStore(
        { ...baseConfig, enableTls: true },
        mockCrypto,
        mockCodec,
      );
      expect(tlsStore).toBeDefined();
    });

    it('should create store with URL', () => {
      const urlStore = new RedisAuthStore(
        { ...baseConfig, redisUrl: 'redis://localhost:6379' },
        mockCrypto,
        mockCodec,
      );
      expect(urlStore).toBeDefined();
    });
  });

  describe('Methods Existence', () => {
    it('should have all required methods', () => {
      expect(typeof store.connect).toBe('function');
      expect(typeof store.disconnect).toBe('function');
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.delete).toBe('function');
      expect(typeof store.touch).toBe('function');
      expect(typeof store.exists).toBe('function');
      expect(typeof store.isHealthy).toBe('function');
      expect(typeof store.getClient).toBe('function');
    });
  });

  describe('Error Handling Without Connection', () => {
    it('should throw when calling methods without connection', async () => {
      await expect(store.get('test')).rejects.toThrow();
      await expect(store.set('test', {} as any)).rejects.toThrow();
      await expect(store.delete('test')).rejects.toThrow();
      await expect(store.touch('test')).rejects.toThrow();
      await expect(store.exists('test')).rejects.toThrow();
      expect(() => store.getClient()).toThrow();
    });

    it('should return false for isHealthy when not connected', async () => {
      const healthy = await store.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should accept custom TTL values', () => {
      const customTtlStore = new RedisAuthStore(
        {
          ...baseConfig,
          ttl: {
            defaultTtl: 3600,
            credsTtl: 1800,
            keysTtl: 900,
            lockTtl: 300,
          },
        },
        mockCrypto,
        mockCodec,
      );
      expect(customTtlStore).toBeDefined();
    });

    it('should accept custom resilience config', () => {
      const customResilienceStore = new RedisAuthStore(
        {
          ...baseConfig,
          resilience: {
            maxRetries: 5,
            retryBaseDelay: 2000,
            retryMultiplier: 1.5,
            operationTimeout: 10000,
          },
        },
        mockCrypto,
        mockCodec,
      );
      expect(customResilienceStore).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should create store via factory function', async () => {
      const { createRedisStore } = await import('../../redis');
      const factoryStore = await createRedisStore(baseConfig, mockCrypto, mockCodec);
      expect(factoryStore).toBeDefined();
      expect(factoryStore).toBeInstanceOf(RedisAuthStore);
    });
  });
});
