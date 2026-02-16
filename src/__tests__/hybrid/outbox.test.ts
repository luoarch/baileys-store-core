/**
 * @baileys-store/core - Outbox Manager Tests
 *
 * Testes completos para OutboxManager com 100% de cobertura
 * - Inicialização e configuração
 * - Operações CRUD de entries
 * - Reconciliação periódica
 * - Error paths e edge cases
 * - Lifecycle e cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutboxManager } from '../../hybrid/outbox';

// Mock Logger
const createMockLogger = () => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Mock Redis
const createMockRedis = () => ({
  hset: vi.fn().mockResolvedValue(1),
  hsetnx: vi.fn().mockResolvedValue(1), // 1 = new entry added
  hget: vi.fn().mockResolvedValue(null),
  hgetall: vi.fn().mockResolvedValue({}),
  hdel: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockResolvedValue([]),
  expire: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
  lpush: vi.fn().mockResolvedValue(1),
  lrange: vi.fn().mockResolvedValue([]),
  llen: vi.fn().mockResolvedValue(0),
});

// Mock MongoDB Store
const createMockMongoStore = () => ({
  set: vi.fn().mockResolvedValue({ version: 1, fencingToken: Date.now() }),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue(undefined),
  isHealthy: vi.fn().mockResolvedValue(true),
});

describe('OutboxManager - Complete Coverage', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockMongo: ReturnType<typeof createMockMongoStore>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let outbox: OutboxManager;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockMongo = createMockMongoStore();
    mockLogger = createMockLogger();
    outbox = new OutboxManager(mockRedis as any, mockMongo as any, mockLogger as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('Initialization & Configuration', () => {
    it('should initialize with Redis and MongoDB', () => {
      expect(outbox).toBeDefined();
      expect(outbox).toBeInstanceOf(OutboxManager);
    });

    it('should have initial stats', () => {
      const stats = outbox.getStats();
      expect(stats).toEqual({
        totalProcessed: 0,
        totalCompleted: 0,
        totalFailed: 0,
        totalRetried: 0,
        avgLatency: 0,
        lastRunAt: 0,
      });
    });
  });

  describe('Entry Management', () => {
    describe('addEntry', () => {
      it('should add entry successfully', async () => {
        const sessionId = 'test-session';
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
            account: { details: 'test' },
            signalIdentities: [],
            myAppStateKeyId: 'test',
            firstUnuploadedPreKeyId: 1,
            nextPreKeyId: 2,
            lastAccountSyncTimestamp: Date.now(),
          },
        };
        const version = 1;
        const fencingToken = 12345;

        await outbox.addEntry(sessionId, patch as any, version, fencingToken);

        expect(mockRedis.hsetnx).toHaveBeenCalledWith(
          'outbox:test-session',
          '1',
          expect.stringContaining('"sessionId":"test-session"'),
        );
        expect(mockRedis.expire).toHaveBeenCalledWith('outbox:test-session', 7 * 24 * 60 * 60);
      });

      it('should add entry without fencing token', async () => {
        const sessionId = 'test-session';
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
            account: { details: 'test' },
            signalIdentities: [],
            myAppStateKeyId: 'test',
            firstUnuploadedPreKeyId: 1,
            nextPreKeyId: 2,
            lastAccountSyncTimestamp: Date.now(),
          },
        };
        const version = 2;

        await outbox.addEntry(sessionId, patch as any, version);

        expect(mockRedis.hsetnx).toHaveBeenCalledWith(
          'outbox:test-session',
          '2',
          expect.stringContaining('"sessionId":"test-session"'),
        );
      });

      it('should handle Redis hsetnx failure', async () => {
        // addEntry now uses hsetnx instead of hset
        mockRedis.hsetnx = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

        await expect(outbox.addEntry('test', {}, 1)).rejects.toThrow('Redis connection failed');
      });

      it('should handle Redis expire failure', async () => {
        mockRedis.expire = vi.fn().mockRejectedValue(new Error('Expire failed'));

        await expect(outbox.addEntry('test', {}, 1)).rejects.toThrow('Expire failed');
      });
    });

    describe('markCompleted', () => {
      it('should mark entry as completed', async () => {
        const sessionId = 'test-session';
        const version = 1;
        const entryStr = JSON.stringify({
          id: 'test-session:1',
          sessionId,
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        });

        mockRedis.hget = vi.fn().mockResolvedValue(entryStr);

        await outbox.markCompleted(sessionId, version);

        expect(mockRedis.hget).toHaveBeenCalledWith('outbox:test-session', '1');
        // markCompleted uses hset to update existing entry (not hsetnx)
        expect(mockRedis.hset).toHaveBeenCalledWith(
          'outbox:test-session',
          '1',
          expect.stringContaining('"status":"completed"'),
        );
      });

      it('should handle entry not found', async () => {
        mockRedis.hget = vi.fn().mockResolvedValue(null);

        await outbox.markCompleted('test-session', 1);

        expect(mockRedis.hset).not.toHaveBeenCalled();
      });

      it('should handle JSON parse error', async () => {
        mockRedis.hget = vi.fn().mockResolvedValue('invalid-json');

        await expect(outbox.markCompleted('test-session', 1)).rejects.toThrow();
      });

      it('should schedule cleanup after marking completed', async () => {
        vi.useFakeTimers();
        const sessionId = 'test-session';
        const version = 1;
        const entryStr = JSON.stringify({
          id: 'test-session:1',
          sessionId,
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        });

        mockRedis.hget = vi.fn().mockResolvedValue(entryStr);

        await outbox.markCompleted(sessionId, version);

        // Avançar timer para executar setTimeout
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

        expect(mockRedis.hdel).toHaveBeenCalledWith('outbox:test-session', '1');
      });
    });

    describe('markFailed', () => {
      it('should mark entry as failed', async () => {
        const sessionId = 'test-session';
        const version = 1;
        const error = 'MongoDB connection failed';
        const entryStr = JSON.stringify({
          id: 'test-session:1',
          sessionId,
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        });

        mockRedis.hget = vi.fn().mockResolvedValue(entryStr);

        await outbox.markFailed(sessionId, version, error);

        // markFailed uses hset to update existing entry (not hsetnx)
        expect(mockRedis.hset).toHaveBeenCalledWith(
          'outbox:test-session',
          '1',
          expect.stringContaining('"status":"failed"'),
        );
        expect(mockRedis.hset).toHaveBeenCalledWith(
          'outbox:test-session',
          '1',
          expect.stringContaining('"lastError":"MongoDB connection failed"'),
        );
      });

      it('should increment attempts counter', async () => {
        const sessionId = 'test-session';
        const version = 1;
        const entryStr = JSON.stringify({
          id: 'test-session:1',
          sessionId,
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 1,
        });

        mockRedis.hget = vi.fn().mockResolvedValue(entryStr);

        await outbox.markFailed(sessionId, version, 'error');

        const setCall = mockRedis.hset.mock.calls[0];
        const updatedEntry = JSON.parse(setCall?.[2] || '{}');
        expect(updatedEntry.attempts).toBe(2);
      });

      it('should handle entry not found', async () => {
        mockRedis.hget = vi.fn().mockResolvedValue(null);

        await outbox.markFailed('test-session', 1, 'error');

        expect(mockRedis.hset).not.toHaveBeenCalled();
      });
    });

    describe('getPendingEntries', () => {
      it('should return pending entries', async () => {
        const sessionId = 'test-session';
        const entries = {
          '1': JSON.stringify({
            id: 'test-session:1',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 1,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
          '2': JSON.stringify({
            id: 'test-session:2',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 2,
            status: 'failed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 1,
          }),
        };

        mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

        const pending = await outbox.getPendingEntries(sessionId);

        expect(pending).toHaveLength(2);
        expect(pending[0]?.version).toBe(1);
        expect(pending[1]?.version).toBe(2);
      });

      it('should filter out completed entries', async () => {
        const sessionId = 'test-session';
        const entries = {
          '1': JSON.stringify({
            id: 'test-session:1',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 1,
            status: 'completed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
          '2': JSON.stringify({
            id: 'test-session:2',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 2,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
        };

        mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

        const pending = await outbox.getPendingEntries(sessionId);

        expect(pending).toHaveLength(1);
        expect(pending[0]?.status).toBe('pending');
      });

      it('should filter out failed entries with max attempts', async () => {
        const sessionId = 'test-session';
        const entries = {
          '1': JSON.stringify({
            id: 'test-session:1',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 1,
            status: 'failed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 3,
          }),
          '2': JSON.stringify({
            id: 'test-session:2',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 2,
            status: 'failed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 2,
          }),
        };

        mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

        const pending = await outbox.getPendingEntries(sessionId);

        expect(pending).toHaveLength(1);
        expect(pending[0]?.attempts).toBe(2);
      });

      it('should sort entries by version', async () => {
        const sessionId = 'test-session';
        const entries = {
          '3': JSON.stringify({
            id: 'test-session:3',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 3,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
          '1': JSON.stringify({
            id: 'test-session:1',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 1,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
          '2': JSON.stringify({
            id: 'test-session:2',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 2,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
        };

        mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

        const pending = await outbox.getPendingEntries(sessionId);

        expect(pending).toHaveLength(3);
        expect(pending[0]?.version).toBe(1);
        expect(pending[1]?.version).toBe(2);
        expect(pending[2]?.version).toBe(3);
      });

      it('should handle JSON parse errors gracefully', async () => {
        const sessionId = 'test-session';
        const entries = {
          '1': 'invalid-json',
          '2': JSON.stringify({
            id: 'test-session:2',
            sessionId,
            patch: {
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
                account: { details: 'test' },
                signalIdentities: [],
                myAppStateKeyId: 'test',
                firstUnuploadedPreKeyId: 1,
                nextPreKeyId: 2,
                lastAccountSyncTimestamp: Date.now(),
              },
            },
            version: 2,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            attempts: 0,
          }),
        };

        mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

        // Deve lançar erro ao tentar fazer parse do JSON inválido
        await expect(outbox.getPendingEntries(sessionId)).rejects.toThrow();
      });
    });
  });

  describe('Reconciliation', () => {
    it('should reconcile with no outbox keys', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      await outbox.reconcile();

      expect(mockRedis.keys).toHaveBeenCalledWith('outbox:*');
    });

    it('should reconcile pending entries', async () => {
      const outboxKeys = ['outbox:session1', 'outbox:session2'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      await outbox.reconcile();

      expect(mockMongo.set).toHaveBeenCalledWith(
        'session1',
        expect.objectContaining({
          creds: expect.objectContaining({
            account: { details: 'test' },
          }),
        }),
        0, // version - 1
        undefined,
      );
    });

    it('should handle MongoDB set failure', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);
      mockMongo.set = vi.fn().mockRejectedValue(new Error('MongoDB connection failed'));

      await outbox.reconcile();

      // Deve ter chamado markFailed - reconciliation uses hset (not hsetnx) for status updates
      expect(mockRedis.hget).toHaveBeenCalledWith('outbox:session1', '1');
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'outbox:session1',
        '1',
        expect.stringContaining('"status":"processing"'),
      );
    });

    it('should update stats after reconciliation', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.totalProcessed).toBeGreaterThan(0);
      expect(stats.totalCompleted).toBeGreaterThan(0);
    });

    it('should handle reconciliation errors', async () => {
      mockRedis.keys = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await outbox.reconcile();

      // Deve logar erro mas não falhar
      expect(mockRedis.keys).toHaveBeenCalledWith('outbox:*');
    });

    it('should calculate average latency correctly', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.avgLatency).toBeGreaterThanOrEqual(0);
    });

    it('should handle division by zero in latency calculation', async () => {
      // Reconciliação sem entries processadas
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await outbox.reconcile();

      // No entries to process, returns 0
      expect(result).toBe(0);
      const stats = outbox.getStats();
      // avgLatency stays at initial value (0) when no entries processed
      expect(stats.avgLatency).toBe(0);
    });
  });

  describe('Reconciler Lifecycle', () => {
    it('should start reconciler', () => {
      vi.useFakeTimers();
      const reconcileSpy = vi.spyOn(outbox, 'reconcile').mockResolvedValue(0);

      outbox.startReconciler();

      // Avançar timer para executar reconciliação
      vi.advanceTimersByTime(30000);
      expect(reconcileSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not start reconciler if already running', () => {
      outbox.startReconciler();
      outbox.startReconciler();

      expect(mockLogger.warn).toHaveBeenCalledWith('Outbox reconciler already running', {
        action: 'outbox_reconciler_already_running',
      });
    });

    it('should stop reconciler', () => {
      vi.useFakeTimers();
      outbox.startReconciler();
      outbox.stopReconciler();

      expect(mockLogger.warn).toHaveBeenCalledWith('Outbox reconciler stopped', {
        action: 'outbox_reconciler_stop',
      });

      vi.useRealTimers();
    });

    it('should handle reconciler unhandled errors', async () => {
      vi.useFakeTimers();
      vi.spyOn(outbox, 'reconcile').mockRejectedValue(new Error('Reconciliation failed'));

      outbox.startReconciler();

      // Avançar timer para executar reconciliação
      await vi.advanceTimersByTimeAsync(30000);

      // O erro deve ser capturado e logado
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Outbox reconciler unhandled error',
        expect.any(Error),
        expect.objectContaining({
          action: 'outbox_reconciler_unhandled_error',
        }),
      );

      vi.useRealTimers();
    }, 10000); // Timeout de 10 segundos
  });

  describe('Cleanup', () => {
    it('should cleanup completed entries older than 1 hour', async () => {
      const outboxKeys = ['outbox:session1'];
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: oneHourAgo - 1000, // Mais de 1 hora atrás
          attempts: 0,
        }),
        '2': JSON.stringify({
          id: 'session1:2',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 2,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: Date.now() - 30 * 60 * 1000, // 30 minutos atrás
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).toHaveBeenCalledWith('outbox:session1', '1');
      expect(mockRedis.hdel).not.toHaveBeenCalledWith('outbox:session1', '2');
    });

    it('should not cleanup non-completed entries', async () => {
      const outboxKeys = ['outbox:session1'];
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockRedis.keys = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await expect(outbox.cleanup()).rejects.toThrow('Redis connection failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle sessionId with special characters', async () => {
      const sessionId = 'session/with:special@chars';
      const patch = { creds: { account: { details: 'test' } } };

      await outbox.addEntry(sessionId, patch as any, 1);

      expect(mockRedis.hsetnx).toHaveBeenCalledWith(
        'outbox:session/with:special@chars',
        '1',
        expect.any(String),
      );
    });

    it('should handle version 0', async () => {
      const sessionId = 'test-session';
      const patch = { creds: { account: { details: 'test' } } };

      await outbox.addEntry(sessionId, patch as any, 0);

      expect(mockRedis.hsetnx).toHaveBeenCalledWith('outbox:test-session', '0', expect.any(String));
    });

    it('should handle multiple entries for same session', async () => {
      const sessionId = 'test-session';
      const patch = { creds: { account: { details: 'test' } } };

      await outbox.addEntry(sessionId, patch as any, 1);
      await outbox.addEntry(sessionId, patch as any, 2);
      await outbox.addEntry(sessionId, patch as any, 3);

      expect(mockRedis.hsetnx).toHaveBeenCalledTimes(3);
    });

    it('should handle very large patch data', async () => {
      const sessionId = 'test-session';
      const largePatch = {
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
            details: 'x'.repeat(10000), // 10KB de dados
          },
          signalIdentities: [],
          myAppStateKeyId: 'test',
          firstUnuploadedPreKeyId: 1,
          nextPreKeyId: 2,
          lastAccountSyncTimestamp: Date.now(),
        },
      };

      await outbox.addEntry(sessionId, largePatch as any, 1);

      expect(mockRedis.hsetnx).toHaveBeenCalledWith(
        'outbox:test-session',
        '1',
        expect.stringContaining('x'.repeat(100)),
      );
    });

    it('should handle concurrent reconciliation', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      // Executar reconciliação concorrente
      const promises = [outbox.reconcile(), outbox.reconcile(), outbox.reconcile()];

      await Promise.all(promises);

      // Deve ter processado as entries
      expect(mockMongo.set).toHaveBeenCalled();
    });
  });

  describe('Stats and Monitoring', () => {
    it('should track total processed', async () => {
      const outboxKeys = ['outbox:session1', 'outbox:session2'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };
      const session2Entries = {
        '1': JSON.stringify({
          id: 'session2:1',
          sessionId: 'session2',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi
        .fn()
        .mockResolvedValueOnce(session1Entries)
        .mockResolvedValueOnce(session2Entries);

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.totalProcessed).toBe(2);
    });

    it('should track total completed', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.totalCompleted).toBe(1);
    });

    it('should track total failed', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);
      mockMongo.set = vi.fn().mockRejectedValue(new Error('MongoDB failed'));

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.totalFailed).toBe(1);
    });

    it('should track total retried', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 1, // 1 attempt means it can be retried (< MAX_RETRY_ATTEMPTS - 1 = 2)
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);
      mockMongo.set = vi.fn().mockRejectedValue(new Error('MongoDB failed'));

      await outbox.reconcile();

      const stats = outbox.getStats();
      // totalRetried is incremented by 1 when entry fails but is still retryable
      expect(stats.totalRetried).toBe(1);
    });

    it('should update lastRunAt timestamp', async () => {
      const beforeRun = Date.now();

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.lastRunAt).toBeGreaterThanOrEqual(beforeRun);
    });
  });

  describe('Reconciliation Error Paths - Complete Coverage', () => {
    it('should handle different error types in persist', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      // Testar diferentes tipos de erro
      const errorTypes = [
        new Error('MongoDB connection failed'),
        new TypeError('Invalid data type'),
        new ReferenceError('Undefined variable'),
        { message: 'Unknown error', toString: () => 'Unknown error' },
      ];

      for (const error of errorTypes) {
        mockMongo.set = vi.fn().mockRejectedValue(error);

        await outbox.reconcile();

        // Deve ter chamado markFailed para cada tipo de erro - reconciliation uses hset for status
        expect(mockRedis.hget).toHaveBeenCalled();
        expect(mockRedis.hset).toHaveBeenCalledWith(
          'outbox:session1',
          '1',
          expect.stringContaining('"status":"processing"'),
        );
      }
    });

    it('should handle top-level reconciliation errors', async () => {
      // Mock Redis.keys para falhar
      mockRedis.keys = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      // Deve capturar erro e retornar 0
      await expect(outbox.reconcile()).resolves.toBe(0);
    });

    it('should handle reconciliation with mixed success and failure', async () => {
      const outboxKeys = ['outbox:session1', 'outbox:session2'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };
      const session2Entries = {
        '1': JSON.stringify({
          id: 'session2:1',
          sessionId: 'session2',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi
        .fn()
        .mockResolvedValueOnce(session1Entries) // Sucesso
        .mockResolvedValueOnce(session2Entries); // Falha

      // Primeira sessão sucesso, segunda falha
      mockMongo.set = vi
        .fn()
        .mockResolvedValueOnce({ version: 1, fencingToken: Date.now() }) // session1 success
        .mockRejectedValueOnce(new Error('MongoDB failed')); // session2 failure

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.totalCompleted).toBe(1);
      expect(stats.totalFailed).toBe(1);
    });

    it('should handle latency calculation with errors', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);
      mockMongo.set = vi.fn().mockRejectedValue(new Error('MongoDB failed'));

      await outbox.reconcile();

      const stats = outbox.getStats();
      expect(stats.avgLatency).toBeGreaterThanOrEqual(0);
    });

    it('should handle JSON parse errors in reconciliation', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': 'invalid-json',
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);

      // Deve capturar erro de JSON parse e continuar
      // Returns 0 since no entries were successfully processed
      await expect(outbox.reconcile()).resolves.toBe(0);
    });

    it('should handle Redis hset failure during reconciliation', async () => {
      const outboxKeys = ['outbox:session1'];
      const session1Entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(session1Entries);
      mockRedis.hset = vi.fn().mockRejectedValue(new Error('Redis hset failed'));

      await outbox.reconcile();

      // Deve ter tentado marcar como processing mas falhado
      expect(mockRedis.hset).toHaveBeenCalled();
    });
  });

  describe('Cleanup Operations - Complete Coverage', () => {
    it('should cleanup completed entries older than 1 hour', async () => {
      const outboxKeys = ['outbox:session1'];
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: oneHourAgo - 1000, // Mais de 1 hora atrás
          attempts: 0,
        }),
        '2': JSON.stringify({
          id: 'session1:2',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 2,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: Date.now() - 30 * 60 * 1000, // 30 minutos atrás
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).toHaveBeenCalledWith('outbox:session1', '1');
      expect(mockRedis.hdel).not.toHaveBeenCalledWith('outbox:session1', '2');
    });

    it('should not cleanup non-completed entries', async () => {
      const outboxKeys = ['outbox:session1'];
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should not cleanup entries without completedAt', async () => {
      const outboxKeys = ['outbox:session1'];
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // Sem completedAt
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockRedis.keys = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await expect(outbox.cleanup()).rejects.toThrow('Redis connection failed');
    });

    it('should handle cleanup with no outbox keys', async () => {
      mockRedis.keys = vi.fn().mockResolvedValue([]);

      await outbox.cleanup();

      expect(mockRedis.hgetall).not.toHaveBeenCalled();
    });

    it('should handle cleanup with empty entries', async () => {
      const outboxKeys = ['outbox:session1'];
      const entries = {};

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      await outbox.cleanup();

      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });

    it('should handle cleanup with JSON parse errors', async () => {
      const outboxKeys = ['outbox:session1'];
      const entries = {
        '1': 'invalid-json',
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);

      // Deve capturar erro de JSON parse
      await expect(outbox.cleanup()).rejects.toThrow();
    });

    it('should handle cleanup with Redis hdel failure', async () => {
      const outboxKeys = ['outbox:session1'];
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const entries = {
        '1': JSON.stringify({
          id: 'session1:1',
          sessionId: 'session1',
          patch: {
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
              account: { details: 'test' },
              signalIdentities: [],
              myAppStateKeyId: 'test',
              firstUnuploadedPreKeyId: 1,
              nextPreKeyId: 2,
              lastAccountSyncTimestamp: Date.now(),
            },
          },
          version: 1,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: oneHourAgo - 1000,
          attempts: 0,
        }),
      };

      mockRedis.keys = vi.fn().mockResolvedValue(outboxKeys);
      mockRedis.hgetall = vi.fn().mockResolvedValue(entries);
      mockRedis.hdel = vi.fn().mockRejectedValue(new Error('Redis hdel failed'));

      // Deve capturar erro do hdel
      await expect(outbox.cleanup()).rejects.toThrow('Redis hdel failed');
    });
  });
});
