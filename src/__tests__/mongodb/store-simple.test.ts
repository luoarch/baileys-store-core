import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoAuthStore } from '../../mongodb/store';

describe('MongoAuthStore - Simplified Tests', () => {
  let store: MongoAuthStore;
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
    mongoUrl: 'mongodb://localhost:27017',
    databaseName: 'test',
    collectionName: 'auth',
    ttl: {
      defaultTtl: 86400,
      credsTtl: 86400,
      keysTtl: 86400,
      lockTtl: 300,
    },
    resilience: {
      operationTimeout: 5000,
      maxRetries: 3,
      retryBaseDelay: 1000,
      retryMultiplier: 2,
    },
    enableTls: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MongoAuthStore(baseConfig, mockCrypto, mockCodec);
  });

  describe('Construction', () => {
    it('should create store instance', () => {
      expect(store).toBeDefined();
    });

    it('should create store with TLS config', () => {
      const tlsStore = new MongoAuthStore(
        { ...baseConfig, enableTls: true },
        mockCrypto,
        mockCodec,
      );
      expect(tlsStore).toBeDefined();
    });

    it('should create store with custom database name', () => {
      const customDbStore = new MongoAuthStore(
        { ...baseConfig, databaseName: 'custom_db' },
        mockCrypto,
        mockCodec,
      );
      expect(customDbStore).toBeDefined();
    });

    it('should create store with custom collection name', () => {
      const customCollectionStore = new MongoAuthStore(
        { ...baseConfig, collectionName: 'custom_collection' },
        mockCrypto,
        mockCodec,
      );
      expect(customCollectionStore).toBeDefined();
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
    });
  });

  describe('Error Handling Without Connection', () => {
    it('should throw when calling methods without connection', async () => {
      await expect(store.get('test')).rejects.toThrow();
      await expect(store.set('test', {} as any)).rejects.toThrow();
      await expect(store.delete('test')).rejects.toThrow();
      await expect(store.touch('test')).rejects.toThrow();

      const healthy = await store.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should accept custom TTL values', () => {
      const customTtlStore = new MongoAuthStore(
        {
          ...baseConfig,
          ttl: {
            defaultTtl: 3600,
            credsTtl: 7200,
            keysTtl: 1800,
            lockTtl: 600,
          },
        },
        mockCrypto,
        mockCodec,
      );
      expect(customTtlStore).toBeDefined();
    });

    it('should accept custom resilience config', () => {
      const customResilienceStore = new MongoAuthStore(
        {
          ...baseConfig,
          resilience: {
            operationTimeout: 10000,
            maxRetries: 5,
            retryBaseDelay: 2000,
            retryMultiplier: 1.5,
          },
        },
        mockCrypto,
        mockCodec,
      );
      expect(customResilienceStore).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should have factory function available', async () => {
      const { createMongoStore } = await import('../../mongodb');
      expect(typeof createMongoStore).toBe('function');
    });
  });
});
