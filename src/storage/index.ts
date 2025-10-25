/**
 * @baileys-store/core - Storage Utilities
 *
 * Utilitários compartilhados para storage:
 * - Serialization helpers (BufferJSON)
 * - Retry logic with exponential backoff
 * - TTL helpers
 */

import { BufferJSON } from '@whiskeysockets/baileys';

/**
 * Helper para serializar objeto com BufferJSON
 */
export function serializeWithBuffer(obj: unknown): string {
  return JSON.stringify(obj, BufferJSON.replacer);
}

/**
 * Helper para deserializar objeto com BufferJSON
 */
export function deserializeWithBuffer(json: string): unknown {
  return JSON.parse(json, BufferJSON.reviver);
}

/**
 * Helper para retry com backoff exponencial
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    multiplier: number;
    onRetry?: (attempt: number, error: Error) => void;
  },
): Promise<T> {
  const { maxRetries, baseDelay, multiplier, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(multiplier, attempt);
        onRetry?.(attempt + 1, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}

/**
 * Helper para calcular TTL isócrono (mesmo timestamp de expiração)
 */
export function calculateExpiresAt(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

/**
 * Helper para calcular TTL em milissegundos para Redis PXAT
 */
export function calculatePXAT(expiresAt: Date): number {
  return expiresAt.getTime();
}

/**
 * Helper para verificar se valor expirou
 */
export function isExpired(expiresAt: Date): boolean {
  return expiresAt < new Date();
}
