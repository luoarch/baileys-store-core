/**
 * @baileys-store/core - CryptoService Security Tests
 *
 * Testa as melhorias de segurança implementadas:
 * - Logging configurável
 * - Sanitização de dados sensíveis
 * - Validação de entrada
 * - Buffer normalization
 * - Production safety
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoService, createCryptoService } from '../../crypto/index.js';
import { type SecurityConfig, ConsoleLogger } from '../../types/index.js';
import { randomBytes } from 'crypto';

describe('CryptoService Security', () => {
  let mockLogger: ConsoleLogger;

  beforeEach(() => {
    mockLogger = new ConsoleLogger();
    vi.spyOn(mockLogger, 'debug').mockImplementation(() => {});
    vi.spyOn(mockLogger, 'info').mockImplementation(() => {});
    vi.spyOn(mockLogger, 'warn').mockImplementation(() => {});
    vi.spyOn(mockLogger, 'error').mockImplementation(() => {});
  });

  describe('Configurable Logging', () => {
    it('should not log in production environment', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: true,
        environment: 'production',
        logger: mockLogger,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test data');
      await service.encrypt(plaintext);

      // Debug logs should not be called in production
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should log in development environment when enabled', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: true,
        environment: 'development',
        logger: mockLogger,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test data');
      await service.encrypt(plaintext);

      // Debug logs should be called in development
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should not log when debug logging is disabled', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: false,
        environment: 'development',
        logger: mockLogger,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test data');
      await service.encrypt(plaintext);

      // Debug logs should not be called when disabled
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe('Data Sanitization', () => {
    it('should not expose sensitive data in logs', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: true,
        environment: 'development',
        logger: mockLogger,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test data');
      await service.encrypt(plaintext);

      // Check that debug calls don't contain sensitive data
      const debugCalls = (mockLogger.debug as any).mock.calls;
      debugCalls.forEach((call: any[]) => {
        const message = call[0];
        const data = call[1];

        // Should not contain keyId, nonce hex, or key previews
        expect(message).not.toMatch(/keyId|nonce.*hex|key.*preview/i);
        if (data) {
          expect(JSON.stringify(data)).not.toMatch(/keyId|nonce.*hex|key.*preview/i);
        }
      });
    });
  });

  describe('Input Validation', () => {
    it('should reject ciphertext shorter than auth tag', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Create invalid ciphertext (too short)
      const invalidEncrypted = {
        ...encrypted,
        ciphertext: Buffer.alloc(10), // < 16 bytes
      };

      await expect(service.decrypt(invalidEncrypted)).rejects.toThrow(
        'Falha ao descriptografar dados',
      );
    });

    it('should reject invalid nonce length', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Create invalid nonce (wrong length)
      const invalidEncrypted = {
        ...encrypted,
        nonce: Buffer.alloc(16), // Should be 12 bytes
      };

      await expect(service.decrypt(invalidEncrypted)).rejects.toThrow(
        'Falha ao descriptografar dados',
      );
    });
  });

  describe('Buffer Normalization', () => {
    it('should handle Buffer format', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it('should handle JSON Buffer format', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Convert to JSON Buffer format
      const jsonFormat = {
        ...encrypted,
        nonce: { type: 'Buffer', data: Array.from(encrypted.nonce) },
        ciphertext: { type: 'Buffer', data: Array.from(encrypted.ciphertext) },
      };

      const decrypted = await service.decrypt(jsonFormat as any);
      expect(decrypted).toEqual(plaintext);
    });

    it('should handle Uint8Array format', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Convert to Uint8Array format
      const uint8Format = {
        ...encrypted,
        nonce: new Uint8Array(encrypted.nonce),
        ciphertext: new Uint8Array(encrypted.ciphertext),
      };

      const decrypted = await service.decrypt(uint8Format as any);
      expect(decrypted).toEqual(plaintext);
    });

    it('should handle Base64 string format', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Convert to Base64 string format
      const base64Format = {
        ...encrypted,
        nonce: encrypted.nonce.toString('base64'),
        ciphertext: encrypted.ciphertext.toString('base64'),
      };

      const decrypted = await service.decrypt(base64Format as any);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('Production Safety', () => {
    it('should reject production without master key', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        environment: 'production',
      };

      await expect(createCryptoService(config)).rejects.toThrow(
        'Falha ao inicializar CryptoService',
      );
    });

    it('should allow development without master key', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        environment: 'development',
      };

      const service = await createCryptoService(config);
      expect(service).toBeInstanceOf(CryptoService);
    });
  });

  describe('Constants Usage', () => {
    it('should use documented cryptographic constants', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Verify nonce length (should be 12 bytes)
      expect(encrypted.nonce.length).toBe(12);

      // Verify ciphertext has auth tag (should be at least 16 bytes)
      expect(encrypted.ciphertext.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe('Error Handling', () => {
    it('should handle factory initialization errors', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        environment: 'production',
      };

      await expect(createCryptoService(config)).rejects.toThrow(
        'Falha ao inicializar CryptoService',
      );
    });

    it('should handle invalid buffer formats', async () => {
      const config: SecurityConfig = {
        enableEncryption: true,
        enableCompression: false,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
      };

      const service = new CryptoService(config);
      await service.initialize(randomBytes(32));

      const plaintext = Buffer.from('test');
      const encrypted = await service.encrypt(plaintext);

      // Create invalid format
      const invalidFormat = {
        ...encrypted,
        nonce: 'invalid-format',
        ciphertext: 'invalid-format',
      };

      await expect(service.decrypt(invalidFormat as any)).rejects.toThrow(
        'Falha ao descriptografar dados',
      );
    });
  });
});
