/**
 * @baileys-store/core - Redis Auth Store
 *
 * Hot cache layer for Auth State
 * - Automatic TTL (24h default)
 * - Incremental key merging (CRITICAL - our discovery!)
 * - Global metadata (unified version)
 * - Auto-reconnect and health checks
 */

import Redis, { type RedisOptions, type Redis as RedisClient } from 'ioredis';
import type {
  AuthStore,
  SessionId,
  AuthSnapshot,
  AuthPatch,
  Versioned,
  VersionedResult,
  TtlConfig,
  ResilienceConfig,
  StructuredLogger,
} from '../types/index.js';
import { StorageError, NullLoggerStructured } from '../types/index.js';
import type { CryptoService } from '../crypto/index.js';
import type { CodecService } from '../crypto/codec.js';
import type { AuthenticationCreds } from '@whiskeysockets/baileys';

/**
 * Internal data structures for Redis storage
 */
interface StoredCreds {
  creds: AuthenticationCreds;
  version: number;
  updatedAt: Date;
}

interface StoredKeys {
  keys: Record<string, Record<string, unknown>>;
  appState?: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}

interface MetaData {
  version: number;
  updatedAt: string;
}

interface EncryptedData {
  ciphertext: string;
  nonce: string;
  keyId: string;
  schemaVersion: number;
  timestamp: string;
}

/**
 * RedisAuthStore configuration
 */
export interface RedisStoreConfig {
  /** Redis connection URL or options object */
  redisUrl?: string;
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database */
  db?: number;
  /** TTL configuration */
  ttl: TtlConfig;
  /** Resilience configuration */
  resilience: ResilienceConfig;
  /** Enable TLS */
  enableTls?: boolean;
  /** Optional structured logger */
  logger?: StructuredLogger;
}

/**
 * RedisAuthStore - AuthStore implementation using Redis
 */
export class RedisAuthStore implements AuthStore {
  private client: RedisClient;
  private crypto: CryptoService;
  private codec: CodecService;
  private config: RedisStoreConfig;
  private logger: StructuredLogger;
  private connected = false;

  constructor(config: RedisStoreConfig, crypto: CryptoService, codec: CodecService) {
    this.config = config;
    this.crypto = crypto;
    this.codec = codec;
    this.logger = config.logger ?? new NullLoggerStructured();

    // Create ioredis client
    const options: RedisOptions = {
      host: config.host ?? 'localhost',
      port: config.port ?? 6379,
      password: config.password,
      db: config.db ?? 0,
      retryStrategy: (times: number) => {
        if (times > config.resilience.maxRetries) {
          this.logger.error('Maximum Redis reconnection attempts reached', undefined, {
            action: 'redis_max_reconnection_attempts',
          });
          return null; // Stop trying
        }

        const delay = Math.min(
          config.resilience.retryBaseDelay * Math.pow(config.resilience.retryMultiplier, times),
          30000, // max 30s
        );

        this.logger.warn(`Attempting Redis reconnection (attempt ${String(times)}), waiting ${String(delay)}ms`, {
          attempt: times,
          delayMs: delay,
          action: 'redis_reconnection_attempt',
        });
        return delay;
      },
      lazyConnect: false,
    };

    if (config.enableTls) {
      options.tls = {};
    }

    // Parse URL if provided
    if (config.redisUrl) {
      this.client = new Redis(config.redisUrl, options);
    } else {
      this.client = new Redis(options);
    }

    // Event handlers
    this.client.on('error', (err) => {
      this.logger.error('Redis client error', err, {
        action: 'redis_client_error',
      });
    });

    this.client.on('connect', () => {
      this.connected = true;
    });

    this.client.on('ready', () => {
      this.connected = true;
    });

    this.client.on('close', () => {
      this.connected = false;
    });
  }

  /**
   * Conecta ao Redis (ioredis conecta automaticamente)
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const startTime = Date.now();

    try {
      await this.client.ping();
      this.connected = true;
      this.logger.info('RedisAuthStore connected successfully', {
        duration: Date.now() - startTime,
        action: 'redis_connect_success',
      });
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error instanceof Error ? error : undefined, {
        duration: Date.now() - startTime,
        action: 'redis_connect_error',
      });
      throw new StorageError(
        'Falha ao conectar ao Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Desconecta do Redis
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client.quit();
      this.connected = false;
    } catch (error) {
      this.logger.error('Erro ao desconectar do Redis', error instanceof Error ? error : undefined, {
        action: 'redis_disconnect_error',
      });
    }
  }

  /**
   * Busca snapshot completo
   */
  async get(sessionId: SessionId): Promise<Versioned<AuthSnapshot> | null> {
    try {
      this.ensureConnected();

      // Buscar metadata (version global) primeiro
      const metaKey = this.buildKey(sessionId, 'meta');
      const metaValue = await this.client.get(metaKey);

      let globalVersion = 1;
      let updatedAt = new Date();

      if (metaValue) {
        const meta = JSON.parse(metaValue) as MetaData;
        globalVersion = meta.version || 1;
        updatedAt = new Date(meta.updatedAt);
      }

      // Buscar creds e keys em paralelo
      const [creds, keys] = await Promise.all([
        this.getField(sessionId, 'creds'),
        this.getField(sessionId, 'keys'),
      ]);

      if (!creds || !keys) {
        return null;
      }

      const snapshot: AuthSnapshot = {
        creds: creds.creds,
        keys: keys.keys,
        appState: keys.appState,
      };

      return {
        data: snapshot,
        version: globalVersion,
        updatedAt,
      };
    } catch (error) {
      throw new StorageError(
        'Falha ao buscar do Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Atualiza snapshot (total ou parcial)
   */
  async set(
    sessionId: SessionId,
    patch: AuthPatch,
    expectedVersion?: number,
    // _fencingToken?: number,
  ): Promise<VersionedResult> {
    try {
      this.ensureConnected();

      const newVersion = (expectedVersion ?? 0) + 1;
      const updatedAt = new Date();

      const promises: Promise<void>[] = [];

      // Salvar creds se houver
      if (patch.creds) {
        promises.push(
          this.setField(sessionId, 'creds', {
            creds: patch.creds,
            version: newVersion,
            updatedAt,
          }),
        );
      }

      // CRÍTICO: MESCLAR keys com as existentes (NÃO sobrescrever!)
      // Essa é nossa descoberta que corrige o bug do baileys-redis-auth original
      if (patch.keys ?? patch.appState) {
        // Buscar keys existentes
        const current = await this.getField(sessionId, 'keys');
        const mergedKeys = { ...(current?.keys ?? {}) };

        // Mesclar incrementalmente
        if (patch.keys) {
          for (const type in patch.keys) {
            mergedKeys[type] ??= {};
            for (const id in patch.keys[type]) {
              const value = patch.keys[type][id];
              if (value === null || value === undefined) {
                // Deletar se valor é null/undefined
                // delete mergedKeys[type][id];
                const { [id]: _unused, ...rest } = mergedKeys[type];
                void _unused; // Suppress unused variable warning
                mergedKeys[type] = rest;
              } else {
                // Adicionar/atualizar
                mergedKeys[type][id] = value as unknown;
              }
            }
          }
        }

        promises.push(
          this.setField(sessionId, 'keys', {
            keys: mergedKeys,
            appState: patch.appState ?? current?.appState,
            version: newVersion,
            updatedAt,
          }),
        );
      }

      await Promise.all(promises);

      // Salvar metadata (version global) separadamente
      const metaKey = this.buildKey(sessionId, 'meta');
      const metaData = JSON.stringify({
        version: newVersion,
        updatedAt: updatedAt.toISOString(),
      });

      await this.client.setex(metaKey, this.config.ttl.defaultTtl, metaData);

      return {
        version: newVersion,
        updatedAt,
        success: true,
      };
    } catch (error) {
      this.logger.error('❌ REDIS SET ERROR', error instanceof Error ? error : undefined, {
        sessionId,
        patchKeys: Object.keys(patch),
        action: 'redis_set_error',
      });
      throw new StorageError(
        'Falha ao salvar no Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Remove snapshot
   */
  async delete(sessionId: SessionId): Promise<void> {
    try {
      this.ensureConnected();

      const keys = [
        this.buildKey(sessionId, 'creds'),
        this.buildKey(sessionId, 'keys'),
        this.buildKey(sessionId, 'meta'),
      ];

      await this.client.del(...keys);
    } catch (error) {
      throw new StorageError(
        'Falha ao deletar do Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Renova TTL (keep-alive)
   */
  async touch(sessionId: SessionId, ttlSeconds?: number): Promise<void> {
    try {
      this.ensureConnected();

      const ttl = ttlSeconds ?? this.config.ttl.defaultTtl;
      const keys = [
        this.buildKey(sessionId, 'creds'),
        this.buildKey(sessionId, 'keys'),
        this.buildKey(sessionId, 'meta'),
      ];

      await Promise.all(keys.map((key) => this.client.expire(key, ttl)));
    } catch (error) {
      throw new StorageError(
        'Falha ao renovar TTL no Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Verifica existência
   */
  async exists(sessionId: SessionId): Promise<boolean> {
    try {
      this.ensureConnected();

      const key = this.buildKey(sessionId, 'creds');
      const result = await this.client.exists(key);

      return result > 0;
    } catch (error) {
      throw new StorageError(
        'Falha ao verificar existência no Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.connected) return false;

      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  // ========== Métodos privados ==========

  /**
   * Busca campo específico
   */
  private async getField(sessionId: SessionId, field: 'creds'): Promise<StoredCreds | null>;
  private async getField(sessionId: SessionId, field: 'keys'): Promise<StoredKeys | null>;
  private async getField(
    sessionId: SessionId,
    field: 'creds' | 'keys',
  ): Promise<StoredCreds | StoredKeys | null> {
    try {
      const key = this.buildKey(sessionId, field);
      const value = await this.client.get(key);

      if (!value) return null;

      // Parse EncryptedData do JSON
      const encryptedData = JSON.parse(value) as EncryptedData;
      const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
      const nonce = Buffer.from(encryptedData.nonce, 'base64');

      // Descriptografar
      const decrypted = await this.crypto.decrypt({
        ciphertext,
        nonce,
        keyId: encryptedData.keyId,
        schemaVersion: encryptedData.schemaVersion,
        timestamp: new Date(encryptedData.timestamp),
      });

      // Decodificar (descomprimir + parse JSON)
      const decoded = await this.codec.decode<StoredCreds | StoredKeys>(decrypted);

      return decoded;
    } catch {
      // Se falhar ao ler, retorna null (miss)
      return null;
    }
  }

  /**
   * Salva campo específico
   */
  private async setField(sessionId: SessionId, field: 'creds', data: StoredCreds): Promise<void>;
  private async setField(sessionId: SessionId, field: 'keys', data: StoredKeys): Promise<void>;
  private async setField(
    sessionId: SessionId,
    field: 'creds' | 'keys',
    data: StoredCreds | StoredKeys,
  ): Promise<void> {
    try {
      const key = this.buildKey(sessionId, field);

      // Codificar (JSON + comprimir)
      const encoded = await this.codec.encode(data);

      // Criptografar
      const encrypted = await this.crypto.encrypt(encoded);

      // Serializar EncryptedData para JSON
      const encryptedData = JSON.stringify({
        ciphertext: encrypted.ciphertext.toString('base64'),
        nonce: encrypted.nonce.toString('base64'),
        keyId: encrypted.keyId,
        schemaVersion: encrypted.schemaVersion,
        timestamp: encrypted.timestamp.toISOString(),
      });

      await this.client.setex(key, this.config.ttl.defaultTtl, encryptedData);
    } catch (error) {
      throw new StorageError(
        'Falha ao escrever no Redis',
        'redis',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Constrói chave Redis
   */
  private buildKey(sessionId: SessionId, field: string): string {
    return `baileys:auth:${sessionId}:${field}`;
  }

  /**
   * Garante que está conectado
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new StorageError('Redis não conectado', 'redis');
    }
  }

  /**
   * Get Redis client for external access (used by HybridAuthStore)
   */
  getClient(): RedisClient {
    this.ensureConnected();
    return this.client;
  }
}

/**
 * Factory para criar RedisAuthStore
 */
export async function createRedisStore(
  config: RedisStoreConfig,
  crypto: CryptoService,
  codec: CodecService,
): Promise<RedisAuthStore> {
  const store = new RedisAuthStore(config, crypto, codec);
  await store.connect();
  return store;
}
