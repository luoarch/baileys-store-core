/**
 * @baileys-store/core - Codec Service
 *
 * Pipeline: Object → JSON estável → Compressão → Buffer
 *
 * Serialização:
 * - JSON.stringify com chaves ordenadas (stable stringify)
 * - Preserva tipos nativos (Date, Buffer, etc) via BufferJSON
 *
 * Compressão:
 * - Snappy (preferencial, requer @napi-rs/snappy)
 * - Gzip (fallback, built-in Node.js)
 */

import { gzipSync, gunzipSync } from 'zlib';
import { BufferJSON } from '@whiskeysockets/baileys';
import type { SecurityConfig } from '../types/index.js';
import { CompressionError } from '../types/index.js';

// Tentar importar Snappy (pode falhar se não instalado)
let snappyModule: unknown = null;

async function loadSnappyModule(): Promise<unknown> {
  if (snappyModule !== null) return snappyModule;

  try {
    const module = await import('@napi-rs/snappy');
    // ESM/CJS interop: use 'in' operator instead of ??
    snappyModule = 'default' in module ? module.default : module;
  } catch {
    // Snappy não disponível - usar null em vez de false
    snappyModule = null;
  }

  return snappyModule;
}

/**
 * Interface de compressor
 */
interface Compressor {
  compress(data: Buffer): Buffer | Promise<Buffer>;
  decompress(data: Buffer): Buffer | Promise<Buffer>;
  name: string;
  isAvailable?(): boolean | Promise<boolean>;
}

/**
 * Compressor Gzip (built-in)
 */
class GzipCompressor implements Compressor {
  name = 'gzip';

  compress(data: Buffer): Buffer {
    return gzipSync(data, { level: 6 }); // Balanceado
  }

  decompress(data: Buffer): Buffer {
    return gunzipSync(data);
  }
}

/**
 * Compressor Snappy (requer @napi-rs/snappy)
 */
class SnappyCompressor implements Compressor {
  name = 'snappy';
  private gzipFallback = new GzipCompressor();

  async compress(data: Buffer): Promise<Buffer> {
    const module = await loadSnappyModule();
    if (module === null || typeof module !== 'object') {
      // Silent fallback - Snappy not available
      return this.gzipFallback.compress(data);
    }

    if ('compressSync' in module) {
      return (module as { compressSync: (data: Buffer) => Buffer }).compressSync(data);
    }

    // Silent fallback - Snappy API not available
    return this.gzipFallback.compress(data);
  }

  async decompress(data: Buffer): Promise<Buffer> {
    const module = await loadSnappyModule();
    if (module === null || typeof module !== 'object') {
      // Silent fallback - Snappy not available
      return this.gzipFallback.decompress(data);
    }

    if ('uncompressSync' in module) {
      return (module as { uncompressSync: (data: Buffer) => Buffer }).uncompressSync(data);
    }

    // Silent fallback - Snappy API not available
    return this.gzipFallback.decompress(data);
  }

  async isAvailable(): Promise<boolean> {
    const module = await loadSnappyModule();
    return module !== null;
  }
}

/**
 * Compressor nulo (sem compressão)
 */
class NoOpCompressor implements Compressor {
  name = 'none';

  compress(data: Buffer): Buffer {
    return data;
  }

  decompress(data: Buffer): Buffer {
    return data;
  }
}

/**
 * CodecService - Serviço de codificação/decodificação
 */
export class CodecService {
  private compressor: Compressor;
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
    this.compressor = this.selectCompressor();
  }

  /**
   * Seleciona compressor baseado na configuração
   */
  private selectCompressor(): Compressor {
    if (!this.config.enableCompression) {
      return new NoOpCompressor();
    }

    switch (this.config.compressionAlgorithm) {
      case 'snappy': {
        // Snappy será testado dinamicamente no primeiro uso
        return new SnappyCompressor();
      }

      case 'gzip':
        return new GzipCompressor();

      case 'lz4':
        // Fallback to gzip if LZ4 not available (silent)
        return new GzipCompressor();

      default:
        return new GzipCompressor();
    }
  }

  /**
   * Encode: Object → Buffer comprimido
   */
  async encode(obj: unknown): Promise<Buffer> {
    try {
      // 1. Serializar para JSON estável
      const json = this.stableStringify(obj);
      const buffer = Buffer.from(json, 'utf-8');

      // 2. Comprimir
      const compressed = await this.compressor.compress(buffer);

      return compressed;
    } catch (error) {
      throw new CompressionError(
        'Falha ao codificar dados',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Decode: Buffer comprimido → Object
   */
  async decode<T = unknown>(buffer: Buffer): Promise<T> {
    try {
      // 1. Descomprimir
      const decompressed = await this.compressor.decompress(buffer);

      // 2. Deserializar de JSON
      const json = decompressed.toString('utf-8');
      const obj = this.stableParse(json);

      return obj as T;
    } catch (error) {
      throw new CompressionError(
        'Falha ao decodificar dados',
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * JSON.stringify estável (chaves ordenadas)
   * Importante para garantir mesma saída para mesmo input
   */
  private stableStringify(obj: unknown): string {
    return JSON.stringify(obj, this.stableReplacer);
  }

  /**
   * Replacer para JSON.stringify que ordena chaves
   */
  private stableReplacer = (_key: string, value: unknown): unknown => {
    // Preservar tipos especiais (BufferJSON do Baileys)
    if (value && typeof value === 'object') {
      if (Buffer.isBuffer(value)) {
        return BufferJSON.replacer(null as unknown as string, value);
      }

      // Ordenar chaves de objetos
      if (!Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(value).sort();
        for (const k of keys) {
          sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
      }
    }

    return value;
  };

  /**
   * JSON.parse com reviver para tipos especiais
   * CRITICAL FIX: Recursively convert nested Buffer objects
   */
  private stableParse(json: string): unknown {
    const parsed = JSON.parse(json, BufferJSON.reviver) as unknown;
    return this.deepBufferRevive(parsed);
  }

  /**
   * Recursively convert Buffer-like objects to actual Buffers
   * RC.6 Fix: Baileys noise-handler requires real Buffer instances
   */
  private deepBufferRevive(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Check if it's a Buffer-like object {type: 'Buffer', data: [...]}
    if (
      typeof obj === 'object' &&
      'type' in obj &&
      obj.type === 'Buffer' &&
      'data' in obj &&
      Array.isArray(obj.data)
    ) {
      return Buffer.from(obj.data as number[]);
    }

    // Recursively process arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepBufferRevive(item));
    }

    // Recursively process objects
    if (typeof obj === 'object' && obj.constructor === Object) {
      const result: Record<string, unknown> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.deepBufferRevive((obj as Record<string, unknown>)[key]);
        }
      }
      return result;
    }

    return obj;
  }

  /**
   * Obtém estatísticas do compressor
   */
  getStats(): {
    compressor: string;
    enabled: boolean;
  } {
    return {
      compressor: this.compressor.name,
      enabled: this.config.enableCompression,
    };
  }

  /**
   * Testa taxa de compressão com dados de exemplo
   */
  async testCompressionRatio(sampleData: unknown): Promise<{
    originalSize: number;
    compressedSize: number;
    ratio: number;
    compressor: string;
  }> {
    const json = this.stableStringify(sampleData);
    const original = Buffer.from(json, 'utf-8');
    const compressed = await this.compressor.compress(original);

    return {
      originalSize: original.length,
      compressedSize: compressed.length,
      ratio: 1 - compressed.length / original.length,
      compressor: this.compressor.name,
    };
  }
}

/**
 * Factory para criar CodecService
 */
export function createCodecService(config: SecurityConfig): CodecService {
  return new CodecService(config);
}
