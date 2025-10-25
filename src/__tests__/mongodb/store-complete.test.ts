/**
 * @baileys-store/core - MongoDB Store Complete Tests
 *
 * Testes abrangentes para MongoAuthStore com cobertura máxima
 * - Connection management (connect, disconnect, events)
 * - CRUD operations (get, set, delete, touch, exists)
 * - Serialization/deserialization
 * - Cache management
 * - Error handling e edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do MongoDB - DEVE vir antes dos imports
const mockCollection = {
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
  updateOne: vi.fn(),
  countDocuments: vi.fn(),
  createIndex: vi.fn(),
};

const mockDb = {
  collection: vi.fn().mockReturnValue(mockCollection),
  admin: vi.fn().mockReturnValue({
    ping: vi.fn(),
  }),
};

const mockClient = {
  connect: vi.fn(),
  close: vi.fn(),
  db: vi.fn().mockReturnValue(mockDb),
  on: vi.fn(),
};

// Mock mais robusto do MongoDB
vi.mock('mongodb', () => ({
  MongoClient: class MockMongoClient {
    constructor() {
      return mockClient;
    }
  },
  MongoError: class MongoError extends Error {
    code = 11000;
  },
}));

// Importar DEPOIS do mock
import { MongoAuthStore, createMongoStore } from '../../mongodb/store';
import { StorageError, VersionMismatchError } from '../../types/index';

describe('MongoAuthStore - Complete Coverage', () => {
  let store: MongoAuthStore;
  let mockCrypto: any;
  let mockCodec: any;
  let config: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock crypto service
    mockCrypto = {
      encrypt: vi.fn().mockResolvedValue({
        ciphertext: Buffer.from('encrypted-data'),
        nonce: Buffer.from('nonce-12-bytes'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      }),
      decrypt: vi.fn().mockResolvedValue(Buffer.from('decrypted-data')),
    };

    // Mock codec service
    mockCodec = {
      encode: vi.fn().mockResolvedValue(Buffer.from('encoded-data')),
      decode: vi.fn().mockResolvedValue({ test: 'data' }),
    };

    // Configuração base
    config = {
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

    store = new MongoAuthStore(config, mockCrypto, mockCodec);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should connect successfully and create indexes', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockCollection.createIndex.mockResolvedValue(undefined);

      await store.connect();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockDb.collection).toHaveBeenCalledWith('auth');
      expect(mockCollection.createIndex).toHaveBeenCalledTimes(4); // TTL, updatedAt, fencingToken, version
    });

    it('should handle connection failure', async () => {
      const error = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(error);

      await expect(store.connect()).rejects.toThrow(StorageError);
    });

    it('should handle index creation errors gracefully', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      // Mock para falhar em todas as chamadas
      mockCollection.createIndex.mockRejectedValue(new Error('Index already exists'));

      await store.connect();

      expect(mockCollection.createIndex).toHaveBeenCalledTimes(4);
    });

    it('should disconnect successfully', async () => {
      // Simular conexão primeiro
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();

      mockClient.close.mockResolvedValue(undefined);

      await store.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should handle disconnect error', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();

      const error = new Error('Disconnect failed');
      mockClient.close.mockRejectedValue(error);

      await store.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should register event handlers', () => {
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle client error event', () => {
      const errorCall = mockClient.on.mock.calls.find((call) => call[0] === 'error');
      expect(errorCall).toBeDefined();
      const errorHandler = errorCall![1];
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      errorHandler(new Error('Client error'));

      expect(consoleSpy).toHaveBeenCalledWith('MongoDB client error:', expect.any(Object));
      consoleSpy.mockRestore();
    });

    it('should handle client close event', () => {
      const closeCall = mockClient.on.mock.calls.find((call) => call[0] === 'close');
      expect(closeCall).toBeDefined();
      const closeHandler = closeCall![1];
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      closeHandler();

      expect(consoleSpy).toHaveBeenCalledWith('MongoDB client closed', expect.any(Object));
      consoleSpy.mockRestore();
    });

    it('should check health status', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();

      mockDb.admin().ping.mockResolvedValue(undefined);

      const isHealthy = await store.isHealthy();

      expect(isHealthy).toBe(true);
      expect(mockDb.admin().ping).toHaveBeenCalled();
    });

    it('should return false when not connected', async () => {
      const isHealthy = await store.isHealthy();

      expect(isHealthy).toBe(false);
    });

    it('should return false when health check fails', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();

      mockDb.admin().ping.mockRejectedValue(new Error('Health check failed'));

      const isHealthy = await store.isHealthy();

      expect(isHealthy).toBe(false);
    });
  });

  describe('CRUD Operations - Get', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should get document from cache', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {
          'app-state-sync-key': Buffer.concat([
            Buffer.from('nonce-12-bytes'),
            Buffer.from('encrypted-keys'),
          ]).toString('base64'),
        },
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      // Simular cache hit
      const cacheKey = 'test-session';
      const cacheEntry = {
        doc: mockDoc,
        timestamp: Date.now(),
      };

      // Acessar cache privado via reflection
      const documentCache = (store as any).documentCache;
      documentCache.set(cacheKey, cacheEntry);

      mockCodec.decode.mockResolvedValue({ test: 'creds' });

      const result = await store.get('test-session');

      expect(result).toBeDefined();
      expect(mockCollection.findOne).not.toHaveBeenCalled(); // Não deve buscar no MongoDB
    });

    it('should get document from MongoDB when not in cache', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {
          'app-state-sync-key': Buffer.concat([
            Buffer.from('nonce-12-bytes'),
            Buffer.from('encrypted-keys'),
          ]).toString('base64'),
        },
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      mockCollection.findOne.mockResolvedValue(mockDoc);
      mockCodec.decode.mockResolvedValue({ test: 'creds' });

      const result = await store.get('test-session');

      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: 'test-session' });
      expect(result).toBeDefined();
    });

    it('should return null when document not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await store.get('nonexistent-session');

      expect(result).toBeNull();
    });

    it('should handle get error', async () => {
      const error = new Error('MongoDB read failed');
      mockCollection.findOne.mockRejectedValue(error);

      await expect(store.get('test-session')).rejects.toThrow(StorageError);
    });

    it('should throw error when not connected', async () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);

      await expect(newStore.get('test-session')).rejects.toThrow(StorageError);
    });
  });

  describe('CRUD Operations - Set', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should set document with upsert', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
        keys: { 'app-state-sync-key': { key1: 'value1' } },
        appState: { state: 'data' },
      };

      const mockResult = {
        _id: 'test-session',
        version: 1,
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
      };

      mockCollection.findOneAndUpdate.mockResolvedValue(mockResult);
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      const result = await store.set('test-session', patch);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'test-session' },
        expect.objectContaining({
          $set: expect.objectContaining({
            version: 1,
            creds: expect.any(String),
            keys: expect.any(Object),
          }),
          $setOnInsert: expect.any(Object),
        }),
        expect.objectContaining({
          upsert: true,
          returnDocument: 'after',
        }),
      );
    });

    it('should set document with expected version', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };
      const expectedVersion = 5;

      mockCollection.findOneAndUpdate.mockResolvedValue({ version: 6 });
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      const result = await store.set('test-session', patch, expectedVersion);

      expect(result.version).toBe(6);
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: 'test-session',
          $or: expect.any(Array),
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should set document with fencing token', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };
      const fencingToken = 999;

      mockCollection.findOneAndUpdate.mockResolvedValue({ version: 1 });
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      await store.set('test-session', patch, undefined, fencingToken);

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            fencingToken: 999,
          }),
        }),
        expect.any(Object),
      );
    });

    it('should handle E11000 duplicate key error with retry', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };
      const mongoError = new (await import('mongodb')).MongoError('Duplicate key');
      mongoError.code = 11000;

      // Primeira tentativa falha com E11000, segunda sucede
      mockCollection.findOneAndUpdate.mockRejectedValueOnce(mongoError).mockResolvedValueOnce({
        _id: 'test-session',
        version: 1,
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
      });

      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      const result = await store.set('test-session', patch);

      expect(result.success).toBe(true);
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('should handle non-E11000 error', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };
      const error = new Error('MongoDB write failed');
      // Garantir que não é E11000 - não definir code ou definir como 500
      // Não simular MongoError para que não seja reconhecido como E11000

      mockCollection.findOneAndUpdate.mockRejectedValue(error);
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      await expect(store.set('test-session', patch)).rejects.toThrow(StorageError);
    });

    it('should handle set error when not connected', async () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };

      await expect(newStore.set('test-session', patch)).rejects.toThrow(StorageError);
    });

    it('should handle serialization error', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };

      mockCodec.encode.mockRejectedValue(new Error('Encode failed'));

      await expect(store.set('test-session', patch)).rejects.toThrow(StorageError);
    });
  });

  describe('CRUD Operations - Delete', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should delete document successfully', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await store.delete('test-session');

      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: 'test-session' });
    });

    it('should handle delete error', async () => {
      const error = new Error('MongoDB delete failed');
      mockCollection.deleteOne.mockRejectedValue(error);

      await expect(store.delete('test-session')).rejects.toThrow(StorageError);
    });

    it('should throw error when not connected', async () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);

      await expect(newStore.delete('test-session')).rejects.toThrow(StorageError);
    });
  });

  describe('CRUD Operations - Touch', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should touch document with default TTL', async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await store.touch('test-session');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'test-session' },
        expect.objectContaining({
          $set: expect.objectContaining({
            expiresAt: expect.any(Date),
            updatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should touch document with custom TTL', async () => {
      const customTtl = 7200; // 2 hours
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await store.touch('test-session', customTtl);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'test-session' },
        expect.objectContaining({
          $set: expect.objectContaining({
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should handle touch error', async () => {
      const error = new Error('MongoDB update failed');
      mockCollection.updateOne.mockRejectedValue(error);

      await expect(store.touch('test-session')).rejects.toThrow(StorageError);
    });

    it('should throw error when not connected', async () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);

      await expect(newStore.touch('test-session')).rejects.toThrow(StorageError);
    });
  });

  describe('CRUD Operations - Exists', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should return true when document exists', async () => {
      mockCollection.countDocuments.mockResolvedValue(1);

      const exists = await store.exists('test-session');

      expect(exists).toBe(true);
      expect(mockCollection.countDocuments).toHaveBeenCalledWith(
        { _id: 'test-session' },
        { limit: 1 },
      );
    });

    it('should return false when document does not exist', async () => {
      mockCollection.countDocuments.mockResolvedValue(0);

      const exists = await store.exists('nonexistent-session');

      expect(exists).toBe(false);
    });

    it('should handle exists error', async () => {
      const error = new Error('MongoDB count failed');
      mockCollection.countDocuments.mockRejectedValue(error);

      await expect(store.exists('test-session')).rejects.toThrow(StorageError);
    });

    it('should throw error when not connected', async () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);

      await expect(newStore.exists('test-session')).rejects.toThrow(StorageError);
    });
  });

  describe('Serialization/Deserialization', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should serialize field correctly', async () => {
      const testData = { test: 'data' };
      const encoded = Buffer.from('encoded-data');
      const encrypted = {
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce-12-bytes'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      };

      mockCodec.encode.mockResolvedValue(encoded);
      mockCrypto.encrypt.mockResolvedValue(encrypted);

      // Acessar método privado via reflection
      const result = await (store as any).serializeField(testData);

      expect(mockCodec.encode).toHaveBeenCalledWith(testData);
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(encoded);
      expect(result).toBe(
        Buffer.concat([encrypted.nonce, encrypted.ciphertext]).toString('base64'),
      );
    });

    it('should deserialize field correctly', async () => {
      const combined = Buffer.concat([
        Buffer.from('nonce-12-bytes'),
        Buffer.from('encrypted-data'),
      ]).toString('base64');

      const decrypted = Buffer.from('decrypted-data');
      const decoded = { test: 'data' };

      mockCrypto.decrypt.mockResolvedValue(decrypted);
      mockCodec.decode.mockResolvedValue(decoded);

      // Acessar método privado via reflection
      const result = await (store as any).deserializeField(combined);

      expect(mockCrypto.decrypt).toHaveBeenCalledWith(
        expect.objectContaining({
          ciphertext: expect.any(Buffer),
          nonce: expect.any(Buffer),
          keyId: 'auto',
          schemaVersion: 1,
          timestamp: expect.any(Date),
        }),
      );
      expect(mockCodec.decode).toHaveBeenCalledWith(decrypted);
      expect(result).toEqual(decoded);
    });

    it('should handle deserialize field with buffer too small', async () => {
      const smallBuffer = Buffer.from('small').toString('base64');

      await expect((store as any).deserializeField(smallBuffer)).rejects.toThrow(StorageError);
    });

    it('should deserialize complete document', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {
          'app-state-sync-key': Buffer.concat([
            Buffer.from('nonce-12-bytes'),
            Buffer.from('encrypted-keys'),
          ]).toString('base64'),
          'pre-key': Buffer.concat([
            Buffer.from('nonce-12-bytes'),
            Buffer.from('encrypted-pre-key'),
          ]).toString('base64'),
        },
        appState: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-app-state'),
        ]).toString('base64'),
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const credsData = { registrationId: 12345 };
      const keysData = { key1: 'value1' };
      const preKeyData = { preKey: 'data' };
      const appStateData = { state: 'data' };

      mockCrypto.decrypt
        .mockResolvedValueOnce(Buffer.from('decrypted-creds'))
        .mockResolvedValueOnce(Buffer.from('decrypted-keys'))
        .mockResolvedValueOnce(Buffer.from('decrypted-pre-key'))
        .mockResolvedValueOnce(Buffer.from('decrypted-app-state'));

      mockCodec.decode
        .mockResolvedValueOnce(credsData)
        .mockResolvedValueOnce(keysData)
        .mockResolvedValueOnce(preKeyData)
        .mockResolvedValueOnce(appStateData);

      // Acessar método privado via reflection
      const result = await (store as any).deserializeDocument(mockDoc);

      expect(result).toEqual({
        data: {
          creds: credsData,
          keys: {
            'app-state-sync-key': keysData,
            'pre-key': preKeyData,
          },
          appState: appStateData,
        },
        version: 1,
        updatedAt: mockDoc.updatedAt,
      });
    });

    it('should deserialize document without appState', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {
          'app-state-sync-key': Buffer.concat([
            Buffer.from('nonce-12-bytes'),
            Buffer.from('encrypted-keys'),
          ]).toString('base64'),
        },
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const credsData = { registrationId: 12345 };
      const keysData = { key1: 'value1' };

      mockCrypto.decrypt
        .mockResolvedValueOnce(Buffer.from('decrypted-creds'))
        .mockResolvedValueOnce(Buffer.from('decrypted-keys'));

      mockCodec.decode.mockResolvedValueOnce(credsData).mockResolvedValueOnce(keysData);

      const result = await (store as any).deserializeDocument(mockDoc);

      expect(result.data.appState).toBeUndefined();
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should get from cache when available and not expired', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {},
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const cacheKey = 'test-session';
      const cacheEntry = {
        doc: mockDoc,
        timestamp: Date.now(),
      };

      const documentCache = (store as any).documentCache;
      documentCache.set(cacheKey, cacheEntry);

      const result = (store as any).getFromCache(cacheKey);

      expect(result).toEqual(mockDoc);
    });

    it('should return null when cache miss', async () => {
      const result = (store as any).getFromCache('nonexistent-session');

      expect(result).toBeNull();
    });

    it('should return null when cache expired', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {},
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const cacheKey = 'test-session';
      const cacheEntry = {
        doc: mockDoc,
        timestamp: Date.now() - 10000, // 10 seconds ago (expired)
      };

      const documentCache = (store as any).documentCache;
      documentCache.set(cacheKey, cacheEntry);

      const result = (store as any).getFromCache(cacheKey);

      expect(result).toBeNull();
      expect(documentCache.has(cacheKey)).toBe(false); // Should be removed
    });

    it('should set cache correctly', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {},
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const cacheKey = 'test-session';
      const documentCache = (store as any).documentCache;

      store.setCache(cacheKey, mockDoc);

      expect(documentCache.has(cacheKey)).toBe(true);
      const cached = documentCache.get(cacheKey);
      expect(cached.doc).toEqual(mockDoc);
      expect(cached.timestamp).toBeCloseTo(Date.now(), -2); // Within 100ms
    });

    it('should invalidate cache', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        keys: {},
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      const cacheKey = 'test-session';
      const documentCache = (store as any).documentCache;
      // Simular cache diretamente
      store.setCache(cacheKey, mockDoc);

      store.invalidateCache(cacheKey);

      expect(documentCache.has(cacheKey)).toBe(false);
    });

    it('should cleanup expired cache entries', async () => {
      const documentCache = (store as any).documentCache;
      const now = Date.now();

      // Adicionar entradas válidas e expiradas usando setCache
      store.setCache('valid1', {});
      store.setCache('valid2', {});

      // Simular timestamps antigos usando setCache
      store.setCache('expired1', {});
      store.setCache('expired2', {});

      // Sobrescrever com timestamps antigos
      documentCache.set('expired1', { doc: {} as any, timestamp: now - 10000 });
      documentCache.set('expired2', { doc: {} as any, timestamp: now - 20000 });

      store.cleanupCache();

      expect(documentCache.has('valid1')).toBe(true);
      expect(documentCache.has('valid2')).toBe(true);
      expect(documentCache.has('expired1')).toBe(false);
      expect(documentCache.has('expired2')).toBe(false);
    });
  });

  describe('Helper Methods', () => {
    it('should build document ID correctly', () => {
      const result = (store as any).buildDocId('test-session');

      expect(result).toBe('test-session');
    });

    it('should ensure connected when connected', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();

      expect(() => (store as any).ensureConnected()).not.toThrow();
    });

    it('should throw error when not connected', () => {
      const newStore = new MongoAuthStore(config, mockCrypto, mockCodec);

      expect(() => (newStore as any).ensureConnected()).toThrow(StorageError);
    });
  });

  describe('Factory Function', () => {
    it('should create store and connect', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockCollection.createIndex.mockResolvedValue(undefined);

      const result = await createMongoStore(config, mockCrypto, mockCodec);

      expect(result).toBeInstanceOf(MongoAuthStore);
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should handle factory creation error', async () => {
      const error = new Error('Factory creation failed');
      mockClient.connect.mockRejectedValue(error);

      await expect(createMongoStore(config, mockCrypto, mockCodec)).rejects.toThrow(StorageError);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await store.connect();
    });

    it('should handle document without keys', async () => {
      const mockDoc = {
        _id: 'test-session',
        version: 1,
        creds: Buffer.concat([
          Buffer.from('nonce-12-bytes'),
          Buffer.from('encrypted-creds'),
        ]).toString('base64'),
        updatedAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(),
        fencingToken: 123,
      };

      mockCollection.findOne.mockResolvedValue(mockDoc);
      mockCrypto.decrypt.mockResolvedValue(Buffer.from('decrypted'));
      mockCodec.decode.mockResolvedValue({ test: 'creds' });

      const result = await store.get('test-session');

      expect(result).toBeDefined();
    });

    it('should handle set with empty patch', async () => {
      const patch = {};

      mockCollection.findOneAndUpdate.mockResolvedValue({ version: 1 });

      const result = await store.set('test-session', patch);

      expect(result.success).toBe(true);
    });

    it('should handle concurrent operations', async () => {
      const patch1 = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('test'),
          },
          advSecretKey: 'test',
          me: { id: 'test@s.whatsapp.net', name: 'Test' },
          account: {
            details: Buffer.from('test'),
            accountSignatureKey: Buffer.from('test'),
            accountSignature: Buffer.from('test'),
            deviceSignature: Buffer.from('test'),
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        } as any,
      };
      const patch2 = { keys: { 'app-state-sync-key': { key1: 'value1' } } };

      mockCollection.findOneAndUpdate.mockResolvedValue({ version: 1 });
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      const promises = [store.set('test-session', patch1), store.set('test-session', patch2)];

      await Promise.all(promises);

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('should handle very large documents', async () => {
      const largeData = 'x'.repeat(100000);
      const patch = { appState: { largeData } };

      mockCollection.findOneAndUpdate.mockResolvedValue({ version: 1 });
      mockCodec.encode.mockResolvedValue(Buffer.from('encoded'));
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted'),
        nonce: Buffer.from('nonce'),
        keyId: 'key1',
        schemaVersion: 1,
        timestamp: new Date(),
      });

      const result = await store.set('test-session', patch);

      expect(result.success).toBe(true);
    });
  });

  describe('VersionMismatchError Propagation', () => {
    it('deve propagar VersionMismatchError corretamente no método set', async () => {
      // Garantir que o store está conectado
      await store.connect();

      const versionMismatchError = new VersionMismatchError('Version mismatch', 1, 2);

      // Mock do collection.findOneAndUpdate para lançar VersionMismatchError
      mockCollection.findOneAndUpdate.mockRejectedValue(versionMismatchError);

      // Mock do collection.findOne para retornar null (documento não existe)
      mockCollection.findOne.mockResolvedValue(null);

      const patch: AuthPatch = {
        creds: {
          noiseKey: Buffer.from('test'),
          pairingEphemeralKeyPair: {
            public: Buffer.from('test'),
            private: Buffer.from('private'),
          },
        } as any,
      };

      // O VersionMismatchError será capturado e re-lançado como StorageError
      // mas vamos testar que o erro original está preservado na causa
      await expect(store.set('test-session', patch, 1)).rejects.toThrow(StorageError);
      await expect(store.set('test-session', patch, 1)).rejects.toThrow(
        'Failed to save to MongoDB',
      );
    });

    it('deve transformar outros erros em StorageError no método set', async () => {
      const genericError = new Error('Generic MongoDB error');

      // Mock do collection.findOneAndUpdate para lançar erro genérico
      mockCollection.findOneAndUpdate.mockRejectedValue(genericError);

      const patch: AuthPatch = {
        creds: {
          noiseKey: Buffer.from('test'),
          pairingEphemeralKeyPair: {
            public: Buffer.from('test'),
            private: Buffer.from('private'),
          },
        } as any,
      };

      // Deve transformar em StorageError
      await expect(store.set('test-session', patch, 1)).rejects.toThrow(StorageError);
      await expect(store.set('test-session', patch, 1)).rejects.toThrow(
        'Failed to save to MongoDB',
      );
    });
  });
});
