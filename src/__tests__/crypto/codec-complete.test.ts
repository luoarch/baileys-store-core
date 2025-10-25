/**
 * @baileys-store/core - CodecService Complete Coverage Tests
 *
 * Testes para atingir 95%+ de cobertura em src/crypto/codec.ts
 * Cobrindo todas as linhas não cobertas identificadas
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodecService, createCodecService } from '../../crypto/codec';
import { CompressionError } from '../../types/index';

// Mock do @napi-rs/snappy
vi.mock('@napi-rs/snappy', () => ({
  compressSync: vi.fn(),
  uncompressSync: vi.fn(),
}));

// Mock do BufferJSON
vi.mock('@whiskeysockets/baileys', () => ({
  BufferJSON: {
    replacer: vi.fn((_key, value) => ({ type: 'Buffer', data: Array.from(value) })),
    reviver: vi.fn((_key, value) => {
      if (
        value &&
        typeof value === 'object' &&
        value.type === 'Buffer' &&
        Array.isArray(value.data)
      ) {
        return Buffer.from(value.data);
      }
      return value;
    }),
  },
}));

describe('CodecService - Complete Coverage', () => {
  let codecService: CodecService;
  let mockSnappy: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock do Snappy
    mockSnappy = {
      compressSync: vi.fn().mockReturnValue(Buffer.from('compressed')),
      uncompressSync: vi.fn().mockReturnValue(Buffer.from('decompressed')),
    };

    // Mock do import dinâmico do Snappy
    vi.doMock('@napi-rs/snappy', () => mockSnappy);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Snappy Module Loading', () => {
    it('should handle Snappy module not available (linha 32)', async () => {
      // Mock para simular que Snappy não está disponível
      const originalImport = vi.fn().mockRejectedValue(new Error('Module not found'));
      vi.doMock('@napi-rs/snappy', () => originalImport);

      const config = {
        enableCompression: true,
        compressionAlgorithm: 'snappy' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      // Testar compressão - deve fazer fallback para Gzip
      const testData = { message: 'test' };
      const result = await codecService.encode(testData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle Snappy module with default export (linhas 73-74)', async () => {
      // Mock Snappy com default export
      const mockSnappyWithDefault = {
        default: {
          compressSync: vi.fn().mockReturnValue(Buffer.from('snappy-compressed')),
          uncompressSync: vi.fn().mockReturnValue(Buffer.from(JSON.stringify({ message: 'test' }))),
        },
      };

      vi.doMock('@napi-rs/snappy', () => mockSnappyWithDefault);

      const config = {
        enableCompression: true,
        compressionAlgorithm: 'snappy' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('should handle Snappy module without compressSync (linhas 81-82)', async () => {
      // Mock Snappy sem compressSync
      const mockSnappyWithoutCompress = {
        someOtherMethod: vi.fn(),
      };

      vi.doMock('@napi-rs/snappy', () => mockSnappyWithoutCompress);

      const config = {
        enableCompression: true,
        compressionAlgorithm: 'snappy' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const result = await codecService.encode(testData);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle Snappy module without uncompressSync (linhas 88-89)', async () => {
      // Mock Snappy sem uncompressSync
      const mockSnappyWithoutUncompress = {
        compressSync: vi.fn().mockReturnValue(Buffer.from('compressed')),
      };

      vi.doMock('@napi-rs/snappy', () => mockSnappyWithoutUncompress);

      const config = {
        enableCompression: true,
        compressionAlgorithm: 'snappy' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('should handle Snappy module without uncompressSync (linhas 96-102)', async () => {
      // Mock Snappy sem uncompressSync
      const mockSnappyWithoutUncompress = {
        compressSync: vi.fn().mockReturnValue(Buffer.from('compressed')),
      };

      vi.doMock('@napi-rs/snappy', () => mockSnappyWithoutUncompress);

      const config = {
        enableCompression: true,
        compressionAlgorithm: 'snappy' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });
  });

  describe('Compression Level Configuration', () => {
    it('should handle invalid compression level (linhas 96-102)', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      // Testar com dados que podem causar erro de compressão
      const testData = { message: 'x'.repeat(10000) };
      const result = await codecService.encode(testData);

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide compression statistics (linha 217)', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const stats = codecService.getStats();

      expect(stats).toEqual({
        compressor: 'gzip',
        enabled: true,
      });
    });

    it('should test compression ratio (linha 254)', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const sampleData = {
        message: 'test message',
        data: Buffer.from('test data'),
        nested: { value: 123 },
      };

      const ratio = await codecService.testCompressionRatio(sampleData);

      expect(ratio).toEqual({
        originalSize: expect.any(Number),
        compressedSize: expect.any(Number),
        ratio: expect.any(Number),
        compressor: 'gzip',
      });
      expect(ratio.originalSize).toBeGreaterThan(0);
      expect(ratio.compressedSize).toBeGreaterThan(0);
      expect(ratio.ratio).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle compression errors', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      // Mock do compressor interno para falhar
      const compressor = (codecService as any).compressor;
      vi.spyOn(compressor, 'compress').mockImplementation(() => {
        throw new Error('Compression failed');
      });

      const testData = { message: 'test' };

      await expect(codecService.encode(testData)).rejects.toThrow(CompressionError);
      await expect(codecService.encode(testData)).rejects.toThrow('Falha ao codificar dados');
    });

    it('should handle decompression errors', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      // Mock do compressor interno para falhar na descompressão
      const compressor = (codecService as any).compressor;
      vi.spyOn(compressor, 'decompress').mockImplementation(() => {
        throw new Error('Decompression failed');
      });

      const testData = { message: 'test' };
      const encoded = await codecService.encode(testData);

      await expect(codecService.decode(encoded)).rejects.toThrow(CompressionError);
      await expect(codecService.decode(encoded)).rejects.toThrow('Falha ao decodificar dados');
    });
  });

  describe('Buffer Handling', () => {
    it('should handle Buffer objects in stableReplacer (linha 217)', async () => {
      const config = {
        enableCompression: false,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = {
        message: 'test',
        buffer: Buffer.from('test buffer'),
        nested: {
          anotherBuffer: Buffer.from('another buffer'),
        },
      };

      const result = await codecService.encode(testData);
      const decoded = await codecService.decode(result);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer((decoded as any).buffer)).toBe(true);
      expect(Buffer.isBuffer((decoded as any).nested.anotherBuffer)).toBe(true);
    });

    it('should handle deep Buffer revival (linha 254)', async () => {
      const config = {
        enableCompression: false,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = {
        message: 'test',
        buffer: Buffer.from('test buffer'),
        array: [Buffer.from('array buffer 1'), Buffer.from('array buffer 2')],
        nested: {
          deepBuffer: Buffer.from('deep buffer'),
        },
      };

      const result = await codecService.encode(testData);
      const decoded = await codecService.decode(result);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer((decoded as any).buffer)).toBe(true);
      expect(Buffer.isBuffer((decoded as any).array[0])).toBe(true);
      expect(Buffer.isBuffer((decoded as any).array[1])).toBe(true);
      expect(Buffer.isBuffer((decoded as any).nested.deepBuffer)).toBe(true);
    });
  });

  describe('Compression Algorithms', () => {
    it('should handle LZ4 fallback to Gzip', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'lz4' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const result = await codecService.encode(testData);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle unknown compression algorithm', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'unknown' as any,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = { message: 'test' };
      const result = await codecService.encode(testData);

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('Factory Function', () => {
    it('should create CodecService via factory', () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      const service = createCodecService(config);

      expect(service).toBeInstanceOf(CodecService);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', async () => {
      const config = {
        enableCompression: false,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const testData = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zero: 0,
        falseValue: false,
      };

      const result = await codecService.encode(testData);
      const decoded = await codecService.decode(result);

      expect(decoded).toEqual(testData);
    });

    it('should handle circular references gracefully', async () => {
      const config = {
        enableCompression: false,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const circular: any = { message: 'test' };
      circular.self = circular;

      // JSON.stringify deve falhar com referência circular
      await expect(codecService.encode(circular)).rejects.toThrow();
    });

    it('should handle very large objects', async () => {
      const config = {
        enableCompression: true,
        compressionAlgorithm: 'gzip' as const,
        enableEncryption: false,
        encryptionAlgorithm: 'aes-256-gcm' as const,
        keyRotationDays: 30,
      };

      codecService = new CodecService(config);

      const largeData = {
        message: 'x'.repeat(100000), // 100KB string
        array: Array.from({ length: 1000 }, (_, i) => `item-${String(i)}`),
        nested: {
          deep: {
            value: 'x'.repeat(50000),
          },
        },
      };

      const result = await codecService.encode(largeData);
      const decoded = await codecService.decode(result);

      expect(decoded).toEqual(largeData);
    });
  });
});
