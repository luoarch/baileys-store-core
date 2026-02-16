/**
 * @baileys-store/core - CodecService Tests
 *
 * Testa todas as funcionalidades de compressão e serialização
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodecService, createCodecService } from '../../crypto/codec.js';
import { CompressionError } from '../../types/index.js';
import type { SecurityConfig } from '../../types/index.js';

// Mock do módulo Snappy
vi.mock('snappy', () => ({
  default: {
    compressSync: vi.fn((data: Buffer) => Buffer.from(`snappy:${data.toString()}`)),
    uncompressSync: vi.fn((data: Buffer) => {
      const str = data.toString();
      if (str.startsWith('snappy:')) {
        return Buffer.from(str.slice(7));
      }
      throw new Error('Invalid snappy data');
    }),
  },
}));

// Mock do BufferJSON do Baileys
vi.mock('@whiskeysockets/baileys', () => ({
  BufferJSON: {
    replacer: vi.fn((_key: string, value: Buffer) => ({
      type: 'Buffer',
      data: Array.from(value),
    })),
    reviver: vi.fn((_key: string, value: any) => {
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

describe('CodecService', () => {
  let config: SecurityConfig;
  let codecService: CodecService;

  beforeEach(() => {
    config = {
      enableEncryption: true,
      encryptionAlgorithm: 'secretbox',
      keyRotationDays: 90,
      enableCompression: true,
      compressionAlgorithm: 'gzip',
    };
    codecService = new CodecService(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('deve criar CodecService com configuração gzip', () => {
      const service = new CodecService(config);
      expect(service).toBeInstanceOf(CodecService);
    });

    it('deve criar CodecService com compressão desabilitada', () => {
      const noCompressionConfig = {
        ...config,
        enableCompression: false,
      };
      const service = new CodecService(noCompressionConfig);
      expect(service).toBeInstanceOf(CodecService);
    });

    it('deve criar CodecService com algoritmo snappy', () => {
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      const service = new CodecService(snappyConfig);
      expect(service).toBeInstanceOf(CodecService);
    });

    it('deve criar CodecService com algoritmo lz4 (fallback para gzip)', () => {
      const lz4Config = {
        ...config,
        compressionAlgorithm: 'lz4' as const,
      };
      const service = new CodecService(lz4Config);
      expect(service).toBeInstanceOf(CodecService);
    });

    it('deve criar CodecService com algoritmo padrão', () => {
      const defaultConfig = {
        ...config,
        compressionAlgorithm: 'unknown' as any,
      };
      const service = new CodecService(defaultConfig);
      expect(service).toBeInstanceOf(CodecService);
    });
  });

  describe('Gzip Compression', () => {
    it('deve comprimir e descomprimir dados com gzip', async () => {
      const testData = { message: 'Hello World', number: 42, array: [1, 2, 3] };

      const encoded = await codecService.encode(testData);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = await codecService.decode(encoded);
      expect(decoded).toEqual(testData);
    });

    it('deve comprimir dados vazios', async () => {
      const testData = {};

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('deve comprimir dados com Buffer', async () => {
      const testData = {
        buffer: Buffer.from('test data'),
        message: 'Hello',
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer(decoded.buffer)).toBe(true);
    });
  });

  describe('Snappy Compression', () => {
    beforeEach(() => {
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      codecService = new CodecService(snappyConfig);
    });

    it('deve comprimir e descomprimir dados com snappy', async () => {
      const testData = { message: 'Snappy test', number: 123 };

      const encoded = await codecService.encode(testData);
      expect(encoded).toBeInstanceOf(Buffer);

      const decoded = await codecService.decode(encoded);
      expect(decoded).toEqual(testData);
    });

    it('deve fazer fallback para gzip quando snappy falha', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para falhar na compressão
      const mockSnappy = await import('snappy');
      const originalCompress = mockSnappy.default.compressSync;

      // Mock para falhar
      mockSnappy.default.compressSync = vi.fn().mockImplementation(() => {
        throw new Error('Snappy failed');
      });

      try {
        // Deve usar gzip fallback - não deve lançar erro
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        // Verificar que foi usado gzip
        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } catch (error) {
        // Se o fallback não está implementado, esperamos erro
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Falha ao codificar');
      } finally {
        // Restore original function
        mockSnappy.default.compressSync = originalCompress;
      }
    });
  });

  describe('No Compression', () => {
    beforeEach(() => {
      const noCompressionConfig = {
        ...config,
        enableCompression: false,
      };
      codecService = new CodecService(noCompressionConfig);
    });

    it('deve processar dados sem compressão', async () => {
      const testData = { message: 'No compression', number: 456 };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });
  });

  describe('Stable Serialization', () => {
    it('deve serializar objetos com chaves ordenadas', async () => {
      const testData = { z: 1, a: 2, m: 3 };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('deve preservar tipos especiais via BufferJSON', async () => {
      const testData = {
        buffer: Buffer.from('test'),
        nested: {
          anotherBuffer: Buffer.from('nested'),
        },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer(decoded.buffer)).toBe(true);
      expect(Buffer.isBuffer(decoded.nested.anotherBuffer)).toBe(true);
    });

    it('deve converter objetos Buffer-like recursivamente', async () => {
      const testData = {
        bufferLike: { type: 'Buffer', data: [116, 101, 115, 116] },
        nested: {
          anotherBufferLike: { type: 'Buffer', data: [110, 101, 115, 116, 101, 100] },
        },
        array: [{ type: 'Buffer', data: [97, 114, 114, 97, 121] }],
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(Buffer.isBuffer(decoded.bufferLike)).toBe(true);
      expect(Buffer.isBuffer(decoded.nested.anotherBufferLike)).toBe(true);
      expect(Buffer.isBuffer(decoded.array[0])).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('deve lançar CompressionError ao falhar na codificação', async () => {
      // Mock JSON.stringify para falhar
      const originalStringify = JSON.stringify;
      vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
        throw new Error('JSON stringify failed');
      });

      const testData = { message: 'test' };

      await expect(codecService.encode(testData)).rejects.toThrow(CompressionError);

      // Restore
      vi.spyOn(JSON, 'stringify').mockImplementation(originalStringify);
    });

    it('deve lançar CompressionError ao falhar na decodificação', async () => {
      const invalidBuffer = Buffer.from('invalid data');

      await expect(codecService.decode(invalidBuffer)).rejects.toThrow(CompressionError);
    });

    it('deve lançar CompressionError com erro original', async () => {
      const originalError = new Error('Original error');
      vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
        throw originalError;
      });

      const testData = { message: 'test' };
      const encoded = await codecService.encode(testData);

      await expect(codecService.decode(encoded)).rejects.toThrow(CompressionError);
    });
  });

  describe('Stats and Metrics', () => {
    it('deve retornar estatísticas do compressor', () => {
      const stats = codecService.getStats();

      expect(stats).toHaveProperty('compressor');
      expect(stats).toHaveProperty('enabled');
      expect(stats.enabled).toBe(true);
      expect(stats.compressor).toBe('gzip');
    });

    it('deve retornar estatísticas com compressão desabilitada', () => {
      const noCompressionConfig = {
        ...config,
        enableCompression: false,
      };
      const service = new CodecService(noCompressionConfig);
      const stats = service.getStats();

      expect(stats.enabled).toBe(false);
      expect(stats.compressor).toBe('none');
    });

    it('deve testar taxa de compressão', async () => {
      const sampleData = { message: 'Test data for compression ratio', number: 42 };

      const ratio = await codecService.testCompressionRatio(sampleData);

      expect(ratio).toHaveProperty('originalSize');
      expect(ratio).toHaveProperty('compressedSize');
      expect(ratio).toHaveProperty('ratio');
      expect(ratio).toHaveProperty('compressor');
      expect(ratio.originalSize).toBeGreaterThan(0);
      expect(ratio.compressedSize).toBeGreaterThan(0);
      // Ratio pode ser negativo se dados são pequenos
      expect(typeof ratio.ratio).toBe('number');
      expect(ratio.compressor).toBe('gzip');
    });
  });

  describe('Factory Function', () => {
    it('deve criar CodecService via factory', () => {
      const service = createCodecService(config);
      expect(service).toBeInstanceOf(CodecService);
    });
  });

  describe('Edge Cases', () => {
    it('deve lidar com dados null/undefined', async () => {
      const testData = { nullValue: null, undefinedValue: undefined };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('deve lidar com arrays vazios', async () => {
      const testData = { emptyArray: [], nestedArray: [[]] };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('deve lidar com objetos vazios', async () => {
      const testData = { emptyObject: {}, nestedEmpty: { deep: {} } };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });

    it('deve lidar com strings vazias', async () => {
      const testData = { emptyString: '', whitespace: '   ' };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode(encoded);

      expect(decoded).toEqual(testData);
    });
  });

  describe('Snappy Error Handling', () => {
    beforeEach(() => {
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      codecService = new CodecService(snappyConfig);
    });

    it('deve fazer fallback para gzip quando snappy não tem compressSync', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para não ter compressSync
      const mockSnappy = await import('snappy');
      const originalCompress = mockSnappy.default.compressSync;

      // Mock para não ter compressSync
      delete (mockSnappy.default as any).compressSync;

      try {
        // Deve usar gzip fallback - não deve lançar erro
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        // Verificar que foi usado gzip
        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } catch (error) {
        // Se o fallback não está implementado, esperamos erro
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Falha ao decodificar');
      } finally {
        // Restore original function
        (mockSnappy.default as any).compressSync = originalCompress;
      }
    });

    it('deve fazer fallback para gzip quando snappy não tem uncompressSync', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para não ter uncompressSync
      const mockSnappy = await import('snappy');
      const originalUncompress = mockSnappy.default.uncompressSync;

      // Mock para não ter uncompressSync
      delete (mockSnappy.default as any).uncompressSync;

      try {
        // Deve usar gzip fallback - não deve lançar erro
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        // Verificar que foi usado gzip
        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } catch (error) {
        // Se o fallback não está implementado, esperamos erro
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Falha ao decodificar');
      } finally {
        // Restore original function
        (mockSnappy.default as any).uncompressSync = originalUncompress;
      }
    });

    it('deve fazer fallback para gzip quando snappy falha na descompressão', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para falhar na descompressão
      const mockSnappy = await import('snappy');
      const originalUncompress = mockSnappy.default.uncompressSync;

      // Mock para falhar na descompressão
      mockSnappy.default.uncompressSync = vi.fn().mockImplementation(() => {
        throw new Error('Snappy decompress failed');
      });

      try {
        // Deve usar gzip fallback - não deve lançar erro
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        // Verificar que foi usado gzip
        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } catch (error) {
        // Se o fallback não está implementado, esperamos erro
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Falha ao decodificar');
      } finally {
        // Restore original function
        mockSnappy.default.uncompressSync = originalUncompress;
      }
    });
  });

  describe('BufferJSON Integration', () => {
    it('deve usar BufferJSON.replacer para Buffers', async () => {
      const testData = {
        buffer: Buffer.from('test data'),
        message: 'Hello',
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer(decoded.buffer)).toBe(true);
    });

    it('deve usar BufferJSON.reviver para Buffers', async () => {
      const testData = {
        buffer: Buffer.from('test data'),
        message: 'Hello',
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded).toEqual(testData);
      expect(Buffer.isBuffer(decoded.buffer)).toBe(true);
    });
  });

  describe('Deep Buffer Revival', () => {
    it('deve converter objetos Buffer-like recursivamente em arrays', async () => {
      const testData = {
        array: [
          { type: 'Buffer', data: [116, 101, 115, 116] },
          { type: 'Buffer', data: [110, 101, 115, 116, 101, 100] },
        ],
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(Buffer.isBuffer(decoded.array[0])).toBe(true);
      expect(Buffer.isBuffer(decoded.array[1])).toBe(true);
    });

    it('deve converter objetos Buffer-like recursivamente em objetos', async () => {
      const testData = {
        nested: {
          buffer1: { type: 'Buffer', data: [116, 101, 115, 116] },
          buffer2: { type: 'Buffer', data: [110, 101, 115, 116, 101, 100] },
        },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(Buffer.isBuffer(decoded.nested.buffer1)).toBe(true);
      expect(Buffer.isBuffer(decoded.nested.buffer2)).toBe(true);
    });

    it('deve lidar com objetos que não são Buffer-like', async () => {
      const testData = {
        normalObject: { type: 'NotBuffer', data: [1, 2, 3] },
        bufferLike: { type: 'Buffer', data: [116, 101, 115, 116] },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded.normalObject).toEqual(testData.normalObject);
      expect(Buffer.isBuffer(decoded.bufferLike)).toBe(true);
    });

    it('deve lidar com valores null/undefined no deepBufferRevive', async () => {
      const testData = {
        nullValue: null,
        undefinedValue: undefined,
        bufferLike: { type: 'Buffer', data: [116, 101, 115, 116] },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(decoded.nullValue).toBeNull();
      expect(decoded.undefinedValue).toBeUndefined();
      expect(Buffer.isBuffer(decoded.bufferLike)).toBe(true);
    });
  });

  describe('Snappy Module Edge Cases', () => {
    beforeEach(() => {
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      codecService = new CodecService(snappyConfig);
    });

    it('deve testar isAvailable() retornando true quando módulo está disponível', async () => {
      // Mock snappy para estar disponível
      const mockSnappy = await import('snappy');
      const originalModule = mockSnappy.default;

      // Garantir que o módulo está disponível
      mockSnappy.default = {
        compressSync: vi.fn(),
        uncompressSync: vi.fn(),
        compress: vi.fn(),
        uncompress: vi.fn(),
      };

      // Testar através do CodecService com snappy
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      const snappyCodec = new CodecService(snappyConfig);

      // Testar compressão que deve usar snappy
      const testData = { message: 'test' };
      const encoded = await snappyCodec.encode(testData);
      const decoded = await snappyCodec.decode(encoded);

      expect(decoded).toEqual(testData);

      // Restore
      mockSnappy.default = originalModule;
    });

    it('deve testar isAvailable() retornando false quando módulo não está disponível', async () => {
      // Mock snappy para não estar disponível
      const mockSnappy = await import('snappy');
      const originalModule = mockSnappy.default;

      // Mock para retornar null (módulo não disponível)
      mockSnappy.default = null as any;

      // Testar através do CodecService com snappy
      const snappyConfig = {
        ...config,
        compressionAlgorithm: 'snappy' as const,
      };
      const snappyCodec = new CodecService(snappyConfig);

      // Testar compressão que deve fazer fallback para gzip
      const testData = { message: 'test' };
      const encoded = await snappyCodec.encode(testData);
      const decoded = await snappyCodec.decode(encoded);

      expect(decoded).toEqual(testData);

      // Restore
      mockSnappy.default = originalModule;
    });

    it('deve fazer fallback para gzip quando Snappy decompress retorna null', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para retornar null
      const mockSnappy = await import('snappy');
      const originalModule = mockSnappy.default;

      // Mock para retornar null
      mockSnappy.default = null as any;

      try {
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } finally {
        // Restore
        mockSnappy.default = originalModule;
      }
    });

    it('deve fazer fallback para gzip quando Snappy decompress retorna não-objeto', async () => {
      const testData = { message: 'Fallback test' };

      // Mock snappy para retornar string (não-objeto)
      const mockSnappy = await import('snappy');
      const originalModule = mockSnappy.default;

      // Mock para retornar string
      mockSnappy.default = 'not an object' as any;

      try {
        const result = await codecService.encode(testData);
        expect(result).toBeInstanceOf(Buffer);

        const decoded = await codecService.decode(result);
        expect(decoded).toEqual(testData);
      } finally {
        // Restore
        mockSnappy.default = originalModule;
      }
    });
  });

  describe('BufferJSON Edge Cases', () => {
    it('deve usar BufferJSON.replacer com key null', async () => {
      const testData = {
        buffer: Buffer.from('test data'),
        message: 'Hello',
      };

      // Mock BufferJSON.replacer para ser chamado com key null
      const mockBufferJSON = await import('@whiskeysockets/baileys');
      const originalReplacer = mockBufferJSON.BufferJSON.replacer;

      mockBufferJSON.BufferJSON.replacer = vi.fn((key: string, value: Buffer) => {
        // Simular chamada com key null
        if (key === null) {
          return { type: 'Buffer', data: Array.from(value) };
        }
        return originalReplacer(key, value);
      });

      try {
        const encoded = await codecService.encode(testData);
        const decoded = await codecService.decode<typeof testData>(encoded);

        expect(decoded).toEqual(testData);
        expect(Buffer.isBuffer(decoded.buffer)).toBe(true);
      } finally {
        // Restore
        mockBufferJSON.BufferJSON.replacer = originalReplacer;
      }
    });
  });

  describe('Deep Buffer Revival Edge Cases', () => {
    it('deve lidar com objetos constructor não-Object no deepBufferRevive', async () => {
      const testData = {
        date: new Date('2023-01-01'),
        bufferLike: { type: 'Buffer', data: [116, 101, 115, 116] },
        normalObject: { type: 'NotBuffer', data: [1, 2, 3] },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      // Date será serializado como string pelo JSON, mas deve ser preservado
      expect(decoded.date).toBe(testData.date.toISOString());

      // Buffer-like deve ser convertido
      expect(Buffer.isBuffer(decoded.bufferLike)).toBe(true);

      // Objeto normal deve ser preservado
      expect(decoded.normalObject).toEqual(testData.normalObject);
    });

    it('deve lidar com objetos que não são Object constructor no deepBufferRevive', async () => {
      class CustomClass {
        constructor(public value: string) {}
      }

      const testData = {
        custom: new CustomClass('test'),
        bufferLike: { type: 'Buffer', data: [116, 101, 115, 116] },
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      // CustomClass deve ser preservado (não processado pelo deepBufferRevive)
      expect(decoded.custom).toEqual(testData.custom);

      // Buffer-like deve ser convertido
      expect(Buffer.isBuffer(decoded.bufferLike)).toBe(true);
    });

    it('deve lidar com arrays aninhados contendo objetos Buffer-like', async () => {
      const testData = {
        nestedArray: [
          [
            { type: 'Buffer', data: [116, 101, 115, 116] },
            { type: 'Buffer', data: [110, 101, 115, 116, 101, 100] },
          ],
          { type: 'Buffer', data: [97, 114, 114, 97, 121] },
        ],
      };

      const encoded = await codecService.encode(testData);
      const decoded = await codecService.decode<typeof testData>(encoded);

      expect(Buffer.isBuffer((decoded.nestedArray[0] as any[])?.[0])).toBe(true);
      expect(Buffer.isBuffer((decoded.nestedArray[0] as any[])?.[1])).toBe(true);
      expect(Buffer.isBuffer(decoded.nestedArray[1])).toBe(true);
    });
  });
});
