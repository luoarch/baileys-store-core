import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageError } from '../../types';

// Mock pipeline commands collector
const createMockPipeline = () => {
  const commands: { method: string; args: unknown[] }[] = [];
  const pipeline = {
    setex: (...args: unknown[]) => {
      commands.push({ method: 'setex', args });
      return pipeline;
    },
    exec: vi.fn().mockResolvedValue(commands.map(() => [null, 'OK'])),
  };
  return pipeline;
};

// Mock do ioredis com comportamento real
const mockRedisClient = {
  ping: vi.fn(),
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
  expire: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  emit: vi.fn(),
  pipeline: vi.fn().mockImplementation(createMockPipeline),
};

// Mock do ioredis constructor
vi.mock('ioredis', () => {
  const MockRedis = function () {
    return mockRedisClient;
  };
  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

// Import after mock
import { RedisAuthStore, createRedisStore } from '../../redis/store';

describe('RedisAuthStore - Integration Tests', () => {
  let store: RedisAuthStore;
  const mockCrypto = {
    encrypt: vi.fn().mockResolvedValue({
      ciphertext: Buffer.from('encrypted-data'),
      nonce: Buffer.from('nonce-data'),
      keyId: 'test-key-id',
      schemaVersion: 1,
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }),
    decrypt: vi.fn().mockResolvedValue(Buffer.from('decrypted-data')),
  } as any;

  const mockCodec = {
    encode: vi.fn().mockResolvedValue(Buffer.from('encoded-data')),
    decode: vi.fn().mockResolvedValue({
      creds: { registrationId: 12345, noiseKey: {}, signedIdentityKey: {} },
      keys: { 'app-state-sync-key': { key1: { id: 'key1', data: Buffer.from('test') } } },
      version: 1,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }),
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

    // Setup default mock behaviors
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.setex.mockResolvedValue('OK');
    mockRedisClient.del.mockResolvedValue(1);
    mockRedisClient.exists.mockResolvedValue(0);
    mockRedisClient.expire.mockResolvedValue(1);
    mockRedisClient.quit.mockResolvedValue('OK');
    // Reset pipeline to working implementation
    mockRedisClient.pipeline.mockImplementation(createMockPipeline);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Lifecycle', () => {
    it('deve conectar com sucesso', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await store.connect();

      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('deve falhar na conexão e lançar StorageError', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Connection failed'));

      await expect(store.connect()).rejects.toThrow(StorageError);
    });

    it('deve desconectar com sucesso', async () => {
      // Simular conexão primeiro
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      await store.disconnect();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('deve lidar com erro ao desconectar', async () => {
      mockRedisClient.quit.mockRejectedValue(new Error('Disconnect failed'));

      // Não deve lançar erro, apenas logar
      await expect(store.disconnect()).resolves.toBeUndefined();
    });

    it('deve testar retry strategy com exponential backoff', () => {
      const config = {
        ...baseConfig,
        resilience: {
          maxRetries: 3,
          retryBaseDelay: 1000,
          retryMultiplier: 2,
          operationTimeout: 5000,
        },
      };

      const retryStore = new RedisAuthStore(config, mockCrypto, mockCodec);
      expect(retryStore).toBeDefined();
    });

    it('deve testar eventos do cliente Redis', () => {
      const onSpy = vi.spyOn(mockRedisClient, 'on');

      new RedisAuthStore(baseConfig, mockCrypto, mockCodec);

      expect(onSpy).toHaveBeenCalledWith('error', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('Operações CRUD Completas', () => {
    beforeEach(async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();
    });

    it('deve retornar null para session inexistente', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await store.get('non-existent-session');

      expect(result).toBeNull();
    });

    it('deve buscar dados completos com metadata', async () => {
      const mockMeta = JSON.stringify({
        version: 2,
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const mockEncryptedData = JSON.stringify({
        ciphertext: 'encrypted-data',
        nonce: 'nonce-data',
        keyId: 'test-key-id',
        schemaVersion: 1,
        timestamp: '2024-01-01T00:00:00Z',
      });

      mockRedisClient.get
        .mockResolvedValueOnce(mockMeta) // metadata
        .mockResolvedValueOnce(mockEncryptedData) // creds
        .mockResolvedValueOnce(mockEncryptedData); // keys

      const result = await store.get('test-session');

      expect(result).toBeDefined();
      expect(result?.version).toBe(2);
      expect(result?.data.creds).toBeDefined();
      expect(result?.data.keys).toBeDefined();
    });

    it('deve lidar com falha de descriptografia retornando null', async () => {
      mockCodec.decode.mockRejectedValue(new Error('Decode failed'));
      mockRedisClient.get.mockResolvedValue('{"invalid": "data"}');

      const result = await store.get('test-session');

      expect(result).toBeNull();
    });

    it('deve salvar apenas creds', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('signature'),
          },
          advSecretKey: 'test-secret',
          me: { id: 'test', name: 'Test' },
          account: { details: 'test' },
          signalIdentities: {},
          myAppStateKeyId: 'test-key',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 1,
          lastAccountSyncTimestamp: Date.now(),
        },
      } as any;

      const result = await store.set('test-session', patch);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      // Now uses pipeline instead of direct setex
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
    });

    it('deve salvar apenas keys', async () => {
      const patch = {
        keys: { 'app-state-sync-key': { key1: { id: 'key1', data: Buffer.from('test') } } },
      };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
    });

    it('deve fazer merge incremental de keys (cenário crítico)', async () => {
      // Primeiro, simular keys existentes
      const existingKeys = {
        keys: {
          'app-state-sync-key': {
            'existing-key': { id: 'existing-key', data: Buffer.from('existing') },
          },
        },
        version: 1,
        updatedAt: new Date(),
      };

      const mockEncryptedData = JSON.stringify({
        ciphertext: 'encrypted-data',
        nonce: 'nonce-data',
        keyId: 'test-key-id',
        schemaVersion: 1,
        timestamp: '2024-01-01T00:00:00Z',
      });

      mockRedisClient.get.mockResolvedValue(mockEncryptedData);
      mockCodec.decode.mockResolvedValue(existingKeys);

      // Patch com novas keys
      const patch = {
        keys: {
          'app-state-sync-key': {
            'new-key': { id: 'new-key', data: Buffer.from('new') },
          },
        },
      };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
      expect(mockCodec.encode).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: expect.objectContaining({
            'app-state-sync-key': expect.objectContaining({
              'existing-key': expect.any(Object),
              'new-key': expect.any(Object),
            }),
          }),
        }),
      );
    });

    it('deve deletar keys quando valor é null/undefined', async () => {
      const existingKeys = {
        keys: {
          'app-state-sync-key': {
            'key-to-delete': { id: 'key-to-delete', data: Buffer.from('data') },
            'key-to-keep': { id: 'key-to-keep', data: Buffer.from('data') },
          },
        },
        version: 1,
        updatedAt: new Date(),
      };

      const mockEncryptedData = JSON.stringify({
        ciphertext: 'encrypted-data',
        nonce: 'nonce-data',
        keyId: 'test-key-id',
        schemaVersion: 1,
        timestamp: '2024-01-01T00:00:00Z',
      });

      mockRedisClient.get.mockResolvedValue(mockEncryptedData);
      mockCodec.decode.mockResolvedValue(existingKeys);

      // Patch deletando uma key
      const patch = {
        keys: {
          'app-state-sync-key': {
            'key-to-delete': null,
          },
        },
      };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
      expect(mockCodec.encode).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: expect.objectContaining({
            'app-state-sync-key': expect.not.objectContaining({
              'key-to-delete': expect.anything(),
            }),
          }),
        }),
      );
    });

    it('deve salvar appState', async () => {
      const patch = {
        appState: { conversations: { chat1: { id: 'chat1', unreadCount: 5 } } },
      };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
    });

    it('deve usar expectedVersion', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('signature'),
          },
          advSecretKey: 'test-secret',
          me: { id: 'test', name: 'Test' },
          account: { details: 'test' },
          signalIdentities: {},
          myAppStateKeyId: 'test-key',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 1,
          lastAccountSyncTimestamp: Date.now(),
        },
      };

      const result = await store.set('test-session', patch as any, 5);

      expect(result.success).toBe(true);
      expect(result.version).toBe(6);
    });

    it('deve deletar todas as chaves', async () => {
      await store.delete('test-session');

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'baileys:auth:test-session:creds',
        'baileys:auth:test-session:keys',
        'baileys:auth:test-session:meta',
      );
    });

    it('deve renovar TTL', async () => {
      await store.touch('test-session');

      expect(mockRedisClient.expire).toHaveBeenCalledTimes(3);
    });

    it('deve renovar TTL com valor customizado', async () => {
      await store.touch('test-session', 3600);

      expect(mockRedisClient.expire).toHaveBeenCalledWith(expect.any(String), 3600);
    });

    it('deve verificar existência', async () => {
      mockRedisClient.exists.mockResolvedValue(1);

      const exists = await store.exists('test-session');

      expect(exists).toBe(true);
      expect(mockRedisClient.exists).toHaveBeenCalledWith('baileys:auth:test-session:creds');
    });

    it('deve retornar false para session inexistente', async () => {
      mockRedisClient.exists.mockResolvedValue(0);

      const exists = await store.exists('non-existent-session');

      expect(exists).toBe(false);
    });

    it('deve verificar health status', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      const healthy = await store.isHealthy();

      expect(healthy).toBe(true);
    });

    it('deve retornar false para health check quando não conectado', async () => {
      // Simular desconexão
      store = new RedisAuthStore(baseConfig, mockCrypto, mockCodec);

      const healthy = await store.isHealthy();

      expect(healthy).toBe(false);
    });

    it('deve retornar false para health check com erro', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Ping failed'));

      const healthy = await store.isHealthy();

      expect(healthy).toBe(false);
    });

    it('deve retornar cliente Redis', () => {
      const client = store.getClient();

      expect(client).toBe(mockRedisClient);
    });
  });

  describe('Cenários de Erro', () => {
    it('deve lançar erro ao tentar operação sem conexão', async () => {
      await expect(store.get('test-session')).rejects.toThrow(StorageError);
      await expect(store.set('test-session', {} as any)).rejects.toThrow(StorageError);
      await expect(store.delete('test-session')).rejects.toThrow(StorageError);
      await expect(store.touch('test-session')).rejects.toThrow(StorageError);
      await expect(store.exists('test-session')).rejects.toThrow(StorageError);
      expect(() => store.getClient()).toThrow(StorageError);
    });

    it('deve lidar com erro no Redis durante get', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      await expect(store.get('test-session')).rejects.toThrow(StorageError);
    });

    it('deve lidar com erro no Redis durante set', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      // Mock pipeline to return error in exec results
      mockRedisClient.pipeline.mockImplementation(() => {
        const pipeline = {
          setex: () => pipeline,
          exec: vi.fn().mockResolvedValue([[new Error('Redis error'), null]]),
        };
        return pipeline;
      });

      await expect(store.set('test-session', { creds: {} } as any)).rejects.toThrow(StorageError);
    });

    it('deve lidar com erro no Redis durante delete', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      await expect(store.delete('test-session')).rejects.toThrow(StorageError);
    });

    it('deve lidar com erro no Redis durante touch', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      mockRedisClient.expire.mockRejectedValue(new Error('Redis error'));

      await expect(store.touch('test-session')).rejects.toThrow(StorageError);
    });

    it('deve lidar com erro no Redis durante exists', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      mockRedisClient.exists.mockRejectedValue(new Error('Redis error'));

      await expect(store.exists('test-session')).rejects.toThrow(StorageError);
    });

    it('deve lidar com erro de criptografia no setField', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      mockCrypto.encrypt.mockRejectedValue(new Error('Encryption failed'));

      await expect(store.set('test-session', { creds: {} } as any)).rejects.toThrow(StorageError);
    });
  });

  describe('Factory Function', () => {
    it('deve criar store via factory function', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      const factoryStore = await createRedisStore(baseConfig, mockCrypto, mockCodec);

      expect(factoryStore).toBeInstanceOf(RedisAuthStore);
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('deve falhar na factory function com erro de conexão', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Connection failed'));

      await expect(createRedisStore(baseConfig, mockCrypto, mockCodec)).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('Configurações Especiais', () => {
    it('deve criar store com TLS', () => {
      const tlsConfig = { ...baseConfig, enableTls: true };
      const tlsStore = new RedisAuthStore(tlsConfig, mockCrypto, mockCodec);

      expect(tlsStore).toBeDefined();
    });

    it('deve criar store com URL Redis', () => {
      const urlConfig = { ...baseConfig, redisUrl: 'redis://localhost:6379' };
      const urlStore = new RedisAuthStore(urlConfig, mockCrypto, mockCodec);

      expect(urlStore).toBeDefined();
    });

    it('deve criar store com configurações customizadas', () => {
      const customConfig = {
        ...baseConfig,
        host: 'custom-host',
        port: 6380,
        password: 'custom-password',
        db: 1,
        ttl: {
          defaultTtl: 3600,
          credsTtl: 1800,
          keysTtl: 900,
          lockTtl: 300,
        },
        resilience: {
          maxRetries: 5,
          retryBaseDelay: 2000,
          retryMultiplier: 1.5,
          operationTimeout: 10000,
        },
      };

      const customStore = new RedisAuthStore(customConfig, mockCrypto, mockCodec);

      expect(customStore).toBeDefined();
    });
  });

  describe('Cobertura de Branches Específicas', () => {
    beforeEach(async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      await store.connect();

      // Reset mocks para evitar interferência
      mockCrypto.encrypt.mockResolvedValue({
        ciphertext: Buffer.from('encrypted-data'),
        nonce: Buffer.from('nonce-data'),
        keyId: 'test-key-id',
        schemaVersion: 1,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });
    });

    it('deve testar branch sem metadata no get', async () => {
      const mockEncryptedData = JSON.stringify({
        ciphertext: 'encrypted-data',
        nonce: 'nonce-data',
        keyId: 'test-key-id',
        schemaVersion: 1,
        timestamp: '2024-01-01T00:00:00Z',
      });

      mockRedisClient.get
        .mockResolvedValueOnce(null) // metadata
        .mockResolvedValueOnce(mockEncryptedData) // creds
        .mockResolvedValueOnce(mockEncryptedData); // keys

      const result = await store.get('test-session');

      expect(result).toBeDefined();
      expect(result?.version).toBe(1); // default version
    });

    it('deve testar branch sem creds ou keys no get', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce('{"version": 1, "updatedAt": "2024-01-01T00:00:00Z"}') // metadata
        .mockResolvedValueOnce(null) // creds
        .mockResolvedValueOnce('{"keys": {}}'); // keys

      const result = await store.get('test-session');

      expect(result).toBeNull();
    });

    it('deve testar branch sem keys no get', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce('{"version": 1, "updatedAt": "2024-01-01T00:00:00Z"}') // metadata
        .mockResolvedValueOnce('{"creds": {}}') // creds
        .mockResolvedValueOnce(null); // keys

      const result = await store.get('test-session');

      expect(result).toBeNull();
    });

    it('deve testar branch sem patch.creds no set', async () => {
      const patch = { keys: { test: { key1: 'value1' } } };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
    });

    it('deve testar branch sem patch.keys nem patch.appState no set', async () => {
      const patch = {
        creds: {
          registrationId: 12345,
          noiseKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedIdentityKey: { public: Buffer.from('test'), private: Buffer.from('test') },
          signedPreKey: {
            keyId: 1,
            keyPair: { public: Buffer.from('test'), private: Buffer.from('test') },
            signature: Buffer.from('signature'),
          },
          advSecretKey: 'test-secret',
          me: { id: 'test', name: 'Test' },
          account: { details: 'test' },
          signalIdentities: {},
          myAppStateKeyId: 'test-key',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 1,
          lastAccountSyncTimestamp: Date.now(),
        },
      };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
    });

    it('deve testar branch com appState no set', async () => {
      const patch = { appState: { conversations: {} } };

      const result = await store.set('test-session', patch as any);

      expect(result.success).toBe(true);
    });
  });
});
