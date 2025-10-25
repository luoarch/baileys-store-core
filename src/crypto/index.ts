/**
 * @baileys-store/core - Crypto Service
 *
 * Camada de criptografia app-level usando AES-256-GCM
 * Suporta rotação de chaves e múltiplas versões
 *
 * Algoritmo: AES-256-GCM (AEAD)
 * - Key: 32 bytes
 * - Nonce: 12 bytes
 * - Auth Tag: 16 bytes
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import type { EncryptedData, SecurityConfig, Logger } from '../types/index.js';
import { EncryptionError, NullLogger } from '../types/index.js';

/**
 * Configuração de criptografia AES-256-GCM
 */
const CRYPTO_CONSTANTS = {
  NONCE_LENGTH: 12, // 96 bits (NIST SP 800-38D recommendation)
  AUTH_TAG_LENGTH: 16, // 128 bits
  KEY_LENGTH: 32, // 256 bits
  ALGORITHM: 'aes-256-gcm' as const,
  KEY_ID_LENGTH: 16, // hex characters (64 bits truncated from SHA-256)
} as const;

/**
 * Chave de criptografia com metadados
 */
interface CryptoKey {
  id: string;
  key: Buffer;
  algorithm: string;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
}

/**
 * Gerenciador de chaves com rotação
 */
class KeyManager {
  private keys = new Map<string, CryptoKey>();
  private activeKeyId: string | null = null;

  /**
   * Adiciona uma chave
   */
  addKey(key: CryptoKey): void {
    this.keys.set(key.id, key);

    if (key.active) {
      // Desativar chave anterior
      if (this.activeKeyId && this.activeKeyId !== key.id) {
        const oldKey = this.keys.get(this.activeKeyId);
        if (oldKey) {
          oldKey.active = false;
        }
      }
      this.activeKeyId = key.id;
    }
  }

  /**
   * Obtém chave ativa
   */
  getActiveKey(): CryptoKey | null {
    if (!this.activeKeyId) return null;
    return this.keys.get(this.activeKeyId) ?? null;
  }

  /**
   * Obtém chave por ID
   */
  getKey(keyId: string): CryptoKey | null {
    return this.keys.get(keyId) ?? null;
  }

  /**
   * Verifica se chave está expirada
   */
  isKeyExpired(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key?.expiresAt) return false;
    return key.expiresAt < new Date();
  }

  /**
   * Lista todas as chaves
   */
  listKeys(): CryptoKey[] {
    return Array.from(this.keys.values());
  }

  /**
   * Remove chaves expiradas
   */
  cleanupExpiredKeys(): number {
    let removed = 0;
    for (const [keyId, key] of this.keys.entries()) {
      if (key.expiresAt && key.expiresAt < new Date() && !key.active) {
        this.keys.delete(keyId);
        removed++;
      }
    }
    return removed;
  }
}

/**
 * CryptoService - Serviço de criptografia
 */
export class CryptoService {
  private keyManager: KeyManager;
  private config: SecurityConfig;
  private logger: Logger;
  private schemaVersion = 1;

  constructor(config: SecurityConfig) {
    this.config = config;
    this.keyManager = new KeyManager();
    this.logger = config.logger ?? new NullLogger();
  }

  /**
   * Debug logging que respeita configuração de segurança
   */
  private debug(message: string, data?: Record<string, unknown>): void {
    if (this.config.enableDebugLogging && this.config.environment !== 'production') {
      this.logger.debug(`🔐 [CRYPTO] ${message}`, data);
    }
  }

  /**
   * Normaliza dados para Buffer (suporta múltiplos formatos)
   */
  private normalizeToBuffer(data: unknown, fieldName: string): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (typeof data === 'string') {
      return Buffer.from(data, 'base64');
    }

    if (data && typeof data === 'object' && 'type' in data) {
      const obj = data as { type: string; data: number[] };
      if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
        return Buffer.from(obj.data);
      }
    }

    if (data && typeof data === 'object' && 'byteLength' in data) {
      return Buffer.from(data as Uint8Array);
    }

    const dataLength = (data as { length?: number }).length;
    throw new EncryptionError(
      `Formato de ${fieldName} inválido: ${typeof data}, length: ${String(dataLength ?? 'unknown')}`,
    );
  }

  /**
   * Inicializa o serviço com chave(s)
   */
  initialize(masterKey: string | Buffer): Promise<void> {
    try {
      this.debug('Inicializando CryptoService', {
        masterKeyType: typeof masterKey,
        masterKeyLength: typeof masterKey === 'string' ? masterKey.length : masterKey.length,
      });

      // Derivar chave de 32 bytes do master key
      const keyBuffer = typeof masterKey === 'string' ? Buffer.from(masterKey, 'hex') : masterKey;

      this.debug('Buffer da chave processado', {
        length: keyBuffer.length,
        isHex: typeof masterKey === 'string',
      });

      if (keyBuffer.length !== CRYPTO_CONSTANTS.KEY_LENGTH) {
        this.debug('Comprimento da chave != 32, derivando com SHA-256');
        // Derivar usando SHA-256
        const derived = createHash('sha256').update(keyBuffer).digest();
        this.debug('Chave derivada', { length: derived.length });
        this.addKey(derived, true);
      } else {
        this.debug('Comprimento da chave == 32, usando diretamente');
        this.addKey(keyBuffer, true);
      }

      this.debug('CryptoService inicializado com sucesso');
      return Promise.resolve();
    } catch (error) {
      this.logger.error('Falha ao inicializar CryptoService', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new EncryptionError(
        'Falha ao inicializar CryptoService',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Adiciona chave ao gerenciador
   */
  private addKey(keyBuffer: Buffer, active = false): void {
    const keyId = this.generateKeyId(keyBuffer);
    const expiresAt =
      this.config.keyRotationDays > 0
        ? new Date(Date.now() + this.config.keyRotationDays * 24 * 60 * 60 * 1000)
        : null;

    this.debug('Adicionando chave', {
      keyLength: keyBuffer.length,
      algorithm: this.config.encryptionAlgorithm,
      active,
      expiresAt: expiresAt?.toISOString() ?? 'never',
    });

    this.keyManager.addKey({
      id: keyId,
      key: keyBuffer,
      algorithm: this.config.encryptionAlgorithm,
      createdAt: new Date(),
      expiresAt,
      active,
    });

    this.debug('Chave adicionada com sucesso');
  }

  /**
   * Gera ID da chave (hash)
   */
  private generateKeyId(key: Buffer): string {
    return createHash('sha256')
      .update(key)
      .digest('hex')
      .substring(0, CRYPTO_CONSTANTS.KEY_ID_LENGTH);
  }

  /**
   * Criptografa dados
   */
  async encrypt(plaintext: Buffer): Promise<EncryptedData> {
    if (!this.config.enableEncryption) {
      // Se criptografia desabilitada, retorna dados "não criptografados"
      return {
        ciphertext: plaintext,
        nonce: Buffer.alloc(0),
        keyId: 'none',
        schemaVersion: this.schemaVersion,
        timestamp: new Date(),
      };
    }

    try {
      const key = this.keyManager.getActiveKey();
      if (!key) {
        throw new EncryptionError('Nenhuma chave ativa disponível');
      }

      return await this.encryptWithKey(plaintext, key);
    } catch (error) {
      throw new EncryptionError(
        'Falha ao criptografar dados',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Descriptografa dados
   */
  async decrypt(encrypted: EncryptedData): Promise<Buffer> {
    this.debug('Decrypt chamado', {
      enableEncryption: this.config.enableEncryption,
      ciphertextLength: encrypted.ciphertext.length,
      nonceLength: encrypted.nonce.length,
      schemaVersion: encrypted.schemaVersion,
    });

    if (!this.config.enableEncryption || encrypted.keyId === 'none') {
      this.debug('Criptografia desabilitada ou keyId=none, retornando plaintext');
      return encrypted.ciphertext;
    }

    try {
      // Suporte para keyId "auto" (dados antigos)
      let keyId = encrypted.keyId;
      if (keyId === 'auto') {
        this.debug('Tratando keyId="auto", procurando chave ativa');
        // Para dados antigos com keyId "auto", usar a primeira chave disponível
        const activeKey = this.keyManager.getActiveKey();
        if (activeKey) {
          keyId = activeKey.id;
          this.debug('Chave ativa encontrada', { algorithm: activeKey.algorithm });
        } else {
          this.logger.error('Nenhuma chave ativa encontrada para keyId="auto"');
          throw new EncryptionError('Chave não encontrada: auto (nenhuma chave ativa disponível)');
        }
      }

      this.debug('Procurando chave', { keyId });
      const key = this.keyManager.getKey(keyId);
      if (!key) {
        this.logger.error('Chave não encontrada', { keyId });
        this.debug('Chaves disponíveis', {
          availableKeys: this.keyManager
            .listKeys()
            .map((k) => ({ algorithm: k.algorithm, active: k.active })),
        });
        throw new EncryptionError(`Chave não encontrada: ${encrypted.keyId}`);
      }

      this.debug('Chave encontrada', {
        algorithm: key.algorithm,
        active: key.active,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
      });

      if (this.keyManager.isKeyExpired(encrypted.keyId)) {
        this.logger.warn('Descriptografando com chave expirada');
      }

      return await this.decryptWithKey(encrypted, key);
    } catch (error) {
      throw new EncryptionError(
        'Falha ao descriptografar dados',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Criptografa com chave específica
   */
  private async encryptWithKey(plaintext: Buffer, key: CryptoKey): Promise<EncryptedData> {
    if (key.algorithm === 'secretbox' || key.algorithm === 'aes-256-gcm') {
      return Promise.resolve(this.encryptAESGCM(plaintext, key));
    }

    throw new EncryptionError(`Algoritmo não suportado: ${key.algorithm}`);
  }

  /**
   * Descriptografa com chave específica
   */
  private async decryptWithKey(encrypted: EncryptedData, key: CryptoKey): Promise<Buffer> {
    if (key.algorithm === 'secretbox' || key.algorithm === 'aes-256-gcm') {
      return Promise.resolve(this.decryptAESGCM(encrypted, key));
    }

    throw new EncryptionError(`Algoritmo não suportado: ${key.algorithm}`);
  }

  /**
   * Criptografia AES-256-GCM (compatível com secretbox)
   */
  private encryptAESGCM(plaintext: Buffer, key: CryptoKey): EncryptedData {
    // Gerar nonce aleatório (12 bytes para GCM)
    const nonce = randomBytes(CRYPTO_CONSTANTS.NONCE_LENGTH);

    // Criar cipher
    const cipher = createCipheriv(CRYPTO_CONSTANTS.ALGORITHM, key.key, nonce);

    // Criptografar
    const chunks: Buffer[] = [];
    chunks.push(cipher.update(plaintext));
    chunks.push(cipher.final());

    const ciphertext = Buffer.concat(chunks);

    // Obter auth tag (16 bytes)
    const authTag = cipher.getAuthTag();

    // Concatenar ciphertext + authTag
    const combined = Buffer.concat([ciphertext, authTag]);

    return {
      ciphertext: combined,
      nonce,
      keyId: key.id,
      schemaVersion: this.schemaVersion,
      timestamp: new Date(),
    };
  }

  /**
   * Descriptografia AES-256-GCM
   */
  private decryptAESGCM(encrypted: EncryptedData, key: CryptoKey): Buffer {
    this.debug('DecryptAESGCM iniciado', {
      ciphertextLength: encrypted.ciphertext.length,
      nonceLength: encrypted.nonce.length,
      nonceType: typeof encrypted.nonce,
    });

    try {
      // Normalizar nonce
      const nonce = this.normalizeToBuffer(encrypted.nonce, 'nonce');

      // Validar tamanho do nonce
      if (nonce.length !== CRYPTO_CONSTANTS.NONCE_LENGTH) {
        throw new EncryptionError(
          `Nonce tem tamanho inválido: ${String(nonce.length)} bytes (esperado: ${String(CRYPTO_CONSTANTS.NONCE_LENGTH)} bytes)`,
        );
      }

      this.debug('Nonce validado', { length: nonce.length });

      // Normalizar ciphertext
      const ciphertextBuffer = this.normalizeToBuffer(encrypted.ciphertext, 'ciphertext');

      // Validar tamanho mínimo do ciphertext
      if (ciphertextBuffer.length < CRYPTO_CONSTANTS.AUTH_TAG_LENGTH) {
        throw new EncryptionError(
          `Ciphertext muito curto: ${String(ciphertextBuffer.length)} bytes (mínimo ${String(CRYPTO_CONSTANTS.AUTH_TAG_LENGTH)} bytes)`,
        );
      }

      // Separar ciphertext e authTag
      const authTag = ciphertextBuffer.subarray(-CRYPTO_CONSTANTS.AUTH_TAG_LENGTH);
      const ciphertext = ciphertextBuffer.subarray(0, -CRYPTO_CONSTANTS.AUTH_TAG_LENGTH);

      this.debug('Dados separados', {
        ciphertextLength: ciphertext.length,
        authTagLength: authTag.length,
      });

      // Criar decipher
      const decipher = createDecipheriv(CRYPTO_CONSTANTS.ALGORITHM, key.key, nonce);
      decipher.setAuthTag(authTag);

      this.debug('Decipher criado com sucesso');

      // Descriptografar
      const chunks: Buffer[] = [];
      chunks.push(decipher.update(ciphertext));
      chunks.push(decipher.final());

      const result = Buffer.concat(chunks);
      this.debug('Descriptografia bem-sucedida', { resultLength: result.length });

      return result;
    } catch (error) {
      this.logger.error('Falha na descriptografia', {
        error: error instanceof Error ? error.message : String(error),
        ciphertextLength: encrypted.ciphertext.length,
        nonceLength: encrypted.nonce.length,
        nonceType: typeof encrypted.nonce,
        keyLength: key.key.length,
      });
      throw error;
    }
  }

  /**
   * Rotaciona chave ativa
   */
  rotateKey(newMasterKey: string | Buffer): Promise<void> {
    try {
      const keyBuffer =
        typeof newMasterKey === 'string' ? Buffer.from(newMasterKey, 'hex') : newMasterKey;

      const derived =
        keyBuffer.length === CRYPTO_CONSTANTS.KEY_LENGTH
          ? keyBuffer
          : createHash('sha256').update(keyBuffer).digest();

      this.addKey(derived, true);
      return Promise.resolve();
    } catch (error) {
      throw new EncryptionError(
        'Falha ao rotacionar chave',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Limpa chaves expiradas
   */
  cleanupExpiredKeys(): number {
    return this.keyManager.cleanupExpiredKeys();
  }

  /**
   * Obtém estatísticas das chaves
   */
  getKeyStats(): {
    totalKeys: number;
    activeKey: string | null;
    expiredKeys: number;
  } {
    const keys = this.keyManager.listKeys();
    const expiredCount = keys.filter((k) => k.expiresAt && k.expiresAt < new Date()).length;

    return {
      totalKeys: keys.length,
      activeKey: this.keyManager.getActiveKey()?.id ?? null,
      expiredKeys: expiredCount,
    };
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    const activeKey = this.keyManager.getActiveKey();
    if (!activeKey) return false;

    // Verificar se chave ativa não está expirada
    if (activeKey.expiresAt && activeKey.expiresAt < new Date()) {
      return false;
    }

    return true;
  }
}

/**
 * Factory para criar CryptoService
 */
export async function createCryptoService(
  config: SecurityConfig,
  masterKey?: string | Buffer,
): Promise<CryptoService> {
  const service = new CryptoService(config);

  try {
    if (masterKey) {
      await service.initialize(masterKey);
    } else if (config.enableEncryption) {
      if (config.environment === 'production') {
        throw new EncryptionError(
          'Criptografia habilitada mas master key ausente. Configure MASTER_KEY para produção.',
        );
      }

      // Development: gerar chave temporária
      // NOTE: Using temporary key in development - configure MASTER_KEY for production!
      const tempKey = randomBytes(CRYPTO_CONSTANTS.KEY_LENGTH);
      await service.initialize(tempKey);
    }
  } catch (error) {
    throw new EncryptionError(
      'Falha ao inicializar CryptoService',
      error instanceof Error ? error : undefined,
    );
  }

  return service;
}
